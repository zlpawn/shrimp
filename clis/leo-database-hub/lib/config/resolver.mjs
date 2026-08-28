import path from "node:path";

export function resolveConnection({ id, config }, { env = process.env } = {}) {
  const override = env[`LEO_DB_${id.toUpperCase()}_URL`];
  const rawUrl = override || config.url;
  if (rawUrl) return parseConnectionUrl(config.type, resolveSecret(rawUrl, env), id);

  if (config.type === "sqlite") {
    return {
      id,
      type: config.type,
      path: expandHome(config.path || "", env),
    };
  }

  return {
    id,
    type: config.type,
    host: config.host || "127.0.0.1",
    port: Number(config.port || defaultPort(config.type)),
    user: config.user || "root",
    password: resolveSecret(config.password || "", env),
    database: config.database || "",
  };
}

function parseConnectionUrl(type, url, id) {
  const parsed = new URL(url);
  if (type === "sqlite") return { id, type, path: decodeURIComponent(parsed.pathname) };
  if (type === "redis") {
    return {
      id,
      type,
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      user: decodeURIComponent(parsed.username || ""),
      password: decodeURIComponent(parsed.password || ""),
      database: Number(parsed.pathname.replace(/^\//, "") || 0),
      tls: parsed.protocol === "rediss:",
    };
  }
  const expected = type === "mysql" ? /^mysql2?:$/ : new RegExp(`^${type}:`);
  if (!expected.test(parsed.protocol)) {
    throw new Error(`Connection '${id}' expects a ${type} URL, but received ${parsed.protocol}//.`);
  }
  return {
    id,
    type,
    host: parsed.hostname,
    port: Number(parsed.port || defaultPort(type)),
    user: decodeURIComponent(parsed.username || defaultUser(type)),
    password: decodeURIComponent(parsed.password || ""),
    database: parsed.pathname.replace(/^\//, ""),
  };
}

function resolveSecret(value, env) {
  const text = String(value || "");
  return text.startsWith("env:") ? env[text.slice(4)] || "" : text;
}

function expandHome(value, env) {
  const home = env.HOME || env.USERPROFILE || ".";
  if (value === "~") return home;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  return value;
}

function defaultPort(type) {
  return type === "mysql" ? 3306 : type === "redis" ? 6379 : 0;
}

function defaultUser(type) {
  return type === "mysql" ? "root" : "";
}
