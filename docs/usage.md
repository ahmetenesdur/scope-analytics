# Usage Guide

Scope is designed to be flexible, supporting interactive prompts for beginners and powerful CLI flags for advanced users.

## Interactive Mode (Recommended)

Simply run:

```bash
pnpm start
```

This will guide you through:

1. Selecting a target network (Citrea/Monad).
2. Choosing between standard polling and real-time indexing.

## CLI Operation Modes

For automated, CI/CD, or headless environments, use direct flags to bypass interactive prompts:

### Scenario 1: Full Historical Backfill & Live Serving (Hybrid Mode)

Captures all historical data matching the contract address, initiates the metrics REST server, and seamlessly connects to the WebSocket stream to capture real-time events.

```bash
pnpm hybrid --network citrea
```

**Expected Output:** A progress bar indicating block synchronization, followed by a persistent `[Metrics]` log indicating the API is actively listening on `http://localhost:3000`.

### Scenario 2: Low-Resource Real-Time Monitoring

Bypasses historical block scanning completely. Directly subscribes to the provider's WebSocket to append strictly new events as they are mined.

```bash
pnpm realtime --network monad
```

### Scenario 3: Snapshot Export

Runs a one-time synchronization pass (no server, no websockets) and flushes the calculated metrics down to a JSON artifact.

```bash
pnpm export analytics.json --network citrea
```

**Expected Output:** Logs indicating successful sync, a printed summary of the metrics, and process termination with an `analytics.json` file written to disk.

## Advanced Options

| Flag             | Description                                                  |
| :--------------- | :----------------------------------------------------------- |
| `--network <id>` | Skip prompts and use specific network ID (`citrea`/`monad`). |
| `--serve`        | Start the REST API server on port 3000.                      |
| `--incremental`  | Resumes from the last known block in the DB.                 |
| `--address <0x>` | Override the contract address for the current session.       |

> [!TIP]
> Use the cumulative `pnpm hybrid -h` for the most complete experience, as it ensures your database is up-to-date before transitioning to real-time events.

### Verifying State

View statistics, database size, and record counts.

```bash
pnpm db:check
```

### Development Reset

Clear all locally cached SQLite databases to force a clean historical backfill on the next run.

```bash
pnpm db:reset && pnpm start
```

## API Usage

Fetch metrics via HTTP:

```bash
curl http://localhost:3000/metrics
```
