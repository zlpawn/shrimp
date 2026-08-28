# Leo Database Hub CLI Design

## Status

Approved for implementation on 2026-08-28.

## Goals

Build an independent database CLI that gives shell-capable agents the same coverage as the existing database-hub MCP:

- Discover configured MySQL, Redis, and SQLite connections.
- Inspect schemas and Redis values.
- Execute read SQL and Redis read commands safely.
- Execute SQL writes/DDL and arbitrary Redis commands when explicitly authorized.
- Remain fully independent of the MCP implementation and its environment-based configuration.
- Preserve a stable extension path for PostgreSQL, ClickHouse, MongoDB, Elasticsearch, and future credential providers.

The companion Skill is named `leo-database-hub`. The executable is `leo-database-hub`. The existing MCP remains independently configured and distributed.

## Non-Goals

- No dynamic external plugin loading in phase 1. Adapters are compiled into the CLI through an internal registry.
- No wrapper around the database-hub MCP.
- No attempt to unify MCP and CLI configuration.
- No SSH tunnel or cloud credential refresh flow in phase 1.

## Architecture

The CLI is organized around an adapter SPI rather than database-specific command handlers.

```
clis/leo-database-hub/
  index.mjs
  lib/
    cli.mjs
    config/
      store.mjs
      resolver.mjs
    core/
      registry.mjs
      policy.mjs
      result.mjs
    adapters/
      mysql.mjs
      sqlite.mjs
      redis.mjs
    output.mjs
```

Command dispatch validates a user operation, resolves a connection, asks the adapter registry for the matching adapter, applies operation policy, delegates to the adapter, and emits a normalized result through a formatter.

### Adapter Contract

SQL-family adapters expose:

- `connect(resolved)`
- `listTables(context)`
- `describeTable(context, tableName)`
- `getSummary(context)`
- `query(context, sql, options)`
- `executeScript(context, statements, options)`
- `close(context)`
- `classifyOperation({ operation, sql })`

KV-family adapters expose:

- `connect(resolved)`
- `scanKeys(context, pattern, options)`
- `getKey(context, key)`
- `executeCommand(context, command, args)`
- `close(context)`
- `classifyOperation({ operation, command })`

Every adapter declares:

-`id`
- `family`: `sql` or `kv`
- `displayName`
- `capabilities`

The command layer uses capabilities and family; it never imports an adapter directly.

## Connection Configuration

Configuration is stored at:

```
~/.shrimp/secrets/database-hub/connections.json
```

`SHRIMP_SECRETS_DIR` overrides the secrets root. The configuration directory is mode 700 and the JSON file is mode 600.

Shape:

```json
{
  "version": 1,
  "connections": {
    "orders": {
      "type": "mysql",
      "url": "mysql://user:password@127.0.0.1:3306/orders",
      "access": "readwrite"
    },
    "orders_prod": {
      "type": "mysql",
      "url": "env:ORDERS_PROD_MYSQL_URL",
      "access": "read"
    },
    "cache": {
      "type": "redis",
      "url": "redis://:password@127.0.0.1:6379/0",
      "access": "readwrite"
    },
    "local": {
      "type": "sqlite",
      "path": "~/data/app.db",
      "access": "readwrite"
    }
  }
}
```

MySQL may alternatively use structured fields:

```json
{
  "type": "mysql",
  "host": "127.0.0.1",
  "port": 3306,
  "user": "app",
  "password": "env:APP_DB_PASSWORD",
  "database": "orders"
}
```

Resolution precedence for a connection URL:

1. `LEO_DB_<CONNECTION_ID_UPPER>_URL`
2. Stored `url`
3. Structured fields

Literal and `env:` secret forms are supported. The resolver is intentionally isolated so `keychain:` and `file:` can be added later.

`connections list` output includes only connection id, adapter id, family, display target, and access mode. It never includes usernames, passwords, query strings, or resolved URLs.

### Configuration Management

```bash
leo-database-hub connections
leo-database-hub connection test <id>
leo-database-hub connection import --stdin
```

Phase 1 does not include an interactive editor. Users may create the JSON file directly or import complete JSON through stdin. Import validates adapter ids and access modes, then writes restricted permissions.

## Command Surface

### Discovery

```bash
leo-database-hub connections
leo-database-hub adapters
leo-database-hub connection test <id>
```

### SQL

```bash
leo-database-hub tables <connection>
leo-database-hub describe <connection> <table>
leo-database-hub summary <connection>
leo-database-hub query <connection> "SELECT * FROM users"
leo-database-hub execute <connection> --file ./fix.sql --write --yes
leo-database-hub execute <connection> "UPDATE users SET status=1 WHERE id=10" --write --yes
```

`query` is read-only and rejects write/DDL statements even when connection access is readwrite.

### Redis

```bash
leo-database-hub redis keys <connection> --pattern "user:*"
leo-database-hub redis get <connection> <key>
leo-database-hub redis exec <connection> SET session:1 '{"uid":1}' --write --yes
leo-database-hub redis exec <connection> EXPIRE session:1 600 --write
```

`keys` and `get` are read operations. `exec` is classified by command name and checked by policy.

## Operation Policy

Connection access values:

- `read`: permits `read` operations only.
- `readwrite`: permits read and authorized write/destructive operations.

Operation classes:

- `read`: no extra authorization.
- `write`: requires `--write`.
- `destructive`: requires `--write --yes`.

SQL classification:

- SELECT, PRAGMA table reads, EXPLAIN: read.
- INSERT, UPDATE, DELETE, CREATE, ALTER, SET, and normal Redis writes: write.
- DROP, TRUNCATE, RENAME, GRANT/REVOKE, FLUSHDB, FLUSHALL, SHUTDOWN, and similar operations: destructive.

Unsafe SQL without a WHERE clause is still classified by statement type. The policy does not try to parse every SQL edge case; it fails closed for unrecognized operations when explicit authorization is present and always rejects unrecognized operations for read commands.

## SQL Script Execution

`execute --file` reads UTF-8 SQL, splits semicolon-delimited statements while respecting single-quoted strings, double-quoted identifiers, backticks, line comments, and block comments. It executes statements in adapter-specific transactional APIs where available. Phase 1 emits one result per statement; rollback is attempted on first failure.

## Result and Output Model

All command handlers return a normalized result object. Default CLI output is JSON. `--format table` renders rows or compact lists for humans.

Query result:

```json
{
  "connection": "orders",
  "type": "mysql",
  "sql": "SELECT ...",
  "columns": ["id"],
  "rowCount": 1,
  "rows": [{ "id": 1 }]
}
```

Default row cap is 50. `--max-rows` accepts 1 through 1000. Values that fail JSON serialization are converted to safe strings.

## Dependencies

MySQL uses `mysql2`; Redis uses `ioredis`; SQLite uses Node's built-in `node:sqlite` when available and returns a clear error on older Node runtimes. These are independent CLI dependencies and do not couple the CLI to the MCP.

## Testing

Tests cover:

- Configuration schema, resolution precedence, secret masking, and restricted permissions.
- Adapter registry and family dispatch.
- SQL classifier and Redis command policy.
- SQL script splitting.
- SQLite adapter behavior using temporary databases.
- Redis typed reads and command classification with a fake connection client.
- CLI JSON/table output and authorization failures.
- In-repo CLI discovery and managed Skill installation.

## Managed Skill

The Skill name is `leo-database-hub`. It instructs agents to:

1. Start with `leo-database-hub connections`.
2. Inspect schema/value shape before querying.
3. Keep user wording and database ids explicit.
4. Use `query` for reads only.
5. Ask the user before write or destructive operations.
6. Never print connection credentials or resolved URLs.

## Extension Path

Adding a database type requires:

1. Create an adapter implementing the contract.
2. Register it in the internal registry.
3. Add adapter contract tests.
4. Update connection examples only; command grammar and policy remain unchanged.

Future formatter and secret resolver additions use separate registries so they do not affect command handlers.
