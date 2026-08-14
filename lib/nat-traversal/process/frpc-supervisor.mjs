import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PROVIDER_STATUS } from "../domain/status.mjs";
import { NatTraversalError } from "../domain/errors.mjs";

const LOG_TAIL_LIMIT = 120;

/**
 * Cross-platform background supervisor for frpc.
 * - Starts frpc detached in background (macOS/Linux/Windows)
 * - Gateway can start/stop/status via pid file
 * - Logs append to a managed log file
 */
export function createFrpcSupervisor({
  binPath = process.platform === "win32" ? "frpc.exe" : "frpc",
  configPath,
  pidPath,
  logPath,
  logger = console,
  platform = process.platform,
} = {}) {
  let status = PROVIDER_STATUS.stopped;
  let lastError = "";
  let startedAt = "";
  const recentLines = [];

  function pushLog(line) {
    const text = String(line || "").trimEnd();
    if (!text) return;
    recentLines.push(text);
    while (recentLines.length > LOG_TAIL_LIMIT) recentLines.shift();
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${text}\n`);
    } catch {
      // ignore log write failures
    }
  }

  function readPidFile() {
    try {
      const raw = fs.readFileSync(pidPath, "utf8").trim();
      const pid = Number(raw);
      return Number.isInteger(pid) && pid > 0 ? pid : 0;
    } catch {
      return 0;
    }
  }

  function writePid(pid) {
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, `${pid}\n`);
  }

  function clearPid() {
    try {
      fs.unlinkSync(pidPath);
    } catch {
      // ignore
    }
  }

  function isPidAlive(pid) {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function openLogFd() {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    return fs.openSync(logPath, "a");
  }

  function killPid(pid) {
    if (!pid) return;
    if (platform === "win32") {
      // Kill process tree on Windows. SIGTERM is not reliable there.
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        detached: true,
      }).unref();
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
    // fallback hard kill shortly after if still alive
    setTimeout(() => {
      if (isPidAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // ignore
        }
      }
    }, 800);
  }

  async function start() {
    const existingPid = readPidFile();
    if (isPidAlive(existingPid)) {
      status = PROVIDER_STATUS.running;
      throw new NatTraversalError(
        "already_running",
        `frpc already running with pid ${existingPid}`,
      );
    }

    if (!configPath || !fs.existsSync(configPath)) {
      throw new NatTraversalError(
        "invalid_config",
        `frpc config not found: ${configPath}`,
      );
    }

    status = PROVIDER_STATUS.starting;
    lastError = "";
    startedAt = new Date().toISOString();

    const logFd = openLogFd();
    pushLog(`[supervisor] starting background frpc bin=${binPath} config=${configPath}`);

    let child;
    try {
      child = spawn(binPath, ["-c", configPath], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: process.env,
        windowsHide: true,
      });
    } catch (error) {
      try {
        fs.closeSync(logFd);
      } catch {
        // ignore
      }
      status = PROVIDER_STATUS.error;
      lastError = error.message || String(error);
      throw new NatTraversalError(
        "process_error",
        `failed to spawn frpc: ${lastError}`,
      );
    }

    // Parent no longer owns stdio handles / lifetime.
    try {
      fs.closeSync(logFd);
    } catch {
      // ignore
    }

    child.unref();

    // Capture immediate spawn failures (bad binary path etc.)
    await new Promise((resolve, reject) => {
      let settled = false;
      const ok = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const bad = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      child.once("error", (error) => {
        status = PROVIDER_STATUS.error;
        lastError = error.message || String(error);
        clearPid();
        bad(
          new NatTraversalError(
            "process_error",
            `frpc process error: ${lastError}`,
          ),
        );
      });

      // If process exits immediately, treat as failure.
      child.once("exit", (code, signal) => {
        if (settled) return;
        status = PROVIDER_STATUS.error;
        lastError = `frpc exited early code=${code} signal=${signal || ""}`;
        clearPid();
        bad(new NatTraversalError("process_error", lastError));
      });

      setTimeout(() => {
        if (!isPidAlive(child.pid)) {
          // wait a tick for exit handler
          setTimeout(() => {
            if (!settled) {
              status = PROVIDER_STATUS.error;
              lastError = "frpc failed to stay running";
              clearPid();
              bad(new NatTraversalError("process_error", lastError));
            }
          }, 50);
          return;
        }
        writePid(child.pid);
        status = PROVIDER_STATUS.running;
        pushLog(`[supervisor] started background frpc pid=${child.pid}`);
        ok();
      }, 200);
    });

    return getStatus();
  }

  async function stop() {
    const pid = readPidFile();
    status = PROVIDER_STATUS.stopped;
    if (pid && isPidAlive(pid)) {
      pushLog(`[supervisor] stopping frpc pid=${pid}`);
      killPid(pid);
    } else {
      pushLog("[supervisor] stop requested (no running pid)");
    }
    clearPid();
    return getStatus();
  }

  function getStatus() {
    const pid = readPidFile();
    const alive = isPidAlive(pid);
    if (alive) status = PROVIDER_STATUS.running;
    else if (status === PROVIDER_STATUS.running) status = PROVIDER_STATUS.stopped;

    // Best-effort tail from log file for UI.
    try {
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, "utf8");
        const lines = content.split(/\r?\n/).filter(Boolean);
        const tail = lines.slice(-LOG_TAIL_LIMIT);
        // merge without unbounded growth
        recentLines.length = 0;
        recentLines.push(...tail);
      }
    } catch {
      // ignore
    }

    return {
      status,
      pid: alive ? pid : 0,
      startedAt,
      lastError,
      recentLogs: [...recentLines],
      binPath,
      configPath,
      logPath,
      mode: "background-detached",
      platform,
    };
  }

  return {
    start,
    stop,
    getStatus,
  };
}
