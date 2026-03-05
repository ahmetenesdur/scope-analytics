import type Database from "better-sqlite3";
import {
	createPublicClient,
	webSocket,
	decodeEventLog,
	decodeFunctionData,
	type Address,
	type Log,
} from "viem";
import { citreaRouterAbi } from "../config/abi";
import { getChainDefinition, type NetworkConfig } from "../config/networks";
import { insertLog, insertFee, insertSwap } from "./storage";
import { ENV } from "../config/env";

export interface SwapEventData {
	sender: string;
	amount_in: string;
	amount_out: string;
	token_in: string;
	token_out: string;
	destination: string;
}

export interface ProcessedSwapEvent extends SwapEventData {
	tx_hash: string;
	block_number: number;
	log_index: number;
	timestamp: number;
}

type SwapCallback = (swap: ProcessedSwapEvent) => void | Promise<void>;

export class RealtimeIndexer {
	private wsClient: ReturnType<typeof createPublicClient> | null = null;
	private swapCallbacks: SwapCallback[] = [];
	private isConnected = false;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private reconnectDelay = 5000; // 5 seconds

	constructor(
		private db: Database.Database,
		private config: NetworkConfig
	) {}

	// Initialize WebSocket connection
	async connect(): Promise<void> {
		const wsRpcUrl = this.getWebSocketUrl();

		if (!wsRpcUrl) {
			console.warn(
				`[Warning] No WebSocket URL configured for ${this.config.name}. Falling back to HTTP polling.`
			);
			return;
		}

		try {
			this.wsClient = createPublicClient({
				chain: getChainDefinition(this.config),
				transport: webSocket(wsRpcUrl, {
					reconnect: {
						attempts: this.maxReconnectAttempts,
						delay: this.reconnectDelay,
					},
					timeout: 30000,
				}),
			});

			this.isConnected = true;
			this.reconnectAttempts = 0;
			console.log(`[Connected] WebSocket connected: ${this.config.name}`);
		} catch (error) {
			console.error(`[Error] WebSocket connection failed:`, error);
			this.handleReconnect();
		}
	}

	// Get WebSocket URL from environment
	private getWebSocketUrl(): string | null {
		// Try to convert HTTP RPC to WebSocket
		const httpUrl = this.config.rpcUrl;

		// Check if there's a specific WebSocket URL in env
		if (this.config.id === "citrea" && process.env.CITREA_WS_RPC_URL) {
			return process.env.CITREA_WS_RPC_URL;
		}
		if (this.config.id === "monad" && process.env.MONAD_WS_RPC_URL) {
			return process.env.MONAD_WS_RPC_URL;
		}

		// Auto-convert HTTP to WebSocket (common patterns)
		if (httpUrl.startsWith("https://")) {
			return httpUrl.replace("https://", "wss://");
		}
		if (httpUrl.startsWith("http://")) {
			return httpUrl.replace("http://", "ws://");
		}

		return null;
	}

	// Handle reconnection logic
	private handleReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error(`[Error] Max reconnection attempts reached. Switching to HTTP polling.`);
			return;
		}

		this.reconnectAttempts++;
		console.log(
			`[Reconnecting] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
		);

		setTimeout(() => {
			this.connect();
		}, this.reconnectDelay * this.reconnectAttempts);
	}

	// Watch for Swap events in real-time
	async watchSwapEvents(): Promise<(() => void) | null> {
		if (!this.wsClient) {
			console.warn("[Warning] WebSocket not connected. Call connect() first.");
			return null;
		}

		console.log(`[Watching] Watching Swap events on ${this.config.name}...`);

		const unwatch = this.wsClient.watchContractEvent({
			address: this.config.contractAddress,
			abi: this.config.abi,
			eventName: "Swap",
			onLogs: async (logs) => {
				for (const log of logs) {
					await this.processLog(log);
				}
			},
			onError: (error) => {
				console.error("[Error] WebSocket event error:", error);
				this.isConnected = false;
				this.handleReconnect();
			},
		});

		return unwatch;
	}

	// Process a single log event
	private async processLog(log: Log): Promise<void> {
		try {
			// Decode event
			const decoded = decodeEventLog({
				abi: this.config.abi,
				data: log.data,
				topics: log.topics,
			});

			if (decoded.eventName !== "Swap") return;

			const args = decoded.args as unknown as SwapEventData;

			// Get transaction details
			const [receipt, block, tx] = await Promise.all([
				this.wsClient!.getTransactionReceipt({ hash: log.transactionHash! }),
				this.wsClient!.getBlock({ blockNumber: log.blockNumber! }),
				this.wsClient!.getTransaction({ hash: log.transactionHash! }),
			]);

			// Calculate fee
			// Calculate fee
			const feeWei = receipt.gasUsed * (receipt as any).effectiveGasPrice || BigInt(0);

			// Execute transaction
			this.db.transaction(() => {
				insertLog(this.db, {
					tx_hash: log.transactionHash!,
					block_number: Number(log.blockNumber!),
					from_address: receipt.from.toLowerCase(),
					gas_used: receipt.gasUsed.toString(),
					timestamp: Number(block.timestamp),
				});

				insertFee(this.db, {
					tx_hash: log.transactionHash!,
					fee_wei: feeWei.toString(),
				});

				let amountOutMin: string | undefined;
				let executionQuality: number | undefined;

				// Slippage Calculation
				try {
					const decodedTx = decodeFunctionData({
						abi: citreaRouterAbi,
						data: tx.input,
					});

					if (decodedTx.functionName === "swap") {
						const route = (decodedTx.args as any)[0];
						if (route && route.min_received) {
							const minReceived = BigInt(route.min_received);
							const amountOut = BigInt(args.amount_out);

							if (amountOut > 0n) {
								const diff = amountOut - minReceived;
								const quality = Number((diff * 10000n) / amountOut) / 100;

								amountOutMin = minReceived.toString();
								executionQuality = quality;
							}
						}
					}
				} catch (err) {
					// Failed to decode input or not a router swap
				}

				const swapData: any = {
					tx_hash: log.transactionHash!,
					log_index: typeof log.logIndex !== "undefined" ? Number(log.logIndex) : 0,
					block_number: Number(log.blockNumber!),
					sender: args.sender.toLowerCase(),
					amount_in: args.amount_in.toString(),
					amount_out: args.amount_out.toString(),
					token_in: args.token_in.toLowerCase(),
					token_out: args.token_out.toLowerCase(),
					destination: args.destination.toLowerCase(),
					timestamp: Number(block.timestamp),
				};

				if (amountOutMin) swapData.amount_out_min = amountOutMin;
				if (executionQuality !== undefined) swapData.execution_quality = executionQuality;

				insertSwap(this.db, swapData);
			})();

			// Create processed event
			const processedEvent: ProcessedSwapEvent = {
				tx_hash: log.transactionHash!,
				block_number: Number(log.blockNumber!),
				log_index: typeof log.logIndex !== "undefined" ? Number(log.logIndex) : 0,
				timestamp: Number(block.timestamp),
				sender: args.sender.toLowerCase(),
				amount_in: args.amount_in.toString(),
				amount_out: args.amount_out.toString(),
				token_in: args.token_in.toLowerCase(),
				token_out: args.token_out.toLowerCase(),
				destination: args.destination.toLowerCase(),
			};

			// Notify callbacks
			for (const callback of this.swapCallbacks) {
				try {
					await callback(processedEvent);
				} catch (error) {
					console.error("Error in swap callback:", error);
				}
			}

			console.log(
				`[Live] Live Swap: ${processedEvent.tx_hash.slice(0, 10)}... | Block ${processedEvent.block_number}`
			);
		} catch (error) {
			console.error("Error processing log:", error);
		}
	}

	// Subscribe to swap events
	onSwap(callback: SwapCallback): () => void {
		this.swapCallbacks.push(callback);

		// Return unsubscribe function
		return () => {
			const index = this.swapCallbacks.indexOf(callback);
			if (index > -1) {
				this.swapCallbacks.splice(index, 1);
			}
		};
	}

	// Hybrid mode: Initial batch scan + real-time watching
	async startHybridMode(): Promise<() => void> {
		console.log("\n[Mode] Starting hybrid mode...");

		// 1. Initial batch scan
		console.log("[Step 1] Initial batch scan...");
		const { scanLogs, backfillFees, backfillSwapEvents, backfillTokenMetadata } =
			await import("./indexer");

		await scanLogs(this.db, this.config, true);
		await backfillFees(this.db, this.config);
		await backfillSwapEvents(this.db, this.config);
		await backfillTokenMetadata(this.db, this.config);

		console.log("[Success] Initial scan complete");

		// 2. Start real-time watching
		console.log("[Step 2] Starting real-time watch...");
		await this.connect();

		const unwatch = await this.watchSwapEvents();

		console.log("[Success] Hybrid mode active\n");

		// Return cleanup function
		return () => {
			if (unwatch) unwatch();
			this.disconnect();
		};
	}

	// Disconnect WebSocket
	disconnect(): void {
		if (this.wsClient) {
			this.isConnected = false;
			console.log(`[Disconnected] WebSocket disconnected: ${this.config.name}`);
		}
	}

	// Check if WebSocket is connected
	isWebSocketConnected(): boolean {
		return this.isConnected;
	}
}
