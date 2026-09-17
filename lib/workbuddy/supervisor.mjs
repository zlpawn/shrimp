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
      `http://127.0.0.1:${port}/health`,
      { timeout: timeoutMs },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          resolve({ ok: res.statusCode === 200, status: res.statusCode, data });
        });
      }
    );
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, timeout: true });
    });
  });
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

  const uvPath = resolveBinary("uv");
  const binPath = resolveBinary("workbuddy2api");
  const installed = Boolean(binPath);

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

  let version = null;
  if (installed) {
    try {
      if (uvPath) {
        const { stdout } = await execFileP(uvPath, ["tool", "list"], {
          timeout: 3000,
          windowsHide: true,
        });
        const match = stdout.match(/workbuddy2api\s+v?([0-9.]+)/i);
        if (match) version = match[1];
      }
    } catch {}
  }

  const session = readSessionInfo(resolvedSession);

  return {
    installed,
    uv_installed: Boolean(uvPath),
    uvPath,
    binPath,
    version,
    running,
    pid: processAlive ? pid : null,
    port: resolvedPort,
    health: health.ok,
    has_session: Boolean(session?.authenticated),
    session_path: resolvedSession,
    session,
  };
}

export async function install() {
  const uvPath = resolveBinary("uv");
  if (!uvPath) {
    const err = new Error("未找到 uv 工具，请先安装 uv (curl -LsSf https://astral.sh/uv/install.sh | sh)");
    err.code = "missing_uv";
    throw err;
  }

  try {
    const { stdout, stderr } = await execFileP(
      uvPath,
      ["tool", "install", "workbuddy2api", "--force"],
      { timeout: 60000, windowsHide: true }
    );
    const binPath = resolveBinary("workbuddy2api");
    return {
      ok: true,
      binPath,
      output: (stdout + "\n" + stderr).trim(),
    };
  } catch (err) {
    const error = new Error(`安装 workbuddy2api 失败: ${err.message}`);
    error.code = "install_failed";
    error.detail = err.stderr || err.stdout;
    throw error;
  }
}

export async function uninstall() {
  await stop();
  const uvPath = resolveBinary("uv");
  if (!uvPath) {
    const err = new Error("未找到 uv 工具");
    err.code = "missing_uv";
    throw err;
  }

  try {
    const { stdout, stderr } = await execFileP(
      uvPath,
      ["tool", "uninstall", "workbuddy2api"],
      { timeout: 30000, windowsHide: true }
    );
    return {
      ok: true,
      output: (stdout + "\n" + stderr).trim(),
    };
  } catch (err) {
    const error = new Error(`卸载 workbuddy2api 失败: ${err.message}`);
    error.code = "uninstall_failed";
    throw error;
  }
}

export async function start({
  port = DEFAULT_WORKBUDDY_PORT,
  sessionFile = "",
  endpoint = "",
  edition = "",
  desensitize = true,
  optimizeContext = true,
  logFile = "",
  pidFile = "",
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_WORKBUDDY_PORT;
  const resolvedSession = resolveSessionFile(resolvedPort, sessionFile);
  const resolvedPid = resolvePidFile(resolvedPort, pidFile);
  const resolvedLog = resolveLogFile(resolvedPort, logFile);

  const current = await getStatus({ port: resolvedPort, sessionFile: resolvedSession });
  if (current.running && current.health) {
    return { ok: true, alreadyRunning: true, pid: current.pid, port: resolvedPort, sessionFile: resolvedSession };
  }

  let binPath = resolveBinary("workbuddy2api");
  if (!binPath) {
    await install();
    binPath = resolveBinary("workbuddy2api");
    if (!binPath) {
      throw new Error("workbuddy2api 安装成功但未找到可执行文件路径");
    }
  }

  const logDir = path.dirname(resolvedLog);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const sessionDir = path.dirname(resolvedSession);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const targetEndpoint = endpoint || (edition ? resolveCodebuddyEndpoint(edition) : "");
  const args = ["--host", "127.0.0.1", "--port", String(resolvedPort), "--session-file", resolvedSession];
  if (targetEndpoint) args.push("--endpoint", targetEndpoint);
  if (desensitize) args.push("--desensitize");
  if (optimizeContext) args.push("--optimize-context");

  const out = fs.openSync(resolvedLog, "a");
  const err = fs.openSync(resolvedLog, "a");

  const child = spawn(binPath, args, {
    detached: true,
    stdio: ["ignore", out, err],
    env: { ...process.env },
    windowsHide: true,
  });

  child.unref();
  writePid(child.pid, resolvedPid, resolvedPort);

  // Poll for health check
  const startAt = Date.now();
  while (Date.now() - startAt < 10000) {
    await new Promise((r) => setTimeout(r, 400));
    const health = await checkHealth(resolvedPort, 1000);
    if (health.ok) {
      return { ok: true, pid: child.pid, port: resolvedPort, targetEndpoint: targetEndpoint || null, sessionFile: resolvedSession };
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
    const baseHeaders = {
      "User-Agent": "Mozilla/5.0 (compatible; Genie-IDE/1.0)",
      "X-Product-Code": "codebuddy",
      "X-No-Authorization": "true",
      "X-No-User-Id": "true",
      "X-No-Enterprise-Id": "true",
      "X-No-Department-Info": "true",
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
                    "User-Agent": baseHeaders["User-Agent"],
                    "X-Product-Code": baseHeaders["X-Product-Code"],
                    "X-Domain": domain,
                    Authorization: `Bearer ${tokenData.accessToken}`,
                    "X-No-User-Id": "true",
                    "X-No-Enterprise-Id": "true",
                    "X-No-Department-Info": "true",
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

          let existing = {};
          try {
            if (fs.existsSync(sessionFile)) {
              existing = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
            }
          } catch {
            // Preserve an existing session so a failed read does not lose machineId.
          }

          const machineId = existing.machineId || crypto.randomUUID();
          const sessionContent = {
            auth: tokenData,
            account: accountData || {},
            machineId,
          };

          fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
          fs.writeFileSync(sessionFile, JSON.stringify(sessionContent, null, 2) + "\n", {
            mode: 0o600,
          });

          record.status = "success";
          record.account = accountData;
          record.completedAt = Date.now();

          try {
            await (stopImpl || stop)({ port });
            await (startImpl || start)({ endpoint, port, sessionFile });
          } catch (restartError) {
            record.error = `登录成功，但重启 WorkBuddy 服务失败：${restartError.message}`;
          }

          if (typeof onSuccess === "function") {
            try { onSuccess(sessionContent); } catch {}
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
  sessionFile = "",
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_WORKBUDDY_PORT;
  const resolvedSession = resolveSessionFile(resolvedPort, sessionFile);
  const { state, authUrl, endpoint: targetEndpoint } = await requestLoginUrl({ endpoint, edition });

  let browserOpened = false;
  if (openBrowser && authUrl) {
    browserOpened = openInBrowser(authUrl);
  }

  pollAndSaveSession({ state, endpoint: targetEndpoint, sessionFile: resolvedSession, port: resolvedPort });

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
  sessionFile = "",
  endpoint = "",
  edition = "",
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_WORKBUDDY_PORT;
  const resolvedSession = resolveSessionFile(resolvedPort, sessionFile);
  const status = await getStatus({ port: resolvedPort, sessionFile: resolvedSession });
  if (status.running && status.health) {
    return status;
  }
  if (!status.installed) {
    await install();
  }
  await start({ port: resolvedPort, sessionFile: resolvedSession, endpoint, edition });
  return getStatus({ port: resolvedPort, sessionFile: resolvedSession });
}
