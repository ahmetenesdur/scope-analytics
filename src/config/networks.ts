import { defineChain, type Address } from "viem";
import { citreaRouterAbi, monadRouterAbi } from "./abi";
import { ENV } from "./env";

export interface NetworkConfig {
	id: string;
	name: string;
	rpcUrl: string;
	chainId: number;
	contractAddress: Address;
	dbFile: string;
	abi: typeof citreaRouterAbi | typeof monadRouterAbi;
	explorer: string;
	currency: { name: string; symbol: string; decimals: number };
}

export const NETWORKS: Record<string, NetworkConfig> = {
	citrea: {
		id: "citrea",
		name: "Citrea Mainnet",
		rpcUrl: ENV.CITREA_RPC_URL,
		chainId: ENV.CITREA_CHAIN_ID,
		contractAddress: ENV.CITREA_CONTRACT_ADDRESS,
		dbFile: ENV.CITREA_DB_FILE,
		abi: citreaRouterAbi,
		explorer: "https://explorer.mainnet.citrea.xyz",
		currency: { name: "Citrea Bitcoin", symbol: "cBTC", decimals: 18 },
	},
	monad: {
		id: "monad",
		name: "Monad Mainnet",
		rpcUrl: ENV.MONAD_RPC_URL,
		chainId: ENV.MONAD_CHAIN_ID,
		contractAddress: ENV.MONAD_CONTRACT_ADDRESS,
		dbFile: ENV.MONAD_DB_FILE,
		abi: monadRouterAbi,
		explorer: "https://monad.explorer",
		currency: { name: "Monad", symbol: "MON", decimals: 18 },
	},
};

export function getChainDefinition(config: NetworkConfig) {
	return defineChain({
		id: config.chainId,
		name: config.name,
		nativeCurrency: config.currency,
		rpcUrls: { default: { http: [config.rpcUrl] } },
		blockExplorers: { default: { name: "Explorer", url: config.explorer } },
	});
}
