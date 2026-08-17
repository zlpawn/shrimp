# 🗄️ Database Hub MCP (多数据库大模型管理与查询服务)

Database Hub 是一个自研的通用多数据库 MCP 服务，为大模型（Claude / Codex / ChatGPT / Antigravity 等）提供 **MySQL、Redis、SQLite** 等数据库的**元数据感知、表结构探查、自然语言转 SQL (NL2SQL) 执行、CRUD 数据操作与 Redis 键值管理**能力。

---

## 🌟 核心特性

1. **多数据源统一挂载**：单个 MCP 服务可同时挂载多个不同的 MySQL、Redis 和 SQLite 实例。
2. **极简 `env` 环境变量配置**：直接以 `库名: "连接URL"` 形式配置，支持标准 URL 及 Java JDBC 格式。
3. **大模型专属工具集**：
   - 表结构与字段注释查看（`list_tables`, `describe_table`, `get_database_summary`）
   - 安全 SQL 查询与分页采样（`query_sql`）
   - 数据变更与防误删安全防护（`execute_mutation`）
   - Redis 专属键扫描与智能类型解析（`redis_scan_keys`, `redis_get_key`, `redis_execute_command`）

---

## ⚙️ 环境变量配置指南 (Environment Variables)

在 MCP 的 `env` 节点中，以 **“库名称 / 别名”** 为 Key，以 **“连接 URL”** 为 Value：

### 配置示例

```json
{
  "env": {
    "order_center": "mysql://root:123456@192.168.1.10:3306/orders_db",
    "user_center": "jdbc:mysql://192.168.1.20:3306/users_db?user=admin&password=secret_password",
    "session_redis": "redis://:redis_password@192.168.1.30:6379/0",
    "local_sqlite": "sqlite:///d:/data/local_app.db"
  }
}
```

### 支持的 URL 协议格式：

| 数据库类型 | 支持的 URL 格式示例 |
| :--- | :--- |
| **MySQL (标准)** | `mysql://user:password@host:port/database?charset=utf8mb4` |
| **MySQL (JDBC兼容)** | `jdbc:mysql://host:port/database?user=xxx&password=yyy` |
| **Redis** | `redis://:password@host:port/dbIndex` 或 `rediss://...` (TLS) |
| **SQLite** | `sqlite:///d:/path/to/database.db` 或 `sqlite:./data.db` |

---

## 🛠️ 提供的 MCP Tools 工具清单

### 1. 关系型数据库工具 (MySQL / SQLite)
- **`list_databases`**：列出当前挂载的所有数据库 ID 与连接状态。
- **`list_tables`**：获取指定库的所有表名及注释（参数：`db_id` 可选）。
- **`describe_table`**：查看数据表的字段名、字段类型、字段注释、主键及索引（参数：`table_name` 必填，`db_id` 可选）。
- **`get_database_summary`**：一键生成全库所有表及字段注释的高密度概览，为大模型生成精准 SQL 提供全局上下文。
- **`query_sql`**：执行 SQL SELECT 查询，支持自动分页与 `max_rows` 保护（参数：`sql` 必填，`db_id` 可选，`max_rows` 默认 50）。
- **`execute_mutation`**：执行 INSERT / UPDATE / DELETE / DDL 变更，内置无 WHERE 条件的高危拦截（参数：`sql` 必填，`allow_unsafe` 可选）。

### 2. Redis 数据库工具
- **`redis_scan_keys`**：根据 pattern 模糊匹配扫描键（参数：`pattern` 默认 `*`，`count` 默认 50）。
- **`redis_get_key`**：智能读取键值（自动识别 String/Hash/List/Set/ZSet 解析为 JSON）。
- **`redis_execute_command`**：执行原生 Redis 命令（如 `SET`, `HGETALL`, `INCR`, `EXPIRE` 等）。

---

## 🚀 客户端配置示例

### 1. Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "database-hub": {
      "command": "node",
      "args": ["d:/agent-transfer/mcps/database-hub/index.mjs"],
      "env": {
        "order_center": "mysql://root:123456@127.0.0.1:3306/orders_db",
        "redis_cache": "redis://:auth123@127.0.0.1:6379/0"
      }
    }
  }
}
```

### 2. OpenAI Codex (`codex.toml`)
```toml
[mcp_servers.database_hub]
command = "node"
args = ["d:/agent-transfer/mcps/database-hub/index.mjs"]

[mcp_servers.database_hub.env]
order_center = "mysql://root:123456@127.0.0.1:3306/orders_db"
redis_cache = "redis://:auth123@127.0.0.1:6379/0"
```
