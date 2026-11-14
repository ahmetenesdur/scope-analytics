# Scope Analytics

Scope Analytics (Modular Edition) is a blockchain indexer and analytics engine for EVM-compatible networks such as Citrea and Monad. It backfills historical events, follows new ones over WebSocket, stores them in SQLite, and serves volume, execution-quality and user metrics over a REST API.

## Features

### Core Architecture

- **Multi-Network Compatibility**: Native out-of-the-box configuration for Citrea and Monad, designed for rapid abstraction and extension to other EVM chains.
- **Hybrid Indexing Engine**: Fuses robust historical data backfilling with ultra-low latency real-time WebSocket event ingestion.
- **High-Concurrency Storage**: Utilizes SQLite in Write-Ahead Logging (WAL) mode tightly coupled with transaction-based storage strategies for maximum IO throughput.

### Data & Analytics

- **Dynamic Pricing Oracle**: Token metadata and fiat mappings via CoinGecko are managed dynamically within the database layer, abstracting away hardcoded constraints.
- **Comprehensive Volume Analysis**: Multi-token inbound and outbound liquidity tracking normalized to USD values.
- **Precision-Safe Accounting**: Raw token amounts and fees are aggregated with `bigint`/fixed-scale helpers to avoid JavaScript `Number` precision loss.
- **Execution Quality Engine**: Advanced slippage analysis comparing user-intended limits against actual execution pricing metrics.
- **On-Chain User Profiling**: Precise tracking of unique active addresses, top interacting entities, and transaction frequency matrices.

### Operations & Reliability

- **Failure-Aware Indexing**: Backfill failures preserve item-level context instead of being silently swallowed.
- **Indexer Observability**: `scan_runs` and `indexer_errors` tables track run status, open errors, retries, and last-seen timestamps.
- **Operational Health API**: `/health`, `/health/errors`, and `/health/runs` expose sync status and recent indexer failures.

## Quick Start

### Automated Setup (Recommended)

Run the automated setup script to install dependencies, configure environment, and launch:

```bash
./quickstart.sh
```

### Manual Setup

1. **Install Dependencies**

    ```bash
    pnpm install
    ```

2. **Configure Environment**

    ```bash
    cp .env.example .env
    # Add your RPC URLs for Citrea and Monad
    ```

3. **Launch**
    ```bash
    pnpm start
    ```
    _Follow the prompts to select your network and operation mode._

## API & Analytics

The integrated server provides advanced analytics via a RESTful API.

### Endpoints

| Endpoint                               | Description                                                |
| :------------------------------------- | :--------------------------------------------------------- |
| `GET /metrics`                         | Full aggregated metrics (volume, fees, pairs, daily stats) |
| `GET /metrics/daily?from=&to=`         | Daily time-series with optional date range filter          |
| `GET /metrics/token/:address`          | Token-specific volume, pairs, and daily chart              |
| `GET /metrics/pair/:tokenIn/:tokenOut` | Pair analytics, top traders, and daily stats               |
| `GET /metrics/wallet/:address`         | Wallet profile: volume, pairs, token flow, activity        |
| `GET /health`                          | System health, sync status, and uptime                     |
| `GET /health/errors?status=&limit=`    | Indexer errors filtered by lifecycle status                |
| `GET /health/runs?limit=`              | Recent historical/incremental scan runs                    |

All endpoints return JSON with CORS headers (`Access-Control-Allow-Origin: *`).

### Response Example (`/metrics`)

```json
{
	"uniqueActiveAddresses": 948,
	"totalTransactions": 7738,
	"cumulativeNetworkFees": "0.003539 cBTC",
	"averageTransactionFee": "0.00000045 cBTC",
	"totalSwapEvents": 7730,
	"cumulativeVolumeUsd": "$2296902.45",
	"executionQuality": {
		"averageSlippageMargin": "1.75%",
		"highSlippageSwaps": 2717,
		"standardSlippageSwaps": 4769
	}
}
```

## Documentation

- [Configuration](docs/configuration.md) - Environment variables and platform settings.
- [Database](docs/database.md) - Schema design and Direct ID mapping.
- [Usage](docs/usage.md) - Advanced CLI commands and hybrid workflows.

## Command Reference

| Command                             | Description                                  |
| :---------------------------------- | :------------------------------------------- |
| `pnpm start`                        | Interactive setup and launch.                |
| `pnpm hybrid`                       | Full sync: Backfill + Realtime + API Server. |
| `pnpm realtime`                     | WebSocket only (no historical scan).         |
| `pnpm serve`                        | API server with polling (incremental mode).  |
| `pnpm export`                       | Export metrics as JSON.                      |
| `pnpm export:csv`                   | Export metrics as CSV (directory of files).  |
| `pnpm export:md`                    | Export metrics as a Markdown report.         |
| `pnpm db:check`                     | Integrity check and storage statistics.      |
| `pnpm errors:list -- --status open` | List indexer errors by lifecycle status.     |
| `pnpm errors:resolve -- <id>`       | Mark an indexer error as resolved.           |
| `pnpm errors:ignore -- <id>`        | Mark an indexer error as ignored.            |
| `pnpm test`                         | Run the Node test suite.                     |
| `pnpm type-check`                   | Run TypeScript type-checking.                |
