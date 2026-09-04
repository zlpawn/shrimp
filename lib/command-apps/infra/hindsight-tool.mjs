import { execFile as nodeExecFile } from "node:child_process";
import { CommandAppsError } from "../domain/errors.mjs";

const INSTALL_COMMAND = "uv tool install hindsight-embed";
const UPDATE_COMMAND = "uv tool upgrade hindsight-embed";

function runUv(args, {
  execFile = nodeExecFile,
  timeoutMs = 5 * 60 * 1000,
} = {}) {
  return new Promise((resolve, reject) => {
    execFile("uv", args, {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (error, stdout = "", stderr = "") => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function commandFailure(action, error) {
  const details = String(error?.stderr || error?.stdout || error?.message || "")
    .trim()
    .slice(0, 2000);
  return new CommandAppsError(
    "process_error",
    `Failed to ${action} hindsight-embed with uv${details ? `: ${details}` : ""}`,
  );
}

export function parseUvToolList(output = "") {
  const match = String(output || "").match(/^hindsight-embed\s+v([^\s]+)\s*$/m);
  return {
    installed: Boolean(match),
    version: match?.[1] || null,
  };
}

export async function inspectHindsightTool(options = {}) {
  try {
    const result = await runUv(["tool", "list"], { ...options, timeoutMs: options.timeoutMs || 15000 });
    const parsed = parseUvToolList(result.stdout);
    return {
      uvAvailable: true,
      installed: parsed.installed,
      managedByUv: parsed.installed,
      version: parsed.version,
      executablePath: null,
      installCommand: INSTALL_COMMAND,
      updateCommand: UPDATE_COMMAND,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        uvAvailable: false,
        installed: false,
        managedByUv: false,
        version: null,
        executablePath: null,
        installCommand: INSTALL_COMMAND,
        updateCommand: UPDATE_COMMAND,
      };
    }
    throw commandFailure("inspect", error);
  }
}

export async function installHindsightTool(options = {}) {
  try {
    const result = await runUv(["tool", "install", "hindsight-embed"], options);
    return { ok: true, command: INSTALL_COMMAND, ...result };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new CommandAppsError("executable_not_found", "uv is required to install hindsight-embed");
    }
    throw commandFailure("install", error);
  }
}

export async function updateHindsightTool(options = {}) {
  try {
    const result = await runUv(["tool", "upgrade", "hindsight-embed"], options);
    return { ok: true, command: UPDATE_COMMAND, ...result };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new CommandAppsError("executable_not_found", "uv is required to update hindsight-embed");
    }
    throw commandFailure("update", error);
  }
}
