import { classifySqlCommand } from "../core/policy.mjs";

function baseAdapter() {
  return {
    id: "mysql",
    family: "sql",
    displayName: "MySQL",
    capabilities: { schemaIntrospection: true, tableComments: true, transactions: true, scriptExecution: true },
    classifyOperation({ operation, sql }) {
      return { operation, operationClass: classifySqlCommand(sql) };
    },
  };
}

export const mysqlAdapter = {
  ...baseAdapter(),
  withDependencies({ createPool = defaultCreatePool } = {}) {
    return {
      ...baseAdapter(),
      async connect(resolved) {
        return {
          id: resolved.id,
          type: "mysql",
          database: resolved.database,
          pool: createPool({
            host: resolved.host,
            port: resolved.port,
            user: resolved.user,
            password: resolved.password,
            database: resolved.database,
            waitForConnections: true,
            connectionLimit: 5,
          }),
        };
      },
      async testConnection(context) {
        const [rows] = await context.pool.query("SELECT 1 AS ok");
        return rows.length > 0;
      },
      async listTables(context) {
        const [rows] = await context.pool.query("SHOW TABLES");
        return rows.map((row) => ({ name: Object.values(row)[0], comment: "" }));
      },
      async describeTable(context, tableName) {
        const [columns] = await context.pool.query("SHOW COLUMNS FROM ??", [tableName]);
        return { table: tableName, columns, summary: JSON.stringify(columns) };
      },
      async getSummary(context) {
        const tables = await this.listTables(context);
        const parts = [];
        for (const table of tables) parts.push(`${table.name}: ${(await this.describeTable(context, table.name)).summary}`);
        return parts.join("\n");
      },
      async query(context, sql, options = {}) {
        if (this.classifyOperation({ operation: "query", sql }).operationClass !== "read") {
          throw new Error("query only supports read-only SQL.");
        }
        const maxRows = normalizeMaxRows(options.maxRows);
        const finalSql = /\blimit\b/i.test(sql) ? sql : `${sql.replace(/;+$/, "")} LIMIT ${maxRows}`;
        const [rows, fields] = await context.pool.query(finalSql);
        return {
          connection: context.id,
          type: context.type,
          sql: finalSql,
          columns: fields?.map((field) => field.name) || [],
          rowCount: Array.isArray(rows) ? rows.length : 0,
          rows: Array.isArray(rows) ? rows : [rows],
        };
      },
      async executeScript(context, statements) {
        const results = [];
        try {
          await context.pool.query("START TRANSACTION");
          for (const statement of statements) {
            const [result] = await context.pool.query(statement);
            results.push({ sql: statement, affectedRows: result.affectedRows || 0, insertId: result.insertId || null });
          }
          await context.pool.query("COMMIT");
          return results;
        } catch (error) {
          try { await context.pool.query("ROLLBACK"); } catch {}
          throw new Error(`MySQL script failed and was rolled back: ${sanitizeError(error)}`);
        }
      },
      async close(context) { await context.pool.end(); },
    };
  },
};

async function defaultCreatePool(options) {
  const mysql = await import("mysql2/promise");
  return mysql.default.createPool(options);
}

function normalizeMaxRows(value) {
  const parsed = Number(value || 50);
  return Math.max(1, Math.min(1000, Number.isFinite(parsed) ? parsed : 50));
}

function sanitizeError(error) {
  return String(error.message || error).replace(/(?:password|passwd|pwd)=[^\s&]+/gi, "password=***");
}
