import fs from "node:fs";
import path from "node:path";

const ACCESS_MODES = new Set(["read", "readwrite"]);

export function loadConnectionStore({
  secretsFile = process.env.LEO_DB_CONNECTIONS_FILE,
  registry,
} = {}) {
  const file = path.resolve(secretsFile || defaultConnectionsFile());
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, connections: {}, file };
    throw new Error(`Invalid database connection configuration: ${error.message}`);
  }

  if (raw?.version !== 1) throw new Error("Unsupported connection configuration version. Expected version 1.");
  if (!raw.connections || typeof raw.connections !== "object" || Array.isArray(raw.connections)) {
    throw new Error("Connection configuration must contain a connections object.");
  }

  const connections = {};
  for (const [id, value] of Object.entries(raw.connections)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid connection id: ${id}`);
    if (!value || typeof value !== "object") throw new Error(`Connection '${id}' must be an object.`);
    if (!registry.get(value.type)) {
      throw new Error(`Connection '${id}' uses unsupported database type '${value.type}'. Available: ${registry.ids().join(", ") || "none"}`);
    }
    const access = value.access || "readwrite";
    if (!ACCESS_MODES.has(access)) throw new Error(`Connection '${id}' has invalid access '${access}'. Expected read or readwrite.`);
    if (!value.url && !value.path && !value.host) {
      throw new Error(`Connection '${id}' must define url, path, or host.`);
    }
    connections[id] = { ...value, id, type: value.type, access };
  }

  ensureRestricted(file);
  return { version: 1, connections, file };
}

export function importConnectionStore(json, { secretsFile, registry }) {
  const parsed = typeof json === "string" ? JSON.parse(json) : json;
  const store = loadConnectionStoreFromObject(parsed, registry);
  const file = path.resolve(secretsFile || defaultConnectionsFile());
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n", { mode: 0o600 });
  ensureRestricted(file);
  return { ...store, file };
}

function loadConnectionStoreFromObject(raw, registry) {
  if (raw?.version !== 1) throw new Error("Unsupported connection configuration version. Expected version 1.");
  if (!raw.connections || typeof raw.connections !== "object" || Array.isArray(raw.connections)) {
    throw new Error("Connection configuration must contain a connections object.");
  }
  const connections = {};
  for (const [id, value] of Object.entries(raw.connections)) {
    if (!registry.get(value.type)) throw new Error(`Connection '${id}' uses unsupported type '${value.type}'.`);
    connections[id] = { ...value, id };
  }
  return { version: 1, connections };
}

export function summarizeConnections(store) {
  return Object.values(store.connections || {}).map((connection) => ({
    id: connection.id,
    type: connection.type,
    access: connection.access,
    target: maskConnectionTarget(connection),
  }));
}

function defaultConnectionsFile() {
  return path.join(process.env.SHRIMP_SECRETS_DIR || path.join(process.env.HOME || ".", ".shrimp", "secrets"), "database-hub", "connections.json");
}

function maskConnectionTarget(connection) {
  if (connection.path) return connection.path;
  if (!connection.url && !connection.host) return "";
  if (connection.host) return `${connection.host}:${connection.port || defaultPort(connection.type)}`;
  try {
    const url = new URL(connection.url);
    return `${url.hostname}:${url.port || defaultPort(connection.type)}${url.pathname}`;
  } catch {
    return "configured";
  }
}

function defaultPort(type) {
  return type === "mysql" ? 3306 : type === "redis" ? 6379 : 0;
}

function ensureRestricted(file) {
  if (process.platform === "win32") return;
  try { fs.chmodSync(path.dirname(file), 0o700); } catch {}
  fs.chmodSync(file, 0o600);
}
