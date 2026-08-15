import { McpManagementError } from "./errors.mjs";

export const KNOWN_CLIENT_IDS = ["codex", "claude", "antigravity"];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function emptyDistribution(value = false) {
  return {
    codex: Boolean(value),
    claude: Boolean(value),
    antigravity: Boolean(value),
  };
}

export function normalizeDistribution(input = {}) {
  const src = isObject(input) ? input : {};
  return {
    codex: asBool(src.codex, false),
    claude: asBool(src.claude, false),
    antigravity: asBool(src.antigravity, false),
  };
}

export function normalizeServer(raw, fallbackName = "") {
  const name = asString(raw?.name || fallbackName).trim();
  if (!name) return null;
  const transport = asString(raw?.transport, "").trim().toLowerCase() === "stdio"
    ? "stdio"
    : "remote";
  const server = {
    name,
    title: asString(raw?.title, name),
    description: asString(raw?.description, ""),
    enabled: asBool(raw?.enabled, true),
    transport,
    command: asString(raw?.command, ""),
    args: Array.isArray(raw?.args) ? raw.args.map((value) => String(value)) : [],
    url: asString(raw?.url, ""),
    distribution: normalizeDistribution(raw?.distribution),
  };
  if (transport === "stdio" && !server.command) {
    throw new McpManagementError("invalid_request", `stdio server "${name}" requires a command`);
  }
  if (transport === "remote" && !server.url) {
    throw new McpManagementError("invalid_request", `remote server "${name}" requires a url`);
  }
  return server;
}

export function normalizeMcpConfig(input = {}) {
  const src = isObject(input) ? input : {};
  const servers = {};
  for (const [name, raw] of Object.entries(isObject(src.servers) ? src.servers : {})) {
    const server = normalizeServer({ ...raw, name }, name);
    if (server) servers[server.name] = server;
  }
  const clientPaths = {};
  for (const id of KNOWN_CLIENT_IDS) {
    clientPaths[id] = asString(src.clientPaths?.[id], "");
  }
  return { version: 1, servers, clientPaths };
}

export function normalizeMcpSecrets(input = {}) {
  const src = isObject(input) ? input : {};
  const servers = {};
  for (const [name, raw] of Object.entries(isObject(src.servers) ? src.servers : {})) {
    const env = isObject(raw?.env) ? raw.env : {};
    const headers = isObject(raw?.headers) ? raw.headers : {};
    if (!Object.keys(env).length && !Object.keys(headers).length) continue;
    servers[name] = { env, headers };
  }
  return { servers };
}

