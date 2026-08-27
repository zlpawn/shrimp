import { McpManagementError } from "./errors.mjs";

export const BUILTIN_CLIENT_IDS = ["codex", "claude", "claude_code", "antigravity"];
export const KNOWN_CLIENT_IDS = BUILTIN_CLIENT_IDS;
const SERVER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function isSafeServerName(name = "") {
  return SERVER_NAME_RE.test(String(name || "").trim());
}

export function resolveAllClientIds(customClientIds = []) {
  const custom = Array.isArray(customClientIds) ? customClientIds : [];
  const result = [...BUILTIN_CLIENT_IDS];
  for (const id of custom) {
    const cleanId = String(id || "").trim();
    if (cleanId && !result.includes(cleanId)) {
      result.push(cleanId);
    }
  }
  return result;
}

export function emptyDistribution(valueOrCustomClients = false, customClientIds = []) {
  let val = false;
  let custom = [];
  if (Array.isArray(valueOrCustomClients)) {
    custom = valueOrCustomClients;
  } else if (typeof valueOrCustomClients === "boolean") {
    val = valueOrCustomClients;
    custom = Array.isArray(customClientIds) ? customClientIds : [];
  } else {
    custom = Array.isArray(customClientIds) ? customClientIds : [];
  }
  const allIds = resolveAllClientIds(custom);
  const out = {};
  for (const id of allIds) {
    out[id] = val;
  }
  return out;
}

export function normalizeDistribution(input = {}, customClientIds = []) {
  const src = isObject(input) ? input : {};
  const allIds = resolveAllClientIds(customClientIds);
  const out = {};
  for (const id of allIds) {
    if (id === "claude_code") {
      out.claude_code = asBool(src.claude_code ?? src["claude-code"], false);
    } else {
      out[id] = asBool(src[id], false);
    }
  }
  for (const [key, val] of Object.entries(src)) {
    if (key === "claude-code") continue;
    if (typeof val === "boolean" && !(key in out)) {
      out[key] = val;
    }
  }
  return out;
}

export function normalizeServer(raw, fallbackName = "", customClientIds = []) {
  const name = asString(raw?.name || fallbackName).trim();
  if (!name) return null;
  if (!isSafeServerName(name)) {
    throw new McpManagementError(
      "invalid_request",
      'MCP 名称只能包含字母、数字、连字符和下划线，且以字母或数字开头（最长 64 位）',
      { field: "name", value: name },
    );
  }
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
    distribution: normalizeDistribution(raw?.distribution, customClientIds),
  };
  if (transport === "stdio" && !server.command) {
    throw new McpManagementError("invalid_request", `stdio server "${name}" requires a command`);
  }
  if (transport === "remote" && !server.url) {
    throw new McpManagementError("invalid_request", `remote server "${name}" requires a url`);
  }
  return server;
}

export function normalizeMcpConfig(input = {}, customClientIds = []) {
  const src = isObject(input) ? input : {};
  const servers = {};
  for (const [name, raw] of Object.entries(isObject(src.servers) ? src.servers : {})) {
    const server = normalizeServer({ ...raw, name }, name, customClientIds);
    if (server) servers[server.name] = server;
  }
  const clientPaths = {};
  const allIds = resolveAllClientIds(customClientIds);
  for (const id of allIds) {
    clientPaths[id] = asString(src.clientPaths?.[id], "");
  }
  if (isObject(src.clientPaths)) {
    for (const [key, val] of Object.entries(src.clientPaths)) {
      if (typeof val === "string" && !(key in clientPaths)) {
        clientPaths[key] = val;
      }
    }
  }
  return { version: 1, servers, clientPaths };
}

export function normalizeSecretMap(value) {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [String(key), String(item)]),
  );
}

export function normalizeMcpSecrets(input = {}) {
  const src = isObject(input) ? input : {};
  const variables = normalizeSecretMap(src.variables);
  const servers = {};
  for (const [name, raw] of Object.entries(isObject(src.servers) ? src.servers : {})) {
    const env = normalizeSecretMap(raw?.env);
    const headers = normalizeSecretMap(raw?.headers);
    if (!Object.keys(env).length && !Object.keys(headers).length) continue;
    servers[name] = { env, headers };
  }
  return Object.keys(variables).length ? { variables, servers } : { servers };
}
