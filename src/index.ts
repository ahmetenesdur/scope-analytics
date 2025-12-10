#!/usr/bin/env tsx

import "dotenv/config";
import prompts from "prompts";
import { writeFileSync } from "node:fs";
import { initDatabase } from "./database";
import {
	scanLogs,
	backfillFees,
	backfillSwapEvents,
	backfillTokenMetadata,
} from "./services/indexer";
import { startServer, calculateEnhancedMetrics } from "./services/server";
import { NETWORKS, type NetworkConfig } from "./config/networks";
import { ENV } from "./config/env";

async function selectNetwork(): Promise<NetworkConfig> {
	const args = process.argv.slice(2);
	const networkArgIndex = args.indexOf("--network");

	if (networkArgIndex !== -1) {
		const networkId = args[networkArgIndex + 1]?.toLowerCase();
		if (networkId && NETWORKS[networkId]) {
			return NETWORKS[networkId];
		}
		console.error(
			`Unknown network: ${networkId}. Available: ${Object.keys(NETWORKS).join(", ")}`
		);
		process.exit(1);
	}

	const response = await prompts({
		type: "select",
		name: "network",
		message: "Select a network to analyze:",
		choices: Object.values(NETWORKS).map((n) => ({ title: n.name, value: n.id })),
	});

	if (!response.network) {
		console.log("No network selected. Exiting.");
		process.exit(0);
	}

	return NETWORKS[response.network] as NetworkConfig;
}

function parseArgs() {
	const args = process.argv.slice(2);
	return {
		incremental: args.includes("--incremental") || args.includes("-i"),
		serve: args.includes("--serve") || args.includes("-s"),
		export: args.indexOf("--export") !== -1 ? args[args.indexOf("--export") + 1] : undefined,
	};
}

async function main() {
	console.log("🌟 Scope (Modular Edition)\n");

	const config = await selectNetwork();
	const args = parseArgs();

	console.log("Configuration:");
	console.log(`  Network: ${config.name}`);
	console.log(`  Contract: ${config.contractAddress}`);
	console.log(`  Incremental: ${args.incremental}`);
	console.log(`  Serve API: ${args.serve}`);
	if (args.export) console.log(`  Export to: ${args.export}`);
	console.log();

	const db = initDatabase(config.dbFile);

	try {
		await scanLogs(db, config, args.incremental);

		const { processed: pFees, inserted: iFees } = await backfillFees(db, config);
		if (pFees > 0) {
			console.log(`\n🧮 Fee backfill complete: ${iFees}/${pFees} inserted`);
		}

		const {
			processed: pEvents,
			inserted: iEvents,
			txWithSwap,
		} = await backfillSwapEvents(db, config);
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

		const { processed: pTokens, inserted: iTokens } = await backfillTokenMetadata(db, config);
		if (pTokens > 0) {
			console.log(`🏷️  Token metadata backfill: ${iTokens}/${pTokens} inserted`);
		}

		const metrics = calculateEnhancedMetrics(db, config, {
			includeEvents: ENV.INCLUDE_EVENTS,
			eventsLimit: ENV.EVENTS_LIMIT,
			recentLimit: ENV.RECENT_SWAPS_LIMIT,
		});

		console.log("\n📈 Analytics Summary:");
		console.log(`  Unique Users: ${metrics.uniqueUsers.toLocaleString()}`);
		console.log(`  Total Transactions: ${metrics.uniqueTxCount.toLocaleString()}`);
		console.log(`  Total Swaps: ${metrics.totalSwaps.toLocaleString()}`);
		console.log(`  Total Fees: ${metrics.totalFees} ${config.currency.symbol}`);
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
			startServer(db, config);
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
