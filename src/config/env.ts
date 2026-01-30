import "dotenv/config";
import type { Address } from "viem";

export const ENV = {
	BATCH_SIZE: BigInt(process.env.BATCH_SIZE || "1000"),
	MAX_RETRIES: parseInt(process.env.MAX_RETRIES || "3", 10),
	RETRY_DELAY_MS: parseInt(process.env.RETRY_DELAY_MS || "1000", 10),
	API_PORT: parseInt(process.env.API_PORT || "3000", 10),
	API_HOST: process.env.API_HOST || "localhost",
	INCLUDE_EVENTS: (process.env.INCLUDE_EVENTS || "false").toLowerCase() === "true",
	EVENTS_LIMIT: parseInt(process.env.EVENTS_LIMIT || "10", 10),
	RECENT_SWAPS_LIMIT: parseInt(process.env.RECENT_SWAPS_LIMIT || "10", 10),

	// Citrea
	CITREA_RPC_URL: process.env.CITREA_RPC_URL || "https://rpc.mainnet.citrea.xyz",
	CITREA_CHAIN_ID: parseInt(process.env.CITREA_CHAIN_ID || "4114", 10),
	CITREA_CONTRACT_ADDRESS: (process.env.CITREA_CONTRACT_ADDRESS ||
		process.env.CONTRACT_ADDRESS ||
		"0x274602a953847d807231d2370072F5f4E4594B44") as Address,
	CITREA_DB_FILE:
		process.env.CITREA_DATABASE_FILE || process.env.DATABASE_FILE || "citrea_cache.db",

	// Monad
	MONAD_RPC_URL: process.env.MONAD_RPC_URL || "https://rpc1.monad.xyz",
	MONAD_CHAIN_ID: parseInt(process.env.MONAD_CHAIN_ID || "143", 10),
	MONAD_CONTRACT_ADDRESS: (process.env.MONAD_CONTRACT_ADDRESS ||
		"0x274602a953847d807231d2370072f5f4e4594b44") as Address,
	MONAD_DB_FILE: process.env.MONAD_DATABASE_FILE || "monad_cache.db",
};
