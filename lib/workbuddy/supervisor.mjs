import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

function normalizeExpiryMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed > 100_000_000_000 ? parsed : parsed * 1000;
}

export const DEFAULT_WORKBUDDY_PORT = 7863;
export const DEFAULT_WORKBUDDY_DIR = path.join(os.homedir(), ".workbuddy2api");
export const DEFAULT_AUTHS_DIR = path.join(DEFAULT_WORKBUDDY_DIR, "auths");
export const DEFAULT_DATA_DIR = path.join(DEFAULT_WORKBUDDY_DIR, "data");
export const DEFAULT_CONFIG_FILE = path.join(DEFAULT_WORKBUDDY_DIR, "config.json");
export const DEFAULT_PID_FILE = path.join(DEFAULT_WORKBUDDY_DIR, "gateway-supervisor.pid");
export const DEFAULT_LOG_FILE = path.join(DEFAULT_WORKBUDDY_DIR, "supervisor-stdout.log");
export const DEFAULT_SESSION_FILE = path.join(os.homedir(), ".codebuddy-session.json");

export function resolveSessionFile(port = DEFAULT_WORKBUDDY_PORT, customPath = "") {
  if (customPath) return path.resolve(customPath);
  const p = Number(port) || DEFAULT_WORKBUDDY_PORT;
  if (p === DEFAULT_WORKBUDDY_PORT) {
    return DEFAULT_SESSION_FILE;
  }
  return path.join(DEFAULT_WORKBUDDY_DIR, "sessions", `session-${p}.json`);
}

export function resolvePidFile(port = DEFAULT_WORKBUDDY_PORT, customPath = "") {
  if (customPath) return path.resolve(customPath);
  const p = Number(port) || DEFAULT_WORKBUDDY_PORT;
  if (p === DEFAULT_WORKBUDDY_PORT) {
    return DEFAULT_PID_FILE;
  }
  return path.join(DEFAULT_WORKBUDDY_DIR, `supervisor-${p}.pid`);
}

export function resolveLogFile(port = DEFAULT_WORKBUDDY_PORT, customPath = "") {
  if (customPath) return path.resolve(customPath);
  const p = Number(port) || DEFAULT_WORKBUDDY_PORT;
  if (p === DEFAULT_WORKBUDDY_PORT) {
    return DEFAULT_LOG_FILE;
  }
  return path.join(DEFAULT_WORKBUDDY_DIR, `supervisor-${p}.log`);
}

export const WORKBUDDY_ENDPOINTS = {
  cn: "https://copilot.tencent.com",
  global: "https://www.workbuddy.ai",
};

export function resolveCodebuddyEndpoint(endpointOrEdition) {
  const val = String(endpointOrEdition || "").trim();
  if (val === "global" || val === "intl" || val === "international") {
    return WORKBUDDY_ENDPOINTS.global;
  }
  if (val === "cn" || val === "domestic") {
    return WORKBUDDY_ENDPOINTS.cn;
  }
  if (val.startsWith("http://") || val.startsWith("https://")) {
    return val;
  }
  return "";
}

export function resolveBinary(name, {
  platform = process.platform,
  home = os.homedir(),
  pathValue = process.env.PATH || "",
} = {}) {
  const commonDirs = [
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
    ...(platform === "win32"
      ? [
          path.join(home, "AppData", "Local", "Programs"),
          path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Packages"),
        ]
      : []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];

  if (pathValue) {
    const envPaths = pathValue.split(path.delimiter);
    for (const p of envPaths) {
      if (!commonDirs.includes(p)) commonDirs.push(p);
    }
  }

  const extensions = platform === "win32"
    ? ["", ".exe", ".cmd", ".bat", ".com"]
    : [""];
  for (const dir of commonDirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${name}${extension}`);
      try {
        if (fs.existsSync(candidate)) {
          if (platform !== "win32") fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        }
      } catch {}
    }
  }
  return null;
}

export async function checkLegacyUvTool() {
  const uvPath = resolveBinary("uv");
  if (!uvPath) return { detected: false };
  try {
    const { stdout } = await execFileP(uvPath, ["tool", "list"], { timeout: 4000, windowsHide: true });
    const match = stdout.match(/workbuddy2api\s+v?([0-9.]+)/i);
    if (match) {
      return { detected: true, version: match[1], uvPath };
    }
  } catch {}
  return { detected: false };
}

export async function cleanupLegacyUvTool() {
  const uvPath = resolveBinary("uv");
  if (!uvPath) return { ok: false, reason: "uv_not_found" };
  try {
    const { stdout, stderr } = await execFileP(
      uvPath,
      ["tool", "uninstall", "workbuddy2api"],
      { timeout: 15000, windowsHide: true }
    );
    return { ok: true, output: (stdout + "\n" + stderr).trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function resolveWorkbuddyBinary({
  platform = process.platform,
  arch = process.arch,
  repoDir = path.resolve(import.meta.dirname, "../.."),
} = {}) {
  const bundledDir = path.join(repoDir, "bin", "workbuddy");
  const candidates = [];

  if (platform === "win32") {
    candidates.push(path.join(bundledDir, "wb2api.exe"));
  } else if (platform === "darwin") {
    if (arch === "arm64") {
      candidates.push(path.join(bundledDir, "wb2api-darwin-arm64"));
    }
    candidates.push(path.join(bundledDir, "wb2api-darwin-amd64"));
  } else {
    candidates.push(path.join(bundledDir, "wb2api-linux-amd64"));
    candidates.push(path.join(bundledDir, "wb2api"));
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { binaryPath: c, platform, arch, source: "bundled" };
    }
  }

  const userBin = path.join(DEFAULT_WORKBUDDY_DIR, "bin", platform === "win32" ? "wb2api.exe" : "wb2api");
  if (fs.existsSync(userBin)) {
    return { binaryPath: userBin, platform, arch, source: "user" };
  }

  const devBin = path.join("D:\\Java Project\\AI-OP\\workbuddy2api", platform === "win32" ? "wb2api.exe" : "wb2api");
  if (fs.existsSync(devBin)) {
    return { binaryPath: devBin, platform, arch, source: "dev" };
  }

  const inPath = resolveBinary("wb2api", { platform });
  if (inPath) {
    return { binaryPath: inPath, platform, arch, source: "path" };
  }

  return { binaryPath: null, platform, arch, source: "not_found" };
}

export function isPidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function readPid(pidFile = null, port = DEFAULT_WORKBUDDY_PORT) {
  const file = pidFile || resolvePidFile(port);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (Number.isInteger(pid) && pid > 0) return pid;
  } catch {}
  return null;
}

export function writePid(pid, pidFile = null, port = DEFAULT_WORKBUDDY_PORT) {
  const file = pidFile || resolvePidFile(port);
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, String(pid), "utf8");
  } catch (err) {
    console.error(`[WorkBuddySupervisor] Failed to write PID file ${file}:`, err);
  }
}

export function removePid(pidFile = null, port = DEFAULT_WORKBUDDY_PORT) {
  const file = pidFile || resolvePidFile(port);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

export async function findPidByPort(port = DEFAULT_WORKBUDDY_PORT) {
  const p = Number(port) || DEFAULT_WORKBUDDY_PORT;
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileP("netstat", ["-ano"]);
      for (const line of stdout.split("\n")) {
        if (line.includes(`:${p} `) && line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (Number.isInteger(pid) && pid > 0) return pid;
        }
      }
    } else {
      const { stdout } = await execFileP("lsof", ["-ti", `tcp:${p}`, "-sTCP:LISTEN"]);
      const pid = parseInt(stdout.trim().split("\n")[0], 10);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  } catch {}
  return null;
}

export async function checkHealth(port = DEFAULT_WORKBUDDY_PORT, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/healthz`,
      { timeout: timeoutMs },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch {}
          const isAlive = res.statusCode === 200 || res.statusCode === 503;
          resolve({ ok: isAlive, status: res.statusCode, data: parsed || data });
        });
      }
    );
    req.on("error", () => {
      // Fallback check on /health
      const fallbackReq = http.get(
        `http://127.0.0.1:${port}/health`,
        { timeout: timeoutMs },
        (res) => {
          resolve({ ok: res.statusCode === 200, status: res.statusCode });
        }
      );
      fallbackReq.on("error", () => resolve({ ok: false }));
      fallbackReq.on("timeout", () => {
        fallbackReq.destroy();
        resolve({ ok: false, timeout: true });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, timeout: true });
    });
  });
}

export async function fetchPoolStatus(port = DEFAULT_WORKBUDDY_PORT, apiKey = "", timeoutMs = 2000) {
  return new Promise((resolve) => {
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const req = http.get(
      `http://127.0.0.1:${port}/status`,
      { headers, timeout: timeoutMs },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

export function listLocalAuthAccounts(authDir = DEFAULT_AUTHS_DIR) {
  const accounts = [];
  try {
    if (!fs.existsSync(authDir)) return accounts;
    const files = fs.readdirSync(authDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      try {
        const fullPath = path.join(authDir, f);
        const raw = fs.readFileSync(fullPath, "utf8");
        const json = JSON.parse(raw);
        const auth = json.auth || json;
        const account = json.account || {};
        const uid = account.uid || json.uid || auth.uid || f.replace(/\.json$/, "");
        const nickname = account.nickname || account.name || json.nickname || json.user || "未命名账号";
        const domain = auth.domain || json.domain || "";
        const realm = auth.realm || json.realm || (domain.includes("workbuddy.ai") ? "global" : "cn");
        const token = auth.accessToken || auth.token || json.accessToken || json.token;
        const expiresAt = normalizeExpiryMs(auth.expiresAt ?? auth.expires_at ?? json.expiresAt);
        accounts.push({
          uid,
          nickname,
          realm,
          domain,
          authenticated: Boolean(token),
          expiresAt,
          file: f,
          filePath: fullPath,
        });
      } catch {}
    }
  } catch {}
  return accounts;
}

export function deleteLocalAuthAccount(uid, authDir = DEFAULT_AUTHS_DIR) {
  if (!uid) return { ok: false, error: "Missing uid" };
  try {
    if (!fs.existsSync(authDir)) return { ok: false, error: "Auth dir not found" };
    const files = fs.readdirSync(authDir).filter((f) => f.endsWith(".json"));
    let deletedCount = 0;
    for (const f of files) {
      const fullPath = path.join(authDir, f);
      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        const json = JSON.parse(raw);
        const currentUid = json.account?.uid || json.uid || json.auth?.uid;
        if (currentUid === uid || f === `workbuddy-${uid}.json` || f === `${uid}.json`) {
          fs.unlinkSync(fullPath);
          deletedCount++;
        }
      } catch {}
    }
    return { ok: true, deletedCount };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function ensureConfigFile({
  port = DEFAULT_WORKBUDDY_PORT,
  authDir = DEFAULT_AUTHS_DIR,
  dataDir = DEFAULT_DATA_DIR,
  configFile = DEFAULT_CONFIG_FILE,
  checkinEnabled = true,
  keepaliveEnabled = true,
  promptMode = "passthrough",
} = {}) {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.mkdirSync(authDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  let existing = {};
  if (fs.existsSync(configFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(configFile, "utf8"));
    } catch {}
  }

  const config = {
    listen: `:${port}`,
    api_key: existing.api_key || "",
    auth_dir: authDir,
    state_file: path.join(dataDir, "state.json"),
    cooldown: {
      soft_rate: "600s",
      soft_rate_max: "2h",
      ...(existing.cooldown || {}),
    },
    schedule: {
      checkin_hours: [9, 21],
      travel_hours: [9, 21],
      activity_hours: [10],
      keepalive_hours: [22],
      school_hours: [12],
      cat_hours: [1],
      checkin_enabled: checkinEnabled,
      travel_enabled: true,
      activity_enabled: true,
      keepalive_enabled: keepaliveEnabled,
      school_enabled: false,
      cat_enabled: false,
      ...(existing.schedule || {}),
    },
    global: {
      enabled: true,
      chat_base: "",
      billing_base: "",
      ...(existing.global || {}),
    },
    upstream: {
      timeout_seconds: 120,
      header_timeout_seconds: 120,
      idle_timeout_seconds: 300,
      user_agent: "",
      client_version: "",
      cli_version: "",
      device_token: "",
      device_token_file: "",
      client_name: "WorkBuddy",
      passthrough_ip: false,
      ...(existing.upstream || {}),
    },
    features: {
      sanitize_blacklist_fingerprints: true,
      ...(existing.features || {}),
    },
    prompt: {
      mode: promptMode,
      file: "",
      ...(existing.prompt || {}),
    },
    pool: {
      max_in_flight: 3,
      max_in_flight_global: 2,
      breaker_threshold: 3,
      breaker_cooldown: "30m",
      breaker_cooldown_max: "6h",
      degrade_threshold: 5,
      degrade_cooldown: "10m",
      degrade_cooldown_max: "2h",
      idle_weight_per_hour: 0.5,
      idle_weight_max: 5.0,
      expiring_soon: "168h",
      cost_explore_interval: "30m",
      ...(existing.pool || {}),
    },
    session_sticky: {
      enabled: true,
      ttl: "30m",
      gc_interval: "5m",
      ...(existing.session_sticky || {}),
    },
  };

  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { configFile, config };
}

export function readWorkbuddyConfig(configFile = DEFAULT_CONFIG_FILE) {
  if (!fs.existsSync(configFile)) {
    return ensureConfigFile({ configFile }).config;
  }
  try {
    return JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch {
    return ensureConfigFile({ configFile }).config;
  }
}

export function updateWorkbuddyConfig(updates = {}, configFile = DEFAULT_CONFIG_FILE) {
  const current = readWorkbuddyConfig(configFile);
  if (typeof updates.checkin_enabled === "boolean") {
    current.schedule = current.schedule || {};
    current.schedule.checkin_enabled = updates.checkin_enabled;
  }
  if (typeof updates.keepalive_enabled === "boolean") {
    current.schedule = current.schedule || {};
    current.schedule.keepalive_enabled = updates.keepalive_enabled;
  }
  if (typeof updates.prompt_mode === "string") {
    current.prompt = current.prompt || {};
    current.prompt.mode = updates.prompt_mode;
  }
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(current, null, 2) + "\n", "utf8");
  return current;
}

export function readSessionInfo(sessionFile = DEFAULT_SESSION_FILE) {
  try {
    if (!fs.existsSync(sessionFile)) {
      return { authenticated: false, reason: "session_file_missing", path: sessionFile };
    }
    const raw = fs.readFileSync(sessionFile, "utf8");
    const json = JSON.parse(raw);
    const auth = json.auth || {};
    const account = json.account || {};
    const token = json.token || json.access_token || json.accessToken || auth.accessToken || auth.token;
    const rawExpiresAt = auth.expiresAt ?? auth.expires_at ?? json.expiresAt ?? json.expires_at;
    const expiresAtMs = normalizeExpiryMs(rawExpiresAt);
    const user =
      account.nickname ||
      account.name ||
      account.uid ||
      json.user ||
      json.account ||
      json.nickname ||
      json.userId ||
      json.uid ||
      "authenticated";

    const isExpired = Boolean(expiresAtMs && Date.now() > expiresAtMs);
    return {
      exists: true,
      authenticated: Boolean(token) && !isExpired,
      user,
      account: account.uid ? account : null,
      expiresAt: expiresAtMs || null,
      isExpired: Boolean(isExpired),
      path: sessionFile,
    };
  } catch (err) {
    return { authenticated: false, exists: false, error: err.message, path: sessionFile };
  }
}

export async function getStatus({ port = DEFAULT_WORKBUDDY_PORT, sessionFile = "" } = {}) {
  const resolvedPort = Number(port) || DEFAULT_WORKBUDDY_PORT;
  const resolvedSession = resolveSessionFile(resolvedPort, sessionFile);
  const resolvedPidFile = resolvePidFile(resolvedPort);

  const binInfo = resolveWorkbuddyBinary();
  const installed = Boolean(binInfo.binaryPath);

  let pid = readPid(resolvedPidFile, resolvedPort);
  let processAlive = pid ? isPidAlive(pid) : false;
  const health = await checkHealth(resolvedPort);

  if (!processAlive && health.ok) {
    const detectedPid = await findPidByPort(resolvedPort);
    if (detectedPid && isPidAlive(detectedPid)) {
      pid = detectedPid;
      processAlive = true;
      try {
        writePid(pid, resolvedPidFile, resolvedPort);
      } catch {}
    }
  }

  const running = health.ok || processAlive;
  const poolStatus = running ? await fetchPoolStatus(resolvedPort) : null;
  const localAccounts = listLocalAuthAccounts();
  const legacyUv = await checkLegacyUvTool();
  const session = readSessionInfo(resolvedSession);

  return {
    installed,
    uv_installed: Boolean(resolveBinary("uv")),
    binPath: binInfo.binaryPath,
    binSource: binInfo.source,
    platform: binInfo.platform,
    arch: binInfo.arch,
    running,
    pid: processAlive ? pid : null,
    port: resolvedPort,
    health: health.ok,
    pool: poolStatus,
    accounts: poolStatus?.accounts || localAccounts,
    local_accounts_count: localAccounts.length,
    legacy_uv: legacyUv,
    has_session: localAccounts.length > 0 || (poolStatus?.healthy || 0) > 0 || Boolean(session?.authenticated),
    session_path: resolvedSession,
    session,
    auth_dir: DEFAULT_AUTHS_DIR,
    config_file: DEFAULT_CONFIG_FILE,
    config: readWorkbuddyConfig(),
  };
}

export async function install() {
  const binInfo = resolveWorkbuddyBinary();
  if (binInfo.binaryPath) {
    return { ok: true, binPath: binInfo.binaryPath, source: binInfo.source };
  }
  return {
    ok: false,
    error: `未找到适合系统的 WorkBuddy 核心驱动 (系统: ${process.platform}/${process.arch})。请确认 bin/workbuddy/ 目录包含对应可执行文件。`,
  };
}

export async function uninstall() {
  await stop();
  return { ok: true, message: "WorkBuddy 服务已停止" };
}

export async function start({
  port = DEFAULT_WORKBUDDY_PORT,
  configFile = DEFAULT_CONFIG_FILE,
  authDir = DEFAULT_AUTHS_DIR,
  dataDir = DEFAULT_DATA_DIR,
  logFile = "",
  pidFile = "",
  autoCleanUv = true,
  checkinEnabled = true,
  keepaliveEnabled = true,
  promptMode = "passthrough",
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_WORKBUDDY_PORT;
  const resolvedPid = resolvePidFile(resolvedPort, pidFile);
  const resolvedLog = resolveLogFile(resolvedPort, logFile);

  const current = await getStatus({ port: resolvedPort });
  if (current.running && current.health) {
    return { ok: true, alreadyRunning: true, pid: current.pid, port: resolvedPort };
  }

  if (autoCleanUv) {
    const legacy = await checkLegacyUvTool();
    if (legacy.detected) {
      await cleanupLegacyUvTool();
    }
  }

  const binInfo = resolveWorkbuddyBinary();
  if (!binInfo.binaryPath) {
    throw new Error(
      `未找到可执行的 WorkBuddy 核心驱动 (系统: ${process.platform}/${process.arch})，请确认 bin/workbuddy/ 目录下存在对应平台的二进制文件。`
    );
  }

  const { configFile: generatedConfigFile } = ensureConfigFile({
    port: resolvedPort,
    authDir,
    dataDir,
    configFile,
    checkinEnabled,
    keepaliveEnabled,
    promptMode,
  });

  const logDir = path.dirname(resolvedLog);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const out = fs.openSync(resolvedLog, "a");
  const err = fs.openSync(resolvedLog, "a");

  const child = spawn(binInfo.binaryPath, ["-config", generatedConfigFile], {
    detached: true,
    stdio: ["ignore", out, err],
    env: { ...process.env },
    windowsHide: true,
  });

  child.unref();
  writePid(child.pid, resolvedPid, resolvedPort);

  const startAt = Date.now();
  while (Date.now() - startAt < 10000) {
    await new Promise((r) => setTimeout(r, 400));
    const health = await checkHealth(resolvedPort, 1000);
    if (health.ok) {
      return {
        ok: true,
        pid: child.pid,
        port: resolvedPort,
        binPath: binInfo.binaryPath,
        configFile: generatedConfigFile,
      };
    }
    if (!isPidAlive(child.pid)) {
      removePid(resolvedPid, resolvedPort);
      throw new Error("workbuddy2api 启动后异常退出，请检查日志：" + resolvedLog);
    }
  }

  throw new Error(`workbuddy2api 启动超时（10s 内未就绪），请检查日志：${resolvedLog}`);
}

export async function stop({ pidFile = "", port = DEFAULT_WORKBUDDY_PORT } = {}) {
  const resolvedPort = Number(port) || DEFAULT_WORKBUDDY_PORT;
  const resolvedPid = resolvePidFile(resolvedPort, pidFile);
  let pid = readPid(resolvedPid, resolvedPort);
  if (!pid || !isPidAlive(pid)) {
    const detected = await findPidByPort(resolvedPort);
    if (detected && isPidAlive(detected)) {
      pid = detected;
    }
  }
  if (pid && isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}

    const startAt = Date.now();
    while (Date.now() - startAt < 3000) {
      await new Promise((r) => setTimeout(r, 200));
      if (!isPidAlive(pid)) break;
    }

    if (isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
  removePid(resolvedPid, resolvedPort);

  const health = await checkHealth(resolvedPort, 500);
  return { ok: true, stopped: !health.ok, port: resolvedPort };
}

export function unwrapCodebuddyPayload(payload) {
  if (payload && typeof payload === "object" && payload.data && typeof payload.data === "object") {
    if ("data" in payload.data) return payload.data.data;
    return payload.data;
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data;
  }
  return payload;
}

export function openInBrowser(targetUrl, {
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  try {
    if (platform === "darwin") {
      const child = spawnImpl("open", [targetUrl], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return true;
    }
    if (platform === "win32") {
      const child = spawnImpl("rundll32", ["url.dll,FileProtocolHandler", targetUrl], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return true;
    }
    const child = spawnImpl("xdg-open", [targetUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function requestLoginUrl({ endpoint = "", edition = "global" } = {}) {
  const targetEndpoint = endpoint || resolveCodebuddyEndpoint(edition) || WORKBUDDY_ENDPOINTS.global;
  const url = new URL("/v2/plugin/auth/state?platform=VSCode", targetEndpoint).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; Genie-IDE/1.0)",
      "X-Product-Code": "codebuddy",
      "X-No-Authorization": "true",
      "X-No-User-Id": "true",
      "X-No-Enterprise-Id": "true",
      "X-No-Department-Info": "true",
    },
    body: "{}",
  });

  if (!res.ok) {
    throw new Error(`获取登录授权状态失败: HTTP ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const data = unwrapCodebuddyPayload(json);
  if (!data?.authUrl || !data?.state) {
    throw new Error(`服务返回的授权数据不完整: ${JSON.stringify(json)}`);
  }

  return {
    state: data.state,
    authUrl: data.authUrl,
    endpoint: targetEndpoint,
  };
}

const activeLoginPollers = new Map();

export function getActiveLoginState(state) {
  return activeLoginPollers.get(state) || null;
}

export function pollAndSaveSession({
  state,
  endpoint,
  authDir = DEFAULT_AUTHS_DIR,
  sessionFile = DEFAULT_SESSION_FILE,
  port = DEFAULT_WORKBUDDY_PORT,
  timeoutMs = 300000,
  onSuccess,
  fetchImpl = fetch,
  accountTimeoutMs = 60000,
  startImpl,
  stopImpl,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const record = {
    state,
    endpoint,
    status: "polling",
    startedAt: Date.now(),
    account: null,
    error: null,
  };
  activeLoginPollers.set(state, record);

  (async () => {
    const deadline = Date.now() + timeoutMs;
    const isGlobal = endpoint.includes("workbuddy.ai");
    const origin = isGlobal ? "https://www.workbuddy.ai" : "https://www.codebuddy.cn";
    const baseHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      Origin: origin,
      Referer: `${origin}/`,
      "User-Agent": "CLI/2.63.2 CodeBuddy/2.63.2",
    };

    while (Date.now() < deadline) {
      await sleepImpl(1500);
      try {
        const tokenRes = await fetchImpl(
          new URL(`/v2/plugin/auth/token?state=${encodeURIComponent(state)}`, endpoint).toString(),
          {
            headers: {
              ...baseHeaders,
              "X-Domain": new URL(endpoint).host,
            },
          }
        );
        if (!tokenRes.ok) continue;

        const tokenJson = await tokenRes.json();
        const tokenData = unwrapCodebuddyPayload(tokenJson);

        if (tokenData && typeof tokenData === "object" && tokenData.accessToken) {
          let accountData = null;
          const accountDeadline = Date.now() + accountTimeoutMs;
          const urlObj = new URL(endpoint);
          const domain = tokenData.domain ? String(tokenData.domain) : urlObj.host;

          while (Date.now() < accountDeadline) {
            await sleepImpl(1000);
            try {
              const accountRes = await fetchImpl(
                new URL(`/v2/plugin/login/account?state=${encodeURIComponent(state)}`, endpoint).toString(),
                {
                  headers: {
                    ...baseHeaders,
                    "X-Domain": domain,
                    Authorization: `Bearer ${tokenData.accessToken}`,
                  },
                }
              );
              if (!accountRes.ok) continue;
              const accountJson = await accountRes.json();
              const unwrapped = unwrapCodebuddyPayload(accountJson);
              if (unwrapped && typeof unwrapped === "object" && unwrapped.uid) {
                accountData = unwrapped;
                break;
              }
            } catch {}
          }

          const uid = accountData?.uid || `acc_${Date.now()}`;
          const realm = isGlobal ? "global" : "cn";
          const authContent = {
            auth: {
              accessToken: tokenData.accessToken,
              refreshToken: tokenData.refreshToken || "",
              expiresAt: tokenData.expiresAt || Math.floor(Date.now() / 1000) + 86400 * 30,
              domain: isGlobal ? "www.workbuddy.ai" : "copilot.tencent.com",
              realm,
            },
            account: accountData || { uid, nickname: "CodeBuddy 账号" },
            machineId: crypto.randomUUID(),
          };

          // 1. Save to standard auths/ directory for workbuddy2api
          fs.mkdirSync(authDir, { recursive: true });
          const targetAuthFile = path.join(authDir, `workbuddy-${uid}.json`);
          fs.writeFileSync(targetAuthFile, JSON.stringify(authContent, null, 2) + "\n", { mode: 0o600 });

          // 2. Also save to sessionFile for legacy compatibility
          try {
            fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
            fs.writeFileSync(sessionFile, JSON.stringify(authContent, null, 2) + "\n", { mode: 0o600 });
          } catch {}

          record.status = "success";
          record.account = accountData;
          record.authFile = targetAuthFile;
          record.completedAt = Date.now();

          // Restart or reload workbuddy service if running
          try {
            const health = await checkHealth(port, 500);
            if (health.ok) {
              await (stopImpl || stop)({ port });
              await (startImpl || start)({ port, authDir });
            }
          } catch {}

          if (typeof onSuccess === "function") {
            try { onSuccess(authContent); } catch {}
          }
          return;
        }
      } catch {}
    }

    record.status = "timeout";
    record.error = "等待用户登录授权超时（5分钟）";
  })();

  return record;
}

export async function login({
  openBrowser = true,
  endpoint = "",
  edition = "global",
  port = DEFAULT_WORKBUDDY_PORT,
  authDir = DEFAULT_AUTHS_DIR,
  sessionFile = "",
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_WORKBUDDY_PORT;
  const resolvedSession = resolveSessionFile(resolvedPort, sessionFile);
  const { state, authUrl, endpoint: targetEndpoint } = await requestLoginUrl({ endpoint, edition });

  let browserOpened = false;
  if (openBrowser && authUrl) {
    browserOpened = openInBrowser(authUrl);
  }

  pollAndSaveSession({
    state,
    endpoint: targetEndpoint,
    authDir,
    sessionFile: resolvedSession,
    port: resolvedPort,
  });

  return {
    ok: true,
    state,
    auth_url: authUrl,
    endpoint: targetEndpoint,
    edition: edition || "global",
    port: resolvedPort,
    sessionFile: resolvedSession,
    browserOpened,
    message: "已成功唤醒 CodeBuddy 登录授权页面，请在浏览器中完成登录",
  };
}

export async function ensureReady({
  port = DEFAULT_WORKBUDDY_PORT,
  configFile = DEFAULT_CONFIG_FILE,
  authDir = DEFAULT_AUTHS_DIR,
  dataDir = DEFAULT_DATA_DIR,
  sessionFile = "",
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_WORKBUDDY_PORT;
  const status = await getStatus({ port: resolvedPort, sessionFile });
  if (status.running && status.health) {
    return status;
  }
  await start({ port: resolvedPort, configFile, authDir, dataDir });
  return getStatus({ port: resolvedPort, sessionFile });
}
