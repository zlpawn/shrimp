import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeHindsightProfileName } from "./hindsight-config.mjs";

const execFileP = promisify(execFile);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 && pid !== process.pid ? pid : null;
}

export function commandLineMatchesHindsightProfile(commandLine, profileName) {
  const normalized = normalizeHindsightProfileName(profileName || "default");
  const text = String(commandLine || "");
  if (!/hindsight-embed|hindsight-api|hindsight_api/i.test(text)) return false;
  if (/hindsight-api|hindsight_api/i.test(text)) return false;
  if (normalized === "default") {
    return /hindsight-embed/i.test(text) && !/\s-p\s+\S+/.test(text);
  }
  return new RegExp(`\\s-p\\s+${escapeRegExp(normalized)}(?:\\s|$)`).test(text);
}

function isHindsightApiProcess(process) {
  return /hindsight-api|hindsight_api/i.test(String(process?.commandLine || ""));
}

function parentChainContains(processes, pid, wantedPid, seen = new Set()) {
  if (pid === wantedPid) return true;
  if (seen.has(pid)) return false;
  seen.add(pid);
  const current = processes.find((row) => row.pid === pid);
  return current?.parentPid
    ? parentChainContains(processes, current.parentPid, wantedPid, seen)
    : false;
}

export function findSafelyTerminableHindsightPids({
  profileName = "default",
  processes = [],
  lockPid = null,
  executablePath = null,
  platform = process.platform,
} = {}) {
  const normalizedLockPid = parsePid(lockPid);
  if (!normalizedLockPid) return [];
  const rows = processes
    .map((row) => ({
      pid: parsePid(row?.pid),
      parentPid: parsePid(row?.parentPid),
      commandLine: String(row?.commandLine || row?.command || ""),
      executablePath: String(row?.executablePath || ""),
    }))
    .filter((row) => row.pid);
  const parents = rows.filter((row) => (
    commandLineMatchesHindsightProfile(row.commandLine, profileName)
  ));
  const safeTrees = [];
  for (const parent of parents) {
    const safe = [parent.pid];
    for (const child of rows) {
      if (
        isHindsightApiProcess(child)
        && child.parentPid
        && parentChainContains(rows, child.parentPid, parent.pid)
        && !safe.includes(child.pid)
      ) safe.push(child.pid);
    }
    safeTrees.push(safe);
  }
  const lockedTree = safeTrees.find((pids) => pids.includes(normalizedLockPid));
  return [...new Set(lockedTree || [])].filter((pid) => pid !== 1);
}

export async function listHindsightProcessDetails({
  platform = process.platform,
  execFile = execFileP,
} = {}) {
  try {
    if (platform === "win32") {
      const script = [
        "$ErrorActionPreference = 'SilentlyContinue';",
        "Get-CimInstance Win32_Process",
        "| Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath",
        "| ConvertTo-Csv -NoTypeInformation",
      ].join(" ");
      const { stdout } = await execFile("powershell", ["-NoProfile", "-Command", script], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 8000,
        maxBuffer: 1024 * 1024,
      });
      const lines = String(stdout || "").split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return [];
      const headers = lines[0].split(",").map((value) => value.replace(/^"|"$/g, "").toLowerCase());
      const indexes = {
        pid: headers.indexOf("processid"),
        parentPid: headers.indexOf("parentprocessid"),
        commandLine: headers.indexOf("commandline"),
        executablePath: headers.indexOf("executablepath"),
      };
      if (indexes.pid < 0 || indexes.parentPid < 0) return [];
      return lines.slice(1).map((line) => {
        const values = line.split(",");
        return {
          pid: parsePid(values[indexes.pid]?.replace(/^"|"$/g, "")),
          parentPid: parsePid(values[indexes.parentPid]?.replace(/^"|"$/g, "")),
          commandLine: values[indexes.commandLine]?.replace(/^"|"$/g, "") || "",
          executablePath: values[indexes.executablePath]?.replace(/^"|"$/g, "") || "",
        };
      }).filter((row) => row.pid);
    }
    const { stdout } = await execFile("ps", ["-ax", "-o", "pid=,ppid=,command="], {
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
    return String(stdout || "").split("\n").map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return match ? {
        pid: parsePid(match[1]),
        parentPid: parsePid(match[2]),
        commandLine: match[3],
        executablePath: "",
      } : null;
    }).filter((row) => row?.pid && /hindsight-embed|hindsight-api|hindsight_api/i.test(row.commandLine));
  } catch {
    return [];
  }
}
