import fs from "node:fs";
import path from "node:path";
import { classifySqlCommand } from "../core/policy.mjs";

function baseAdapter() {
  return {
    id: "sqlite",
    family: "sql",
    displayName: "SQLite",
    capabilities: {
      schemaIntrospection: true,
      tableComments: false,
      transactions: true,
      scriptExecution: true,
    },
    classifyOperation({ operation, sql }) {
      return { operation, operationClass: classifySqlCommand(sql) };
    },
  };
}

export const sqliteAdapter = {
  ...baseAdapter(),
  withDependencies({ loadDriver = loadSqliteDriver } = {}) {
    return {
      ...baseAdapter(),
      async connect(resolved) {
        const dbPath = resolved.path || ":memory:";
        if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        const driver = await loadDriver();
        return { id: resolved.id, type: "sqlite", path: dbPath, db: new driver.DatabaseSync(dbPath) };
      },
      async testConnection(context) {
        return Boolean(context.db.prepare("SELECT 1 AS ok").get());
      },
      async listTables(context) {
        return context.db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
          .map((row) => ({ name: row.name, type: row.type, comment: "" }));
      },
      async describeTable(context, tableName) {
        const safeName = String(tableName).replace(/[^a-zA-Z0-9_]/g, "");
        const columns = context.db.prepare(`PRAGMA table_info("${safeName}")`).all();
        return { table: tableName, columns, summary: JSON.stringify(columns) };
      },
      async getSummary(context) {
        const tables = await this.listTables(context);
        const parts = [];
        for (const table of tables) {
          const described = await this.describeTable(context, table.name);
          parts.push(`${table.name}: ${described.summary}`);
        }
        return parts.join("\n");
      },
      async query(context, sql, options = {}) {
        const classification = this.classifyOperation({ operation: "query", sql }).operationClass;
        if (classification !== "read") throw new Error("query only supports read-only SQL.");
        const maxRows = normalizeMaxRows(options.maxRows);
        const rows = context.db.prepare(wrapLimit(sql, maxRows)).all();
        return normalizedQueryResult(context, sql, rows);
      },
      async executeScript(context, statements) {
        const results = [];
        try {
          context.db.exec("BEGIN");
          for (const statement of statements) {
            const info = context.db.prepare(statement).run();
            results.push({ sql: statement, affectedRows: Number(info.changes || 0), lastInsertRowid: Number(info.lastInsertRowid || 0) });
          }
          context.db.exec("COMMIT");
          return results;
        } catch (error) {
          try { context.db.exec("ROLLBACK"); } catch {}
          throw new Error(`SQLite script failed and was rolled back: ${error.message}`);
        }
      },
      async close(context) { context.db.close(); },
    };
  },
};

async function loadSqliteDriver() {
  const sqlite = await import("node:sqlite");
  return sqlite;
}

function wrapLimit(sql, maxRows) {
  return /\blimit\b/i.test(sql) ? sql : `${sql.replace(/;+$/, "")} LIMIT ${maxRows}`;
}

function normalizeMaxRows(value) {
  const parsed = Number(value || 50);
  return Math.max(1, Math.min(1000, Number.isFinite(parsed) ? parsed : 50));
}

function normalizedQueryResult(context, sql, rows) {
  return {
    connection: context.id,
    type: context.type,
    sql,
    columns: rows.length ? Object.keys(rows[0]) : [],
    rowCount: rows.length,
    rows,
  };
}
