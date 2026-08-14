import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PROVIDER_STATUS } from "../domain/status.mjs";
import { NatTraversalError } from "../domain/errors.mjs";

const LOG_TAIL_LIMIT = 80;

export function createFrpcSupervisor({
  binPath = "frpc",
  configPath,
  pidPath,
  logPath,
  logger = console,
} = {}) {
  let child = null;
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

  async function start() {
    if (child && !child.killed) {
      throw new NatTraversalError("already_running", "frpc is already running");
    }
    const existingPid = readPidFile();
    if (isPidAlive(existingPid)) {
      status = PROVIDER_STATUS.running;
      throw new NatTraversalError(
        "already_running",
        `frpc already running with pid ${existingPid}`,
      );
    }

    if (!fs.existsSync(configPath)) {
      throw new NatTraversalError(
        "invalid_config",
        `frpc config not found: ${configPath}`,
      );
    }

    status = PROVIDER_STATUS.starting;
    lastError = "";
    startedAt = new Date().toISOString();

    await new Promise((resolve, reject) => {
      let settled = false;
      const finishOk = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishErr = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      try {
        child = spawn(binPath, ["-c", configPath], {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        });
      } catch (error) {
        status = PROVIDER_STATUS.error;
        lastError = error.message || String(error);
        finishErr(
          new NatTraversalError("process_error", `failed to spawn frpc: ${lastError}`),
        );
        return;
      }

      writePid(child.pid);
      status = PROVIDER_STATUS.running;
      pushLog(`[supervisor] started frpc pid=${child.pid}`);

      child.stdout.on("data", (buf) => {
        String(buf)
          .split(/\r?\n/)
          .forEach((line) => pushLog(line));
      });
      child.stderr.on("data", (buf) => {
        String(buf)
          .split(/\r?\n/)
          .forEach((line) => pushLog(line));
      });
      child.on("error", (error) => {
        status = PROVIDER_STATUS.error;
        lastError = error.message || String(error);
        clearPid();
        child = null;
        finishErr(
          new NatTraversalError("process_error", `frpc process error: ${lastError}`),
        );
      });
      child.on("exit", (code, signal) => {
        pushLog(`[supervisor] frpc exited code=${code} signal=${signal || ""}`);
        if (status !== PROVIDER_STATUS.stopped) {
          status = code === 0 ? PROVIDER_STATUS.stopped : PROVIDER_STATUS.error;
          if (code !== 0) {
            lastError = `frpc exited with code ${code}`;
          }
        }
        clearPid();
        child = null;
      });

      // Give spawn a brief moment to surface immediate failures.
      setTimeout(() => {
        if (status === PROVIDER_STATUS.error && lastError) {
          finishErr(new NatTraversalError("process_error", lastError));
          return;
        }
        finishOk();
      }, 150);
    });

    return getStatus();
  }

  async function stop() {
    const pid = child?.pid || readPidFile();
    status = PROVIDER_STATUS.stopped;
    if (child && !child.killed) {
      child.kill("SIGTERM");
      child = null;
    } else if (pid && isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        lastError = error.message || String(error);
        throw new NatTraversalError(
          "process_error",
          `failed to stop frpc pid ${pid}: ${lastError}`,
        );
      }
    }
    clearPid();
    pushLog("[supervisor] stop requested");
    return getStatus();
  }

  function getStatus() {
    const pid = child?.pid || readPidFile();
    const alive = Boolean(child && !child.killed) || isPidAlive(pid);
    if (alive && status !== PROVIDER_STATUS.starting) {
      status = PROVIDER_STATUS.running;
    } else if (!alive && status === PROVIDER_STATUS.running) {
      status = PROVIDER_STATUS.stopped;
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
    };
  }

  return {
    start,
    stop,
    getStatus,
  };
}
