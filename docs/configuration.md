# Configuration

Environment variable reference for `.env`.

## Network Settings

| Variable                  | Type    | Status   | Description                                                                                                                                                 |
| :------------------------ | :------ | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CITREA_RPC_URL`          | URL     | Required | HTTP/HTTPS RPC endpoint for Citrea used for polling and historical data backfilling.                                                                        |
| `CITREA_WS_RPC_URL`       | WS URL  | Required | WebSocket endpoint for Citrea. Mandatory for starting the engine in Real-time or Hybrid modes.                                                              |
| `CITREA_CHAIN_ID`         | Number  | Optional | Chain ID for Citrea. Defaults to `4114` if omitted.                                                                                                         |
| `MONAD_RPC_URL`           | URL     | Required | HTTP/HTTPS RPC endpoint for Monad used for polling and historical data backfilling.                                                                         |
| `MONAD_WS_RPC_URL`        | WS URL  | Required | WebSocket endpoint for Monad. Mandatory for starting the engine in Real-time or Hybrid modes.                                                               |
| `MONAD_CHAIN_ID`          | Number  | Optional | Chain ID for Monad. Defaults to `143` if omitted.                                                                                                           |
| `CITREA_CONTRACT_ADDRESS` | Address | Required | The core protocol smart contract address on Citrea. The indexer strictly filters logs matching this address to ensure highly targeted, performant scanning. |
| `MONAD_CONTRACT_ADDRESS`  | Address | Required | The core protocol smart contract address on Monad. The indexer strictly filters logs matching this address to ensure highly targeted, performant scanning.  |

## Application Settings

| Variable                   | Type   | Status   | Default           | Description                                                                                                                  |
| :------------------------- | :----- | :------- | :---------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `BATCH_SIZE`               | Number | Optional | `1000`            | Maximum number of blocks requested per historical scan iteration. Reduce this value if RPC rate limits or timeouts occur.    |
| `MAX_RETRIES`              | Number | Optional | `3`               | Configuration for exponential backoff. Defines the maximum number of attempts for failed RPC data fetching requests.         |
| `CITREA_DATABASE_FILE`     | String | Optional | `citrea_cache.db` | Local SQLite database filename target for Citrea network data. Defaults to root directory isolation.                         |
| `MONAD_DATABASE_FILE`      | String | Optional | `monad_cache.db`  | Local SQLite database filename target for Monad network data. Defaults to root directory isolation.                          |
| `API_PORT`                 | Number | Optional | `3000`            | Local port binding for the REST `/metrics` API server.                                                                       |
| `API_HOST`                 | String | Optional | `localhost`       | Host binding address for the REST `/metrics` API server.                                                                     |
| `PRICE_UPDATE_INTERVAL_MS` | Number | Optional | `3600000`         | Interval (in milliseconds) delineating the frequency at which the CoinGecko price oracle refreshes its cache.                |
| `COINGECKO_API_KEY`        | String | Optional | `-`               | Pro API Key for CoinGecko. If omitted, the engine automatically falls back to the public, rate-limited public CoinGecko API. |

## Architectural Fallbacks & Behaviours

- **CoinGecko Resilience**: If `COINGECKO_API_KEY` is not provided, the system degrades gracefully to the public API endpoint. Note that heavy indexing during high volume bursts might run into `429 Too Many Requests`.
- **Database Partitioning**: The engine dynamically routes read/write operations into network-specific databases (defined by `*_DATABASE_FILE`) natively supporting concurrent scans without locking cross-network tasks.

## CLI Overrides

CLI flags override environment variables:

```bash
# Override contract address
pnpm start -- --address 0x123...

# Force specific network
pnpm start -- --network citrea

# Enable Realtime Mode
pnpm realtime
```
