import path from "node:path";

/**
 * Normalizes and extracts database connection profiles from environment variables or custom options.
 *
 * Supported formats:
 * 1. Key-Value mapping where Key is database alias, Value is connection URL:
 *    - MySQL:  order_db="mysql://root:123456@192.168.1.10:3306/orders_db"
 *    - JDBC:   order_db="jdbc:mysql://192.168.1.10:3306/orders_db?user=root&password=123"
 *    - Redis:  cache="redis://:password@192.168.1.20:6379/0"
 *    - SQLite: local="sqlite:///d:/data/app.db" or local="sqlite:./app.db"
 *
 * 2. Prefix mapping:
 *    - MYSQL_PROD_URL="mysql://..."
 *    - DB_ORDER_MYSQL="mysql://..."
 *    - MYSQL_PROD_HOST, MYSQL_PROD_PORT, MYSQL_PROD_USER, MYSQL_PROD_PASSWORD, MYSQL_PROD_DATABASE
 *
 * 3. Default single-instance environment variables:
 *    - MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *    - REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB
 *    - SQLITE_PATH
 *
 * 4. JSON configuration string in DATABASES_CONFIG
 */

export function parseDatabaseUrl(rawUrl, idHint = "default") {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Handle JDBC prefix (e.g., jdbc:mysql://... -> mysql://...)
  let urlStr = trimmed;
  let isJdbc = false;
  if (urlStr.toLowerCase().startsWith("jdbc:")) {
    isJdbc = true;
    urlStr = urlStr.slice(5);
  }

  // Detect type by scheme
  const schemeMatch = urlStr.match(/^([a-zA-Z0-9_+.-]+):\/\//);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : "";

  // 1. MySQL
  if (scheme === "mysql" || scheme === "mysql2") {
    return parseMysqlUrl(urlStr, idHint, isJdbc);
  }

  // 2. Redis
  if (scheme === "redis" || scheme === "rediss") {
    return parseRedisUrl(urlStr, idHint);
  }

  // 3. SQLite
  if (scheme === "sqlite" || urlStr.toLowerCase().startsWith("sqlite:")) {
    return parseSqliteUrl(urlStr, idHint);
  }

  // 4. PostgreSQL (future-ready)
  if (scheme === "postgres" || scheme === "postgresql") {
    return parsePostgresUrl(urlStr, idHint, isJdbc);
  }

  // Check if it looks like a direct SQLite file path (.db, .sqlite, .sqlite3)
  if (/\.(db|sqlite|sqlite3)$/i.test(trimmed)) {
    return {
      id: idHint,
      type: "sqlite",
      path: path.resolve(trimmed),
      rawUrl: trimmed,
    };
  }

  return null;
}

function parseMysqlUrl(urlStr, id, isJdbc) {
  try {
    // If it's a JDBC URL like mysql://host:port/database?user=xxx&password=yyy
    const parsed = new URL(urlStr);
    let user = decodeURIComponent(parsed.username || "");
    let password = decodeURIComponent(parsed.password || "");
    const host = parsed.hostname || "127.0.0.1";
    const port = parsed.port ? parseInt(parsed.port, 10) : 3306;
    let database = parsed.pathname ? parsed.pathname.replace(/^\//, "") : "";

    // Query params for JDBC or options
    const searchParams = parsed.searchParams;
    if (!user && searchParams.has("user")) {
      user = searchParams.get("user");
    }
    if (!password && searchParams.has("password")) {
      password = searchParams.get("password");
    }
    if (!database && searchParams.has("database")) {
      database = searchParams.get("database");
    }
    const charset = searchParams.get("charset") || searchParams.get("characterEncoding") || "utf8mb4";
    const ssl = searchParams.has("useSSL") ? searchParams.get("useSSL") === "true" : undefined;

    return {
      id,
      type: "mysql",
      host,
      port,
      user: user || "root",
      password: password || "",
      database: database || "",
      charset,
      ssl,
      rawUrl: urlStr,
    };
  } catch (err) {
    return null;
  }
}

function parseRedisUrl(urlStr, id) {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname || "127.0.0.1";
    const port = parsed.port ? parseInt(parsed.port, 10) : 6379;
    const password = decodeURIComponent(parsed.password || "");
    const username = decodeURIComponent(parsed.username || "");
    let dbIndex = 0;
    if (parsed.pathname && parsed.pathname.length > 1) {
      const idx = parseInt(parsed.pathname.slice(1), 10);
      if (!Number.isNaN(idx)) dbIndex = idx;
    }
    const tls = parsed.protocol === "rediss:";

    return {
      id,
      type: "redis",
      host,
      port,
      username: username || undefined,
      password: password || undefined,
      db: dbIndex,
      tls,
      rawUrl: urlStr,
    };
  } catch {
    return null;
  }
}

function parseSqliteUrl(urlStr, id) {
  let filePath = urlStr.replace(/^sqlite:\/\/\/?/i, "").replace(/^sqlite:/i, "");
  // On Windows, sqlite:///d:/path or sqlite://d:/path
  if (process.platform === "win32" && /^[a-zA-Z]:/.test(filePath)) {
    filePath = path.normalize(filePath);
  } else if (filePath.startsWith("/")) {
    filePath = path.resolve(filePath);
  } else {
    filePath = path.resolve(filePath);
  }
  return {
    id,
    type: "sqlite",
    path: filePath,
    rawUrl: urlStr,
  };
}

function parsePostgresUrl(urlStr, id, isJdbc) {
  try {
    const parsed = new URL(urlStr.replace(/^jdbc:/i, ""));
    const user = decodeURIComponent(parsed.username || "");
    const password = decodeURIComponent(parsed.password || "");
    const host = parsed.hostname || "127.0.0.1";
    const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
    const database = parsed.pathname ? parsed.pathname.replace(/^\//, "") : "";
    return {
      id,
      type: "postgres",
      host,
      port,
      user: user || "postgres",
      password: password || "",
      database: database || "",
      rawUrl: urlStr,
    };
  } catch {
    return null;
  }
}

/**
 * Scans environment variables and options to discover all configured data sources.
 */
export function loadDataSources(env = process.env, options = {}) {
  const dataSources = new Map();

  function registerSource(source) {
    if (!source || !source.id) return;
    dataSources.set(source.id, source);
  }

  // 1. Check DATABASES_CONFIG (JSON array or object)
  const jsonConfig = env.DATABASES_CONFIG || options.databasesConfig;
  if (jsonConfig) {
    try {
      const parsed = typeof jsonConfig === "string" ? JSON.parse(jsonConfig) : jsonConfig;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.id && item.type) registerSource(item);
        }
      } else if (parsed && typeof parsed === "object") {
        for (const [id, item] of Object.entries(parsed)) {
          if (typeof item === "string") {
            const src = parseDatabaseUrl(item, id);
            if (src) registerSource(src);
          } else if (item && typeof item === "object") {
            registerSource({ id, ...item });
          }
        }
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  // 2. Scan all env keys for Key=URL format or DB_* format
  const ignoredKeys = new Set([
    "PATH", "NODE_ENV", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
    "TEMP", "TMP", "OS", "SHELL", "COMSPEC", "PATHEXT", "PSMODULEPATH",
    "LANG", "PWD", "SHLVL", "_", "COMMAND", "ARGS", "HOSTNAME",
  ]);

  for (const [key, val] of Object.entries(env)) {
    if (!val || typeof val !== "string" || ignoredKeys.has(key.toUpperCase())) continue;

    const trimmedVal = val.trim();

    // Check if value is a database URL
    if (/^(jdbc:)?(mysql|redis|rediss|sqlite|postgres|postgresql):\/\//i.test(trimmedVal) ||
        trimmedVal.toLowerCase().startsWith("sqlite:") ||
        /\.(db|sqlite|sqlite3)$/i.test(trimmedVal)) {

      // Determine alias/ID
      let id = key;
      if (id.startsWith("DB_")) id = id.slice(3);
      if (id.endsWith("_URL")) id = id.slice(0, -4);
      id = id.toLowerCase();

      const src = parseDatabaseUrl(trimmedVal, id);
      if (src) {
        registerSource(src);
      }
    }
  }

  // 3. Scan grouped prefix variables (e.g. MYSQL_PROD_HOST, MYSQL_PROD_PASSWORD)
  const groupedMysql = new Map();
  for (const [key, val] of Object.entries(env)) {
    const match = key.match(/^MYSQL_([A-Z0-9_]+)_(HOST|PORT|USER|PASSWORD|DATABASE|CHARSET|DB)$/i);
    if (match) {
      const alias = match[1].toLowerCase();
      const field = match[2].toLowerCase();
      if (!groupedMysql.has(alias)) {
        groupedMysql.set(alias, { id: alias, type: "mysql", host: "127.0.0.1", port: 3306, user: "root", password: "", database: "" });
      }
      const item = groupedMysql.get(alias);
      if (field === "host") item.host = val;
      else if (field === "port") item.port = parseInt(val, 10) || 3306;
      else if (field === "user") item.user = val;
      else if (field === "password") item.password = val;
      else if (field === "database" || field === "db") item.database = val;
      else if (field === "charset") item.charset = val;
    }
  }
  for (const item of groupedMysql.values()) {
    if (!dataSources.has(item.id)) {
      registerSource(item);
    }
  }

  // 4. Default fallback: single standard variables
  if (env.MYSQL_HOST || env.MYSQL_DATABASE) {
    const id = "mysql_default";
    if (!dataSources.has(id)) {
      registerSource({
        id,
        type: "mysql",
        host: env.MYSQL_HOST || "127.0.0.1",
        port: parseInt(env.MYSQL_PORT || "3306", 10),
        user: env.MYSQL_USER || "root",
        password: env.MYSQL_PASSWORD || "",
        database: env.MYSQL_DATABASE || "",
        charset: env.MYSQL_CHARSET || "utf8mb4",
      });
    }
  }

  if (env.REDIS_HOST) {
    const id = "redis_default";
    if (!dataSources.has(id)) {
      registerSource({
        id,
        type: "redis",
        host: env.REDIS_HOST || "127.0.0.1",
        port: parseInt(env.REDIS_PORT || "6379", 10),
        password: env.REDIS_PASSWORD || undefined,
        db: parseInt(env.REDIS_DB || "0", 10),
      });
    }
  }

  if (env.SQLITE_PATH) {
    const id = "sqlite_default";
    if (!dataSources.has(id)) {
      registerSource({
        id,
        type: "sqlite",
        path: path.resolve(env.SQLITE_PATH),
      });
    }
  }

  return Array.from(dataSources.values());
}
