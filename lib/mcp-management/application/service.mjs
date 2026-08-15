import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpManagementError } from "../domain/errors.mjs";
import { KNOWN_CLIENT_IDS, normalizeDistribution } from "../domain/schema.mjs";
import { listClientAdapters } from "../clients/registry.mjs";

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

function exists(fileSystem, filePath) {
  try {
    return Boolean(fileSystem.existsSync(filePath));
  } catch {
    return false;
  }
}

function copyBackup(fileSystem, filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = filePath + ".mcp-backup-" + stamp;
  fileSystem.copyFileSync(filePath, backupPath);
  return backupPath;
}

function ensureDir(fileSystem, filePath) {
  try {
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // best effort; write will fail with a clearer error if the dir is unusable
  }
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
    const override = String(config?.clientPaths?.[client] || "").trim();
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
    const text = readText(fsImpl, filePath);
    if (text === null) {
      return { client, path: filePath, status: "missing", servers: [] };
    }
    const scanned = adapter.scan(text);
    if (scanned && typeof scanned === "object" && scanned.error) {
      return { client, path: filePath, status: "invalid", error: scanned.error, servers: [] };
    }
    const servers = [];
    if (scanned instanceof Map) {
      for (const [name, configOfServer] of scanned.entries()) servers.push({ name, config: configOfServer });
    }
    return { client, path: filePath, status: "ok", servers };
  }

  function scan(config) {
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
    const secret = secrets?.servers?.[server.name] || {};
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
      if (!server.distribution?.[client]) continue;
      out.push(mergedServer(server, secrets));
    }
    return out;
  }

  function state() {
    const { config, secrets } = store.load();
    const paths = resolvedClientPaths(config);
    const scanResult = scan(config);
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
    return { paths: resolvedClientPaths(config), ...scan(config) };
  }

  function upsertServer(input = {}) {
    const { config, secrets } = store.load();
    const name = String(input?.name || "").trim();
    if (!name) throw new McpManagementError("invalid_request", "server name is required");
    const existing = config.servers[name] || {};
    const mergedInput = {
      ...existing,
      ...input,
      name,
      distribution: normalizeDistribution(input?.distribution || existing.distribution),
    };
    const nextServers = { ...config.servers, [name]: mergedInput };
    store.saveConfig({ ...config, servers: nextServers });

    const env = input?.env && typeof input.env === "object" ? input.env : undefined;
    const headers = input?.headers && typeof input.headers === "object" ? input.headers : undefined;
    if (env || headers) {
      const nextSecretsServers = { ...(secrets.servers || {}) };
      nextSecretsServers[name] = {
        env: { ...(secrets.servers?.[name]?.env || {}), ...(env || {}) },
        headers: { ...(secrets.servers?.[name]?.headers || {}), ...(headers || {}) },
      };
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
    if (secrets.servers?.[name]) {
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
      const current = readText(fsImpl, filePath) ?? "";
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

  function verifyWritten(client, filePath, servers) {
    const text = readText(fsImpl, filePath);
    if (text === null) return false;
    const adapter = requireAdapter(client);
    if (client !== "codex") {
      try {
        const parsed = JSON.parse(text);
        return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
      } catch {
        return false;
      }
    }
    const scanned = adapter.scan(text);
    if (scanned instanceof Map) {
      for (const server of servers) {
        if (!scanned.has(server.name)) return false;
      }
      return true;
    }
    return false;
  }

  function apply({ targets = {} } = {}) {
    const normalizedTargets = normalizeTargets(targets);
    const { config, secrets } = store.load();
    const changed = [];
    const backups = [];
    for (const client of KNOWN_CLIENT_IDS) {
      if (!normalizedTargets[client]) continue;
      const adapter = requireAdapter(client);
      const filePath = resolveClientPath(client, config);
      const servers = serversForClient(config, secrets, client);
      if (!servers.length) continue;
      const current = readText(fsImpl, filePath) ?? "";
      const merged = adapter.merge(current, servers);
      const backupPath = exists(fsImpl, filePath) ? copyBackup(fsImpl, filePath) : null;
      if (backupPath) backups.push(backupPath);
      ensureDir(fsImpl, filePath);
      fsImpl.writeFileSync(filePath, merged, "utf8");
      const ok = verifyWritten(client, filePath, servers);
      if (!ok && current) {
        fsImpl.writeFileSync(filePath, current, "utf8");
        throw new McpManagementError("storage_error", "写入后校验失败，已恢复原文件: " + filePath);
      }
      changed.push(filePath);
    }
    return { changed, backups, preview: buildPreviews(config, secrets, normalizedTargets) };
  }

  function setClientPath({ client, path: filePath } = {}) {
    const { config } = store.load();
    if (!KNOWN_CLIENT_IDS.includes(String(client || ""))) {
      throw new McpManagementError("client_not_found", "Unknown client: " + client);
    }
    store.saveConfig({
      ...config,
      clientPaths: { ...(config.clientPaths || {}), [client]: String(filePath || "").trim() },
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
