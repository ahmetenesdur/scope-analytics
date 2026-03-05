# Database Schema

The project utilizes SQLite configured in Write-Ahead Logging (`WAL`) mode. This architectural choice natively enables highly concurrent read/write operations by allowing reads to proceed while a distinct write transaction happens concurrently. A separate, isolated database file is created per network (e.g., `citrea_cache.db`), mapping to a highly parallelized operating architecture.

## Entity Relationship Overview

At the core, the `logs` table operates as the foundational anchor. As transactions are ingested, any discovered standard router swap events are parsed and stored in `swap_events`, holding a foreign key reference (`tx_hash`) back to the originating log. `fees` are mapped similarly 1:1 against the `logs` table using the `tx_hash`.

## Core Tables

### `logs`

Raw transaction logs.

- `tx_hash` (TEXT, PK): Cryptographic transaction hash.
- `block_number` (INTEGER): Index of the block where the event occurred.
- `timestamp` (INTEGER): Unix block timestamp.
- `from_address` (TEXT): Sender wallet address.

### `swap_events`

Parsed Swap events. Supports multiple swaps per transaction.

- `id` (INTEGER, PK): Auto-incrementing relational ID.
- `tx_hash` (TEXT, FK): Cryptographic link to parent `logs` entry.
- `sender` (TEXT): Cryptographic address of the user initiating the swap workflow.
- `token_in` / `token_out` (TEXT): Respective token contract addresses.
- `amount_in` / `amount_out` (TEXT): Raw token amounts (stored as strings to prevent integer overflow beyond MAX_SAFE_INTEGER).
- `amount_out_min` (TEXT): User's minimum received limit parsed from router calldata.
- `execution_quality` (REAL): Derived safety margin percentage calculating slippage dynamics.

### `fees`

Transaction fee data.

- `tx_hash` (TEXT, PK): Cryptographic link to parent `logs` entry.
- `fee_wei` (TEXT): Total topological fee calculated via (Gas Used \* Effective Gas Price).

### `token_prices` [NEW]

Cached USD values for tokens.

- `address` (TEXT, PK): The distinct token contract address.
- `price_usd` (REAL): The latest spot price denominated in USD derived via the oracle.
- `last_updated` (INTEGER): Unix timestamp denoting the freshness of the fetched payload.

### `token_metadata`

Metadata about tokens discovered during indexing.

- `address` (TEXT, PK): Token contract address.
- `decimals` (INTEGER): Defined scale mapping token magnitude.
- `symbol` (TEXT): Human-readable ticker symbol.
- `coingecko_id` (TEXT): Optional platform-specific CoinGecko REST scalar identifier.

## Useful SQL Queries

**Top 5 Token Pairs by Volume**

```sql
SELECT token_in, token_out, COUNT(*) as count
FROM swap_events
GROUP BY token_in, token_out
ORDER BY count DESC
LIMIT 5;
```

**Daily Transaction Count**

```sql
SELECT date(timestamp, 'unixepoch') as day, COUNT(*)
FROM logs
GROUP BY day
ORDER BY day DESC;
```

## Database Maintenance

```bash
# Check database size and stats
pnpm db:check

# Delete all data for all networks
pnpm db:reset
```
