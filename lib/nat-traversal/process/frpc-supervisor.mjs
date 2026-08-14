import { spawn, spawnSync } from "node:child_process";
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

/**
 * Find already-running frpc processes that match our bin/config.
 * Used so gateway status can detect externally started frpc.
 */
export function discoverRunningFrpcProcesses({
  binPath = "",
  configPath = "",
  platform = process.platform,
  listProcessCommandLines = defaultListProcessCommandLines,
} = {}) {
  const wantedConfig = normalizePathForMatch(configPath);
  const wantedBin = normalizePathForMatch(binPath);
  const rows = listProcessCommandLines({ platform }) || [];
  const matches = [];

  for (const row of rows) {
    const pid = Number(row.pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pid === process.pid) continue;
    const cmd = String(row.command || "");
    if (!looksLikeFrpcCommand(cmd)) continue;

    const cmdNorm = normalizePathForMatch(cmd);
    const configMatched = wantedConfig
      ? cmdNorm.includes(wantedConfig)
      : true;
    // If a specific config is configured, require it. Otherwise any frpc is candidate.
    if (wantedConfig && !configMatched) continue;

    matches.push({
      pid,
      command: cmd.trim(),
      managed: false,
      configPath: extractConfigPathFromCommand(cmd) || configPath || "",
    });
  }

  // Prefer exact config match order, then lowest pid
  matches.sort((a, b) => a.pid - b.pid);
  return matches;
}

function defaultListProcessCommandLines({ platform = process.platform } = {}) {
  if (platform === "win32") {
    // CommandLine is available via WMIC (still present on many Windows hosts).
    const res = spawnSync(
      "wmic",
      ["process", "get", "ProcessId,CommandLine", "/FORMAT:CSV"],
      { encoding: "utf8", windowsHide: true, timeout: 5000 },
    );
    if (res.error || res.status !== 0) {
      // Fallback: PowerShell
      const ps = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 7000 },
      );
      if (ps.error || ps.status !== 0) return [];
      return parseCsvPidCommand(ps.stdout || "");
    }
    return parseCsvPidCommand(res.stdout || "");
  }

  // macOS / Linux
  const res = spawnSync("ps", ["-ax", "-o", "pid=", "-o", "command="], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (res.error || res.status !== 0) return [];
  const out = [];
  for (const line of String(res.stdout || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    out.push({ pid: Number(m[1]), command: m[2] });
  }
  return out;
}

function parseCsvPidCommand(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  // header may be Node,CommandLine,ProcessId OR "ProcessId","CommandLine"
  const header = lines[0].toLowerCase();
  const out = [];
  for (const line of lines.slice(1)) {
    // crude CSV split that keeps quoted commas
    const cols = splitCsvLine(line);
    if (!cols.length) continue;
    let pid = 0;
    let command = "";
    if (header.includes("processid") && header.includes("commandline")) {
      // find indexes from header
      const heads = splitCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, "").toLowerCase());
      const pidIdx = heads.findIndex((h) => h === "processid" || h.endsWith("processid"));
      const cmdIdx = heads.findIndex((h) => h === "commandline" || h.endsWith("commandline"));
      pid = Number(String(cols[pidIdx] || "").replace(/^"|"$/g, ""));
      command = String(cols[cmdIdx] || "").replace(/^"|"$/g, "");
    } else if (cols.length >= 2) {
      // wmic CSV often: Node,CommandLine,ProcessId
      pid = Number(String(cols[cols.length - 1] || "").replace(/^"|"$/g, ""));
      command = String(cols[cols.length - 2] || "").replace(/^"|"$/g, "");
    }
    if (pid > 0) out.push({ pid, command });
  }
  return out;
}

function splitCsvLine(line) {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cols.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

function looksLikeFrpcCommand(command) {
  const cmd = String(command || "").trim();
  if (!cmd) return false;
  // Match an frpc binary invocation, not arbitrary paths that merely contain "frpc.toml".
  // Examples:
  //   frpc -c /path/frpc.toml
  //   /Users/pa/frp/frpc -c /Users/pa/frp/frpc.toml
  //   C:\frp\frpc.exe -c C:\frp\frpc.toml
  return /(?:^|[\s"'])(?:(?:[A-Za-z]:)?(?:[\\/][^\s"']*)?)?frpc(?:\.exe)?(?:\s|"|'|$)/i.test(cmd);
}

function hasConfigFlag(command) {
  return /(^|\s)-c(\s|=)/.test(String(command || ""));
}

function extractConfigPathFromCommand(command) {
  const cmd = String(command || "");
  let m = cmd.match(/(?:^|\s)-c\s*=\s*("([^"]+)"|'([^']+)'|([^\s]+))/);
  if (!m) m = cmd.match(/(?:^|\s)-c\s+("([^"]+)"|'([^']+)'|([^\s]+))/);
  if (!m) return "";
  return m[2] || m[3] || m[4] || "";
}

function normalizePathForMatch(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

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
    const adopted = adoptExternalIfPresent();
    if (adopted) {
      status = PROVIDER_STATUS.running;
      // Already running externally (or previously managed). Treat as success, not failure.
      pushLog(`[supervisor] detected existing frpc pid=${adopted.pid} (adopted=${adopted.adopted})`);
      return getStatus();
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
    // Prefer pid file; if missing, still try to stop a matching external process.
    let pid = readPidFile();
    if (!pid || !isPidAlive(pid)) {
      const external = discoverRunningFrpcProcesses({
        binPath,
        configPath,
        platform,
      });
      pid = external[0]?.pid || 0;
    }
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

  function adoptExternalIfPresent() {
    const managedPid = readPidFile();
    if (isPidAlive(managedPid)) {
      return { pid: managedPid, adopted: false, source: "pid-file" };
    }
    // Stale pid file
    if (managedPid) clearPid();

    const external = discoverRunningFrpcProcesses({
      binPath,
      configPath,
      platform,
    });
    const hit = external[0];
    if (!hit?.pid) return null;
    // Adopt so subsequent stop/status stay consistent with gateway controls.
    writePid(hit.pid);
    if (!startedAt) startedAt = new Date().toISOString();
    return { pid: hit.pid, adopted: true, source: "external-process", command: hit.command };
  }

  function getStatus() {
    const adopted = adoptExternalIfPresent();
    const pid = adopted?.pid || 0;
    const alive = Boolean(pid && isPidAlive(pid));
    if (alive) status = PROVIDER_STATUS.running;
    else if (status === PROVIDER_STATUS.running || status === PROVIDER_STATUS.starting) {
      status = PROVIDER_STATUS.stopped;
    }

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

    // Also surface external process log if our managed log is empty and config dir has frpc.log
    if (recentLines.length === 0 && configPath) {
      try {
        const siblingLog = path.join(path.dirname(configPath), "frpc.log");
        if (fs.existsSync(siblingLog)) {
          const content = fs.readFileSync(siblingLog, "utf8");
          const lines = content.split(/\r?\n/).filter(Boolean).slice(-LOG_TAIL_LIMIT);
          recentLines.push(...lines);
        }
      } catch {
        // ignore
      }
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
      mode: adopted?.source === "external-process" ? "external-detected" : "background-detached",
      managed: adopted ? adopted.source === "pid-file" || adopted.adopted : false,
      adopted: Boolean(adopted?.adopted),
      platform,
    };
  }

  return {
    start,
    stop,
    getStatus,
  };
}
