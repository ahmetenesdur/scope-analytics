import type Database from "better-sqlite3";
import { createServer } from "node:http";
import { ENV } from "../config/env";
import { formatAmount } from "../utils/format";

interface SwapEventData {
	sender: string;
	amount_in: string;
	amount_out: string;
	token_in: string;
	token_out: string;
	destination: string;
}

interface TokenVolume {
	contractAddress: string;
	rawAmount: string;
	formattedAmount: string;
	volumeUsd: string;
	swapCount: number;
}

interface TokenPairDetail {
	tokenInAddress: string;
	tokenOutAddress: string;
	swapCount: number;
	volumeIn: string;
	volumeOut: string;
	totalVolumeUsd: string;
}

interface EnhancedMetrics {
	uniqueActiveAddresses: number;
	totalTransactions: number;
	cumulativeNetworkFees: string;
	averageTransactionFee: string;
	totalSwapEvents: number;
	tokenMetrics: {
		liquidityIn: Array<TokenVolume>;
		liquidityOut: Array<TokenVolume>;
	};
	topInteractingAddresses: Array<{ address: string; txCount: number }>;
	topTradingPairs: Array<TokenPairDetail>;
	historicalDailyMetrics: Array<{
		date: string;
		txCount: number;
		uniqueActiveAddresses: number;
		transactionsWithSwaps: number;
		swapEventCount: number;
		fees: string;
		averageFeePerTx: string;
		volumeUsd: string;
	}>;
	latestSwapEvents: Array<{
		tx_hash: string;
		timestamp: string;
		sender: string;
		tokenInAddress: string;
		tokenOutAddress: string;
		amountIn: string;
		amountOut: string;
	}>;
	swapEvents?: Array<SwapEventData>;
	range: { startBlock: number | null; endBlock: number | null; lastUpdatedAt: string | null };
	executionQuality: {
		averageSlippageMargin: string;
		highSlippageSwaps: number;
		standardSlippageSwaps: number;
	};
	cumulativeVolumeUsd: string;
}

// Metrics Calculation Helpers

function getDecimalsAndSymbols(db: Database.Database) {
	const rows = db.prepare("SELECT address, decimals, symbol FROM token_metadata").all() as Array<{
		address: string;
		decimals: number;
		symbol: string;
	}>;
	const decimalsMap = new Map<string, number>();
	const symbolMap = new Map<string, string>();
	for (const r of rows) {
		const addr = r.address.toLowerCase();
		decimalsMap.set(addr, r.decimals);
		symbolMap.set(addr, r.symbol);
	}
	return { decimalsMap, symbolMap };
}

function getPrices(db: Database.Database) {
	const rows = db.prepare("SELECT address, price_usd FROM token_prices").all() as Array<{
		address: string;
		price_usd: number;
	}>;
	const priceMap = new Map<string, number>();
	for (const r of rows) {
		priceMap.set(r.address.toLowerCase(), r.price_usd);
	}
	return priceMap;
}

function formatVolumeData(
	rows: Array<{ token_in?: string; token_out?: string; total: number; cnt: number }>,
	isOut: boolean,
	decimalsMap: Map<string, number>,
	symbolMap: Map<string, string>,
	priceMap: Map<string, number>
): TokenVolume[] {
	return rows.map((r) => {
		const token = (isOut ? r.token_out : r.token_in) ?? "";
		const addr = token.toLowerCase();
		const dec = decimalsMap.get(addr) ?? 18;
		const sym = symbolMap.get(addr) ?? "";
		const price = priceMap.get(addr);
		const raw = BigInt(Math.floor(r.total));
		const normalized = Number(raw) / 10 ** dec;

		let volumeUsd = "N/A";
		if (price !== undefined) {
			volumeUsd = `$${(normalized * price).toFixed(2)}`;
		}

		return {
			contractAddress: token,
			rawAmount: raw.toString(),
			formattedAmount: `${formatAmount(raw, dec, 2)} ${sym}`,
			volumeUsd,
			swapCount: r.cnt,
		};
	});
}

function getTopTokenPairs(
	db: Database.Database,
	decimalsMap: Map<string, number>,
	symbolMap: Map<string, string>,
	priceMap: Map<string, number>
): TokenPairDetail[] {
	const rows = db
		.prepare(
			`SELECT token_in, token_out, COUNT(*) as cnt, 
              SUM(CAST(amount_in AS REAL)) as volIn, 
              SUM(CAST(amount_out AS REAL)) as volOut
             FROM swap_events 
             GROUP BY token_in, token_out 
             ORDER BY cnt DESC 
             LIMIT 10`
		)
		.all() as Array<{
		token_in: string;
		token_out: string;
		cnt: number;
		volIn: number;
		volOut: number;
	}>;

	return rows.map((r) => {
		const addrIn = r.token_in.toLowerCase();
		const addrOut = r.token_out.toLowerCase();
		const decIn = decimalsMap.get(addrIn) ?? 18;
		const decOut = decimalsMap.get(addrOut) ?? 18;
		const symIn = symbolMap.get(addrIn) ?? "";
		const symOut = symbolMap.get(addrOut) ?? "";
		const priceIn = priceMap.get(addrIn);

		let totalVolumeUsd = "N/A";
		if (priceIn !== undefined) {
			const volInUsd = (r.volIn / 10 ** decIn) * priceIn;
			totalVolumeUsd = `$${volInUsd.toFixed(2)}`;
		}

		return {
			tokenInAddress: r.token_in,
			tokenOutAddress: r.token_out,
			swapCount: r.cnt,
			volumeIn: `${formatAmount(BigInt(Math.floor(r.volIn)), decIn, 2)} ${symIn}`,
			volumeOut: `${formatAmount(BigInt(Math.floor(r.volOut)), decOut, 2)} ${symOut}`,
			totalVolumeUsd,
		};
	});
}

function getDailyStats(
	db: Database.Database,
	decimalsMap: Map<string, number>,
	priceMap: Map<string, number>,
	config: { currency: { decimals: number; symbol: string } }
) {
	const statsRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') as day, COUNT(*) as txCount, COUNT(DISTINCT from_address) as totalUsers FROM logs GROUP BY day ORDER BY day DESC`
		)
		.all() as Array<{ day: string; txCount: number; totalUsers: number }>;

	const feesRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', l.timestamp, 'unixepoch') as day, SUM(CAST(f.fee_wei AS REAL)) as fees FROM logs l JOIN fees f ON l.tx_hash = f.tx_hash GROUP BY day`
		)
		.all() as Array<{ day: string; fees: number }>;

	const feesMap = new Map(feesRows.map((r) => [r.day, BigInt(Math.floor(r.fees))]));

	const eventRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') as day, COUNT(*) as swapEventCount FROM swap_events GROUP BY day`
		)
		.all() as Array<{ day: string; swapEventCount: number }>;
	const eventMap = new Map(eventRows.map((r) => [r.day, r.swapEventCount]));

	const volumeRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') as day, COUNT(DISTINCT tx_hash) as swapTxCount, SUM(CAST(amount_in AS REAL)) as totalIn, token_in FROM swap_events GROUP BY day, token_in`
		)
		.all() as Array<{ day: string; swapTxCount: number; totalIn: number; token_in: string }>;

	const dailyVolumeUsdMap = new Map<string, number>();
	const dailySwapTxMap = new Map<string, number>();

	for (const r of volumeRows) {
		dailySwapTxMap.set(r.day, (dailySwapTxMap.get(r.day) ?? 0) + r.swapTxCount);
		const dec = decimalsMap.get(r.token_in.toLowerCase()) ?? 18;
		const price = priceMap.get(r.token_in.toLowerCase());
		if (price !== undefined) {
			const usd = (r.totalIn / 10 ** dec) * price;
			dailyVolumeUsdMap.set(r.day, (dailyVolumeUsdMap.get(r.day) ?? 0) + usd);
		}
	}

	return statsRows.map((r) => {
		const vol = dailyVolumeUsdMap.get(r.day);
		const dayFees = feesMap.get(r.day) ?? 0n;
		const avgFee = r.txCount > 0 ? dayFees / BigInt(r.txCount) : 0n;

		return {
			date: r.day,
			txCount: r.txCount,
			uniqueActiveAddresses: r.totalUsers,
			transactionsWithSwaps: dailySwapTxMap.get(r.day) ?? 0,
			swapEventCount: eventMap.get(r.day) ?? 0,
			fees: `${formatAmount(dayFees, config.currency.decimals, 6)} ${config.currency.symbol}`,
			averageFeePerTx: `${formatAmount(avgFee, config.currency.decimals, 6)} ${config.currency.symbol}`,
			volumeUsd: vol !== undefined ? `$${vol.toFixed(2)}` : "N/A",
		};
	});
}

export function calculateEnhancedMetrics(
	db: Database.Database,
	config: { currency: { decimals: number; symbol: string } },
	options?: { includeEvents?: boolean; eventsLimit?: number; recentLimit?: number }
): EnhancedMetrics {
	// 1. Basic Counts
	const totalUsers = (
		db.prepare("SELECT COUNT(DISTINCT from_address) as count FROM logs").get() as any
	).count;
	const totalTxCount = (
		db.prepare("SELECT COUNT(DISTINCT tx_hash) as count FROM logs").get() as any
	).count;
	const totalSwaps = (db.prepare("SELECT COUNT(*) as count FROM swap_events").get() as any).count;

	const totalFeesRow = db
		.prepare("SELECT SUM(CAST(fee_wei AS REAL)) as total FROM fees")
		.get() as any;
	const totalFeesRaw = BigInt(Math.floor(totalFeesRow?.total ?? 0));
	const totalFees = `${formatAmount(totalFeesRaw, config.currency.decimals, 6)} ${config.currency.symbol}`;
	const avgFeeRaw = totalTxCount > 0 ? totalFeesRaw / BigInt(totalTxCount) : 0n;
	const averageFeePerTx = `${formatAmount(avgFeeRaw, config.currency.decimals, 6)} ${config.currency.symbol}`;

	// 2. Metadata & Prices
	const { decimalsMap, symbolMap } = getDecimalsAndSymbols(db);
	const priceMap = getPrices(db);

	// 3. Volume Analysis
	const inboundVolumeRows = db
		.prepare(
			`SELECT token_in, SUM(CAST(amount_in AS REAL)) as total, COUNT(*) as cnt FROM swap_events GROUP BY token_in ORDER BY cnt DESC`
		)
		.all() as any;
	const outboundVolumeRows = db
		.prepare(
			`SELECT token_out, SUM(CAST(amount_out AS REAL)) as total, COUNT(*) as cnt FROM swap_events GROUP BY token_out ORDER BY cnt DESC`
		)
		.all() as any;

	const tokenMetrics = {
		liquidityIn: formatVolumeData(inboundVolumeRows, false, decimalsMap, symbolMap, priceMap),
		liquidityOut: formatVolumeData(outboundVolumeRows, true, decimalsMap, symbolMap, priceMap),
	};

	let totalVolumeUsdValue: number | null = null;
	inboundVolumeRows.forEach((r: any) => {
		const dec = decimalsMap.get(r.token_in.toLowerCase()) ?? 18;
		const price = priceMap.get(r.token_in.toLowerCase());
		if (price !== undefined) {
			if (totalVolumeUsdValue === null) totalVolumeUsdValue = 0;
			totalVolumeUsdValue += (r.total / 10 ** dec) * price;
		}
	});

	// 4. Leaders & Pairs
	const topCallers = db
		.prepare(
			`SELECT from_address as address, COUNT(*) as txCount FROM logs GROUP BY from_address ORDER BY txCount DESC LIMIT 10`
		)
		.all() as any;
	const topTokenPairs = getTopTokenPairs(db, decimalsMap, symbolMap, priceMap);

	// 5. Time-series Stats
	const dailyStats = getDailyStats(db, decimalsMap, priceMap, config);

	// 6. Block Range
	const blockRangeRow = db
		.prepare("SELECT MIN(block_number) as first, MAX(block_number) as last FROM logs")
		.get() as any;
	const lastTsRow = db.prepare("SELECT MAX(timestamp) as last_ts FROM logs").get() as any;
	const range = {
		startBlock: blockRangeRow?.first ?? null,
		endBlock: blockRangeRow?.last ?? null,
		lastUpdatedAt: lastTsRow?.last_ts ? new Date(lastTsRow.last_ts * 1000).toISOString() : null,
	};

	// 7. Recent Swaps
	const recentLimit = options?.recentLimit ?? 10;
	const recentRows = db
		.prepare(
			`SELECT tx_hash, timestamp, sender, amount_in, amount_out, token_in, token_out FROM swap_events ORDER BY block_number DESC, log_index DESC LIMIT ?`
		)
		.all(recentLimit) as any;

	const recentSwaps = recentRows.map((r: any) => {
		const addrIn = r.token_in.toLowerCase();
		const addrOut = r.token_out.toLowerCase();
		const timestamp = new Date(r.timestamp * 1000).toISOString();
		return {
			tx_hash: r.tx_hash,
			timestamp,
			sender: r.sender,
			tokenInAddress: r.token_in,
			tokenOutAddress: r.token_out,
			amountIn: `${formatAmount(BigInt(r.amount_in), decimalsMap.get(addrIn) ?? 18, 6)}${symbolMap.get(addrIn) ? ` (${symbolMap.get(addrIn)})` : ""}`,
			amountOut: `${formatAmount(BigInt(r.amount_out), decimalsMap.get(addrOut) ?? 18, 6)}${symbolMap.get(addrOut) ? ` (${symbolMap.get(addrOut)})` : ""}`,
		};
	});

	// 8. Slippage
	const slippageStats = db
		.prepare(
			`SELECT COUNT(*) as total, AVG(execution_quality) as avgQuality, SUM(CASE WHEN execution_quality < 0.5 THEN 1 ELSE 0 END) as riskyCount FROM swap_events WHERE execution_quality IS NOT NULL`
		)
		.get() as any;

	const avgQuality = slippageStats?.avgQuality ?? 0;
	const riskyCount = slippageStats?.riskyCount ?? 0;

	return {
		uniqueActiveAddresses: totalUsers,
		totalTransactions: totalTxCount,
		cumulativeNetworkFees: totalFees,
		averageTransactionFee: averageFeePerTx,
		totalSwapEvents: totalSwaps,
		tokenMetrics,
		topInteractingAddresses: topCallers,
		topTradingPairs: topTokenPairs,
		historicalDailyMetrics: dailyStats,
		latestSwapEvents: recentSwaps,
		range,
		executionQuality: {
			averageSlippageMargin: `${Number(avgQuality).toFixed(2)}%`,
			highSlippageSwaps: Number(riskyCount),
			standardSlippageSwaps: Number(slippageStats?.total ?? 0) - Number(riskyCount),
		},
		cumulativeVolumeUsd:
			totalVolumeUsdValue !== null ? `$${(totalVolumeUsdValue as number).toFixed(2)}` : "N/A",
		...(options?.includeEvents
			? {
					swapEvents: db
						.prepare("SELECT * FROM swap_events ORDER BY block_number DESC LIMIT ?")
						.all(options.eventsLimit ?? 10) as any,
				}
			: {}),
	};
}

// Server Lifecycle

const metricsCache = {
	data: null as EnhancedMetrics | null,
	lastUpdated: 0,
	ttl: 10000,
};

function getCachedMetrics(
	db: Database.Database,
	config: { currency: { decimals: number; symbol: string } },
	options?: { includeEvents?: boolean; eventsLimit?: number; recentLimit?: number }
): EnhancedMetrics {
	const now = Date.now();
	if (metricsCache.data && now - metricsCache.lastUpdated < metricsCache.ttl) {
		return metricsCache.data;
	}
	const data = calculateEnhancedMetrics(db, config, options);
	metricsCache.data = data;
	metricsCache.lastUpdated = now;
	return data;
}

export function startServer(
	db: Database.Database,
	config: { currency: { decimals: number; symbol: string } },
	port = ENV.API_PORT
): void {
	const server = createServer((req, res) => {
		if (req.url === "/metrics" && req.method === "GET") {
			try {
				const metrics = getCachedMetrics(db, config, {
					includeEvents: ENV.INCLUDE_EVENTS,
					eventsLimit: ENV.EVENTS_LIMIT,
					recentLimit: ENV.RECENT_SWAPS_LIMIT,
				});
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(metrics, null, 2));
			} catch (error) {
				console.error("[Server] Error:", error);
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Internal Server Error" }));
			}
		} else {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		}
	});

	server.listen(port, () => {
		console.log(`\n[Server] Metrics API running at http://${ENV.API_HOST}:${port}/metrics`);
	});
}
