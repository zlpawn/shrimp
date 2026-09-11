import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROVIDER_STATUS } from "../domain/status.mjs";
import { NatTraversalError } from "../domain/errors.mjs";

const LOG_TAIL_LIMIT = 120;
const QUICK_URL_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

export function buildCloudflaredArgs({
  mode = "quick",
  localUrl = "http://127.0.0.1:8787",
  token = "",
  logLevel = "",
} = {}) {
  const args = ["tunnel"];
  if (mode === "token") {
    args.push("run", "--token", String(token || "").trim());
  } else {
    args.push("--url", String(localUrl || "http://127.0.0.1:8787").trim());
  }
  if (logLevel) {
    args.push("--loglevel", logLevel);
  }
  args.push("--no-autoupdate");
  return args;
}

export function extractQuickTunnelUrl(text) {
  if (!text) return "";
  const match = String(text).match(QUICK_URL_REGEX);
  return match ? match[0] : "";
}

function defaultWhichBin(name) {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const res = spawnSync(cmd, [name], { encoding: "utf8", timeout: 3000 });
    if (!res.error && res.status === 0 && res.stdout) {
      const line = res.stdout.trim().split(/\r?\n/)[0];
      if (line) return line.trim();
    }
  } catch {
    // ignore
  }
  return "";
}

export function resolveCloudflaredBin({
  configuredPath = "",
  whichBin = defaultWhichBin,
  platform = process.platform,
  existsSync = fs.existsSync,
} = {}) {
  const configured = String(configuredPath || "").trim();
  if (configured) {
    try {
      if (existsSync(configured)) return configured;
    } catch {
      // ignore
    }
  }

  const found = typeof whichBin === "function" ? whichBin("cloudflared") : "";
  if (found) {
    return found;
  }

  const candidates = [];
  if (platform === "win32") {
    const appdata = process.env.APPDATA || "";
    const localappdata = process.env.LOCALAPPDATA || "";
    if (appdata) candidates.push(path.join(appdata, "npm", "cloudflared.cmd"));
    if (localappdata) {
      candidates.push(path.join(localappdata, "Programs", "cloudflared", "cloudflared.exe"));
    }
    candidates.push("C:\\Program Files\\cloudflared\\cloudflared.exe");
  } else {
    candidates.push(
      "/opt/homebrew/bin/cloudflared",
      "/usr/local/bin/cloudflared",
      path.join(os.homedir(), ".npm-global", "bin", "cloudflared"),
    );
  }

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // continue
    }
  }

  return platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

function defaultIsProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultKillProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 3000 });
      return true;
    }
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function tailLog(filePath, limit = LOG_TAIL_LIMIT) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

export function createCloudflaredSupervisor({
  binPath = "cloudflared",
  pidPath,
  logPath,
  statePath,
  spawnRunner = null,
  isProcessRunning = defaultIsProcessRunning,
  killProcess = defaultKillProcess,
  logger = console,
} = {}) {
  let inMemoryState = {
    mode: "quick",
    quickUrl: "",
    publicUrl: "",
    lastError: "",
  };

  function readPid() {
    if (!pidPath) return 0;
    try {
      if (!fs.existsSync(pidPath)) return 0;
      const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
      return Number.isInteger(pid) && pid > 0 ? pid : 0;
    } catch {
      return 0;
    }
  }

  function writePid(pid) {
    if (!pidPath) return;
    try {
      fs.mkdirSync(path.dirname(pidPath), { recursive: true });
      fs.writeFileSync(pidPath, String(pid), "utf8");
    } catch (e) {
      logger.error?.("[cloudflared-supervisor] writePid failed:", e);
    }
  }

  function clearPid() {
    if (!pidPath) return;
    try {
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    } catch {
      // ignore
    }
  }

  function scanLogsForQuickUrl() {
    if (!logPath || !fs.existsSync(logPath)) return "";
    try {
      const recent = tailLog(logPath, 200).join("\n");
      const url = extractQuickTunnelUrl(recent);
      if (url) {
        inMemoryState.quickUrl = url;
      }
      return url;
    } catch {
      return "";
    }
  }

  async function start({ mode = "quick", localUrl = "http://127.0.0.1:8787", token = "", publicUrl = "" } = {}) {
    const currentPid = readPid();
    if (currentPid && isProcessRunning(currentPid)) {
      scanLogsForQuickUrl();
      return getStatus();
    }

    inMemoryState.mode = mode;
    inMemoryState.publicUrl = publicUrl;
    inMemoryState.lastError = "";

    const args = buildCloudflaredArgs({ mode, localUrl, token });

    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
    }

    let childPid = 0;
    if (typeof spawnRunner === "function") {
      const proc = spawnRunner(binPath, args);
      childPid = proc.pid;
    } else {
      const logFd = logPath ? fs.openSync(logPath, "a") : "ignore";
      const child = spawn(binPath, args, {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
      });
      childPid = child.pid;
      child.on("error", (err) => {
        inMemoryState.lastError = err.message || String(err);
        clearPid();
      });
      child.unref();
      if (logFd !== "ignore") {
        try { fs.closeSync(logFd); } catch {}
      }
    }

    if (!childPid) {
      throw new NatTraversalError("process_error", "Failed to start cloudflared process");
    }

    writePid(childPid);

    // If quick mode, attempt to capture the URL from log output quickly
    if (mode === "quick") {
      for (let i = 0; i < 15; i++) {
        const found = scanLogsForQuickUrl();
        if (found) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return getStatus();
  }

  async function stop() {
    const pid = readPid();
    if (pid && isProcessRunning(pid)) {
      killProcess(pid);
    }
    clearPid();
    inMemoryState.quickUrl = "";
    return getStatus();
  }

  function getStatus() {
    const pid = readPid();
    const isRunning = pid > 0 && isProcessRunning(pid);
    if (!isRunning && pid > 0) {
      clearPid();
    }

    if (isRunning && inMemoryState.mode === "quick" && !inMemoryState.quickUrl) {
      scanLogsForQuickUrl();
    }

    const recentLogs = logPath ? tailLog(logPath, 50) : [];
    return {
      status: isRunning ? PROVIDER_STATUS.running : PROVIDER_STATUS.stopped,
      pid: isRunning ? pid : 0,
      mode: inMemoryState.mode,
      quickUrl: inMemoryState.quickUrl,
      publicUrl: inMemoryState.publicUrl || inMemoryState.quickUrl,
      lastError: inMemoryState.lastError,
      recentLogs,
      binPath,
    };
  }

  return {
    start,
    stop,
    getStatus,
    buildArgs: (opts) => buildCloudflaredArgs(opts),
    scanLogsForQuickUrl,
  };
}
