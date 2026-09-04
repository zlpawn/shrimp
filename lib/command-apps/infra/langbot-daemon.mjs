import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { CommandAppsError } from "../domain/errors.mjs";
import { PROXY_ENV_KEYS } from "./hindsight-daemon.mjs";

const STARTUP_WINDOW_MS = 120000;

export function sanitizeLangBotEnv(source = process.env, overrides = {}) {
  const env = { ...source };
  env.LANGBOT_DATA_ROOT = String(overrides.LANGBOT_DATA_ROOT || overrides.dataRoot || "").trim();
  if (!env.LANGBOT_DATA_ROOT) delete env.LANGBOT_DATA_ROOT;
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
  // LangBot's Telegram client supports HTTP proxies, but python-telegram-bot
  // requires an extra dependency for SOCKS. Prefer HTTP(S) variables when both
  // proxy styles are present.
  if (env.HTTP_PROXY || env.HTTPS_PROXY || env.http_proxy || env.https_proxy) {
    delete env.ALL_PROXY;
    delete env.all_proxy;
  }
  return env;
}

export function langbotDaemonUrl(app, settings = {}) {
  const configuredPort = Number(settings.port || app.defaultPort || 5300);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536
    ? configuredPort
    : (app.defaultPort || 5300);
  return {
    port,
    healthUrl: `http://127.0.0.1:${port}${app.healthPath || "/login"}`,
    appUrl: `http://127.0.0.1:${port}${app.appPath || "/"}`,
    mcpUrl: `http://127.0.0.1:${port}${app.mcpPath || "/mcp"}`,
  };
}

export async function probeLangBotHealth(app, settings = {}, {
  request = defaultRequest,
  timeoutMs = 1500,
} = {}) {
  const { healthUrl } = langbotDaemonUrl(app, settings);
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

export async function inspectLangBotDaemon(app, settings = {}, {
  probe = (currentApp, currentSettings) => probeLangBotHealth(currentApp, currentSettings),
  managedPid = null,
  isPidAliveOverride,
} = {}) {
  const alive = isPidAliveOverride || isPidAlive;
  if (await probe(app, settings)) {
    const pid = Number(managedPid);
    const pidAlive = Number.isInteger(pid) && pid > 0 && alive(pid);
    return {
      status: "running",
      pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
      managed: pidAlive,
    };
  }
  const launchedAt = Date.parse(settings.lastLaunchedAt || "");
  const withinStartup = Number.isFinite(launchedAt)
    && Date.now() - launchedAt < STARTUP_WINDOW_MS;
  const pid = Number(managedPid);
  const pidAlive = Number.isInteger(pid) && pid > 0 && alive(pid);
  if (pidAlive && !withinStartup) {
    return {
      status: "error",
      pid,
      error: "LangBot failed to become healthy within the startup window",
    };
  }
  if (Number.isInteger(pid) && pid > 0 && alive(pid) && withinStartup) {
    return { status: "launching", pid };
  }
  return { status: "stopped", pid: null };
}

export async function startLangBotDaemonLogsToInstanceFile(app, settings = {}, {
  spawnProcess = spawn,
  probe = (currentApp, currentSettings) => probeLangBotHealth(currentApp, currentSettings),
  env = sanitizeLangBotEnv(),
  platform = process.platform,
  ensureDirectories = defaultEnsureDirectories,
  openLogFile = (value) => fs.openSync(value, "a"),
} = {}) {
  if (!settings.executablePath) {
    throw new CommandAppsError("executable_not_found", "langbot executable was not found");
  }
  const urls = langbotDaemonUrl(app, settings);
  if (await probe(app, settings)) {
    return { alreadyRunning: true, pid: null, ...urls };
  }
  const logDir = path.join(settings.dataRoot || ".", "logs");
  await ensureDirectories({ cwd: settings.cwd, dataRoot: settings.dataRoot, logDir });
  const logPath = path.join(logDir, "shrimp-launch.log");
  const output = openLogFile(logPath);
  const child = await spawnProcess(settings.executablePath, [...(app.defaultArgs || [])], {
    cwd: settings.cwd,
    detached: true,
    stdio: ["ignore", output, output],
    env: sanitizeLangBotEnv(env, {
      LANGBOT_DATA_ROOT: settings.dataRoot,
    }),
    windowsHide: true,
  });
  if (typeof child?.unref === "function") child.unref();
  if (typeof output?.close === "function") output.close();
  return {
    alreadyRunning: false,
    pid: child?.pid || null,
    ...urls,
    platform,
  };
}

export async function startLangBotDaemon(app, settings = {}, options = {}) {
  return startLangBotDaemonLogsToInstanceFile(app, settings, options);
}

function defaultEnsureDirectories({ cwd, dataRoot, logDir } = {}) {
  if (cwd) fs.mkdirSync(cwd, { recursive: true });
  if (dataRoot) fs.mkdirSync(dataRoot, { recursive: true });
  if (logDir) fs.mkdirSync(logDir, { recursive: true });
}

export async function stopLangBotDaemon(app, settings = {}, {
  probe = (currentApp, currentSettings) => probeLangBotHealth(currentApp, currentSettings),
  managedPid = null,
  terminateProcess,
  waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 10000,
  pollMs = 200,
} = {}) {
  const urls = langbotDaemonUrl(app, settings);
  if (!(await probe(app, settings))) {
    return { stopped: true, alreadyStopped: true, ...urls };
  }
  const pid = Number(managedPid);
  if (Number.isInteger(pid) && pid > 0 && terminateProcess) {
    await terminateProcess(pid);
  } else {
    throw new CommandAppsError(
      "process_error",
      "LangBot is running but was not launched by the gateway. Stop it from its own terminal or explicitly terminate its root process.",
      { port: urls.port },
    );
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await probe(app, settings))) return { stopped: true, ...urls };
    await waitMs(pollMs);
  }
  throw new CommandAppsError("process_error", "LangBot did not stop in time");
}

export { PROXY_ENV_KEYS, STARTUP_WINDOW_MS };
