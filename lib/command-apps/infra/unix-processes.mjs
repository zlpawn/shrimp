import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CommandAppsError } from "../domain/errors.mjs";

const execFileP = promisify(execFile);

export async function listUnixProcesses({
  execFile = execFileP,
} = {}) {
  try {
    const { stdout } = await execFile("ps", ["-axo", "pid=,ppid=,command="], {
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return String(stdout || "")
      .split("\n")
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (!match) return null;
        const pid = Number(match[1]);
        const parentPid = Number(match[2]);
        const commandLine = match[3];
        const binaryName = commandLine.split(/\s+/)[0] || "";
        const name = path.basename(binaryName);
        return {
          pid,
          parentPid,
          name,
          commandLine,
          executablePath: binaryName.startsWith("/") ? binaryName : "",
        };
      })
      .filter((row) => row && row.pid > 0 && row.pid !== process.pid);
  } catch {
    return [];
  }
}

export async function terminateUnixProcess(pid, {
  killProcessGroup = (value, signal) => process.kill(-value, signal),
  killProcess = (value, signal) => process.kill(value, signal),
} = {}) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CommandAppsError("invalid_request", "A valid process id is required");
  }
  try {
    killProcessGroup(value, "SIGTERM");
  } catch (error) {
    if (error?.code === "ESRCH") return;
    try {
      killProcess(value, "SIGTERM");
    } catch (fallbackError) {
      if (fallbackError?.code === "ESRCH") return;
      throw new CommandAppsError("process_error", `Failed to stop process ${value}`, {
        reason: fallbackError?.message || error?.message,
      });
    }
  }
}

export const terminateUnixProcessGroup = terminateUnixProcess;
