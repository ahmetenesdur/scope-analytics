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
	totalUsers: number;
	totalTxCount: number;
	totalFees: string;
	totalSwaps: number;
	volumeByToken: {
		inbound: Array<TokenVolume>;
		outbound: Array<TokenVolume>;
	};
	topCallers: Array<{ address: string; txCount: number }>;
	topTokenPairs: Array<TokenPairDetail>;
	dailyStats: Array<{
		day: string;
		txCount: number;
		totalUsers: number;
		swapTxCount: number;
		swapEventCount: number;
		fees: string;
	}>;
	recentSwaps: Array<{
		tx_hash: string;
		timestamp: string;
		sender: string;
		tokenIn: string;
		tokenOut: string;
		amountIn: string;
		amountOut: string;
	}>;
	swapEvents?: Array<SwapEventData>;
	range: { startBlock: number | null; endBlock: number | null; lastUpdatedAt: string | null };
	executionQuality: {
		averageMargin: string;
		riskySwapCount: number;
		safeSwapCount: number;
	};
}

export function calculateEnhancedMetrics(
	db: Database.Database,
	config: { currency: { decimals: number; symbol: string } },
	options?: { includeEvents?: boolean; eventsLimit?: number; recentLimit?: number }
): EnhancedMetrics {
	const totalUsers = db
		.prepare("SELECT COUNT(DISTINCT from_address) as count FROM logs")
		.get() as {
		count: number;
	};
	const totalTxCount = db.prepare("SELECT COUNT(DISTINCT tx_hash) as count FROM logs").get() as {
		count: number;
	};

	const totalFeesRow = db
		.prepare("SELECT SUM(CAST(fee_wei AS REAL)) as total FROM fees")
		.get() as {
		total: number | null;
	};
	const totalFees = `${formatAmount(
		BigInt(Math.floor(totalFeesRow?.total ?? 0)),
		config.currency.decimals,
		6
	)} ${config.currency.symbol}`;

	const totalSwaps = db.prepare("SELECT COUNT(*) as count FROM swap_events").get() as {
		count: number;
	};

	const tokenMetaRows = db
		.prepare("SELECT address, decimals, symbol FROM token_metadata")
		.all() as Array<{ address: string; decimals: number; symbol: string }>;
	const decimalsMap = new Map<string, number>();
	const symbolMap = new Map<string, string>();
	for (const r of tokenMetaRows) {
		decimalsMap.set(r.address.toLowerCase(), r.decimals);
		symbolMap.set(r.address.toLowerCase(), r.symbol);
	}

	const inboundVolumeRows = db
		.prepare(
			`SELECT token_in, SUM(CAST(amount_in AS REAL)) as total, COUNT(*) as cnt FROM swap_events GROUP BY token_in ORDER BY cnt DESC`
		)
		.all() as Array<{ token_in: string; total: number; cnt: number }>;

	const outboundVolumeRows = db
		.prepare(
			`SELECT token_out, SUM(CAST(amount_out AS REAL)) as total, COUNT(*) as cnt FROM swap_events GROUP BY token_out ORDER BY cnt DESC`
		)
		.all() as Array<{ token_out: string; total: number; cnt: number }>;

	const formatVolume = (
		rows: Array<{ token_in?: string; token_out?: string; total: number; cnt: number }>,
		isOut: boolean
	): TokenVolume[] => {
		return rows.map((r) => {
			const token = (isOut ? r.token_out : r.token_in) ?? "";
			const dec = decimalsMap.get(token.toLowerCase()) ?? 18;
			const sym = symbolMap.get(token.toLowerCase()) ?? "";
			const raw = BigInt(Math.floor(r.total));
			return {
				token,
				totalAmount: raw.toString(),
				normalizedAmount: `${formatAmount(raw, dec, 2)} ${sym}`,
				swapCount: r.cnt,
			};
		});
	};

	const volumeByToken = {
		inbound: formatVolume(inboundVolumeRows, false),
		outbound: formatVolume(outboundVolumeRows, true),
	};

	const topCallers = db
		.prepare(
			`SELECT from_address as address, COUNT(*) as txCount FROM logs GROUP BY from_address ORDER BY txCount DESC LIMIT 10`
		)
		.all() as Array<{ address: string; txCount: number }>;

	const topPairsRows = db
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

	const topTokenPairs: TokenPairDetail[] = topPairsRows.map((r) => {
		const decIn = decimalsMap.get(r.token_in.toLowerCase()) ?? 18;
		const decOut = decimalsMap.get(r.token_out.toLowerCase()) ?? 18;
		const symIn = symbolMap.get(r.token_in.toLowerCase()) ?? "";
		const symOut = symbolMap.get(r.token_out.toLowerCase()) ?? "";
		return {
			tokenIn: r.token_in,
			tokenOut: r.token_out,
			swapCount: r.cnt,
			volumeIn: `${formatAmount(BigInt(Math.floor(r.volIn)), decIn, 2)} ${symIn}`,
			volumeOut: `${formatAmount(BigInt(Math.floor(r.volOut)), decOut, 2)} ${symOut}`,
		};
	});

	const dailyStatsRows = db
		.prepare(
			`SELECT 
        strftime('%Y-%m-%d', timestamp, 'unixepoch') as day,
        COUNT(*) as txCount,
        COUNT(DISTINCT from_address) as totalUsers
      FROM logs
      GROUP BY day
      ORDER BY day DESC`
		)
		.all() as Array<{ day: string; txCount: number; totalUsers: number }>;

	const dailyFeesRows = db
		.prepare(
			`SELECT 
        strftime('%Y-%m-%d', l.timestamp, 'unixepoch') as day,
        SUM(CAST(f.fee_wei AS REAL)) as fees
      FROM logs l
      JOIN fees f ON l.tx_hash = f.tx_hash
      GROUP BY day`
		)
		.all() as Array<{ day: string; fees: number }>;
	const feesByDayMap = new Map<string, bigint>();
	for (const r of dailyFeesRows) {
		feesByDayMap.set(r.day, BigInt(Math.floor(r.fees)));
	}

	const dailyStatsEventRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', s.timestamp, 'unixepoch') AS day,
                    COUNT(*) AS swapEventCount
             FROM swap_events s
             GROUP BY day
             ORDER BY day DESC`
		)
		.all() as Array<{ day: string; swapEventCount: number }>;
	const dailyEventMap = new Map<string, number>(
		dailyStatsEventRows.map((r) => [r.day, r.swapEventCount ?? 0])
	);

	const dailyStatsTxRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', s.timestamp, 'unixepoch') AS day,
                    COUNT(DISTINCT tx_hash) AS swapTxCount
             FROM swap_events s
             GROUP BY day
             ORDER BY day DESC`
		)
		.all() as Array<{ day: string; swapTxCount: number }>;
	const dailyTxMap = new Map<string, number>(
		dailyStatsTxRows.map((r) => [r.day, r.swapTxCount ?? 0])
	);

	const dailyStats = dailyStatsRows.map((r) => ({
		day: r.day,
		txCount: r.txCount,
		totalUsers: r.totalUsers,
		swapTxCount: dailyTxMap.get(r.day) ?? 0,
		swapEventCount: dailyEventMap.get(r.day) ?? 0,
		fees: `${formatAmount(feesByDayMap.get(r.day) ?? 0n, config.currency.decimals, 6)} ${config.currency.symbol}`,
	}));

	const blockRangeRow = db
		.prepare("SELECT MIN(block_number) as first, MAX(block_number) as last FROM logs")
		.get() as { first: number | null; last: number | null };
	const lastTsRow = db.prepare("SELECT MAX(timestamp) as last_ts FROM logs").get() as {
		last_ts: number | null;
	};
	const range = {
		startBlock: blockRangeRow?.first ?? null,
		endBlock: blockRangeRow?.last ?? null,
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
		const timestamp = new Date(r.timestamp * 1000).toISOString();
		return {
			tx_hash: r.tx_hash,
			timestamp,
			sender: r.sender,
			tokenIn: r.token_in,
			tokenOut: r.token_out,
			amountIn: amountInNorm,
			amountOut: amountOutNorm,
		};
	});

	// Slippage Analysis
	const slippageStats = db
		.prepare(
			`
    SELECT 
      COUNT(*) as total,
      AVG(execution_quality) as avgQuality,
      SUM(CASE WHEN execution_quality < 0.5 THEN 1 ELSE 0 END) as riskyCount
    FROM swap_events
    WHERE execution_quality IS NOT NULL
  `
		)
		.get() as { total: number; avgQuality: number | null; riskyCount: number | null };

	const avgQuality = slippageStats.avgQuality ?? 0;
	const riskySwapCount = slippageStats.riskyCount ?? 0;
	const safeSwapCount = (slippageStats.total ?? 0) - riskySwapCount;

	return {
		totalUsers: totalUsers.count,
		totalTxCount: totalTxCount.count,
		totalFees,
		totalSwaps: totalSwaps.count,
		volumeByToken,
		topCallers,
		topTokenPairs,
		dailyStats,
		recentSwaps,
		...(includeEvents && swapEvents ? { swapEvents } : {}),
		range,
		executionQuality: {
			averageMargin: `${avgQuality.toFixed(2)}%`,
			riskySwapCount,
			safeSwapCount,
		},
	};
}

const metricsCache = {
	data: null as EnhancedMetrics | null,
	lastUpdated: 0,
	ttl: 10000, // 10 seconds
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
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Failed to calculate metrics" }));
			}
		} else {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		}
	});

	server.listen(port, () => {
		console.log(`\n[Server] Server running at http://${ENV.API_HOST}:${port}/metrics`);
	});
}
