# Leo Database Hub CLI

独立的 MySQL / Redis / SQLite 操作 CLI，与 database-hub MCP 完全独立。

## 配置

默认读取：

```text
~/.shrimp/secrets/database-hub/connections.json
```

示例：

```json
{
  "version": 1,
  "connections": {
    "orders": {
      "type": "mysql",
      "url": "env:ORDERS_MYSQL_URL",
      "access": "read"
    },
    "local": {
      "type": "sqlite",
      "path": "~/data/app.db",
      "access": "readwrite"
    },
    "cache": {
      "type": "redis",
      "url": "env:CACHE_REDIS_URL",
      "access": "readwrite"
    }
  }
}
```

单个连接 URL 可用 `LEO_DB_<CONNECTION>_URL` 临时覆盖。MySQL 依赖 `mysql2`，Redis 依赖 `ioredis`，SQLite 使用 Node 内置 `node:sqlite`。

## 用法

```bash
leo-database-hub connections
leo-database-hub tables orders
leo-database-hub describe orders users
leo-database-hub summary orders
leo-database-hub query orders "SELECT * FROM users LIMIT 20"
leo-database-hub execute orders --file fix.sql --write --yes
leo-database-hub redis keys cache --pattern 'user:*'
leo-database-hub redis get cache session:1
leo-database-hub redis exec cache SET session:1 '{"uid":1}' --write
```

`query` 永远只读；写操作需要 `--write`，破坏性操作还需要 `--yes`。
