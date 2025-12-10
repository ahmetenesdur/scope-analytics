#!/usr/bin/env tsx

import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { config } from "dotenv";

config();

const DB_FILE = process.env.CITREA_DATABASE_FILE || process.env.DATABASE_FILE || "citrea_cache.db";

console.log("🗄️  Database Status Check\n");

try {
	const db = new Database(DB_FILE, { readonly: true });

	// Check if database exists and has data
	const meta = db.prepare("SELECT * FROM meta").all() as Array<{ key: string; value: string }>;

	console.log("📊 Meta Information:");
	console.log("═══════════════════════════════════════════════════");
	if (meta.length === 0) {
		console.log("  ⚠️  No data yet - database is empty");
	} else {
		meta.forEach((row) => {
			if (row.key === "lastScannedBlock") {
				console.log(`  Last Scanned Block: ${Number(row.value).toLocaleString()}`);
			} else {
				console.log(`  ${row.key}: ${row.value}`);
			}
		});
	}

	// Count records
	const logCount = db.prepare("SELECT COUNT(*) as count FROM logs").get() as { count: number };
	const swapCount = db.prepare("SELECT COUNT(*) as count FROM swap_events").get() as {
		count: number;
	};
	const uniqueUsers = db
		.prepare("SELECT COUNT(DISTINCT from_address) as count FROM logs")
		.get() as { count: number };

	console.log("\n📈 Statistics:");
	console.log("═══════════════════════════════════════════════════");
	console.log(`  Total Transactions: ${logCount.count.toLocaleString()}`);
	console.log(`  Total Swap Events: ${swapCount.count.toLocaleString()}`);
	console.log(`  Unique Users: ${uniqueUsers.count.toLocaleString()}`);

	// Total fees (wei→cBTC) if fees table exists
	const feesTable = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fees'")
		.get() as { name: string } | undefined;
	if (feesTable?.name) {
		const feeRows = db.prepare("SELECT fee_wei FROM fees").all() as Array<{ fee_wei: string }>;
		let totalFeesWei = 0n;
		for (const row of feeRows) totalFeesWei += BigInt(row.fee_wei);
		const totalFeesCBTC = (() => {
			const base = 10n ** 18n;
			const integer = totalFeesWei / base;
			const fraction = totalFeesWei % base;
			const fracStr = fraction.toString().padStart(18, "0").slice(0, 6);
			return `${integer.toString()}.${fracStr}`;
		})();
		console.log(`  Total Fees: ${totalFeesCBTC} (native)`);
	}

	// Block range
	const blockRange = db
		.prepare(
			`
    SELECT 
      MIN(block_number) as first_block,
      MAX(block_number) as last_block
    FROM logs
  `
		)
		.get() as { first_block: number; last_block: number } | undefined;

	if (blockRange && blockRange.first_block) {
		console.log("\n🔗 Block Range:");
		console.log("═══════════════════════════════════════════════════");
		console.log(`  First Block: ${blockRange.first_block.toLocaleString()}`);
		console.log(`  Last Block: ${blockRange.last_block.toLocaleString()}`);
		console.log(
			`  Total Blocks Scanned: ${(blockRange.last_block - blockRange.first_block + 1).toLocaleString()}`
		);
	}

	// Recent activity
	const recentTx = db
		.prepare(
			`
    SELECT 
      tx_hash,
      block_number,
      from_address,
      datetime(timestamp, 'unixepoch') as time
    FROM logs
    ORDER BY block_number DESC
    LIMIT 5
  `
		)
		.all() as Array<{
		tx_hash: string;
		block_number: number;
		from_address: string;
		time: string;
	}>;

	if (recentTx.length > 0) {
		console.log("\n⏱️  Recent Transactions:");
		console.log("═══════════════════════════════════════════════════");
		recentTx.forEach((tx, i) => {
			console.log(`  ${i + 1}. Block ${tx.block_number.toLocaleString()}`);
			console.log(`     Tx: ${tx.tx_hash.slice(0, 16)}...`);
			console.log(`     From: ${tx.from_address.slice(0, 10)}...`);
			console.log(`     Time: ${tx.time}`);
		});
	}

	// Top token pairs
	const topPairs = db
		.prepare(
			`
    SELECT 
      token_in || ' → ' || token_out as pair,
      COUNT(*) as count,
      SUM(CAST(amount_in as REAL)) as total_volume
    FROM swap_events
    GROUP BY token_in, token_out
    ORDER BY count DESC
    LIMIT 5
  `
		)
		.all() as Array<{ pair: string; count: number; total_volume: number }>;

	if (topPairs.length > 0) {
		console.log("\n🔥 Top Token Pairs:");
		console.log("═══════════════════════════════════════════════════");
		topPairs.forEach((pair, i) => {
			console.log(`  ${i + 1}. ${pair.count} swaps`);
			console.log(`     ${pair.pair.slice(0, 10)}... → ${pair.pair.slice(-10)}`);
		});
	}

	// Database file size
	const { statSync } = await import("fs");
	const stats = statSync(DB_FILE);
	const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

	console.log("\n💾 Database File:");
	console.log("═══════════════════════════════════════════════════");
	console.log(`  File: ${DB_FILE}`);
	console.log(`  Size: ${fileSizeMB} MB`);

	db.close();
} catch (error) {
	if ((error as NodeJS.ErrnoException).code === "ENOENT") {
		console.log("  ⚠️  Database file not found!");
		console.log(`  Expected location: ${DB_FILE}`);
		console.log(`  Run 'pnpm start' to create and populate the database.`);
	} else {
		console.error("❌ Error reading database:", error);
	}
}
