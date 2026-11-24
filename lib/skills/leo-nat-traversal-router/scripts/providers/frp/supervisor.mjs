import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { getProviderPaths, getPlatformInfo } from "../../core/system.mjs";
import { probeFrpc } from "./install.mjs";
import { getConfigPaths, loadConfig, saveConfig } from "./config.mjs";

export function getSupervisorPaths(overrideDir = null) {
  const { runDir, logsDir } = getProviderPaths("frp", overrideDir);
  return {
    pidPath: path.join(runDir, "frpc.pid"),
    logPath: path.join(logsDir, "frpc.log"),
  };
}

export function isProcessAlive(pid) {
  if (!pid || isNaN(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Discovers running frpc processes across the operating system.
 */
export function discoverSystemFrpc() {
  const { isWindows } = getPlatformInfo();
  const results = [];

  try {
    if (isWindows) {
      const output = execSync("wmic process where \"name like 'frpc%'\" get ProcessId,CommandLine /format:csv", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const lines = output.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const parts = line.split(",");
        if (parts.length >= 3 && !parts[1].includes("wmic")) {
          const pid = Number(parts[2]?.trim());
          const cmd = parts[1]?.trim();
          if (pid && !isNaN(pid) && pid !== process.pid) {
            results.push({ pid, command: cmd });
          }
        }
      }
    } else {
      const output = execSync("ps -ax -o pid=,command=", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const lines = output.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(\d+)\s+(.+)$/);
        if (match) {
          const pid = Number(match[1]);
          const command = match[2];
          if (pid !== process.pid && /(^|\/|\\)frpc(\.exe)?(\s|$)/.test(command)) {
            results.push({ pid, command });
          }
        }
      }
    }
  } catch {
    // Process discovery failed or unsupported, fallback
  }

  return results;
}

export function statusFrpc({ dataDir = null } = {}) {
  const { pidPath, logPath } = getSupervisorPaths(dataDir);
  const { tomlPath } = getConfigPaths(dataDir);
  const probe = probeFrpc();

  let pid = null;
  let status = "stopped";
  let mode = "managed";

  if (fs.existsSync(pidPath)) {
    try {
      const recorded = Number(fs.readFileSync(pidPath, "utf-8").trim());
      if (isProcessAlive(recorded)) {
        pid = recorded;
        status = "running";
      } else {
        // Stale pid file
        try { fs.unlinkSync(pidPath); } catch {}
      }
    } catch {}
  }

  // If not running via PID file, check system for external frpc processes
  if (status === "stopped") {
    const systemFrpc = discoverSystemFrpc();
    if (systemFrpc.length > 0) {
      // Found running frpc, adopt the first one
      const target = systemFrpc[0];
      pid = target.pid;
      status = "running";
      mode = "adopted";
      // Record adopted PID
      try { fs.writeFileSync(pidPath, String(pid), "utf-8"); } catch {}
    }
  }

  // Get last 3 lines from log
  let recentLogs = [];
  if (fs.existsSync(logPath)) {
    try {
      const all = fs.readFileSync(logPath, "utf-8").split(/\r?\n/).filter(Boolean);
      recentLogs = all.slice(-3);
    } catch {}
  }

  return {
    status,
    pid,
    mode: status === "running" ? mode : null,
    binInstalled: probe.installed,
    binPath: probe.binPath,
    binVersion: probe.version,
    configPath: tomlPath,
    recentLogs,
  };
}

export function startFrpc({ force = false, dataDir = null } = {}) {
  const current = statusFrpc({ dataDir });
  if (current.status === "running" && !force) {
    return {
      success: true,
      alreadyRunning: true,
      pid: current.pid,
      mode: current.mode,
      message: `frpc is already running (PID: ${current.pid})`,
    };
  }

  const probe = probeFrpc();
  if (!probe.installed) {
    throw new Error("frpc binary is not installed. Please run `frp install` first.");
  }

  const { tomlPath } = getConfigPaths(dataDir);
  if (!fs.existsSync(tomlPath)) {
    // Attempt auto-render if config exists
    saveConfig(loadConfig(dataDir).config, null, dataDir);
  }

  const { pidPath, logPath } = getSupervisorPaths(dataDir);

  // Ensure log directory exists & open stream
  const logFd = fs.openSync(logPath, "a");

  // Spawn detached process
  const child = spawn(probe.binPath, ["-c", tomlPath], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();

  const pid = child.pid;
  fs.writeFileSync(pidPath, String(pid), "utf-8");

  // Short delay to let process initialize or fail fast
  try {
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      // spin briefly
    }
  } catch {}

  if (!isProcessAlive(pid)) {
    let errHint = "Process terminated immediately.";
    if (fs.existsSync(logPath)) {
      const tail = fs.readFileSync(logPath, "utf-8").split(/\r?\n/).filter(Boolean).slice(-5).join(" ");
      if (tail) errHint = tail;
    }
    try { fs.unlinkSync(pidPath); } catch {}
    throw new Error(`Failed to start frpc: ${errHint}`);
  }

  return {
    success: true,
    pid,
    binPath: probe.binPath,
    configPath: tomlPath,
    logPath,
    message: `frpc successfully started in background (PID: ${pid})`,
  };
}

export function stopFrpc({ dataDir = null } = {}) {
  const current = statusFrpc({ dataDir });
  const { pidPath } = getSupervisorPaths(dataDir);

  if (current.status === "stopped" || !current.pid) {
    if (fs.existsSync(pidPath)) {
      try { fs.unlinkSync(pidPath); } catch {}
    }
    return {
      success: true,
      alreadyStopped: true,
      message: "frpc is not currently running.",
    };
  }

  const targetPid = current.pid;
  try {
    process.kill(targetPid, "SIGTERM");
  } catch (err) {
    if (err.code !== "ESRCH") {
      throw err;
    }
  }

  // Wait up to 3s for graceful termination
  let alive = isProcessAlive(targetPid);
  const startWait = Date.now();
  while (alive && Date.now() - startWait < 3000) {
    const t = Date.now() + 100;
    while (Date.now() < t) {}
    alive = isProcessAlive(targetPid);
  }

  // Force kill if still alive
  if (alive) {
    try {
      process.kill(targetPid, "SIGKILL");
    } catch {}
  }

  if (fs.existsSync(pidPath)) {
    try { fs.unlinkSync(pidPath); } catch {}
  }

  return {
    success: true,
    stoppedPid: targetPid,
    message: `frpc (PID: ${targetPid}) has been stopped.`,
  };
}

export function restartFrpc({ dataDir = null } = {}) {
  stopFrpc({ dataDir });
  return startFrpc({ force: true, dataDir });
}

export function logsFrpc(lines = 30, { dataDir = null } = {}) {
  const { logPath } = getSupervisorPaths(dataDir);
  if (!fs.existsSync(logPath)) {
    return {
      exists: false,
      logPath,
      lines: [],
    };
  }

  const all = fs.readFileSync(logPath, "utf-8").split(/\r?\n/);
  const selected = all.slice(-Math.abs(Number(lines) || 30));
  return {
    exists: true,
    logPath,
    lines: selected,
  };
}
