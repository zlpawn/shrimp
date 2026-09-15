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
    const res = spawnSync(cmd, [name], { encoding: "utf8", timeout: 3000, windowsHide: true });
    if (!res.error && res.status === 0 && res.stdout) {
      const lines = res.stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (process.platform === "win32") {
        const exeLine = lines.find((l) => l.toLowerCase().endsWith(".exe"));
        if (exeLine) return exeLine;
      }
      if (lines[0]) return lines[0];
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
      if (existsSync(configured)) {
        if (platform === "win32" && !configured.toLowerCase().endsWith(".exe")) {
          const directExe = configured.replace(/\.(cmd|bat|ps1)$/i, "") + ".exe";
          if (existsSync(directExe)) return directExe;
          const siblingExe = path.join(path.dirname(configured), "cloudflared.exe");
          if (existsSync(siblingExe)) return siblingExe;
        }
        return configured;
      }
    } catch {
      // ignore
    }
  }

  const found = typeof whichBin === "function" ? whichBin("cloudflared") : "";

  // On Windows, strictly prefer native PE executable (.exe) to eliminate terminal popup flashes
  if (platform === "win32") {
    // 1. If whichBin already returned an .exe, use it
    if (found && found.toLowerCase().endsWith(".exe")) {
      return found;
    }

    // 2. If whichBin found a non-exe wrapper, check for companion/sibling .exe
    if (found) {
      try {
        const directExe = found.replace(/\.(cmd|bat|ps1)$/i, "") + ".exe";
        if (existsSync(directExe)) return directExe;
        const siblingExe = path.join(path.dirname(found), "cloudflared.exe");
        if (existsSync(siblingExe)) return siblingExe;
        const pkgExe = path.join(path.dirname(found), "node_modules", "cloudflared", "bin", "cloudflared.exe");
        if (existsSync(pkgExe)) return pkgExe;
      } catch {
        // ignore
      }
    }

    // 3. Search standard Windows installation locations for native cloudflared.exe
    const nodeBinDir = path.dirname(process.execPath);
    const appdata = process.env.APPDATA || "";
    const localappdata = process.env.LOCALAPPDATA || "";
    const winExeCandidates = [
      path.join(nodeBinDir, "cloudflared.exe"),
      path.join(nodeBinDir, "node_modules", "cloudflared", "bin", "cloudflared.exe"),
      ...(appdata
        ? [
            path.join(appdata, "npm", "cloudflared.exe"),
            path.join(appdata, "npm", "node_modules", "cloudflared", "bin", "cloudflared.exe"),
          ]
        : []),
      ...(localappdata ? [path.join(localappdata, "Programs", "cloudflared", "cloudflared.exe")] : []),
      "C:\\Program Files\\cloudflared\\cloudflared.exe",
      "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    ];

    for (const cand of winExeCandidates) {
      try {
        if (existsSync(cand)) return cand;
      } catch {
        // ignore
      }
    }

    // 4. Fall back to wrapper if found (or if mock returned it)
    if (found) {
      return found;
    }

    // 5. Fall back to .cmd candidates
    const winCmdCandidates = [
      path.join(nodeBinDir, "cloudflared.cmd"),
      ...(appdata ? [path.join(appdata, "npm", "cloudflared.cmd")] : []),
    ];
    for (const cand of winCmdCandidates) {
      try {
        if (existsSync(cand)) return cand;
      } catch {
        // ignore
      }
    }

    return "cloudflared.exe";
  }

  // Non-Windows (Linux, macOS)
  if (found) {
    return found;
  }

  const candidates = [];
  const nodeBinDir = path.dirname(process.execPath);
  candidates.push(
    path.join(nodeBinDir, "cloudflared"),
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
    path.join(os.homedir(), ".npm-global", "bin", "cloudflared"),
  );

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // continue
    }
  }

  return "cloudflared";
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
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 3000, windowsHide: true });
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

function defaultDiscoverRunningCloudflaredPid({ platform = process.platform } = {}) {
  try {
    if (platform === "win32") {
      const ps = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name like '%cloudflared%'\" | Select-Object -ExpandProperty ProcessId",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 4000 },
      );
      if (!ps.error && ps.status === 0 && ps.stdout) {
        const pids = ps.stdout
          .trim()
          .split(/\r?\n/)
          .map((l) => Number(l.trim()))
          .filter((n) => Number.isInteger(n) && n > 0);
        if (pids.length > 0) return pids[0];
      }
      return 0;
    }
    const res = spawnSync("pgrep", ["-x", "cloudflared"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 2000,
    });
    if (!res.error && res.status === 0 && res.stdout) {
      const pids = res.stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => Number(l.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (pids.length > 0) return pids[0];
    }
  } catch {
    // ignore
  }
  return 0;
}

export function createCloudflaredSupervisor({
  binPath = "cloudflared",
  pidPath,
  logPath,
  statePath,
  spawnRunner = null,
  isProcessRunning = defaultIsProcessRunning,
  killProcess = defaultKillProcess,
  discoverProcess = defaultDiscoverRunningCloudflaredPid,
  logger = console,
} = {}) {
  let inMemoryState = {
    mode: "quick",
    quickUrl: "",
    publicUrl: "",
    lastError: "",
    adopted: false,
  };

  let lastDiscoveryTime = 0;
  let cachedAdoptedPid = 0;
  const DISCOVERY_CACHE_TTL_MS = 3000;

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

  function adoptExternalIfPresent() {
    const managedPid = readPid();
    if (managedPid && isProcessRunning(managedPid)) {
      return { pid: managedPid, adopted: inMemoryState.adopted || false };
    }
    if (managedPid) clearPid();

    const now = Date.now();
    if (cachedAdoptedPid && now - lastDiscoveryTime < DISCOVERY_CACHE_TTL_MS) {
      if (isProcessRunning(cachedAdoptedPid)) {
        return { pid: cachedAdoptedPid, adopted: true };
      }
    }

    lastDiscoveryTime = now;
    const externalPid = typeof discoverProcess === "function" ? discoverProcess() : 0;
    if (externalPid && isProcessRunning(externalPid)) {
      cachedAdoptedPid = externalPid;
      inMemoryState.adopted = true;
      writePid(externalPid);
      scanLogsForQuickUrl();
      return { pid: externalPid, adopted: true };
    }
    cachedAdoptedPid = 0;
    return null;
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
    const active = adoptExternalIfPresent();
    if (active?.pid && isProcessRunning(active.pid)) {
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
      childPid = proc?.pid || 0;
    } else if (spawnRunner && typeof spawnRunner.spawn === "function") {
      const proc = spawnRunner.spawn(binPath, args);
      childPid = proc?.pid || 0;
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
    cachedAdoptedPid = 0;
    inMemoryState.adopted = false;
    inMemoryState.quickUrl = "";
    return getStatus();
  }

  function getStatus() {
    adoptExternalIfPresent();
    const pid = readPid();
    const isRunning = pid > 0 && isProcessRunning(pid);
    if (!isRunning && pid > 0) {
      clearPid();
      inMemoryState.adopted = false;
    }

    if (isRunning && inMemoryState.mode === "quick" && !inMemoryState.quickUrl) {
      scanLogsForQuickUrl();
    }

    const recentLogs = logPath ? tailLog(logPath, 50) : [];
    return {
      status: isRunning ? PROVIDER_STATUS.running : PROVIDER_STATUS.stopped,
      pid: isRunning ? pid : 0,
      mode: inMemoryState.adopted ? "external-detected" : inMemoryState.mode,
      adopted: Boolean(inMemoryState.adopted),
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
