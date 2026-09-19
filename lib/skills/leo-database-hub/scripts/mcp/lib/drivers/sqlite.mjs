import fs from "node:fs";
import path from "node:path";

/**
 * SQLite Driver Adapter for MCP
 * Uses native node:sqlite (Node 22+) with fallback to better-sqlite3 or sqlite3.
 */

export class SqliteAdapter {
  constructor(config) {
    this.config = config;
    this.dbPath = config.path || ":memory:";
    this.db = null;
  }

  async getDb() {
    if (this.db) return this.db;

    // Ensure directory exists if file path
    if (this.dbPath !== ":memory:") {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    try {
      const { DatabaseSync } = await import("node:sqlite");
      this.db = new DatabaseSync(this.dbPath);
      this.engine = "node:sqlite";
      return this.db;
    } catch {
      try {
        const BetterSqlite3 = (await import("better-sqlite3")).default;
        this.db = new BetterSqlite3(this.dbPath);
        this.engine = "better-sqlite3";
        return this.db;
      } catch (err) {
        throw new Error(
          `SQLite driver could not be initialized: ${err.message}. Please use Node 22+ with node:sqlite or run 'npm install better-sqlite3'.`
        );
      }
    }
  }

  async testConnection() {
    const db = await this.getDb();
    if (this.engine === "node:sqlite") {
      const stmt = db.prepare("SELECT 1 AS ok");
      const row = stmt.get();
      return Boolean(row);
    }
    return Boolean(db.prepare("SELECT 1 AS ok").get());
  }

  async listTables() {
    const db = await this.getDb();
    const sql = `SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`;
    let rows = [];
    if (this.engine === "node:sqlite") {
      rows = db.prepare(sql).all();
    } else {
      rows = db.prepare(sql).all();
    }

    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      comment: "",
    }));
  }

  async describeTable(tableName) {
    const db = await this.getDb();
    const cleanName = tableName.replace(/[^a-zA-Z0-9_]/g, "");

    let cols = [];
    let fks = [];
    let idxs = [];

    const colSql = `PRAGMA table_info("${cleanName}")`;
    const fkSql = `PRAGMA foreign_key_list("${cleanName}")`;
    const idxSql = `PRAGMA index_list("${cleanName}")`;

    if (this.engine === "node:sqlite") {
      cols = db.prepare(colSql).all();
      fks = db.prepare(fkSql).all();
      idxs = db.prepare(idxSql).all();
    } else {
      cols = db.prepare(colSql).all();
      fks = db.prepare(fkSql).all();
      idxs = db.prepare(idxSql).all();
    }

    const formattedCols = cols.map((c) => ({
      name: c.name,
      type: c.type || "TEXT",
      nullable: c.notnull === 1 ? "NO" : "YES",
      key: c.pk === 1 ? "PRI" : "",
      defaultValue: c.dflt_value,
      comment: "",
    }));

    return {
      table: cleanName,
      columns: formattedCols,
      foreignKeys: fks,
      indexes: idxs,
    };
  }

  async getDatabaseSummary() {
    const tables = await this.listTables();
    const summary = [];

    for (const t of tables) {
      const desc = await this.describeTable(t.name);
      const colLines = desc.columns.map((c) => {
        const keyTag = c.key ? ` [${c.key}]` : "";
        return `    - ${c.name} (${c.type}${c.nullable === "NO" ? ", NOT NULL" : ""}${keyTag})`;
      });

      summary.push(`Table: ${t.name} (${t.type})\n${colLines.join("\n")}`);
    }

    return summary.join("\n\n");
  }

  async querySql(sql, maxRows = 50) {
    const start = Date.now();
    const db = await this.getDb();

    const cleanSql = sql.trim().replace(/^;+|;+$/g, "");
    const lowerSql = cleanSql.toLowerCase();

    let finalSql = cleanSql;
    if (lowerSql.startsWith("select") && !lowerSql.includes("limit")) {
      finalSql = `${cleanSql} LIMIT ${parseInt(maxRows, 10) || 50}`;
    }

    let rows = [];
    if (this.engine === "node:sqlite") {
      const stmt = db.prepare(finalSql);
      rows = stmt.all();
    } else {
      rows = db.prepare(finalSql).all();
    }

    const executionMs = Date.now() - start;
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return {
      sql: finalSql,
      rowCount: rows.length,
      columns,
      rows,
      executionMs,
    };
  }

  async executeMutation(sql, allowUnsafe = false) {
    const start = Date.now();
    const cleanSql = sql.trim().replace(/^;+|;+$/g, "");
    const lowerSql = cleanSql.toLowerCase();

    if (!allowUnsafe) {
      if ((lowerSql.startsWith("delete") || lowerSql.startsWith("update")) && !lowerSql.includes("where")) {
        throw new Error(
          "Safety Guard: UPDATE or DELETE without a WHERE clause is blocked. Set allow_unsafe=true if this is intentional."
        );
      }
      if (lowerSql.startsWith("drop table") && !lowerSql.includes("if exists")) {
        throw new Error("Safety Guard: DROP TABLE without IF EXISTS is blocked.");
      }
    }

    const db = await this.getDb();
    let result = null;

    if (this.engine === "node:sqlite") {
      const stmt = db.prepare(cleanSql);
      const res = stmt.run();
      result = {
        changes: Number(res.changes || 0),
        lastInsertRowid: Number(res.lastInsertRowid || 0),
      };
    } else {
      const res = db.prepare(cleanSql).run();
      result = {
        changes: Number(res.changes || 0),
        lastInsertRowid: Number(res.lastInsertRowid || 0),
      };
    }

    const executionMs = Date.now() - start;

    return {
      sql: cleanSql,
      affectedRows: result.changes,
      lastInsertRowid: result.lastInsertRowid,
      message: "OK",
      executionMs,
    };
  }

  async close() {
    if (this.db) {
      if (typeof this.db.close === "function") {
        this.db.close();
      }
      this.db = null;
    }
  }
}
