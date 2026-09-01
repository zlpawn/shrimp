import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { CommandAppsError } from "../domain/errors.mjs";

const execFileP = promisify(execFile);

const PROXY_ENV_KEYS = [
  "ALL_PROXY",
  "all_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "SOCKS_PROXY",
  "socks_proxy",
  "SOCKS5_PROXY",
  "socks5_proxy",
];

export function sanitizeDaemonEnv(source = process.env) {
  const env = { ...source };
  for (const key of PROXY_ENV_KEYS) {
    delete env[key];
  }
  const noProxy = [
    env.NO_PROXY,
    env.no_proxy,
    "localhost",
    "127.0.0.1",
    "127.0.0.0/8",
    "::1",
  ].filter(Boolean).join(",");
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  return env;
}


export function defaultHindsightLockPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".hindsight", "daemon.lock.owner");
}

function isPidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return !error || error.code === "EPERM";
  }
}

export function readHindsightLockPid({
  lockPath = defaultHindsightLockPath(),
  fileExists = (filePath) => fs.existsSync(filePath),
  readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
} = {}) {
  const candidates = [lockPath];
  if (lockPath.endsWith(".owner")) candidates.push(lockPath.replace(/\.owner$/, ""));
  else candidates.push(`${lockPath}.owner`);
  for (const candidate of candidates) {
    if (!fileExists(candidate)) continue;
    try {
      const raw = String(readFile(candidate) || "").trim();
      const pid = parseInt(raw, 10);
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {}
  }
  return null;
}

export async function listHindsightPids({
  execFile = execFileP,
  platform = process.platform,
} = {}) {
  const pids = new Set();
  try {
    if (platform === "win32") {
      const { stdout } = await execFile("wmic", ["process", "where", "Name='python.exe' or Name='hindsight-api.exe' or Name='hindsight-embed.exe'", "get", "ProcessId,CommandLine", "/FORMAT:CSV"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
      });
      for (const line of String(stdout || "").split(/\r?\n/)) {
        if (!/hindsight-api|hindsight-embed|hindsight_api/i.test(line)) continue;
        const match = line.match(/,(\d+)\s*$/);
        if (match) pids.add(Number(match[1]));
      }
    } else {
      const { stdout } = await execFile("ps", ["-ax", "-o", "pid=,command="], {
        encoding: "utf8",
        timeout: 3000,
      });
      for (const line of String(stdout || "").split(/\n/)) {
        if (!/hindsight-api|hindsight-embed|hindsight_api/.test(line)) continue;
        if (/pgrep| rg |grep /.test(line)) continue;
        const pid = Number(String(line).trim().split(/\s+/, 1)[0]);
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
      }
    }
  } catch {
    // Process listing is best-effort; callers treat an empty list as stopped.
  }
  return [...pids];
}

export async function inspectHindsightDaemon(app, settings = {}, options = {}) {
  const probe = options.probe || ((currentApp, currentSettings) => probeHindsightHealth(currentApp, currentSettings, options));
  const healthy = await probe(app, settings);
  if (healthy) {
    return { status: "running", pid: options.lockPid || readHindsightLockPid(options) || 0 };
  }
  const pid = options.lockPid || readHindsightLockPid(options);
  const pidAlive = options.isPidAlive ? options.isPidAlive(pid) : isPidAlive(pid);
  if (pid && pidAlive) {
    return { status: "launching", pid };
  }
  const runningPids = options.listPids ? await options.listPids() : await listHindsightPids(options);
  if (runningPids?.length) {
    return { status: "launching", pid: runningPids[0] };
  }
  return { status: "stopped", pid: null };
}

function daemonUrl(app, settings = {}) {
  const current = settings || {};
  const port = Number(current.port || app.defaultPort || 8888);
  const healthPath = app.healthPath || "/health";
  return {
    port,
    healthUrl: `http://127.0.0.1:${port}${healthPath}`,
    mcpUrl: `http://127.0.0.1:${port}${app.mcpPath || "/mcp/default/"}`,
  };
}

export async function probeHindsightHealth(app, settings = {}, {
  request = defaultRequest,
  timeoutMs = 1500,
} = {}) {
  const { healthUrl } = daemonUrl(app, settings);
  try {
    const response = await request(healthUrl, { timeoutMs });
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch {
    return false;
  }
}

function defaultRequest(url, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode || 0 });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("health probe timed out"));
    });
    req.on("error", reject);
  });
}

function spawnDaemonCommand(executablePath, args, {
  spawnProcess = spawn,
  env = sanitizeDaemonEnv(),
  platform = process.platform,
} = {}) {
  const options = {
    detached: true,
    stdio: "ignore",
    env,
    windowsHide: true,
  };
  return spawnProcess(executablePath, args, options);
}

export async function startHindsightDaemon(app, settings, {
  spawnProcess = spawn,
  probe = (currentApp, currentSettings) => probeHindsightHealth(currentApp, currentSettings),
  waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 180000,
  pollMs = 1500,
  env = sanitizeDaemonEnv(),
  platform = process.platform,
} = {}) {
  if (!settings?.executablePath) {
    throw new CommandAppsError("executable_not_found", "hindsight-embed was not found");
  }
  if (await probe(app, settings)) {
    return { alreadyRunning: true, ...daemonUrl(app, settings) };
  }
  const child = await spawnDaemonCommand(settings.executablePath, [...(app.defaultArgs || ["daemon", "start"])], {
    spawnProcess,
    env,
    platform,
  });
  if (typeof child?.unref === "function") child.unref();
  if (!timeoutMs) {
    return { alreadyRunning: false, pid: child?.pid || null, ...daemonUrl(app, settings) };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probe(app, settings)) {
      return { alreadyRunning: false, pid: child?.pid || null, ...daemonUrl(app, settings) };
    }
    await waitMs(pollMs);
  }
  throw new CommandAppsError(
    "process_error",
    "Hindsight daemon failed to become healthy. Check ~/.hindsight/daemon.log",
  );
}

export async function stopHindsightDaemon(app, settings, {
  spawnProcess = spawn,
  probe = (currentApp, currentSettings) => probeHindsightHealth(currentApp, currentSettings),
  waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 20000,
  pollMs = 400,
  env = sanitizeDaemonEnv(),
  platform = process.platform,
} = {}) {
  if (!settings?.executablePath) return { stopped: true, ...daemonUrl(app, settings) };
  if (!(await probe(app, settings))) {
    return { stopped: true, alreadyStopped: true, ...daemonUrl(app, settings) };
  }
  const child = await spawnDaemonCommand(settings.executablePath, [...(app.stopArgs || ["daemon", "stop"])], {
    spawnProcess,
    env,
    platform,
  });
  if (typeof child?.unref === "function") child.unref();
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await probe(app, settings))) {
      return { stopped: true, ...daemonUrl(app, settings) };
    }
    await waitMs(pollMs);
  }
  throw new CommandAppsError("process_error", "Hindsight daemon did not stop in time");
}

export { daemonUrl, PROXY_ENV_KEYS };
