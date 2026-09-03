import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

function executableName(platform) {
  return platform === "win32" ? "codexhost.cmd" : "codexhost";
}

function pathCandidates(platform, environment) {
  const candidates = [];
  for (const directory of String(environment.PATH || "").split(path.delimiter)) {
    if (directory) candidates.push(path.join(directory, executableName(platform)));
  }
  if (platform === "win32" && environment.APPDATA) {
    candidates.push(path.join(environment.APPDATA, "npm", "codexhost.cmd"));
  }
  return [...new Set(candidates)];
}

async function npmGlobalRoot({ platform, environment, execFileImpl }) {
  const command = platform === "win32" ? "npm.cmd" : "npm";
  try {
    const { stdout } = await execFileImpl(command, ["root", "-g"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
      env: environment,
    });
    return String(stdout || "").trim();
  } catch {
    return "";
  }
}

export async function discoverCodexhostExecutable({
  platform = process.platform,
  arch = process.arch,
  environment = process.env,
  fileExists = (value) => fs.existsSync(value),
  execFileImpl = execFileP,
} = {}) {
  if (!(["win32", "darwin", "linux"].includes(platform))) return null;
  const executablePath = pathCandidates(platform, environment).find(fileExists) || "";
  const globalRoot = await npmGlobalRoot({ platform, environment, execFileImpl });
  if (!globalRoot) return null;
  const entrypointPath = path.join(globalRoot, "@codexhost", "cli", "bin", "codexhost.js");
  const packageSuffix = `${platform}-${arch}`;
  const launcherPath = path.join(
    globalRoot,
    "@codexhost",
    `cli-${packageSuffix}`,
    "bin",
    `codexhost${platform === "win32" ? ".exe" : ""}`,
  );
  if (!fileExists(entrypointPath) || !fileExists(launcherPath)) return null;
  let version = "";
  try {
    const { stdout } = await execFileImpl(process.execPath, [entrypointPath, "--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
      env: environment,
    });
    version = String(stdout || "").trim();
  } catch {}
  return {
    executablePath: executablePath || entrypointPath,
    entrypointPath,
    launcherPath,
    version,
  };
}

export function defaultRuntimeDescriptorPath({ platform = process.platform, environment = process.env } = {}) {
  if (environment.CODEXHOST_RUNTIME_DESCRIPTOR_PATH) {
    return path.resolve(environment.CODEXHOST_RUNTIME_DESCRIPTOR_PATH);
  }
  if (platform === "win32") {
    return path.join(environment.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "codexhost", "desktop-runtime-v1.json");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "codexhost", "desktop-runtime-v1.json");
  }
  return path.join(environment.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() || 0}`, "codexhost", "desktop-runtime-v1.json");
}
