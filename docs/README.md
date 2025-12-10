# 📚 Documentation Index

Complete documentation for Scope.

---

## Quick Links

- **[../README.md](../README.md)** - Main project README and quick start
- **[usage.md](usage.md)** - Detailed usage examples and CLI options
- **[database.md](database.md)** - Database structure and incremental scanning
- **[configuration.md](configuration.md)** - Environment variables and settings

---

## Documentation Structure

### 1. README.md (Main)

**Location**: Root directory  
**Purpose**: Quick start guide and project overview

**Contents**:

- Features overview
- Quick start commands
- Usage examples (enhanced vs standard)
- Basic configuration
- API response format
- Documentation links

---

### 2. usage.md

**Location**: `docs/usage.md`  
**Purpose**: Complete CLI usage guide

**Contents**:

- CLI options reference
- Common workflows
- Database queries
- API examples
- Performance optimization tips
- Troubleshooting

---

### 3. database.md

**Location**: `docs/database.md`  
**Purpose**: Complete database management guide

**Contents**:

- Database structure and tables
- Incremental scanning implementation
- Practical usage scenarios
- Database commands (check, reset)
- Manual SQL queries
- Troubleshooting and best practices

---

### 4. configuration.md

**Location**: `docs/configuration.md`  
**Purpose**: Complete configuration reference

**Contents**:

- Environment variables explained
- Configuration examples
- Priority order (CLI vs ENV)
- Security considerations
- Troubleshooting

---

## Version History

### Current Version: 1.1.0

**Features**:

- ✅ **Multi-Network Support** (Citrea Testnet & Monad Mainnet)
- ✅ **Interactive CLI** with network selection
- ✅ **Modular Architecture** (`src/` directory structure)
- ✅ Enhanced version as default (`pnpm start`)
- ✅ Simplified scripts (`pnpm scan`, `pnpm serve`, `pnpm export`)
- ✅ Incremental scanning with SQLite cache (separate DB per network)
- ✅ Complete documentation
- ✅ HTTP API server
- ✅ JSON export functionality
- ✅ Event decoding and analysis
- ✅ Real fee metrics (totalFees) and daily fees (dailyStats.fees)
- ✅ Token-aware normalization using ERC20 decimals & symbols
- ✅ Recent swaps summary (recentSwaps) and optional raw events (swapEvents)
- ✅ Multi-swap event support (per-transaction `log_index`, accurate counts & volumes)
- ✅ Token metadata multicall (batched `decimals`/`symbol` with automatic fallback)
- ✅ Daily stats include both tx-level (`swapsTx`) and event-level (`swapsEvent`) counts

---

**Last Updated**: 2025-11-25
