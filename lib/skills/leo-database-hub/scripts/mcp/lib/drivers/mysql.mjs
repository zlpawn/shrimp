/**
 * MySQL Driver Adapter for MCP
 */

let mysqlModule = null;

async function getMysql() {
  if (!mysqlModule) {
    try {
      mysqlModule = await import("mysql2/promise");
    } catch (err) {
      throw new Error(
        "MySQL driver (mysql2) is not installed. Please run 'npm install mysql2' in mcps/database-hub or project root."
      );
    }
  }
  return mysqlModule.default || mysqlModule;
}

export class MysqlAdapter {
  constructor(config) {
    this.config = config;
    this.pool = null;
    this.database = config.database;
  }

  async getPool() {
    if (this.pool) return this.pool;
    const mysql = await getMysql();
    this.pool = mysql.createPool({
      host: this.config.host || "127.0.0.1",
      port: this.config.port || 3306,
      user: this.config.user || "root",
      password: this.config.password || "",
      database: this.config.database || undefined,
      charset: this.config.charset || "utf8mb4",
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 10000,
    });
    return this.pool;
  }

  async testConnection() {
    const pool = await this.getPool();
    const [rows] = await pool.query("SELECT 1 AS ok");
    return rows && rows.length > 0;
  }

  async listTables() {
    const pool = await this.getPool();
    const schema = this.database || "";
    if (!schema) {
      const [rows] = await pool.query("SHOW TABLES");
      return rows.map((r) => ({ name: Object.values(r)[0], comment: "" }));
    }

    const [rows] = await pool.query(
      `SELECT 
        TABLE_NAME AS name, 
        TABLE_COMMENT AS comment, 
        TABLE_ROWS AS estimatedRows,
        CREATE_TIME AS createTime
       FROM information_schema.TABLES 
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [schema]
    );
    return rows;
  }

  async describeTable(tableName) {
    const pool = await this.getPool();
    const schema = this.database || "";

    const [cols] = await pool.query(
      `SELECT 
        COLUMN_NAME AS name,
        COLUMN_TYPE AS type,
        IS_NULLABLE AS nullable,
        COLUMN_KEY AS \`key\`,
        COLUMN_DEFAULT AS defaultValue,
        EXTRA AS extra,
        COLUMN_COMMENT AS comment
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [schema, tableName]
    );

    let indexes = [];
    try {
      const [idxRows] = await pool.query(`SHOW INDEX FROM \`${tableName}\``);
      indexes = idxRows.map((idx) => ({
        keyName: idx.Key_name,
        columnName: idx.Column_name,
        nonUnique: idx.Non_unique === 1,
        seqInIndex: idx.Seq_in_index,
      }));
    } catch {
      // ignore index read failure
    }

    return {
      table: tableName,
      columns: cols,
      indexes,
    };
  }

  async getDatabaseSummary() {
    const tables = await this.listTables();
    const summary = [];

    for (const t of tables) {
      const desc = await this.describeTable(t.name);
      const colLines = desc.columns.map((c) => {
        const keyTag = c.key ? ` [${c.key}]` : "";
        const commentTag = c.comment ? ` - ${c.comment}` : "";
        return `    - ${c.name} (${c.type}${c.nullable === "NO" ? ", NOT NULL" : ""}${keyTag})${commentTag}`;
      });

      summary.push(
        `Table: ${t.name}${t.comment ? ` (${t.comment})` : ""}\n${colLines.join("\n")}`
      );
    }

    return summary.join("\n\n");
  }

  async querySql(sql, maxRows = 50) {
    const start = Date.now();
    const pool = await this.getPool();

    // Check if query is dangerous
    const cleanSql = sql.trim().replace(/^;+|;+$/g, "");
    const lowerSql = cleanSql.toLowerCase();

    // Add LIMIT if not present for SELECT queries
    let finalSql = cleanSql;
    if (lowerSql.startsWith("select") && !lowerSql.includes("limit")) {
      finalSql = `${cleanSql} LIMIT ${parseInt(maxRows, 10) || 50}`;
    }

    const [rows, fields] = await pool.query(finalSql);
    const executionMs = Date.now() - start;

    return {
      sql: finalSql,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      columns: fields ? fields.map((f) => f.name) : [],
      rows: Array.isArray(rows) ? rows : [rows],
      executionMs,
    };
  }

  async executeMutation(sql, allowUnsafe = false) {
    const start = Date.now();
    const cleanSql = sql.trim().replace(/^;+|;+$/g, "");
    const lowerSql = cleanSql.toLowerCase();

    if (!allowUnsafe) {
      // Guard against unconditional DELETE or UPDATE
      if ((lowerSql.startsWith("delete") || lowerSql.startsWith("update")) && !lowerSql.includes("where")) {
        throw new Error(
          "Safety Guard: UPDATE or DELETE without a WHERE clause is blocked. Set allow_unsafe=true if this is intentional."
        );
      }
      if (lowerSql.startsWith("drop database") || lowerSql.startsWith("drop schema")) {
        throw new Error("Safety Guard: DROP DATABASE is blocked for safety.");
      }
    }

    const pool = await this.getPool();
    const [result] = await pool.query(cleanSql);
    const executionMs = Date.now() - start;

    return {
      sql: cleanSql,
      affectedRows: result.affectedRows ?? 0,
      insertId: result.insertId ?? null,
      changedRows: result.changedRows ?? 0,
      message: result.message || "OK",
      executionMs,
    };
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
