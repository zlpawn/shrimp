import { MysqlAdapter } from "./drivers/mysql.mjs";
import { RedisAdapter } from "./drivers/redis.mjs";
import { SqliteAdapter } from "./drivers/sqlite.mjs";

export class DatabaseManager {
  constructor(dataSources = []) {
    this.configs = new Map();
    this.adapters = new Map();

    for (const src of dataSources) {
      this.registerSource(src);
    }
  }

  registerSource(config) {
    if (!config || !config.id) return;
    this.configs.set(config.id, config);
  }

  getAdapter(dbId, expectedType = null) {
    // 1. If explicit dbId provided
    if (dbId) {
      const normalizedId = String(dbId).trim().toLowerCase();
      if (!this.configs.has(normalizedId)) {
        const available = Array.from(this.configs.keys()).join(", ");
        throw new Error(
          `Database '${dbId}' not found. Available configured databases: [${available || "none"}]`
        );
      }

      if (!this.adapters.has(normalizedId)) {
        const cfg = this.configs.get(normalizedId);
        this.adapters.set(normalizedId, this.createAdapter(cfg));
      }
      const adapter = this.adapters.get(normalizedId);
      if (expectedType && adapter.config.type !== expectedType && !(expectedType === "sql" && (adapter.config.type === "mysql" || adapter.config.type === "sqlite"))) {
        throw new Error(
          `Database '${dbId}' is of type '${adapter.config.type}', but this tool requires '${expectedType}'`
        );
      }
      return adapter;
    }

    // 2. If dbId is omitted, find matching candidates
    const matchingConfigs = Array.from(this.configs.values()).filter((c) => {
      if (!expectedType) return true;
      if (expectedType === "sql") return c.type === "mysql" || c.type === "sqlite";
      if (expectedType === "redis") return c.type === "redis";
      return c.type === expectedType;
    });

    if (matchingConfigs.length === 0) {
      const all = Array.from(this.configs.values()).map((c) => `${c.id} (${c.type})`).join(", ");
      throw new Error(
        `No configured database found matching type '${expectedType || "any"}'. Configured sources: [${all || "none"}]. Please configure databases in environment variables (e.g. order_center="mysql://...").`
      );
    }

    if (matchingConfigs.length > 1) {
      const list = matchingConfigs.map((c) => `'${c.id}' (${c.type})`).join(", ");
      throw new Error(
        `Multiple ${expectedType || ""} databases configured: [${list}]. Please provide the 'db_id' parameter to specify which database to use.`
      );
    }

    const defaultCfg = matchingConfigs[0];
    if (!this.adapters.has(defaultCfg.id)) {
      this.adapters.set(defaultCfg.id, this.createAdapter(defaultCfg));
    }
    return this.adapters.get(defaultCfg.id);
  }

  createAdapter(cfg) {
    switch (cfg.type) {
      case "mysql":
        return new MysqlAdapter(cfg);
      case "redis":
        return new RedisAdapter(cfg);
      case "sqlite":
        return new SqliteAdapter(cfg);
      default:
        throw new Error(`Unsupported database type: ${cfg.type}`);
    }
  }

  async listDatabases() {
    const list = [];
    for (const cfg of this.configs.values()) {
      let details = "";
      if (cfg.type === "mysql") {
        details = `${cfg.host}:${cfg.port}/${cfg.database || ""}`;
      } else if (cfg.type === "redis") {
        details = `${cfg.host}:${cfg.port} (db: ${cfg.db ?? 0})`;
      } else if (cfg.type === "sqlite") {
        details = cfg.path;
      }

      list.push({
        id: cfg.id,
        type: cfg.type,
        details,
        configuredVia: cfg.rawUrl ? "URL" : "fields",
      });
    }
    return list;
  }

  async closeAll() {
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.close();
      } catch {}
    }
    this.adapters.clear();
  }
}
