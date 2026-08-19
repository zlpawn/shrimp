import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpManagementError } from "../domain/errors.mjs";
import { KNOWN_CLIENT_IDS, normalizeDistribution, normalizeSecretMap } from "../domain/schema.mjs";
import { listClientAdapters } from "../clients/registry.mjs";
import { createInspectorManager } from "../infra/inspector-manager.mjs";

const CLIENT_FILE_EXTENSIONS = {
  codex: ".toml",
  claude: ".json",
  claude_code: ".json",
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
  inspectorManager: injectedInspectorManager,
  logger = console,
} = {}) {
  if (!store) throw new Error("store is required");
  const byId = new Map(listClientAdapters().map((adapter) => [adapter.id, adapter]));

  const configDir = store.configPath ? path.dirname(store.configPath) : process.cwd();

  const inspectorManager = injectedInspectorManager || createInspectorManager({
    cwd: configDir,
    logger,
  });


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

  function interpolateString(str, envMap) {
    if (!str || typeof str !== "string") return str;
    return str.replace(/\$\{([A-Za-z0-9_]+)\}|\{([A-Za-z0-9_]+)\}/g, (match, p1, p2) => {
      const key = p1 || p2;
      if (Object.prototype.hasOwnProperty.call(envMap, key) && envMap[key] !== undefined && envMap[key] !== null) {
        return String(envMap[key]);
      }
      if (process.env[key] !== undefined) {
        return process.env[key];
      }
      return match;
    });
  }

  function normalizeDistributionArgs(args = []) {
    if (!configDir || !Array.isArray(args)) return args;
    return args.map((arg) => {
      if (typeof arg === "string" && (arg.startsWith("./mcps") || arg.startsWith(".\\mcps") || arg.startsWith("mcps/") || arg.startsWith("mcps\\"))) {
        return path.resolve(configDir, arg).replace(/\\/g, "/");
      }
      return arg;
    });
  }

  function mergedServer(server, secrets) {
    const secret = (secrets.servers && secrets.servers[server.name]) || {};
    const combinedEnv = { ...(server.env || {}), ...(secret.env || {}) };
    const combinedHeaders = { ...(server.headers || {}), ...(secret.headers || {}) };
    const resolvedUrl = interpolateString(server.url, {
      ...(secrets.variables || {}),
      ...combinedEnv,
    });
    const resolvedArgs = normalizeDistributionArgs(server.args);
    return {
      ...server,
      args: resolvedArgs,
      url: resolvedUrl,
      env: combinedEnv,
      headers: combinedHeaders,
    };
  }

  function serversForClient(config, secrets, client, serverName = null, isPreview = false) {
    const out = [];
    for (const server of Object.values(config.servers || {})) {
      if (serverName && server.name !== serverName) continue;
      if (!isPreview) {
        if (server.enabled === false) continue;
        if (!server.distribution || !server.distribution[client]) continue;
      } else if (serverName) {
        const dist = server.distribution || {};
        const hasAnyTarget = Object.values(dist).some(Boolean);
        if (hasAnyTarget && !dist[client]) continue;
      } else {
        if (server.enabled === false) continue;
        if (!server.distribution || !server.distribution[client]) continue;
      }
      out.push(mergedServer(server, secrets));
    }
    return out;
  }

  function scanInRepoMcps(configDir) {
    if (!configDir) return [];
    const mcpsDir = path.join(configDir, "mcps");
    try {
      if (!fsImpl.existsSync(mcpsDir)) return [];
    } catch {
      return [];
    }
    let entries;
    try {
      entries = fsImpl.readdirSync(mcpsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const list = [];
    for (const entry of entries) {
      const isDir = typeof entry === "string" ? fsImpl.statSync(path.join(mcpsDir, entry)).isDirectory() : entry.isDirectory();
      if (!isDir) continue;
      const subName = typeof entry === "string" ? entry : entry.name;
      if (subName.startsWith(".") || subName === "node_modules") continue;

      const subDir = path.join(mcpsDir, subName);
      const relSubDir = `./mcps/${subName}`;

      const checkFile = (f) => {
        try { return fsImpl.existsSync(path.join(subDir, f)); } catch { return false; }
      };

      try {
        const files = fsImpl.readdirSync(subDir);
        if (!files.some((f) => typeof f === "string" ? !f.startsWith(".") : f.isFile())) continue;
      } catch {
        continue;
      }

      const nodeFiles = ["index.mjs", "index.js", "src/index.ts", "src/index.js", "dist/index.js"];
      const foundNode = nodeFiles.find(checkFile);
      const hasPackageJson = checkFile("package.json");

      const pyFiles = ["server.py", "main.py", "app.py"];
      const foundPy = pyFiles.find(checkFile);
      const hasPyProject = checkFile("pyproject.toml") || checkFile("requirements.txt");

      const hasPom = checkFile("pom.xml") || checkFile("build.gradle");
      let foundJar = null;
      const targetDir = path.join(subDir, "target");
      if (checkFile("target")) {
        try {
          const jars = fsImpl.readdirSync(targetDir).filter((f) => f.endsWith(".jar") && !f.includes("sources"));
          if (jars.length) foundJar = jars[0];
        } catch {}
      }

      const goFiles = ["main.go", "server.go", "app.go"];
      const foundGo = goFiles.find(checkFile);
      const hasGoMod = checkFile("go.mod");
      const hasCompiledExe = checkFile("app.exe") ? "app.exe" : checkFile("app") ? "app" : null;

      if (foundNode || hasPackageJson) {
        const entryFile = foundNode || "index.mjs";
        const isDbHub = subName === "database-hub";
        const sampleEnv = isDbHub
          ? [
              { key: "order_center", value: "mysql://root:123456@127.0.0.1:3306/orders_db" },
              { key: "cache_redis", value: "redis://:auth123@127.0.0.1:6379/0" },
              { key: "local_sqlite", value: "sqlite:///d:/data/app.db" },
            ]
          : [];
        list.push({
          name: subName,
          lang: "node",
          title: isDbHub ? "database-hub (多数据库 MCP)" : `${subName} (Node.js 自研 MCP)`,
          description: isDbHub
            ? "支持 MySQL / Redis / SQLite 的多数据源连接、NL2SQL 查询与表结构管理 MCP"
            : `位于 ${relSubDir} 的自研 Node.js MCP 服务`,
          command: "node",
          args: [`${relSubDir}/${entryFile}`],
          transport: "stdio",
          path: `${relSubDir}/${entryFile}`,
          sampleEnv,
        });
      } else if (foundPy || hasPyProject) {
        const pyFile = foundPy || "server.py";
        list.push({
          name: subName,
          lang: "python",
          title: `${subName} (Python FastMCP)`,
          description: `位于 ${relSubDir} 的自研 Python FastMCP 服务`,
          command: "uv",
          args: ["run", "--directory", relSubDir, pyFile],
          transport: "stdio",
          path: `${relSubDir}/${pyFile}`,
        });
      } else if (foundGo || hasGoMod || hasCompiledExe) {
        if (hasCompiledExe) {
          list.push({
            name: subName,
            lang: "go",
            title: `${subName} (Go 二进制 MCP)`,
            description: `位于 ${relSubDir} 的自研 Go 独立编译 MCP 服务`,
            command: `${relSubDir}/${hasCompiledExe}`,
            args: [],
            transport: "stdio",
            path: `${relSubDir}/${hasCompiledExe}`,
          });
        } else {
          const goFile = foundGo || "main.go";
          list.push({
            name: subName,
            lang: "go",
            title: `${subName} (Go 自研 MCP)`,
            description: `位于 ${relSubDir} 的自研 Go 源码 MCP 服务`,
            command: "go",
            args: ["run", `${relSubDir}/${goFile}`],
            transport: "stdio",
            path: `${relSubDir}/${goFile}`,
          });
        }
      } else if (hasPom || foundJar) {
        const jarPath = foundJar ? `${relSubDir}/target/${foundJar}` : `${relSubDir}/target/app.jar`;
        list.push({
          name: subName,
          lang: "java",
          title: `${subName} (Java 自研 MCP)`,
          description: `位于 ${relSubDir} 的自研 Java MCP 服务`,
          command: "java",
          args: ["-jar", jarPath],
          transport: "stdio",
          path: jarPath,
        });
      } else {
        list.push({
          name: subName,
          lang: "custom",
          title: `${subName} (自研 MCP)`,
          description: `位于 ${relSubDir} 的自研 MCP 模块`,
          command: "node",
          args: [`${relSubDir}/index.mjs`],
          transport: "stdio",
          path: relSubDir,
        });
      }
    }
    return list;
  }

  function state() {
    const { config, secrets } = store.load();
    const paths = resolvedClientPaths(config);
    const scanResult = scanClients(config);
    const configDir = store.configPath ? path.dirname(store.configPath) : process.cwd();
    return {
      config,
      secretsConfigured: Object.keys(secrets.servers || {}),
      paths,
      clients: scanResult.clients,
      presentIn: scanResult.presentIn,
      inRepoMcps: scanInRepoMcps(configDir),
      runningInspectors: inspectorManager.listRunning(),
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

  function buildPreviews(config, secrets, targets, serverName = null) {
    const previews = [];
    for (const client of KNOWN_CLIENT_IDS) {
      if (!targets[client]) continue;
      const adapter = requireAdapter(client);
      const filePath = resolveClientPath(client, config);
      const servers = serversForClient(config, secrets, client, serverName, true);
      if (!servers.length) {
        previews.push({ client, path: filePath, servers: [], text: null, hint: null });
        continue;
      }
      const current = readText(fsImpl, filePath) || "";
      const merged = adapter.merge(current, servers);
      const snippet = adapter.formatSnippet ? adapter.formatSnippet(servers) : merged;
      const targetServer = serverName ? config.servers?.[serverName] : null;
      let hint = adapter.hint(filePath, servers);
      if (targetServer) {
        if (targetServer.enabled === false) {
          hint = (hint ? hint + " | " : "") + "注意：该 MCP 当前处于「已停用」状态，启用后写入客户端方可生效";
        }
        const dist = targetServer.distribution || {};
        const hasAnyTarget = Object.values(dist).some(Boolean);
        if (!hasAnyTarget) {
          hint = (hint ? hint + " | " : "") + "未勾选此客户端的分发开关（此为预览片段参考）";
        }
      }
      previews.push({
        client,
        path: filePath,
        servers: servers.map((server) => server.name),
        text: merged,
        snippet,
        hint,
      });
    }
    return previews;
  }

  function preview({ targets = {}, serverName = null } = {}) {
    const { config, secrets } = store.load();
    const normalizedTargets = normalizeTargets(targets);
    const targetName = serverName ? String(serverName).trim() : null;
    if (targetName && !config.servers[targetName]) {
      throw new McpManagementError("server_not_found", "Unknown server: " + targetName);
    }
    return {
      targets: normalizedTargets,
      serverName: targetName,
      previews: buildPreviews(config, secrets, normalizedTargets, targetName),
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

  function apply({ targets = {}, serverName = null } = {}) {
    const normalizedTargets = normalizeTargets(targets);
    const { config, secrets } = store.load();
    const targetName = serverName ? String(serverName).trim() : null;
    if (targetName && !config.servers[targetName]) {
      throw new McpManagementError("server_not_found", "Unknown server: " + targetName);
    }

    const planned = [];
    for (const client of KNOWN_CLIENT_IDS) {
      if (!normalizedTargets[client]) continue;
      const adapter = requireAdapter(client);
      const filePath = resolveClientPath(client, config);
      const servers = serversForClient(config, secrets, client, targetName);
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

    return { changed, backups, serverName: targetName, preview: buildPreviews(config, secrets, normalizedTargets, targetName) };
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

  function findServerConfig(serverName) {
    const { config, secrets } = store.load();
    const name = String(serverName || "").trim();
    const configDir = store.configPath ? path.dirname(store.configPath) : process.cwd();

    // 1. Check configured servers first
    if (config.servers && config.servers[name]) {
      return {
        server: mergedServer(config.servers[name], secrets),
        secrets,
      };
    }

    // 2. Check in-repo MCPs
    const inRepoList = scanInRepoMcps(configDir);
    const inRepo = inRepoList.find((m) => m.name === name);
    if (inRepo) {
      return {
        server: mergedServer(inRepo, secrets),
        secrets,
      };
    }

    // 3. Check client-detected local MCPs
    const scanResult = scanClients(config);
    for (const client of scanResult.clients || []) {
      const found = client.servers?.find((s) => s.name === name);
      if (found && found.config) {
        const conf = found.config;
        const isRemote = Boolean(conf.url) || conf.transport === "remote" || conf.transport === "sse" || conf.type === "sse" || conf.type === "http";
        const serverObj = {
          name,
          title: name,
          transport: isRemote ? "remote" : "stdio",
          command: conf.command || (isRemote ? "" : "node"),
          args: Array.isArray(conf.args) ? conf.args : [],
          url: conf.url || "",
          env: (conf.env && typeof conf.env === "object") ? conf.env : {},
          headers: (conf.headers && typeof conf.headers === "object") ? conf.headers : {},
        };
        return {
          server: mergedServer(serverObj, secrets),
          secrets,
        };
      }
    }

    throw new McpManagementError("server_not_found", "未找到 MCP 服务: " + name);
  }

  async function startInspector(serverName) {
    const { server, secrets } = findServerConfig(serverName);
    return await inspectorManager.start(serverName, server, secrets);
  }

  async function stopInspector(serverName) {
    return await inspectorManager.stop(serverName);
  }

  function getInspectorStatus(serverName) {
    return inspectorManager.status(serverName);
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
    startInspector,
    stopInspector,
    getInspectorStatus,
    inspectorManager,
  };
}
