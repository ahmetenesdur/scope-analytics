# Scope Analytics

Scope Analytics (Modular Edition) is an enterprise-grade, high-performance blockchain indexer and analytics engine constructed for precision, scalability, and seamless integration with EVM-compatible networks like Citrea and Monad.

## Features

### Core Architecture

- **Multi-Network Compatibility**: Native out-of-the-box configuration for Citrea and Monad, designed for rapid abstraction and extension to other EVM chains.
- **Hybrid Indexing Engine**: Fuses robust historical data backfilling with ultra-low latency real-time WebSocket event ingestion.
- **High-Concurrency Storage**: Utilizes SQLite in Write-Ahead Logging (WAL) mode tightly coupled with transaction-based storage strategies for maximum IO throughput.

### Data & Analytics

- **Dynamic Pricing Oracle**: Token metadata and fiat mappings via CoinGecko are managed dynamically within the database layer, abstracting away hardcoded constraints.
- **Comprehensive Volume Analysis**: Multi-token inbound and outbound liquidity tracking normalized to USD values.
- **Execution Quality Engine**: Advanced slippage analysis comparing user-intended limits against actual execution pricing metrics.
- **On-Chain User Profiling**: Precise tracking of unique active addresses, top interacting entities, and transaction frequency matrices.

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

The integrated server provides advanced analytics via **GET** `/metrics`.

### Response Example

```json
{
	"uniqueActiveAddresses": 552,
	"totalTransactions": 4280,
	"cumulativeNetworkFees": "0.001947 cBTC",
	"averageTransactionFee": "0.00000045 cBTC",
	"totalSwapEvents": 4272,
	"tokenMetrics": {
		"liquidityIn": [
			{ "contractAddress": "0x...", "volumeUsd": "$368738.28", "swapCount": 1440 },
			{ "contractAddress": "0x...", "volumeUsd": "N/A", "swapCount": 250 }
		],
		"liquidityOut": []
	},
	"executionQuality": {
		"averageSlippageMargin": "1.84%",
		"highSlippageSwaps": 1402,
		"standardSlippageSwaps": 2766
	}
}
```

## Documentation

- [Configuration](docs/configuration.md) - Environment variables and platform settings.
- [Database](docs/database.md) - Schema design and Direct ID mapping.
- [Usage](docs/usage.md) - Advanced CLI commands and hybrid workflows.

## Command Reference

| Command         | Description                                     |
| :-------------- | :---------------------------------------------- |
| `pnpm start`    | Interactive setup and launch.                   |
| `pnpm hybrid`   | Full sync: Backfill + Realtime + API Server.    |
| `pnpm realtime` | WebSocket only (no historical scan).            |
| `pnpm export`   | Generate `analytics.json` for snapshot sharing. |
| `pnpm db:check` | Integrity check and storage statistics.         |
