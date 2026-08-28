---
name: leo-database-hub
description: 通过 leo-database-hub CLI 安全查询和管理 MySQL、Redis、SQLite 数据连接，支持表结构探查、SQL 查询、事务执行和 Redis 命令。
---

# Leo Database Hub

触发时机：用户要求查看数据库连接、分析表结构、查询数据、修改数据、执行 SQL 文件，或管理 Redis 键值。

## 工作流

1. 先执行 `leo-database-hub connections`，确认可用连接和访问级别。
2. SQL 查询前优先执行 `summary` 或 `describe`，确认字段、类型和表名。
3. 读数据使用 `query`，默认最多 50 行；确有需要时通过 `--max-rows` 提高，最大 1000。
4. Redis 先用 `redis keys` 缩小范围，再用 `redis get` 读取具体键。

## 安全规则

- `query` 只能执行只读 SQL，不得用来改写数据。
- 写入、DDL、删除键、EXPIRE 等 Redis 写命令需要 `--write`；执行前必须向用户说明影响并获得确认。
- DROP、TRUNCATE、FLUSH、SHUTDOWN 等破坏性操作需要 `--write --yes`；必须在用户明确确认目标后再执行。
- connection 配置为 `read` 时不得尝试写操作。
- 永远不要查看、输出或复述连接 URL、用户名或密码；连接列表已经是脱敏格式。

## 常用命令

```bash
leo-database-hub connections
leo-database-hub tables <connection>
leo-database-hub describe <connection> <table>
leo-database-hub summary <connection>
leo-database-hub query <connection> "SELECT ..."
leo-database-hub execute <connection> --file ./fix.sql --write --yes
leo-database-hub redis keys <connection> --pattern 'user:*'
leo-database-hub redis get <connection> <key>
leo-database-hub redis exec <connection> SET key value --write
```
