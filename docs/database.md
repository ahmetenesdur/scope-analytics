# Database Management

Guide to understanding and managing the SQLite database.

## Database Structure

### Tables

#### `meta` - Checkpoint Storage

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Stores scanning progress:

| Key              | Value    |
| ---------------- | -------- |
| lastScannedBlock | 16769945 |

#### `logs` - Transaction Records

```sql
CREATE TABLE logs (
  tx_hash TEXT PRIMARY KEY,
  block_number INTEGER NOT NULL,
  from_address TEXT NOT NULL,
  gas_used TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
```

Indexes: `block_number`, `from_address`, `timestamp`

#### `swap_events` (v2) - Swap Event Details (Multi-Swap Support)

Stores each Swap log individually, supporting multiple Swap events per transaction.

```sql
CREATE TABLE swap_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  sender TEXT NOT NULL,
  amount_in TEXT NOT NULL,
  amount_out TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  destination TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
);
```

Indexes: `UNIQUE(tx_hash, log_index)`, `token_in, token_out`, `sender`

#### `fees` - Transaction Fee Records

```sql
CREATE TABLE fees (
  tx_hash TEXT PRIMARY KEY,
  fee_wei TEXT NOT NULL,
  FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
);
```

Indexes: `tx_hash`

Stores actual paid fee per transaction in wei (`gasUsed * effectiveGasPrice`). Useful for computing `totalFees`.

#### `token_metadata` - Token Decimals and Symbols

```sql
CREATE TABLE token_metadata (
  address TEXT PRIMARY KEY,
  decimals INTEGER NOT NULL,
  symbol TEXT NOT NULL
);
```

Indexes: `address`

Stores ERC20 metadata used to normalize volumes correctly. Decimals are sanitized and common tokens use heuristics (e.g., USDC/USDT=6, WBTC=8, WETH=18).

## How Incremental Scanning Works

### First Run

```bash
pnpm start
```

1. Creates database and tables
2. Scans from block 0 to latest
3. Saves `lastScannedBlock` in `meta` table

### Subsequent Runs

```bash
pnpm scan
```

1. Reads `lastScannedBlock` from database
2. Scans only new blocks
3. Updates `lastScannedBlock`

## Database Commands

### Database Files

Each network uses a separate database file to ensure data isolation:

- **Citrea:** `citrea_cache.db`
- **Monad:** `monad_cache.db`

The file name is automatically determined based on the selected network.

### Check Status

```bash
pnpm db:check
```

Output:

```
🗄️  Database Status Check (citrea_cache.db)

📊 Meta Information:
  Last Scanned Block: 16,850,000

📈 Statistics:
  Total Transactions: 1,323
  Total Swap Events: 590
  Unique Users: 234

🔗 Block Range:
  First Block: 1,234,567
  Last Block: 16,850,000

💾 Database File:
  File: citrea_cache.db
  Size: 2.73 MB
```

### Reset Database

```bash
pnpm db:reset
```

⚠️ **Warning:** This deletes all data for **both** networks (Citrea and Monad)!

## Common Queries

### Top Users

```sql
SELECT from_address, COUNT(*) as tx_count
FROM logs
GROUP BY from_address
ORDER BY tx_count DESC
LIMIT 10;
```

### Daily Statistics

```sql
SELECT date(timestamp, 'unixepoch') as day,
       COUNT(*) as tx_count,
       COUNT(DISTINCT from_address) as unique_users
FROM logs
GROUP BY day
ORDER BY day DESC
LIMIT 30;
```

### Top Token Pairs

```sql
SELECT token_in, token_out, COUNT(*) as swap_count
FROM swap_events
GROUP BY token_in, token_out
ORDER BY swap_count DESC
LIMIT 10;
```

### Recent Swaps (24h)

```sql
SELECT *
FROM swap_events
WHERE timestamp > strftime('%s', 'now') - 86400
ORDER BY timestamp DESC;
```

### User Activity

```sql
SELECT l.*, s.*
FROM logs l
LEFT JOIN swap_events s ON l.tx_hash = s.tx_hash
WHERE l.from_address = '0x...'
ORDER BY l.block_number DESC;
```

### Total Fees

```sql

SELECT (SUM(CAST(fee_wei AS REAL)) / 1e18) AS total_fees FROM fees;
```

Or in application code, sum `fee_wei` as BigInt and format `wei → native currency` (e.g. "1.23 cBTC").

### Fees By Day

```sql
SELECT
  strftime('%Y-%m-%d', l.timestamp, 'unixepoch') AS day,
  SUM(CAST(f.fee_wei AS REAL)) / 1e18 AS fees
FROM fees f
JOIN logs l ON l.tx_hash = f.tx_hash
GROUP BY day
ORDER BY day DESC
LIMIT 30;
```

Application code should aggregate with BigInt for exact results and format with symbol.

## Backfill Process

**Fees Backfill**

- Fills `fees(tx_hash, fee_wei)` for existing `logs` using `gasUsed * effectiveGasPrice`.

**Event Backfill**

- Decodes `Swap` events from receipts for `logs` missing `swap_events` records.
- Each Swap log is stored separately using `log_index` (multi-swap per transaction).

**Token Metadata Backfill**

- Reads ERC20 `decimals` & `symbol` for tokens seen in `swap_events` and stores in `token_metadata`.

## Best Practices

### Regular Backups

```bash
# Daily backup
cp citrea_cache.db "backups/citrea_cache_$(date +%Y%m%d).db"

# Or use SQLite backup
sqlite3 citrea_cache.db ".backup backups/citrea_cache_$(date +%Y%m%d_%H%M%S).db"
```

### Automated Scanning

```bash
# Cron: Every 6 hours (Citrea)
0 */6 * * * cd /path/to/scope-analytics && pnpm scan -- --network citrea

# Cron: Daily at midnight (Monad)
0 0 * * * cd /path/to/scope-analytics && pnpm scan -- --network monad
```

### Log Rotation

```bash
# Save logs to file
pnpm scan >> logs/scan_$(date +%Y%m%d).log 2>&1

# Clean old logs (30+ days)
find logs/ -name "scan_*.log" -mtime +30 -delete
```

### Monitor Database

```bash
# Watch database size
watch -n 60 'ls -lh citrea_cache.db'

# Monitor via API
pnpm serve &
curl http://localhost:3000/metrics | jq
```
