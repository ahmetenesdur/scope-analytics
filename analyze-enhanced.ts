#!/usr/bin/env tsx

import "dotenv/config";
import { createPublicClient, http, type Address, type Log, decodeEventLog } from "viem";
import { defineChain } from "viem/utils";
import Database from "better-sqlite3";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { citreaRouterAbi, erc20Abi } from "./abi";

// Load environment variables
const CITREA_RPC_URL = process.env.CITREA_RPC_URL || "https://rpc.testnet.citrea.xyz";
const CITREA_CHAIN_ID = parseInt(process.env.CITREA_CHAIN_ID || "5115", 10);
const DEFAULT_CONTRACT = (process.env.CONTRACT_ADDRESS ||
	"0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556") as Address;
const DB_FILE = process.env.DATABASE_FILE || "citrea_cache.db";
const BATCH_SIZE = BigInt(process.env.BATCH_SIZE || "1000");
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || "1000", 10);
const API_PORT = parseInt(process.env.API_PORT || "3000", 10);
const API_HOST = process.env.API_HOST || "localhost";
const INCLUDE_EVENTS = (process.env.INCLUDE_EVENTS || "false").toLowerCase() === "true";
const EVENTS_LIMIT = parseInt(process.env.EVENTS_LIMIT || "10", 10);
const RECENT_SWAPS_LIMIT = parseInt(process.env.RECENT_SWAPS_LIMIT || "10", 10);

const CITREA_TESTNET = defineChain({
	id: CITREA_CHAIN_ID,
	name: "Citrea Testnet",
	nativeCurrency: { name: "cBTC", symbol: "cBTC", decimals: 18 },
	rpcUrls: { default: { http: [CITREA_RPC_URL] } },
	blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.citrea.xyz" } },
});

interface SwapEventData {
	sender: string;
	amount_in: string;
	amount_out: string;
	token_in: string;
	token_out: string;
	destination: string;
}

interface TokenVolume {
	token: string;
	totalAmount: string;
	normalizedAmount: string;
	swapCount: number;
}

interface TokenPairDetail {
	tokenIn: string;
	tokenOut: string;
	swapCount: number;
	volumeIn: string;
	volumeOut: string;
}

interface EnhancedMetrics {
	uniqueUsers: number;
	uniqueTxCount: number;
	totalFees_cBTC: string;
	totalSwaps: number;
	volumeByToken: {
		inbound: Array<TokenVolume>;
		outbound: Array<TokenVolume>;
	};
	topCallers: Array<{ addr: string; count: number }>;
	topTokenPairs: Array<TokenPairDetail>;
	dailyStats: Array<{
		day: string;
		tx: number;
		uniqueUsers: number;
		swapsTx: number;
		swapsEvent: number;
		fees_cBTC: string;
	}>;
	recentSwaps: Array<{
		tx_hash: string;
		time: string;
		sender: string;
		tokenIn: string;
		tokenOut: string;
		amountIn: string;
		amountOut: string;
	}>;
	swapEvents?: Array<SwapEventData>;
	range: { firstBlock: number | null; lastBlock: number | null; lastUpdatedAt: string | null };
}

// Initialize database with events table
function initDatabase(): Database.Database {
	const db = new Database(DB_FILE);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");

	db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      tx_hash TEXT PRIMARY KEY,
      block_number INTEGER NOT NULL,
      from_address TEXT NOT NULL,
      gas_used TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_block_number ON logs(block_number);
    CREATE INDEX IF NOT EXISTS idx_from_address ON logs(from_address);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON logs(timestamp);

    CREATE TABLE IF NOT EXISTS fees (
      tx_hash TEXT PRIMARY KEY,
      fee_wei TEXT NOT NULL,
      FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_fee_tx_hash ON fees(tx_hash);

    CREATE TABLE IF NOT EXISTS token_metadata (
      address TEXT PRIMARY KEY,
      decimals INTEGER NOT NULL,
      symbol TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_token_metadata_address ON token_metadata(address);
    
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

	// Migration: if legacy swap_events without log_index exists, migrate to v2
	try {
		const cols = db.prepare("PRAGMA table_info(swap_events)").all() as Array<{ name: string }>;
		const tableExists = cols.length > 0;
		const hasLogIndex = cols.some((c) => c.name.toLowerCase() === "log_index");
		const hasId = cols.some((c) => c.name.toLowerCase() === "id");
		if (!tableExists) {
			// Fresh create v2 schema
			db.exec(`
            CREATE TABLE IF NOT EXISTS swap_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              tx_hash TEXT NOT NULL,
              log_index INTEGER NOT NULL,
              block_number INTEGER NOT NULL,
              sender TEXT NOT NULL,
              amount_in TEXT NOT NULL,
              amount_out TEXT NOT NULL,
              token_in TEXT NOT NULL,
              token_out TEXT NOT NULL,
              destination TEXT NOT NULL,
              timestamp INTEGER NOT NULL,
              FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
            );
            `);
		} else if (!hasLogIndex || !hasId) {
			db.exec(`
            CREATE TABLE IF NOT EXISTS swap_events_v2 (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              tx_hash TEXT NOT NULL,
              log_index INTEGER NOT NULL,
              block_number INTEGER NOT NULL,
              sender TEXT NOT NULL,
              amount_in TEXT NOT NULL,
              amount_out TEXT NOT NULL,
              token_in TEXT NOT NULL,
              token_out TEXT NOT NULL,
              destination TEXT NOT NULL,
              timestamp INTEGER NOT NULL,
              FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
            );
            `);
			// Copy legacy data with log_index=0 default
			try {
				db.exec(`
                  INSERT INTO swap_events_v2 (tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
                  SELECT tx_hash, 0 as log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp
                  FROM swap_events;
                `);
			} catch {}
			// Replace table
			db.exec(`
              DROP TABLE IF EXISTS swap_events;
              ALTER TABLE swap_events_v2 RENAME TO swap_events;
            `);
		}
		// Ensure indexes exist on the final swap_events schema
		db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_swap_tx_log ON swap_events(tx_hash, log_index);
          CREATE INDEX IF NOT EXISTS idx_token_pair ON swap_events(token_in, token_out);
          CREATE INDEX IF NOT EXISTS idx_sender ON swap_events(sender);
        `);
	} catch {}

	console.log("✓ Database initialized with event decoding support");
	return db;
}

function getMeta(db: Database.Database, key: string): string | null {
	const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

function setMeta(db: Database.Database, key: string, value: string): void {
	db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}

function createCitreaClient() {
	return createPublicClient({
		chain: CITREA_TESTNET,
		transport: http(CITREA_RPC_URL, {
			retryCount: MAX_RETRIES,
			retryDelay: RETRY_DELAY_MS,
		}),
	});
}

async function fetchLogsWithRetry(
	client: ReturnType<typeof createCitreaClient>,
	address: Address,
	fromBlock: bigint,
	toBlock: bigint,
	retries = MAX_RETRIES
): Promise<Log[]> {
	try {
		return await client.getLogs({ address, fromBlock, toBlock });
	} catch (error) {
		if (retries > 0) {
			console.warn(`⚠ RPC error, retrying... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
			await new Promise((resolve) =>
				setTimeout(resolve, RETRY_DELAY_MS * (MAX_RETRIES - retries + 1))
			);
			return fetchLogsWithRetry(client, address, fromBlock, toBlock, retries - 1);
		}
		throw error;
	}
}

/**
 * Scan contract logs incrementally and store in database
 * Supports event decoding, fee calculation, and swap event extraction
 */
export async function scanLogs(
	db: Database.Database,
	client: ReturnType<typeof createCitreaClient>,
	address: Address,
	incremental: boolean
): Promise<void> {
	const latestBlock = await client.getBlockNumber();
	let startBlock = 0n;

	if (incremental) {
		const lastScanned = getMeta(db, "lastScannedBlock");
		if (lastScanned) {
			startBlock = BigInt(lastScanned) + 1n;
			console.log(`📊 Resuming from block ${startBlock.toLocaleString()}`);
		}
	} else {
		console.log("🔄 Full scan mode - scanning from genesis");
	}

	if (startBlock > latestBlock) {
		console.log("✓ Already up to date!");
		return;
	}

	console.log(
		`🔍 Scanning blocks ${startBlock.toLocaleString()} → ${latestBlock.toLocaleString()}`
	);

	const insertLog = db.prepare(`
    INSERT OR IGNORE INTO logs (tx_hash, block_number, from_address, gas_used, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);

	const insertSwap = db.prepare(`
    INSERT OR IGNORE INTO swap_events 
    (tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

	const insertFee = db.prepare(`
    INSERT OR IGNORE INTO fees (tx_hash, fee_wei)
    VALUES (?, ?)
  `);

	// Check if transaction already exists and has missing data
	const checkTxExists = db.prepare(`
    SELECT 
      CASE WHEN EXISTS(SELECT 1 FROM logs WHERE tx_hash = ?) THEN 1 ELSE 0 END as log_exists,
      CASE WHEN EXISTS(SELECT 1 FROM fees WHERE tx_hash = ?) THEN 1 ELSE 0 END as fee_exists,
      CASE WHEN EXISTS(SELECT 1 FROM swap_events WHERE tx_hash = ?) THEN 1 ELSE 0 END as swap_exists
  `);

	let currentBlock = startBlock;
	let processedLogs = 0;
	let processedSwaps = 0;
	let filledMissingFees = 0;
	let filledMissingSwaps = 0;

	while (currentBlock <= latestBlock) {
		const endBlock =
			currentBlock + BATCH_SIZE > latestBlock ? latestBlock : currentBlock + BATCH_SIZE - 1n;

		try {
			const logs = await fetchLogsWithRetry(client, address, currentBlock, endBlock);

			if (logs.length > 0) {
				const logData = await Promise.all(
					logs.map(async (log) => {
						try {
							const [receipt, block] = await Promise.all([
								client.getTransactionReceipt({ hash: log.transactionHash! }),
								client.getBlock({ blockNumber: log.blockNumber! }),
							]);

							const feeWei =
								receipt.gasUsed *
								(receipt as unknown as { effectiveGasPrice: bigint })
									.effectiveGasPrice;
							const feeData = {
								tx_hash: log.transactionHash!,
								fee_wei: feeWei.toString(),
							};

							// Decode swap events from the current log
							const decodedSwaps = [];
							if (log.address.toLowerCase() === address.toLowerCase()) {
								try {
									const decoded = decodeEventLog({
										abi: citreaRouterAbi,
										data: log.data,
										topics: log.topics,
									});
									if (decoded.eventName === "Swap") {
										const args = decoded.args as unknown as SwapEventData;
										decodedSwaps.push({
											tx_hash: log.transactionHash!,
											log_index:
												typeof log.logIndex !== "undefined"
													? Number(log.logIndex)
													: 0,
											block_number: Number(log.blockNumber!),
											sender: args.sender.toLowerCase(),
											amount_in: args.amount_in.toString(),
											amount_out: args.amount_out.toString(),
											token_in: args.token_in.toLowerCase(),
											token_out: args.token_out.toLowerCase(),
											destination: args.destination.toLowerCase(),
											timestamp: Number(block.timestamp),
										});
									}
								} catch {
									/* Not a swap event or decoding failed */
								}
							}

							// If transaction already exists (only in full scan mode), check for missing data and decode all logs from receipt
							// In incremental mode, we only scan new blocks, so existing transactions shouldn't be re-processed
							if (!incremental) {
								const txHash = log.transactionHash!;
								const txStatus = checkTxExists.get(txHash, txHash, txHash) as
									| {
											log_exists: number;
											fee_exists: number;
											swap_exists: number;
									  }
									| undefined;

								// If transaction exists but missing fee, ensure fee data is included
								if (txStatus?.log_exists && !txStatus.fee_exists) {
									filledMissingFees++;
									// Fee data already calculated above, will be inserted
								}

								// If transaction exists but missing swap events, decode all logs from receipt
								if (txStatus?.log_exists && !txStatus.swap_exists && receipt.logs) {
									let foundSwapsInReceipt = 0;
									for (const recLog of receipt.logs) {
										if (
											recLog.address.toLowerCase() === address.toLowerCase()
										) {
											try {
												const decoded = decodeEventLog({
													abi: citreaRouterAbi,
													data: recLog.data,
													topics: recLog.topics,
												});
												if (decoded.eventName === "Swap") {
													const args =
														decoded.args as unknown as SwapEventData;
													decodedSwaps.push({
														tx_hash: txHash,
														log_index:
															typeof recLog.logIndex !== "undefined"
																? Number(recLog.logIndex)
																: 0,
														block_number: Number(log.blockNumber!),
														sender: args.sender.toLowerCase(),
														amount_in: args.amount_in.toString(),
														amount_out: args.amount_out.toString(),
														token_in: args.token_in.toLowerCase(),
														token_out: args.token_out.toLowerCase(),
														destination: args.destination.toLowerCase(),
														timestamp: Number(block.timestamp),
													});
													foundSwapsInReceipt++;
												}
											} catch {
												/* Not a swap event or decoding failed */
											}
										}
									}
									if (foundSwapsInReceipt > 0) {
										filledMissingSwaps++;
									}
								}
							}

							return {
								log: {
									tx_hash: log.transactionHash!,
									block_number: Number(log.blockNumber!),
									from_address: receipt.from.toLowerCase(),
									gas_used: receipt.gasUsed.toString(),
									timestamp: Number(block.timestamp),
								},
								fee: feeData,
								swaps: decodedSwaps,
							};
						} catch (e) {
							console.warn(
								`⚠ Could not process log for ${log.transactionHash!}:`,
								(e as Error).message
							);
							return null;
						}
					})
				);

				const validData = logData.filter((d) => d !== null);

				if (validData.length > 0) {
					const insertMany = db.transaction((data) => {
						for (const item of data) {
							if (item) {
								insertLog.run(
									item.log.tx_hash,
									item.log.block_number,
									item.log.from_address,
									item.log.gas_used,
									item.log.timestamp
								);
								if (item.fee) {
									insertFee.run(item.fee.tx_hash, item.fee.fee_wei);
								}
								for (const swap of item.swaps) {
									insertSwap.run(
										swap.tx_hash,
										swap.log_index,
										swap.block_number,
										swap.sender,
										swap.amount_in,
										swap.amount_out,
										swap.token_in,
										swap.token_out,
										swap.destination,
										swap.timestamp
									);
									processedSwaps++;
								}
							}
						}
					});

					insertMany(validData);
					processedLogs += validData.length;
				}
			}

			const denom = latestBlock - startBlock;
			const progress = denom === 0n ? 100 : Number(((endBlock - startBlock) * 100n) / denom);
			console.log(
				`  Block ${endBlock.toLocaleString()} | ${logs.length} logs | ${processedSwaps} swaps | ${progress.toFixed(1)}% complete`
			);

			currentBlock = endBlock + 1n;
		} catch (error) {
			console.error(`❌ Error scanning blocks ${currentBlock}-${endBlock}:`, error);
			throw error;
		}
	}

	setMeta(db, "lastScannedBlock", latestBlock.toString());

	// Get actual counts from database to show accurate numbers
	const actualTxCount = db.prepare("SELECT COUNT(*) as count FROM logs").get() as {
		count: number;
	};
	const actualSwapCount = db.prepare("SELECT COUNT(*) as count FROM swap_events").get() as {
		count: number;
	};

	let summary = `\n✓ Scan complete! Processed ${processedLogs.toLocaleString()} transactions, ${processedSwaps.toLocaleString()} swap events`;
	summary += `\n  📊 Database now contains: ${actualTxCount.count.toLocaleString()} transactions, ${actualSwapCount.count.toLocaleString()} swap events`;
	if (filledMissingFees > 0 || filledMissingSwaps > 0) {
		summary += `\n  🔧 Filled missing data: ${filledMissingFees} fees, ${filledMissingSwaps} swap events`;
	}
	console.log(summary);
}

function formatWeiToCbtc(wei: bigint, fractionDigits = 6): string {
	const base = 10n ** 18n;
	const integer = wei / base;
	const fraction = wei % base;
	const fracStr = fraction.toString().padStart(18, "0").slice(0, fractionDigits);
	return `${integer.toString()}.${fracStr}`;
}

function sanitizeDecimals(dec: number | bigint): number {
	const n = Number(dec);
	if (!Number.isFinite(n) || n <= 0 || n > 36) return 18;
	return n;
}

async function backfillFees(
	db: Database.Database,
	client: ReturnType<typeof createCitreaClient>,
	batch = 500,
	concurrency = 10
): Promise<{ processed: number; inserted: number }> {
	const countMissingStmt = db.prepare(
		`SELECT COUNT(*) AS cnt
         FROM logs l
         LEFT JOIN fees f ON l.tx_hash = f.tx_hash
         WHERE f.tx_hash IS NULL`
	);
	const totalMissingRow = countMissingStmt.get() as { cnt: number } | undefined;
	const totalMissing = totalMissingRow?.cnt ?? 0;
	if (totalMissing === 0) return { processed: 0, inserted: 0 };

	const selectMissing = db.prepare(
		`SELECT l.tx_hash AS tx_hash
         FROM logs l
         LEFT JOIN fees f ON l.tx_hash = f.tx_hash
         WHERE f.tx_hash IS NULL
         ORDER BY l.block_number ASC
         LIMIT ?`
	);
	const insertFeeLocal = db.prepare(`
        INSERT OR IGNORE INTO fees (tx_hash, fee_wei)
        VALUES (?, ?)
    `);

	let processed = 0;
	let inserted = 0;

	while (true) {
		const rows = selectMissing.all(batch) as Array<{ tx_hash: string }>;
		if (rows.length === 0) break;

		// Process in chunks to limit concurrency
		for (let i = 0; i < rows.length; i += concurrency) {
			const chunk = rows.slice(i, i + concurrency);
			await Promise.all(
				chunk.map(async ({ tx_hash }) => {
					try {
						const receipt = await client.getTransactionReceipt({
							hash: tx_hash as `0x${string}`,
						});
						const eff = (receipt as unknown as { effectiveGasPrice: bigint })
							.effectiveGasPrice;
						const feeWei = receipt.gasUsed * eff;
						insertFeeLocal.run(tx_hash, feeWei.toString());
						inserted++;
					} catch {
						// Skip if receipt not available or effectiveGasPrice missing
					} finally {
						processed++;
					}
				})
			);
		}

		const percent = Math.min(100, (processed / totalMissing) * 100).toFixed(1);
		console.log(
			`  Backfill ${processed}/${totalMissing} | ${inserted} inserted | ${percent}% complete`
		);
		if (rows.length < batch) break;
	}

	return { processed, inserted };
}

async function backfillSwapEvents(
	db: Database.Database,
	client: ReturnType<typeof createCitreaClient>,
	batch = 500,
	concurrency = 10
): Promise<{ processed: number; inserted: number; txWithSwap: number }> {
	const countMissingStmt = db.prepare(
		`SELECT COUNT(*) AS cnt
         FROM logs l
         LEFT JOIN swap_events s ON l.tx_hash = s.tx_hash
         WHERE s.tx_hash IS NULL`
	);
	const totalMissingRow = countMissingStmt.get() as { cnt: number } | undefined;
	const totalMissing = totalMissingRow?.cnt ?? 0;
	if (totalMissing === 0) return { processed: 0, inserted: 0, txWithSwap: 0 };

	const selectMissing = db.prepare(
		`SELECT l.tx_hash AS tx_hash
         FROM logs l
         LEFT JOIN swap_events s ON l.tx_hash = s.tx_hash
         WHERE s.tx_hash IS NULL
         ORDER BY l.block_number ASC
         LIMIT ?`
	);
	const insertSwapLocal = db.prepare(`
        INSERT OR IGNORE INTO swap_events 
        (tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

	let processed = 0;
	let inserted = 0;
	let txWithSwap = 0;

	while (true) {
		const rows = selectMissing.all(batch) as Array<{ tx_hash: string }>;
		if (rows.length === 0) break;

		for (let i = 0; i < rows.length; i += concurrency) {
			const chunk = rows.slice(i, i + concurrency);
			await Promise.all(
				chunk.map(async ({ tx_hash }) => {
					try {
						const receipt = await client.getTransactionReceipt({
							hash: tx_hash as `0x${string}`,
						});
						// decode logs in receipt
						let foundSwapForTx = false;
						for (const recLog of receipt.logs ?? []) {
							try {
								const decoded = decodeEventLog({
									abi: citreaRouterAbi,
									data: recLog.data,
									topics: recLog.topics,
								});
								if (decoded.eventName === "Swap") {
									const args = decoded.args as unknown as {
										sender: string;
										amount_in: bigint;
										amount_out: bigint;
										token_in: string;
										token_out: string;
										destination: string;
									};
									const block = await client.getBlock({
										blockNumber: receipt.blockNumber!,
									});
									insertSwapLocal.run(
										tx_hash,
										typeof recLog.logIndex !== "undefined"
											? Number(recLog.logIndex)
											: 0,
										Number(receipt.blockNumber!),
										args.sender.toLowerCase(),
										args.amount_in.toString(),
										args.amount_out.toString(),
										args.token_in.toLowerCase(),
										args.token_out.toLowerCase(),
										args.destination.toLowerCase(),
										Number(block.timestamp)
									);
									inserted++;
									foundSwapForTx = true;
								}
							} catch {
								// not a Swap event; continue
							}
						}
						if (foundSwapForTx) txWithSwap++;
					} catch {
						// skip on errors
					} finally {
						processed++;
					}
				})
			);
		}

		const percent = Math.min(100, (processed / totalMissing) * 100).toFixed(1);
		console.log(
			`  Backfill(events) ${processed}/${totalMissing} | swaps inserted: ${inserted} | tx with swaps: ${txWithSwap} | ${percent}% complete`
		);

		if (rows.length < batch) break;
	}

	return { processed, inserted, txWithSwap };
}

async function backfillTokenMetadata(
	db: Database.Database,
	client: ReturnType<typeof createCitreaClient>,
	batch = 200,
	concurrency = 10
): Promise<{ processed: number; inserted: number }> {
	const selectMissingTokens = db.prepare(
		`WITH tokens AS (
            SELECT DISTINCT token_in AS address FROM swap_events
            UNION
            SELECT DISTINCT token_out AS address FROM swap_events
        )
        SELECT t.address AS address
        FROM tokens t
        LEFT JOIN token_metadata m ON t.address = m.address
        WHERE m.address IS NULL
        LIMIT ?`
	);
	const insertMeta = db.prepare(
		`INSERT OR IGNORE INTO token_metadata (address, decimals, symbol) VALUES (?, ?, ?)`
	);

	let processed = 0;
	let inserted = 0;

	while (true) {
		const rows = selectMissingTokens.all(batch) as Array<{ address: string }>;
		if (rows.length === 0) break;

		const tokens = rows.map((r) => r.address as Address);

		try {
			const decCalls = tokens.map((address) => ({
				address,
				abi: erc20Abi,
				functionName: "decimals" as const,
			}));
			const symCalls = tokens.map((address) => ({
				address,
				abi: erc20Abi,
				functionName: "symbol" as const,
			}));

			const [decResults, symResults] = await Promise.all([
				client.multicall({ contracts: decCalls, allowFailure: true }),
				client.multicall({ contracts: symCalls, allowFailure: true }),
			]);

			for (let i = 0; i < tokens.length; i++) {
				const address = tokens[i];
				if (!address) {
					processed++;
					continue;
				}
				const decRes = decResults[i] as {
					status: "success" | "failure";
					result?: number | bigint;
				};
				const symRes = symResults[i] as { status: "success" | "failure"; result?: string };

				let decimals: number | bigint = 18;
				let symbol: string = "UNKNOWN";

				if (decRes && decRes.status === "success" && decRes.result !== undefined) {
					decimals = decRes.result as number | bigint;
				}
				if (symRes && symRes.status === "success" && symRes.result !== undefined) {
					symbol = symRes.result as string;
				}

				const symUpper = symbol.toUpperCase();
				let decSan = sanitizeDecimals(decimals);
				if (symUpper === "USDC") decSan = 6;
				else if (symUpper === "USDT") decSan = 6;
				else if (symUpper === "WBTC") decSan = 8;
				else if (symUpper === "WETH") decSan = 18;

				insertMeta.run(address.toLowerCase(), decSan, symbol);
				inserted++;
				processed++;
			}
		} catch {
			for (const addr of tokens) {
				if (!addr) {
					processed++;
					continue;
				}
				try {
					let decimals = await client.readContract({
						address: addr as Address,
						abi: erc20Abi,
						functionName: "decimals",
					});
					let symbol = "";
					try {
						symbol = await client.readContract({
							address: addr as Address,
							abi: erc20Abi,
							functionName: "symbol",
						});
					} catch {
						symbol = "UNKNOWN";
					}
					const symUpper = symbol.toUpperCase();
					let decSan = sanitizeDecimals(decimals);
					if (symUpper === "USDC") decSan = 6;
					else if (symUpper === "USDT") decSan = 6;
					else if (symUpper === "WBTC") decSan = 8;
					else if (symUpper === "WETH") decSan = 18;
					insertMeta.run(addr.toLowerCase(), decSan, symbol);
					inserted++;
				} catch {
					insertMeta.run(addr.toLowerCase(), 18, "UNKNOWN");
					inserted++;
				} finally {
					processed++;
				}
			}
		}

		console.log(`  Backfill(tokens) processed ${processed} | inserted ${inserted}`);
		if (rows.length < batch) break;
	}

	return { processed, inserted };
}

function formatAmount(amount: bigint, decimals: number, fractionDigits = 6): string {
	const base = 10n ** BigInt(decimals);
	const integer = amount / base;
	const fraction = amount % base;
	const fracStr = fraction.toString().padStart(decimals, "0").slice(0, fractionDigits);
	return `${integer.toString()}.${fracStr}`;
}

function calculateEnhancedMetrics(
	db: Database.Database,
	options?: { includeEvents?: boolean; eventsLimit?: number; recentLimit?: number }
): EnhancedMetrics {
	const uniqueUsers = db
		.prepare("SELECT COUNT(DISTINCT from_address) as count FROM logs")
		.get() as { count: number };
	const uniqueTxCount = db.prepare("SELECT COUNT(*) as count FROM logs").get() as {
		count: number;
	};

	let totalFeesWei = 0n;
	try {
		const feeRows = db.prepare("SELECT fee_wei FROM fees").all() as Array<{ fee_wei: string }>;
		for (const row of feeRows) {
			totalFeesWei += BigInt(row.fee_wei);
		}
	} catch {
		// fees table might not exist yet; keep totalFeesWei as 0n
	}
	const totalFees_cBTC = formatWeiToCbtc(totalFeesWei, 6);

	const totalSwaps = db.prepare("SELECT COUNT(*) as count FROM swap_events").get() as {
		count: number;
	};

	const inboundRows = db
		.prepare("SELECT token_in as token, amount_in FROM swap_events")
		.all() as Array<{ token: string; amount_in: string }>;
	const inboundMap = new Map<string, { sum: bigint; count: number }>();
	for (const r of inboundRows) {
		const key = r.token.toLowerCase();
		const cur = inboundMap.get(key) ?? { sum: 0n, count: 0 };
		inboundMap.set(key, { sum: cur.sum + BigInt(r.amount_in), count: cur.count + 1 });
	}
	const volumeInByToken = Array.from(inboundMap.entries())
		.map(([token, { sum, count }]) => ({ token, total: sum, count }))
		.sort((a, b) => b.count - a.count);

	const outboundRows = db
		.prepare("SELECT token_out as token, amount_out FROM swap_events")
		.all() as Array<{ token: string; amount_out: string }>;
	const outboundMap = new Map<string, { sum: bigint; count: number }>();
	for (const r of outboundRows) {
		const key = r.token.toLowerCase();
		const cur = outboundMap.get(key) ?? { sum: 0n, count: 0 };
		outboundMap.set(key, { sum: cur.sum + BigInt(r.amount_out), count: cur.count + 1 });
	}
	const volumeOutByToken = Array.from(outboundMap.entries())
		.map(([token, { sum, count }]) => ({ token, total: sum, count }))
		.sort((a, b) => b.count - a.count);

	// Convert to readable format with proper decimals
	const metaRows = db
		.prepare("SELECT address, decimals, symbol FROM token_metadata")
		.all() as Array<{ address: string; decimals: number; symbol: string }>;
	const decimalsMap = new Map(metaRows.map((m) => [m.address.toLowerCase(), m.decimals]));
	const symbolMap = new Map(metaRows.map((m) => [m.address.toLowerCase(), m.symbol]));

	const volumeByToken = {
		inbound: volumeInByToken.map((v) => {
			const dec = decimalsMap.get(v.token.toLowerCase()) ?? 18;
			const sym = symbolMap.get(v.token.toLowerCase()) ?? "";
			return {
				token: v.token,
				totalAmount: v.total.toString(),
				normalizedAmount: `${formatAmount(v.total, dec, 6)}${sym ? ` (${sym})` : ""}`,
				swapCount: v.count,
			};
		}),
		outbound: volumeOutByToken.map((v) => {
			const dec = decimalsMap.get(v.token.toLowerCase()) ?? 18;
			const sym = symbolMap.get(v.token.toLowerCase()) ?? "";
			return {
				token: v.token,
				totalAmount: v.total.toString(),
				normalizedAmount: `${formatAmount(v.total, dec, 6)}${sym ? ` (${sym})` : ""}`,
				swapCount: v.count,
			};
		}),
	};

	const topCallers = db
		.prepare(
			`
    SELECT from_address as addr, COUNT(*) as count
    FROM logs
    GROUP BY from_address
    ORDER BY count DESC
    LIMIT 10
  `
		)
		.all() as Array<{ addr: string; count: number }>;

	const pairRows = db
		.prepare("SELECT token_in, token_out, amount_in, amount_out FROM swap_events")
		.all() as Array<{
		token_in: string;
		token_out: string;
		amount_in: string;
		amount_out: string;
	}>;
	const pairMap = new Map<
		string,
		{ token_in: string; token_out: string; count: number; volIn: bigint; volOut: bigint }
	>();
	for (const r of pairRows) {
		const key = `${r.token_in.toLowerCase()}|${r.token_out.toLowerCase()}`;
		const cur = pairMap.get(key) ?? {
			token_in: r.token_in,
			token_out: r.token_out,
			count: 0,
			volIn: 0n,
			volOut: 0n,
		};
		cur.count += 1;
		cur.volIn += BigInt(r.amount_in);
		cur.volOut += BigInt(r.amount_out);
		pairMap.set(key, cur);
	}
	const topTokenPairs = Array.from(pairMap.values())
		.sort((a, b) => b.count - a.count)
		.slice(0, 10)
		.map((p) => {
			const decIn = decimalsMap.get(p.token_in.toLowerCase()) ?? 18;
			const decOut = decimalsMap.get(p.token_out.toLowerCase()) ?? 18;
			const symIn = symbolMap.get(p.token_in.toLowerCase()) ?? "";
			const symOut = symbolMap.get(p.token_out.toLowerCase()) ?? "";
			return {
				tokenIn: p.token_in,
				tokenOut: p.token_out,
				swapCount: p.count,
				volumeIn: `${formatAmount(p.volIn, decIn, 6)} (${symIn ? symIn : `${p.token_in.slice(0, 8)}...`})`,
				volumeOut: `${formatAmount(p.volOut, decOut, 6)} (${symOut ? symOut : `${p.token_out.slice(0, 8)}...`})`,
			};
		});

	const feeDailyRows = db
		.prepare(
			`
    SELECT 
      strftime('%Y-%m-%d', l.timestamp, 'unixepoch') as day,
      f.fee_wei as fee_wei
    FROM fees f
    JOIN logs l ON l.tx_hash = f.tx_hash
  `
		)
		.all() as Array<{ day: string; fee_wei: string }>;

	const feesByDayMap = new Map<string, bigint>();
	for (const row of feeDailyRows) {
		const prev = feesByDayMap.get(row.day) ?? 0n;
		feesByDayMap.set(row.day, prev + BigInt(row.fee_wei));
	}

	const dailyStatsRows = db
		.prepare(
			`
    SELECT 
      strftime('%Y-%m-%d', l.timestamp, 'unixepoch') as day,
      COUNT(DISTINCT l.tx_hash) as tx,
      COUNT(DISTINCT l.from_address) as uniqueUsers,
      COUNT(DISTINCT s.tx_hash) as swaps
    FROM logs l
    LEFT JOIN swap_events s ON l.tx_hash = s.tx_hash
    GROUP BY day
    ORDER BY day DESC
  `
		)
		.all() as Array<{ day: string; tx: number; uniqueUsers: number; swaps: number }>;

	// Event-level daily stats (counts Swap events per day)
	const dailyStatsEventRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', s.timestamp, 'unixepoch') AS day,
                    COUNT(*) AS swapsEvent
             FROM swap_events s
             GROUP BY day
             ORDER BY day DESC
             LIMIT 30`
		)
		.all() as Array<{ day: string; swapsEvent: number }>;
	const dailyEventMap = new Map<string, number>(
		dailyStatsEventRows.map((r) => [r.day, r.swapsEvent ?? 0])
	);

	const dailyStats = dailyStatsRows.map((r) => ({
		day: r.day,
		tx: r.tx,
		uniqueUsers: r.uniqueUsers,
		swapsTx: r.swaps,
		swapsEvent: dailyEventMap.get(r.day) ?? 0,
		fees_cBTC: formatWeiToCbtc(feesByDayMap.get(r.day) ?? 0n, 6),
	}));

	const blockRangeRow = db
		.prepare("SELECT MIN(block_number) as first, MAX(block_number) as last FROM logs")
		.get() as { first: number | null; last: number | null };
	const lastTsRow = db.prepare("SELECT MAX(timestamp) as last_ts FROM logs").get() as {
		last_ts: number | null;
	};
	const range = {
		firstBlock: blockRangeRow?.first ?? null,
		lastBlock: blockRangeRow?.last ?? null,
		lastUpdatedAt: lastTsRow?.last_ts ? new Date(lastTsRow.last_ts * 1000).toISOString() : null,
	};

	const includeEvents = options?.includeEvents ?? false;
	const eventsLimit = options?.eventsLimit ?? 10;
	const recentLimit = options?.recentLimit ?? 10;

	const swapEvents = includeEvents
		? (db
				.prepare(
					`
    SELECT sender, amount_in, amount_out, token_in, token_out, destination
    FROM swap_events
    ORDER BY block_number DESC, log_index DESC
    LIMIT ?
  `
				)
				.all(eventsLimit) as Array<SwapEventData>)
		: undefined;

	const recentRows = db
		.prepare(
			`
    SELECT tx_hash, timestamp, sender, amount_in, amount_out, token_in, token_out
    FROM swap_events
    ORDER BY block_number DESC, log_index DESC
    LIMIT ?
  `
		)
		.all(recentLimit) as Array<{
		tx_hash: string;
		timestamp: number;
		sender: string;
		amount_in: string;
		amount_out: string;
		token_in: string;
		token_out: string;
	}>;

	const recentSwaps = recentRows.map((r) => {
		const decIn = decimalsMap.get(r.token_in.toLowerCase()) ?? 18;
		const decOut = decimalsMap.get(r.token_out.toLowerCase()) ?? 18;
		const symIn = symbolMap.get(r.token_in.toLowerCase()) ?? "";
		const symOut = symbolMap.get(r.token_out.toLowerCase()) ?? "";
		const amountInNorm = `${formatAmount(BigInt(r.amount_in), decIn, 6)}${symIn ? ` (${symIn})` : ""}`;
		const amountOutNorm = `${formatAmount(BigInt(r.amount_out), decOut, 6)}${symOut ? ` (${symOut})` : ""}`;
		const time = new Date(r.timestamp * 1000).toISOString();
		return {
			tx_hash: r.tx_hash,
			time,
			sender: r.sender,
			tokenIn: r.token_in,
			tokenOut: r.token_out,
			amountIn: amountInNorm,
			amountOut: amountOutNorm,
		};
	});

	return {
		uniqueUsers: uniqueUsers.count,
		uniqueTxCount: uniqueTxCount.count,
		totalFees_cBTC,
		totalSwaps: totalSwaps.count,
		volumeByToken,
		topCallers,
		topTokenPairs,
		dailyStats,
		recentSwaps,
		...(includeEvents && swapEvents ? { swapEvents } : {}),
		range,
	};
}

function startServer(db: Database.Database, port = API_PORT): void {
	const server = createServer((req, res) => {
		if (req.url === "/metrics" && req.method === "GET") {
			try {
				const metrics = calculateEnhancedMetrics(db, {
					includeEvents: INCLUDE_EVENTS,
					eventsLimit: EVENTS_LIMIT,
					recentLimit: RECENT_SWAPS_LIMIT,
				});
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(metrics, null, 2));
			} catch (error) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Failed to calculate metrics" }));
			}
		} else {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		}
	});

	server.listen(port, () => {
		console.log(`\n🚀 Server running at http://${API_HOST}:${port}/metrics`);
	});
}

function parseArgs(): {
	address: Address;
	incremental: boolean;
	serve: boolean;
	export?: string;
	includeEvents?: boolean;
	eventsLimit?: number;
	recentLimit?: number;
} {
	const args = process.argv.slice(2);
	const parsed: {
		address: Address;
		incremental: boolean;
		serve: boolean;
		export?: string;
		includeEvents?: boolean;
		eventsLimit?: number;
		recentLimit?: number;
	} = {
		address: DEFAULT_CONTRACT,
		incremental: false,
		serve: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const nextArg = args[i + 1];

		if (arg === "--address" && nextArg) {
			parsed.address = nextArg as Address;
			i++;
		} else if (arg === "--incremental" && nextArg) {
			parsed.incremental = nextArg.toLowerCase() === "true";
			i++;
		} else if (arg === "--serve" && nextArg) {
			parsed.serve = nextArg.toLowerCase() === "true";
			i++;
		} else if (arg === "--export" && nextArg) {
			parsed.export = nextArg;
			i++;
		} else if (arg === "--includeEvents" && nextArg) {
			parsed.includeEvents = nextArg.toLowerCase() === "true";
			i++;
		} else if (arg === "--eventsLimit" && nextArg) {
			parsed.eventsLimit = parseInt(nextArg, 10);
			i++;
		} else if (arg === "--recentLimit" && nextArg) {
			parsed.recentLimit = parseInt(nextArg, 10);
			i++;
		}
	}

	return parsed;
}

async function main() {
	console.log("🌟 Citrea Analytics Tool (Enhanced with Event Decoding)\n");

	const args = parseArgs();
	console.log("Configuration:");
	console.log(`  Contract: ${args.address}`);
	console.log(`  Incremental: ${args.incremental}`);
	console.log(`  Serve API: ${args.serve}`);
	if (args.export) console.log(`  Export to: ${args.export}`);
	console.log();

	const db = initDatabase();
	const client = createCitreaClient();

	try {
		await scanLogs(db, client, args.address, args.incremental);

		const { processed: pFees, inserted: iFees } = await backfillFees(db, client);
		if (pFees > 0) {
			console.log(`\n🧮 Fee backfill complete: ${iFees}/${pFees} inserted`);
		}

		const {
			processed: pEvents,
			inserted: iEvents,
			txWithSwap,
		} = await backfillSwapEvents(db, client);
		if (pEvents > 0) {
			if (iEvents === 0) {
				console.log(
					`🧩 Event backfill complete: ${iEvents}/${pEvents} inserted — no Swap events found in missing transactions (tx with swaps: ${txWithSwap}/${pEvents}).`
				);
			} else {
				console.log(
					`🧩 Event backfill complete: ${iEvents}/${pEvents} inserted (${txWithSwap} tx contained Swap events).`
				);
			}
		}

		const { processed: pTokens, inserted: iTokens } = await backfillTokenMetadata(db, client);
		if (pTokens > 0) {
			console.log(`🏷️  Token metadata backfill: ${iTokens}/${pTokens} inserted`);
		}

		const includeEventsOpt = args.includeEvents ?? INCLUDE_EVENTS;
		const eventsLimitOpt = args.eventsLimit ?? EVENTS_LIMIT;
		const recentLimitOpt = args.recentLimit ?? RECENT_SWAPS_LIMIT;
		const metrics = calculateEnhancedMetrics(db, {
			includeEvents: includeEventsOpt,
			eventsLimit: eventsLimitOpt,
			recentLimit: recentLimitOpt,
		});
		console.log("\n📈 Analytics Summary:");
		console.log(`  Unique Users: ${metrics.uniqueUsers.toLocaleString()}`);
		console.log(`  Total Transactions: ${metrics.uniqueTxCount.toLocaleString()}`);
		console.log(`  Total Swaps: ${metrics.totalSwaps.toLocaleString()}`);
		console.log(`  Total Fees: ${metrics.totalFees_cBTC} cBTC`);
		console.log(`\n  📊 Volume by Token (Top 3 Inbound):`);
		metrics.volumeByToken.inbound.slice(0, 3).forEach((v, i) => {
			console.log(`    ${i + 1}. ${v.token.slice(0, 10)}...`);
			console.log(`       Amount: ${v.normalizedAmount}`);
			console.log(`       Swaps: ${v.swapCount.toLocaleString()}`);
		});
		console.log(
			`\n  Top Token Pair: ${metrics.topTokenPairs[0]?.tokenIn.slice(0, 8)}... → ${metrics.topTokenPairs[0]?.tokenOut.slice(0, 8)}... (${metrics.topTokenPairs[0]?.swapCount ?? 0} swaps)`
		);

		if (args.export) {
			writeFileSync(args.export, JSON.stringify(metrics, null, 2));
			console.log(`\n💾 Exported metrics to ${args.export}`);
		}

		if (args.serve) {
			startServer(db);
			await new Promise(() => {});
		} else {
			db.close();
		}
	} catch (error) {
		console.error("\n❌ Fatal error:", error);
		db.close();
		process.exit(1);
	}
}

main();
