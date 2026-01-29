# Scope Analytics

High-performance, modular blockchain indexer and analytics engine for **Citrea** and **Monad** networks.

## Features

- **Hybrid Indexing**: Seamlessly combines historical backfilling with real-time WebSocket monitoring.
- **Multi-Network**: Built-in support for Citrea and Monad mainnets.
- **Analytics Engine**: Real-time calculation of volumes, fees, and unique user activity.
- **Persistent Storage**: SQLite with WAL mode for robust, local data caching.
- **API Server**: RESTful interface to serve metrics to dashboards.

## Quick Start

### One-Command Setup (Recommended)

Run the automated setup script to install dependencies, configure the environment, and launch the app:

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
    # Edit .env to set your RPC URLs
    ```

3. **Start Indexer**
    ```bash
    pnpm start
    ```
    _Follow the interactive prompt to select a network and mode._

## Command Reference

| Command                                          | Description                          |
| :----------------------------------------------- | :----------------------------------- |
| `pnpm start`                                     | Interactive mode (Recommended).      |
| `pnpm start -- --network citrea --realtime`      | Listen for live events only.         |
| `pnpm start -- --network monad --hybrid --serve` | Backfill + Realtime + API Server.    |
| `pnpm db:check`                                  | View database statistics and health. |
| `pnpm export`                                    | Export metrics to `analytics.json`.  |

## Documentation

- [Configuration](docs/configuration.md) - Environment variables and flags.
- [Database](docs/database.md) - Schema and SQL queries.
- [Usage](docs/usage.md) - Advanced CLI usage and workflows.

## API Endpoint

The server exposes a **GET** `/metrics` endpoint:

```json
{
  "uniqueUsers": 29326,
  "totalSwaps": 137365,
  "totalFees": "123.456789 cBTC",
  "dailyStats": [...],
  "recentSwaps": [...]
}
```
