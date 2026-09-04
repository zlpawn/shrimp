import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { CommandAppsError } from "../domain/errors.mjs";
import { sanitizeLangBotEnv } from "./langbot-daemon.mjs";

const execFileP = promisify(execFile);
const UV_CANDIDATES = ["uv", "/opt/homebrew/bin/uv", "/usr/local/bin/uv"];

export function findUv({
  commandExists = (value) => (value === "uv" ? true : fs.existsSync(value)),
} = {}) {
  return UV_CANDIDATES.find((candidate) => commandExists(candidate)) || null;
}

export async function langbotVersion({
  executablePath,
  execFile = execFileP,
  timeoutMs = 8000,
} = {}) {
  if (!executablePath) return null;
  try {
    const { stdout } = await execFile(executablePath, ["--version"], {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      env: sanitizeLangBotEnv(),
    });
    const match = String(stdout || "").match(/([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)/);
    return match?.[1] || String(stdout || "").trim() || null;
  } catch {
    return null;
  }
}

function parseVersion(stdout = "") {
  const match = String(stdout || "").match(/([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match?.[1] || null;
}

async function runUv(uvPath, args, {
  execFile,
  timeoutMs = 600000,
} = {}) {
  const { stdout, stderr } = await execFile(uvPath, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    env: sanitizeLangBotEnv(),
  });
  return { stdout: String(stdout || ""), stderr: String(stderr || "") };
}

export async function installLangBotTool({
  uvPath = findUv(),
  execFile = execFileP,
  discoverExecutable = null,
  timeoutMs,
} = {}) {
  if (!uvPath) throw new CommandAppsError("executable_not_found", "uv was not found");
  const output = await runUv(uvPath, ["tool", "install", "langbot"], { execFile, timeoutMs });
  const discovered = discoverExecutable ? await discoverExecutable() : null;
  if (!discovered) throw new CommandAppsError("executable_not_found", "LangBot executable was not found after installation");
  return {
    executablePath: discovered,
    version: parseVersion(output.stdout),
  };
}

export async function upgradeLangBotTool({
  uvPath = findUv(),
  execFile = execFileP,
  stop = async () => {},
  discoverExecutable = null,
  timeoutMs,
} = {}) {
  if (!uvPath) throw new CommandAppsError("executable_not_found", "uv was not found");
  await stop();
  try {
    await runUv(uvPath, ["tool", "upgrade", "langbot"], { execFile, timeoutMs });
  } catch (error) {
    // uv may leave or replace the shim while reporting a network failure.
    // Rediscover it; ~/.langbot is never touched by package operations.
    const recovered = discoverExecutable ? await discoverExecutable() : null;
    if (!recovered) throw new CommandAppsError("process_error", `LangBot update failed: ${error.message}`);
    return { executablePath: recovered, version: null, recovered: true };
  }
  const discovered = discoverExecutable ? await discoverExecutable() : null;
  if (!discovered) throw new CommandAppsError("executable_not_found", "LangBot executable was not found after update");
  return {
    executablePath: discovered,
    version: await langbotVersion({ executablePath: discovered, execFile }),
    recovered: false,
  };
}
