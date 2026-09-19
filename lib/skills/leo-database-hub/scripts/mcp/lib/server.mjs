import { McpStdioServer } from "./mcp-server.mjs";
import { DatabaseManager } from "./manager.mjs";
import { loadDataSources } from "./config-loader.mjs";

export function createDatabaseHubServer(env = process.env) {
  const dataSources = loadDataSources(env);
  const manager = new DatabaseManager(dataSources);

  const server = new McpStdioServer({
    name: "database-hub",
    version: "1.0.0",
    description: "多数据库 (MySQL / Redis / SQLite) 统一大模型查询与数据管理 MCP 服务",
    instructions:
      "本服务提供 MySQL、Redis、SQLite 数据库的元数据感知、表结构探查、自然语言转 SQL (NL2SQL) 查询、数据增删改及 Redis 键值管理工具。在生成复杂查询前，建议先调用 get_database_summary 或 describe_table 了解字段含义与类型。",
  });

  // Tool 1: list_databases
  server.registerTool({
    name: "list_databases",
    description: "列出当前已配置的所有数据库（MySQL、Redis、SQLite）。当存在多个数据源时，可通过此工具获取每个库的 ID / 别名。",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const list = await manager.listDatabases();
      return {
        total: list.length,
        databases: list,
        hint:
          list.length === 0
            ? "当前尚未配置任何数据库，请在环境变量中通过 'order_center=mysql://...' 或 'cache=redis://...' 进行配置。"
            : "调用其他工具时，若配置了多个数据库，请传入对应的 db_id 参数。",
      };
    },
  });

  // Tool 2: list_tables
  server.registerTool({
    name: "list_tables",
    description: "获取指定关系型数据库（MySQL / SQLite）中的所有数据表名及表注释。",
    inputSchema: {
      type: "object",
      properties: {
        db_id: {
          type: "string",
          description: "数据库 ID / 别名（当配置了多个关系型数据库时必填，单个库时可选）",
        },
      },
    },
    handler: async (args) => {
      const adapter = manager.getAdapter(args.db_id, "sql");
      const tables = await adapter.listTables();
      return {
        databaseId: adapter.config.id,
        type: adapter.config.type,
        totalTables: tables.length,
        tables,
      };
    },
  });

  // Tool 3: describe_table
  server.registerTool({
    name: "describe_table",
    description: "获取数据表的详细结构定义，包括字段名、类型、主键、是否为空、字段注释/含义、索引及外键约束。",
    inputSchema: {
      type: "object",
      properties: {
        table_name: {
          type: "string",
          description: "要查看结构的数据表名称（如 'orders', 'users'）",
        },
        db_id: {
          type: "string",
          description: "数据库 ID / 别名（单个库时可选）",
        },
      },
      required: ["table_name"],
    },
    handler: async (args) => {
      const adapter = manager.getAdapter(args.db_id, "sql");
      const desc = await adapter.describeTable(args.table_name);
      return {
        databaseId: adapter.config.id,
        type: adapter.config.type,
        ...desc,
      };
    },
  });

  // Tool 4: get_database_summary
  server.registerTool({
    name: "get_database_summary",
    description:
      "一键获取整个数据库所有表及其字段名、数据类型和字段注释的全局结构概览。大模型生成 SQL 查询前调用此工具可获取最全面的上下文。",
    inputSchema: {
      type: "object",
      properties: {
        db_id: {
          type: "string",
          description: "数据库 ID / 别名（单个库时可选）",
        },
      },
    },
    handler: async (args) => {
      const adapter = manager.getAdapter(args.db_id, "sql");
      const summary = await adapter.getDatabaseSummary();
      return {
        databaseId: adapter.config.id,
        type: adapter.config.type,
        summary: summary || "(数据库中暂无数据表)",
      };
    },
  });

  // Tool 5: query_sql
  server.registerTool({
    name: "query_sql",
    description:
      "在关系型数据库（MySQL / SQLite）中执行通用 SQL 查询（如 SELECT）。支持自动限制最大返回记录数，防止超大结果集消耗模型上下文。",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "要执行的 SQL 查询语句（如 SELECT * FROM orders WHERE amount > 100）",
        },
        db_id: {
          type: "string",
          description: "目标数据库 ID / 别名（单个库时可选）",
        },
        max_rows: {
          type: "number",
          description: "最大返回行数（默认 50 条，最大建议 200 条）",
        },
      },
      required: ["sql"],
    },
    handler: async (args) => {
      const adapter = manager.getAdapter(args.db_id, "sql");
      const result = await adapter.querySql(args.sql, args.max_rows || 50);
      return {
        databaseId: adapter.config.id,
        type: adapter.config.type,
        ...result,
      };
    },
  });

  // Tool 6: execute_mutation
  server.registerTool({
    name: "execute_mutation",
    description:
      "执行数据写入或结构修改 SQL（INSERT、UPDATE、DELETE、CREATE TABLE、ALTER TABLE）。内置防误删安全拦截。",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "要执行的变更 SQL 语句",
        },
        db_id: {
          type: "string",
          description: "目标数据库 ID / 别名（单个库时可选）",
        },
        allow_unsafe: {
          type: "boolean",
          description: "是否允许无 WHERE 条件的 UPDATE/DELETE 或 DROP 等高危操作（默认 false）",
        },
      },
      required: ["sql"],
    },
    handler: async (args) => {
      const adapter = manager.getAdapter(args.db_id, "sql");
      const result = await adapter.executeMutation(args.sql, args.allow_unsafe === true);
      return {
        databaseId: adapter.config.id,
        type: adapter.config.type,
        ...result,
      };
    },
  });

  // Tool 7: redis_scan_keys
  server.registerTool({
    name: "redis_scan_keys",
    description: "在 Redis 数据库中根据 pattern 模糊匹配扫描键（Keys）列表及类型/TTL 信息。",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "匹配模式（如 'user:*', 'order:100*'，默认为 '*'）",
        },
        count: {
          type: "number",
          description: "扫描数量限制（默认 50）",
        },
        db_id: {
          type: "string",
          description: "Redis 数据源 ID（单个 Redis 时可选）",
        },
      },
    },
    handler: async (args) => {
      const adapter = manager.getAdapter(args.db_id, "redis");
      const result = await adapter.scanKeys(args.pattern || "*", args.count || 50);
      return {
        databaseId: adapter.config.id,
        ...result,
      };
    },
  });

  // Tool 8: redis_get_key
  server.registerTool({
    name: "redis_get_key",
    description:
      "智能读取 Redis 任意键的完整数据（自动识别 String / Hash / List / Set / ZSet 并转为 JSON 格式）。",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "要读取的 Redis 键名",
        },
        db_id: {
          type: "string",
          description: "Redis 数据源 ID（单个 Redis 时可选）",
        },
      },
      required: ["key"],
    },
    handler: async (args) => {
      const adapter = manager.getAdapter(args.db_id, "redis");
      const result = await adapter.getKey(args.key);
      return {
        databaseId: adapter.config.id,
        ...result,
      };
    },
  });

  // Tool 9: redis_execute_command
  server.registerTool({
    name: "redis_execute_command",
    description: "执行任意原生 Redis 命令（如 SET, GET, HSET, HGETALL, LPUSH, INCR, EXPIRE, TTL, DEL 等）。",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Redis 命令名称（如 'SET', 'HSET', 'INCR', 'EXPIRE'）",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "命令参数列表，如 ['mykey', 'value'] 或 ['mykey', '60']",
        },
        db_id: {
          type: "string",
          description: "Redis 数据源 ID（单个 Redis 时可选）",
        },
      },
      required: ["command"],
    },
    handler: async (args) => {
      const adapter = manager.getAdapter(args.db_id, "redis");
      const result = await adapter.executeCommand(args.command, args.args || []);
      return {
        databaseId: adapter.config.id,
        command: args.command,
        result,
      };
    },
  });

  return {
    server,
    manager,
  };
}
