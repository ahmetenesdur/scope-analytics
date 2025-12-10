# Scope

Analyze smart contract activity on multiple EVM networks (Citrea, Monad, etc.) with SQLite caching and incremental scanning.

## Features

- **Multi-Network Support** - Support for Citrea Testnet and Monad Mainnet
- **Interactive Mode** - Easy network selection via CLI
- **Incremental Scanning** - Only scans new blocks since last run
- **SQLite Cache** - Persistent storage with WAL mode (separate DB per network)
- **Event Decoding** - Decode and analyze Swap events
- **Real Fee Metrics** - Total and daily fees
- **Recent Swaps** - Compact summary of latest N swaps
- **Auto Retry** - Automatic retry for RPC failures
- **HTTP API** - RESTful metrics endpoint
- **JSON Export** - Export analytics to file
- **TypeScript** - Full type safety with ESM

### New/Enhanced

- **Modular Architecture** — Refactored codebase for better maintainability.
- **Interactive Network Selection** — Choose between Citrea and Monad at runtime.
- **Multi-Swap Event Support** — Stores multiple Swap logs per transaction via `log_index`.
- **Token Metadata via Multicall** — Batched ERC20 `decimals` and `symbol` retrieval.

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env

# Run scanner (Interactive)
pnpm start
```

## Configuration

Edit the `.env` file:

```bash
# Citrea Testnet
CITREA_RPC_URL=https://rpc.testnet.citrea.xyz
CITREA_CHAIN_ID=5115

# Monad Mainnet
MONAD_RPC_URL=https://monad-mainnet.g.alchemy.com/v2/...
MONAD_CHAIN_ID=143
MONAD_CONTRACT_ADDRESS=0x274602a953847d807231d2370072f5f4e4594b44

# Contract to analyze (Citrea Default)
CONTRACT_ADDRESS=0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556

# Database
CITREA_DATABASE_FILE=citrea_cache.db

# Performance
BATCH_SIZE=1000
MAX_RETRIES=3

# API Server
API_PORT=3000
API_HOST=localhost
```

See [docs/configuration.md](docs/configuration.md) for all options.

## Usage

### Interactive Mode

Simply run `pnpm start` and select a network from the list.

### Command Line Arguments

You can specify the network directly:

```bash
# Run for Citrea
pnpm start -- --network citrea

# Run for Monad
pnpm start -- --network monad
```

### Incremental Scan

```bash
pnpm scan -- --network citrea
```

### Start API Server

```bash
pnpm serve -- --network citrea
```

Access at: `http://localhost:3000/metrics`

### Export to JSON

```bash
pnpm export -- --network citrea
```

### Combined Options

```bash
pnpm start -- --network citrea --incremental --serve --export report.json
```

## API Response

```json
{
  "uniqueUsers": 29326,
  "uniqueTxCount": 137368,
  "totalFees": "123.456789 cBTC",
  "totalSwaps": 137365,
  "range": {"firstBlock": 1234567, "lastBlock": 16850000, "lastUpdatedAt": "2025-10-15T16:59:34.000Z"},
  "volumeByToken": {
    "inbound": [
      {"token": "0x8d0c...", "normalizedAmount": "232.43", "swapCount": 47920}
    ],
    "outbound": [...]
  },
  "topCallers": [{"addr": "0xabc...", "count": 3047}],
  "topTokenPairs": [
    {
      "tokenIn": "0x8d0c...",
      "tokenOut": "0x36c1...",
      "swapCount": 41212,
      "volumeIn": "181.74 (0x8d0c...)",
      "volumeOut": "0.000046 (0x36c1...)"
    }
  ],
  "dailyStats": [{
    "day": "2025-10-13",
    "tx": 577,
    "uniqueUsers": 360,
    "swapsTx": 577,
    "swapsEvent": 580,
    "fees": "0.123456 cBTC"
  }],
  "recentSwaps": [{"tx_hash": "0x...", "amountIn": "0.001000 (WCBTC)", "amountOut": "6.522482 (USDC)", "time": "2025-10-15T16:59:34.000Z"}]
}
```

---

## Project Structure

```
scope-analytics/
├── src/                    # Source code
│   ├── config/             # Configuration (networks, env, abi)
│   ├── database/           # Database logic
│   ├── services/           # Business logic (indexer, server)
│   ├── utils/              # Utilities
│   ├── scripts/            # Helper scripts (check-db)
│   └── index.ts            # Entry point
├── docs/                   # Documentation
├── package.json            # Dependencies
└── .env                    # Configuration
```

## Documentation

- [Usage Guide](docs/usage.md) - CLI options and examples
- [Database Guide](docs/database.md) - Database structure and management
- [Configuration](docs/configuration.md) - Environment variables

## Tech Stack

- Node.js 18+
- TypeScript 5.9+ (ESM)
- SQLite with WAL mode
- Viem (Ethereum client)
- pnpm

---

[![GitHub](https://img.shields.io/badge/GitHub-ahmetenesdur-blue?logo=github)](https://github.com/ahmetenesdur)
