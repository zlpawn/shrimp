import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CommandAppsError } from "../domain/errors.mjs";
import { createCommandAppsProcessStore } from "./process-store.mjs";

export { createCommandAppsProcessStore };

const execFileP = promisify(execFile);

function normalizeExecutable(value, platform) {
  if (platform === "win32") {
    return path.win32.normalize(String(value || "")).toLowerCase();
  }
  return path.normalize(String(value || ""));
}

export function findProcessesByExecutable(
  processes = [],
  executablePath = "",
  { platform = process.platform } = {},
) {
  const pathLib = platform === "win32" ? path.win32 : path.posix;
  const wanted = normalizeExecutable(executablePath, platform);
  const expectedName = pathLib.basename(String(executablePath || "")).toLowerCase();
  return (processes || []).filter((row) => {
    const current = String(row?.executablePath || "");
    if (current) return normalizeExecutable(current, platform) === wanted;
    const currentName = String(row?.name || "").toLowerCase();
    return Boolean(currentName) && currentName === expectedName;
  });
}

function splitCsvLine(line) {
  const cols = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cols.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cols.push(current);
  return cols;
}

function parseProcessCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((item) => item.replace(/^"|"$/g, "").toLowerCase());
  const pidIndex = header.indexOf("processid");
  const pathIndex = header.indexOf("executablepath");
  const nameIndex = header.indexOf("name");
  const creationIndex = header.indexOf("creationdate");
  if (pidIndex < 0 || pathIndex < 0) return [];

  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line).map((item) => item.replace(/^"|"$/g, ""));
    const pid = Number(cols[pidIndex]);
    const executablePath = String(cols[pathIndex] || "").trim();
    const name = String(cols[nameIndex] || "").trim();
    if (!Number.isInteger(pid) || pid <= 0 || (!path.win32.isAbsolute(executablePath) && !path.isAbsolute(executablePath) && !name)) continue;
    const createdAt = creationIndex >= 0 ? new Date(String(cols[creationIndex] || "").trim()) : null;
    rows.push({ pid, executablePath, name, createdAt: Number.isNaN(createdAt?.getTime?.()) ? null : createdAt.toISOString() });
  }
  return rows;
}

export async function listWindowsProcesses({ execFile = execFileP } = {}) {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue';",
    "Get-CimInstance Win32_Process",
    "| Select-Object ProcessId,Name,ExecutablePath,CreationDate",
    "| ConvertTo-Csv -NoTypeInformation",
  ].join(" ");
  const { stdout } = await execFile("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000,
    maxBuffer: 1024 * 1024,
  });
  return parseProcessCsv(stdout);
}

export async function terminateProcessTree(pid, { execFile = execFileP } = {}) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CommandAppsError("invalid_request", "A valid process id is required");
  }
  const commandOptions = {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000,
  };
  const runTerminator = () => new Promise((resolve, reject) => {
    const maybePromise = execFile(
      "taskkill",
      ["/PID", String(value), "/T", "/F"],
      commandOptions,
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }));
        else resolve({ stdout, stderr });
      },
    );
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise.then(resolve, reject);
    }
  });  try {
    await runTerminator();
  } catch (error) {
    const output = `${error.stderr || error.stdout || ""}`;
    if (/(not found|no such file|找不到)/i.test(output)) return;
    if (/(access is denied|拒绝访问)/i.test(output)) {
      throw new CommandAppsError(
        "process_error",
        "无法停止进程：当前网关权限不足。请先在应用内退出，或以管理员权限重启网关。",
        { pid: value },
      );
    }
    throw new CommandAppsError("process_error", `Failed to stop process ${value}`, {
      reason: error.message,
    });
  }
}



