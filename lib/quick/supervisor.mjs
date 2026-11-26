import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

export const DEFAULT_QUICK_PORT = 8377;
export const DEFAULT_QUICK_DIR = path.join(os.homedir(), ".quick2api");
export const DEFAULT_CONFIG_FILE = path.join(DEFAULT_QUICK_DIR, "config.yaml");
export const DEFAULT_PID_FILE = path.join(DEFAULT_QUICK_DIR, "gateway-supervisor.pid");
export const DEFAULT_LOG_FILE = path.join(DEFAULT_QUICK_DIR, "supervisor-stdout.log");

export function resolvePidFile(port = DEFAULT_QUICK_PORT, customPath = "") {
  if (customPath) return path.resolve(customPath);
  const p = Number(port) || DEFAULT_QUICK_PORT;
  if (p === DEFAULT_QUICK_PORT) {
    return DEFAULT_PID_FILE;
  }
  return path.join(DEFAULT_QUICK_DIR, `supervisor-${p}.pid`);
}

export function resolveLogFile(port = DEFAULT_QUICK_PORT, customPath = "") {
  if (customPath) return path.resolve(customPath);
  const p = Number(port) || DEFAULT_QUICK_PORT;
  if (p === DEFAULT_QUICK_PORT) {
    return DEFAULT_LOG_FILE;
  }
  return path.join(DEFAULT_QUICK_DIR, `supervisor-${p}.log`);
}

export function resolveBinary(name, {
  platform = process.platform,
  home = os.homedir(),
  pathValue = process.env.PATH || "",
} = {}) {
  const commonDirs = [
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    ...(platform === "win32"
      ? [
          path.join(home, "AppData", "Local", "Programs"),
          path.join(home, "AppData", "Local", "quickwork", "agent"),
        ]
      : []),
  ];

  const searchNames = platform === "win32" ? [name, `${name}.exe`] : [name];
  const envDirs = pathValue.split(path.delimiter).filter(Boolean);
  const allDirs = [...new Set([...commonDirs, ...envDirs])];

  for (const dir of allDirs) {
    for (const binName of searchNames) {
      const fullPath = path.join(dir, binName);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

export function resolveQuickBinary({
  platform = process.platform,
  arch = process.arch,
  repoDir = path.resolve(import.meta.dirname, "../.."),
} = {}) {
  const bundledDir = path.join(repoDir, "bin", "quick");
  const candidates = [];

  if (platform === "win32") {
    candidates.push(path.join(bundledDir, "quick2api.exe"));
    candidates.push(path.join(bundledDir, "quick2api-windows-amd64.exe"));
  } else if (platform === "darwin") {
    if (arch === "arm64") {
      candidates.push(path.join(bundledDir, "quick2api-darwin-arm64"));
      candidates.push(path.join(bundledDir, "quick2api-darwin-amd64"));
    } else {
      candidates.push(path.join(bundledDir, "quick2api-darwin-amd64"));
      candidates.push(path.join(bundledDir, "quick2api-darwin-arm64"));
    }
  } else {
    candidates.push(path.join(bundledDir, "quick2api-linux-amd64"));
    candidates.push(path.join(bundledDir, "quick2api"));
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      if (platform !== "win32") {
        try {
          fs.chmodSync(c, 0o755);
        } catch {}
      }
      return { binaryPath: c, platform, arch, source: "bundled" };
    }
  }

  const userBin = path.join(DEFAULT_QUICK_DIR, "bin", platform === "win32" ? "quick2api.exe" : "quick2api");
  if (fs.existsSync(userBin)) {
    if (platform !== "win32") {
      try {
        fs.chmodSync(userBin, 0o755);
      } catch {}
    }
    return { binaryPath: userBin, platform, arch, source: "user" };
  }

  const devBin = path.join("/Users/pa/project/AI-SAVE-MONEY/quick2api/dist", platform === "win32" ? "quick2api.exe" : "quick2api-darwin-arm64");
  if (fs.existsSync(devBin)) {
    return { binaryPath: devBin, platform, arch, source: "dev" };
  }

  const inPath = resolveBinary("quick2api", { platform });
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
  } catch (err) {
    return err.code === "EPERM";
  }
}

export function readPid(pidFile = null, port = DEFAULT_QUICK_PORT) {
  const resolved = pidFile ? path.resolve(pidFile) : resolvePidFile(port);
  try {
    if (!fs.existsSync(resolved)) return null;
    const content = fs.readFileSync(resolved, "utf8").trim();
    const pid = Number(content);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function writePid(pid, pidFile = null, port = DEFAULT_QUICK_PORT) {
  const resolved = pidFile ? path.resolve(pidFile) : resolvePidFile(port);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, String(pid), "utf8");
}

export function removePid(pidFile = null, port = DEFAULT_QUICK_PORT) {
  const resolved = pidFile ? path.resolve(pidFile) : resolvePidFile(port);
  try {
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
  } catch {}
}

export async function checkHealth(port = DEFAULT_QUICK_PORT, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/healthz`,
      { timeout: timeoutMs },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          try {
            const data = JSON.parse(raw);
            resolve({ ok: res.statusCode === 200 && data.ok === true, status: res.statusCode, data });
          } catch {
            resolve({ ok: res.statusCode === 200, status: res.statusCode, raw });
          }
        });
      }
    );
    req.on("error", () => resolve({ ok: false, status: 0 }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, timeout: true });
    });
  });
}

export async function start({
  port = DEFAULT_QUICK_PORT,
  configPath = "",
  logFile = null,
  pidFile = null,
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_QUICK_PORT;
  const existingHealth = await checkHealth(resolvedPort, 800);
  if (existingHealth.ok) {
    return { ok: true, alreadyRunning: true, port: resolvedPort };
  }

  const binInfo = resolveQuickBinary();
  if (!binInfo.binaryPath) {
    throw new Error(
      `未找到可执行的 quick2api 核心驱动 (系统: ${process.platform}/${process.arch})，请确认 bin/quick/ 目录下存在对应平台的二进制文件。`
    );
  }

  const resolvedLog = resolveLogFile(resolvedPort, logFile);
  const resolvedPid = resolvePidFile(resolvedPort, pidFile);
  const logDir = path.dirname(resolvedLog);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const out = fs.openSync(resolvedLog, "a");
  const err = fs.openSync(resolvedLog, "a");

  const args = [];
  if (configPath && fs.existsSync(configPath)) {
    args.push("-config", configPath);
  }

  const child = spawn(binInfo.binaryPath, args, {
    detached: true,
    stdio: ["ignore", out, err],
    env: {
      ...process.env,
      QUICK2API_LISTEN: `127.0.0.1:${resolvedPort}`,
    },
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
      };
    }
    if (!isPidAlive(child.pid)) {
      removePid(resolvedPid, resolvedPort);
      throw new Error("quick2api 启动后异常退出，请检查日志：" + resolvedLog);
    }
  }

  throw new Error(`quick2api 启动超时（10s 内未就绪），请检查日志：${resolvedLog}`);
}

export async function stop({ port = DEFAULT_QUICK_PORT, pidFile = null } = {}) {
  const resolvedPort = Number(port) || DEFAULT_QUICK_PORT;
  const resolvedPid = resolvePidFile(resolvedPort, pidFile);
  const pid = readPid(resolvedPid, resolvedPort);

  if (pid && isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
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

export async function getStatus({ port = DEFAULT_QUICK_PORT, pidFile = null } = {}) {
  const resolvedPort = Number(port) || DEFAULT_QUICK_PORT;
  const resolvedPid = resolvePidFile(resolvedPort, pidFile);
  const binInfo = resolveQuickBinary();
  const installed = Boolean(binInfo.binaryPath);

  let pid = readPid(resolvedPid, resolvedPort);
  let processAlive = pid ? isPidAlive(pid) : false;
  const health = await checkHealth(resolvedPort);

  return {
    ok: true,
    installed,
    binaryPath: binInfo.binaryPath,
    running: processAlive || health.ok,
    processAlive,
    pid,
    port: resolvedPort,
    health: health.ok ? health.data || { ok: true } : null,
  };
}

export async function ensureReady({ port = DEFAULT_QUICK_PORT, configPath = "" } = {}) {
  const resolvedPort = Number(port) || DEFAULT_QUICK_PORT;
  const health = await checkHealth(resolvedPort, 800);
  if (health.ok) {
    return { ok: true, alreadyRunning: true, port: resolvedPort };
  }
  return start({ port: resolvedPort, configPath });
}
