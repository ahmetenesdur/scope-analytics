import type Database from "better-sqlite3";
import { ENV } from "../config/env";

export interface TokenPrice {
	address: string;
	price_usd: number;
	last_updated: number;
}

export class PriceService {
	constructor(
		private db: Database.Database,
		private config: {
			coingeckoPlatform: string;
		}
	) {}

	async updatePrices(tokenAddresses: string[]): Promise<void> {
		if (tokenAddresses.length === 0) return;

		try {
			const now = Math.floor(Date.now() / 1000);
			const stmt = this.db.prepare(`
				INSERT INTO token_prices (address, price_usd, last_updated)
				VALUES (?, ?, ?)
				ON CONFLICT(address) DO UPDATE SET
					price_usd = excluded.price_usd,
					last_updated = excluded.last_updated
			`);

			// Fetch metadata for these tokens to get coingecko_ids
			const placeholders = tokenAddresses.map(() => "?").join(",");
			const metadata = this.db
				.prepare(
					`SELECT address, coingecko_id FROM token_metadata WHERE address IN (${placeholders})`
				)
				.all(tokenAddresses.map((a) => a.toLowerCase())) as Array<{
				address: string;
				coingecko_id: string | null;
			}>;

			const mappedTokens = metadata.filter((m) => !!m.coingecko_id);
			const unmappedTokens = metadata.filter((m) => !m.coingecko_id);

			// Strategy 1: Mapping-based (Direct IDs from DB)
			if (mappedTokens.length > 0) {
				const ids = Array.from(new Set(mappedTokens.map((m) => m.coingecko_id))).join(",");
				const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;

				const response = await fetch(url, {
					headers: ENV.COINGECKO_API_KEY
						? { "x-cg-demo-api-key": ENV.COINGECKO_API_KEY }
						: {},
				});

				if (response.ok) {
					const data = (await response.json()) as Record<string, { usd: number }>;

					this.db.transaction(() => {
						let updatedCount = 0;
						for (const m of mappedTokens) {
							const id = m.coingecko_id;
							if (id && data[id]?.usd !== undefined) {
								stmt.run(m.address.toLowerCase(), data[id].usd, now);
								updatedCount++;
							}
						}
						if (updatedCount > 0) {
							console.log(
								`[PriceService] Updated ${updatedCount} tokens using direct mapping`
							);
						}
					})();
				} else {
					console.warn(
						`[PriceService] Direct mapping API failed: ${response.status} ${response.statusText}`
					);
				}
			}

			// Strategy 2: Platform-based (Contract Addresses)
			if (unmappedTokens.length > 0) {
				const ids = unmappedTokens.map((m) => m.address).join(",");
				const url = `https://api.coingecko.com/api/v3/simple/token_price/${this.config.coingeckoPlatform}?contract_addresses=${ids}&vs_currencies=usd`;

				const response = await fetch(url, {
					headers: ENV.COINGECKO_API_KEY
						? { "x-cg-demo-api-key": ENV.COINGECKO_API_KEY }
						: {},
				});

				if (response.ok) {
					const data = (await response.json()) as Record<string, { usd: number }>;

					this.db.transaction(() => {
						let updatedCount = 0;
						for (const address in data) {
							const priceObj = data[address];
							if (priceObj?.usd !== undefined) {
								stmt.run(address.toLowerCase(), priceObj.usd, now);
								updatedCount++;
							}
						}
						if (updatedCount > 0) {
							console.log(
								`[PriceService] Updated ${updatedCount} tokens using platform search (${this.config.coingeckoPlatform})`
							);
						}
					})();
				} else {
					console.warn(
						`[PriceService] Platform search API failed: ${response.status} ${response.statusText}`
					);
				}
			}
		} catch (error) {
			console.error("[PriceService] Critical error updating prices:", error);
		}
	}

	getPrice(address: string): number {
		const row = this.db
			.prepare("SELECT price_usd FROM token_prices WHERE address = ?")
			.get(address.toLowerCase()) as { price_usd: number } | undefined;
		return row?.price_usd ?? 0;
	}

	async ensurePricesUpdated(tokenAddresses: string[]): Promise<void> {
		if (tokenAddresses.length === 0) return;

		const now = Math.floor(Date.now() / 1000);
		const threshold = now - ENV.PRICE_UPDATE_INTERVAL_MS / 1000;

		// Create placeholders for the list (e.g., ?, ?, ?)
		const placeholders = tokenAddresses.map(() => "?").join(",");
		const rows = this.db
			.prepare(
				`SELECT address, last_updated FROM token_prices WHERE address IN (${placeholders})`
			)
			.all(tokenAddresses.map((a) => a.toLowerCase())) as Array<{
			address: string;
			last_updated: number;
		}>;

		const lastUpdatedMap = new Map<string, number>();
		for (const row of rows) {
			lastUpdatedMap.set(row.address.toLowerCase(), row.last_updated);
		}

		const staleTokens = tokenAddresses.filter((addr) => {
			const lastUpdated = lastUpdatedMap.get(addr.toLowerCase());
			return !lastUpdated || lastUpdated < threshold;
		});

		if (staleTokens.length > 0) {
			await this.updatePrices(staleTokens);
		}
	}
}
