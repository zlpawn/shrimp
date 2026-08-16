import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpManagementError } from "../domain/errors.mjs";
import { KNOWN_CLIENT_IDS, normalizeDistribution, normalizeSecretMap } from "../domain/schema.mjs";
import { listClientAdapters } from "../clients/registry.mjs";

const CLIENT_FILE_EXTENSIONS = {
  codex: ".toml",
  claude: ".json",
  antigravity: ".json",
};

function normalizeTargets(input = {}) {
  if (Array.isArray(input)) {
    const out = {};
    for (const id of KNOWN_CLIENT_IDS) out[id] = input.includes(id);
    return out;
  }
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const id of KNOWN_CLIENT_IDS) out[id] = Boolean(src[id]);
  return out;
}
function readText(fileSystem, filePath) {
  try {
    return fileSystem.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function fileExists(fileSystem, filePath) {
  try {
    const stat = fileSystem.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function ensureDir(fileSystem, filePath) {
  fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function copyBackup(fileSystem, filePath) {
  const backupPath = filePath + ".mcp-backup-" + timestamp();
  fileSystem.copyFileSync(filePath, backupPath);
  return backupPath;
}

function normalizeClientConfig(server) {
  if (server.transport === "stdio") {
    const config = { command: server.command };
    if (server.args && server.args.length) config.args = [...server.args];
    if (server.env && Object.keys(server.env).length) config.env = { ...server.env };
    return config;
  }
  const config = { url: server.url };
  if (server.headers && Object.keys(server.headers).length) config.headers = { ...server.headers };
  return config;
}

function sameConfig(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createMcpManagementService({
  store,
  home = process.env.USERPROFILE || process.env.HOME || os.homedir(),
  platform = process.platform,
  fsImpl = fs,
} = {}) {
  if (!store) throw new Error("store is required");
  const byId = new Map(listClientAdapters().map((adapter) => [adapter.id, adapter]));

  function requireAdapter(client) {
    const adapter = byId.get(String(client || ""));
    if (!adapter) throw new McpManagementError("client_not_found", "Unknown client: " + client);
    return adapter;
  }

  function resolveClientPath(client, config) {
    const override = String(config.clientPaths && config.clientPaths[client] || "").trim();
    if (override) {
      const expanded = override === "~" || (override[0] === "~" && (override[1] === "/" || override[1] === path.sep))
        ? path.join(home, override.slice(2))
        : override;
      return path.resolve(expanded);
    }
    return requireAdapter(client).defaultPath(home, platform);
  }

  function resolvedClientPaths(config) {
    const out = {};
    for (const id of KNOWN_CLIENT_IDS) out[id] = resolveClientPath(id, config);
    return out;
  }

  function scanClient(client, config) {
    const adapter = requireAdapter(client);
    const filePath = resolveClientPath(client, config);
    if (!fileExists(fsImpl, filePath)) {
      return { client, path: filePath, status: "missing", servers: [] };
    }
    const text = readText(fsImpl, filePath);
    if (text === null) {
      return { client, path: filePath, status: "invalid", error: "unreadable_file", servers: [] };
    }
    const scanned = adapter.scan(text);
    if (scanned && typeof scanned === "object" && scanned.error) {
      return { client, path: filePath, status: "invalid", error: scanned.error, servers: [] };
    }
    const servers = [];
    if (scanned instanceof Map) {
      for (const [name, configOfServer] of scanned.entries()) {
        servers.push({ name, config: configOfServer });
      }
    }
    return { client, path: filePath, status: "ok", servers };
  }

  function scanClients(config) {
    const clients = KNOWN_CLIENT_IDS.map((client) => scanClient(client, config));
    const presentIn = {};
    for (const result of clients) {
      for (const entry of result.servers || []) {
        presentIn[entry.name] = presentIn[entry.name] || {};
        presentIn[entry.name][result.client] = true;
      }
    }
    return { clients, presentIn };
  }

  function mergedServer(server, secrets) {
    const secret = (secrets.servers && secrets.servers[server.name]) || {};
    return {
      ...server,
      env: { ...(server.env || {}), ...(secret.env || {}) },
      headers: { ...(server.headers || {}), ...(secret.headers || {}) },
    };
  }

  function serversForClient(config, secrets, client) {
    const out = [];
    for (const server of Object.values(config.servers || {})) {
      if (server.enabled === false) continue;
      if (!server.distribution || !server.distribution[client]) continue;
      out.push(mergedServer(server, secrets));
    }
    return out;
  }

  function state() {
    const { config, secrets } = store.load();
    const paths = resolvedClientPaths(config);
    const scanResult = scanClients(config);
    return {
      config,
      secretsConfigured: Object.keys(secrets.servers || {}),
      paths,
      clients: scanResult.clients,
      presentIn: scanResult.presentIn,
      clientsMeta: KNOWN_CLIENT_IDS.map((id) => ({
        id,
        label: requireAdapter(id).label,
        path: paths[id],
        defaultPath: requireAdapter(id).defaultPath(home, platform),
      })),
    };
  }

  function scan() {
    const { config } = store.load();
    return { paths: resolvedClientPaths(config), ...scanClients(config) };
  }

  function normalizeSecretPatch(value) {
    if (value === null) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return normalizeSecretMap(value);
  }

  function upsertServer(input = {}) {
    const { config, secrets } = store.load();
    const name = String(input.name || "").trim();
    if (!name) throw new McpManagementError("invalid_request", "server name is required");
    const existing = config.servers[name] || {};
    const nextServer = {
      ...existing,
      ...input,
      name,
      env: undefined,
      headers: undefined,
      distribution: normalizeDistribution(input.distribution || existing.distribution),
    };
    const nextServers = { ...config.servers, [name]: nextServer };
    store.saveConfig({ ...config, servers: nextServers });

    const hasEnvPatch = Object.prototype.hasOwnProperty.call(input, "env");
    const hasHeadersPatch = Object.prototype.hasOwnProperty.call(input, "headers");
    const envPatch = hasEnvPatch ? normalizeSecretPatch(input.env) : undefined;
    const headersPatch = hasHeadersPatch ? normalizeSecretPatch(input.headers) : undefined;
    if (envPatch !== undefined || headersPatch !== undefined) {
      const current = (secrets.servers && secrets.servers[name]) || { env: {}, headers: {} };
      const nextSecret = {
        env: envPatch === undefined ? (current.env || {}) : envPatch,
        headers: headersPatch === undefined ? (current.headers || {}) : headersPatch,
      };
      const nextSecretsServers = { ...(secrets.servers || {}) };
      if (!Object.keys(nextSecret.env).length && !Object.keys(nextSecret.headers).length) {
        delete nextSecretsServers[name];
      } else {
        nextSecretsServers[name] = nextSecret;
      }
      store.saveSecrets({ servers: nextSecretsServers });
    }
    return state();
  }

  function deleteServer(name) {
    const { config, secrets } = store.load();
    if (!config.servers[name]) throw new McpManagementError("server_not_found", "Unknown server: " + name);
    const nextServers = { ...config.servers };
    delete nextServers[name];
    store.saveConfig({ ...config, servers: nextServers });
    if (secrets.servers && secrets.servers[name]) {
      const nextSecretsServers = { ...secrets.servers };
      delete nextSecretsServers[name];
      store.saveSecrets({ servers: nextSecretsServers });
    }
    return state();
  }

  function buildPreviews(config, secrets, targets) {
    const previews = [];
    for (const client of KNOWN_CLIENT_IDS) {
      if (!targets[client]) continue;
      const adapter = requireAdapter(client);
      const filePath = resolveClientPath(client, config);
      const servers = serversForClient(config, secrets, client);
      if (!servers.length) {
        previews.push({ client, path: filePath, servers: [], text: null, hint: null });
        continue;
      }
      const current = readText(fsImpl, filePath) || "";
      const merged = adapter.merge(current, servers);
      previews.push({
        client,
        path: filePath,
        servers: servers.map((server) => server.name),
        text: merged,
        hint: adapter.hint(filePath, servers),
      });
    }
    return previews;
  }

  function preview({ targets = {} } = {}) {
    const { config, secrets } = store.load();
    const normalizedTargets = normalizeTargets(targets);
    return {
      targets: normalizedTargets,
      previews: buildPreviews(config, secrets, normalizedTargets),
    };
  }

  function parseClientText(client, text) {
    const adapter = requireAdapter(client);
    const scanned = adapter.scan(text);
    if (scanned instanceof Map) return scanned;
    throw new McpManagementError(
      "invalid_config",
      "客户端配置无法解析：" + client,
      { error: (scanned && scanned.error) || "unknown" },
    );
  }

  function scanWritten(client, filePath) {
    const text = readText(fsImpl, filePath);
    if (text === null) return null;
    try {
      return parseClientText(client, text);
    } catch {
      return null;
    }
  }

  function verifyWritten(client, filePath, servers) {
    const scanned = scanWritten(client, filePath);
    if (!scanned) return false;
    for (const server of servers) {
      const actual = scanned.get(server.name);
      if (!actual) return false;
      const expected = normalizeClientConfig(server);
      if (server.transport === "stdio") {
        if (actual.command !== expected.command) return false;
        if (JSON.stringify(actual.args || []) !== JSON.stringify(expected.args || [])) return false;
        if (JSON.stringify(actual.env || {}) !== JSON.stringify(expected.env || {})) return false;
      } else {
        if (actual.url !== expected.url) return false;
        if (JSON.stringify(actual.headers || {}) !== JSON.stringify(expected.headers || {})) return false;
      }
    }
    return true;
  }

  function validateNoManualConflict(client, currentText, servers) {
    const scanned = parseClientText(client, currentText);
    for (const server of servers) {
      const actual = scanned.get(server.name);
      if (!actual) continue;
      const expected = normalizeClientConfig(server);
      if (!sameConfig(actual, expected)) {
        throw new McpManagementError(
          "conflict",
          '客户端 ' + client + ' 已有同名但内容不同的 MCP "' + server.name + '"，为避免覆盖已取消写入',
          { client, server: server.name },
        );
      }
    }
  }

  function restoreWrites(writes) {
    for (const write of [...writes].reverse()) {
      if (write.existed) {
        fsImpl.writeFileSync(write.filePath, write.current, "utf8");
      } else {
        try { fsImpl.unlinkSync(write.filePath); } catch { /* best effort */ }
      }
    }
  }

  function apply({ targets = {} } = {}) {
    const normalizedTargets = normalizeTargets(targets);
    const { config, secrets } = store.load();

    const planned = [];
    for (const client of KNOWN_CLIENT_IDS) {
      if (!normalizedTargets[client]) continue;
      const adapter = requireAdapter(client);
      const filePath = resolveClientPath(client, config);
      const servers = serversForClient(config, secrets, client);
      if (!servers.length) continue;
      const existed = fileExists(fsImpl, filePath);
      const current = readText(fsImpl, filePath) || "";
      validateNoManualConflict(client, current, servers);
      const merged = adapter.merge(current, servers);
      planned.push({ client, filePath, servers, existed, current, merged });
    }

    const changed = [];
    const backups = [];
    const writes = [];
    try {
      for (const item of planned) {
        if (item.existed) {
          backups.push(copyBackup(fsImpl, item.filePath));
        }
        ensureDir(fsImpl, item.filePath);
        fsImpl.writeFileSync(item.filePath, item.merged, "utf8");
        writes.push(item);
        if (!verifyWritten(item.client, item.filePath, item.servers)) {
          throw new McpManagementError(
            "storage_error",
            "写入后校验失败，已恢复原文件: " + item.filePath,
            { client: item.client },
          );
        }
        changed.push(item.filePath);
      }
    } catch (error) {
      restoreWrites(writes);
      throw error;
    }

    return { changed, backups, preview: buildPreviews(config, secrets, normalizedTargets) };
  }

  function setClientPath({ client, path: filePath } = {}) {
    const { config } = store.load();
    const clientId = String(client || "");
    if (!KNOWN_CLIENT_IDS.includes(clientId)) {
      throw new McpManagementError("client_not_found", "Unknown client: " + client);
    }
    const rawPath = String(filePath || "").trim();
    if (rawPath) {
      const expectedExtension = CLIENT_FILE_EXTENSIONS[clientId];
      if (path.extname(rawPath).toLowerCase() !== expectedExtension) {
        throw new McpManagementError(
          "invalid_request",
          requireAdapter(clientId).label + " 配置文件必须是 " + expectedExtension + " 文件",
          { field: "path", value: rawPath },
        );
      }
    }
    store.saveConfig({
      ...config,
      clientPaths: { ...(config.clientPaths || {}), [clientId]: rawPath },
    });
    return state();
  }

  return {
    state,
    scan,
    upsertServer,
    deleteServer,
    preview,
    apply,
    setClientPath,
    resolvedClientPaths,
  };
}
