#!/usr/bin/env node
import { exec, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { getHost, loadConfig, saveConfig, getBinDir, getEngineDataDir } from "../config.mjs";

const execAsync = promisify(exec);
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ASKPASS_SCRIPT = path.resolve(SCRIPT_DIR, "..", "askpass.mjs");

/**
 * Standard default ignore list to prevent network saturation and IDE lag
 */
export const DEFAULT_IGNORES = [
  ".git",
  ".svn",
  ".DS_Store",
  "Thumbs.db",
  "*.tmp",
  "*.log",
  ".idea",
  ".vscode",
  "node_modules",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "__pycache__",
  "*.pyc",
  ".venv",
  "venv",
  "target"
];

/**
 * Find mutagen binary, giving highest priority to configured binDir (~/.local/bin)
 */
function findMutagenBinary() {
  const binDir = getBinDir();
  const targetName = process.platform === "win32" ? "mutagen.exe" : "mutagen";
  const customPath = path.join(binDir, targetName);

  if (fs.existsSync(customPath)) {
    return customPath;
  }

  // Fallback to system PATH
  const checkCmd = process.platform === "win32" ? `where ${targetName}` : `which ${targetName}`;
  try {
    const res = execSync(checkCmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" });
    const firstLine = res.trim().split(/\r?\n/)[0];
    return firstLine || null;
  } catch {
    return null;
  }
}

/**
 * Build child process environment variables
 * Ensures MUTAGEN_DATA_DIRECTORY is always set to ~/.shrimp/skills/leo-workspace-router/data/mutagen
 * Ensures binDir is prepended to PATH
 * Injects SSH_ASKPASS if host requires password
 */
function buildExecEnv(host = null) {
  const binDir = getBinDir();
  const dataDir = getEngineDataDir("mutagen");
  const pathSep = process.platform === "win32" ? ";" : ":";

  const env = {
    ...process.env,
    PATH: `${binDir}${pathSep}${process.env.PATH || ""}`,
    MUTAGEN_DATA_DIRECTORY: dataDir
  };

  if (host && host.password) {
    env.SSH_ASKPASS_REQUIRE = "force";
    env.SSH_ASKPASS = `node "${ASKPASS_SCRIPT}"`;
    env.LEO_SSH_PASSWORD = host.password;
    env.LEO_SSH_TARGET_ALIAS = host.alias;
  }

  return env;
}

/**
 * Execute mutagen command with isolated environment
 */
async function runMutagenCmd(args, host = null) {
  const bin = findMutagenBinary() || "mutagen";
  const env = buildExecEnv(host);
  return await execAsync(`${bin} ${args}`, { env });
}

/**
 * Fetch latest release version tag from GitHub API
 */
export async function fetchLatestVersion() {
  try {
    const { stdout } = await execAsync('curl -s https://api.github.com/repos/mutagen-io/mutagen/releases/latest');
    const data = JSON.parse(stdout);
    if (data.tag_name) return data.tag_name;
  } catch {}
  return "v0.18.1";
}

/**
 * 1. Probe mutagen installation, isolated data directory, and daemon status
 */
export async function probe() {
  const binPath = findMutagenBinary();
  const dataDir = getEngineDataDir("mutagen");

  if (!binPath) {
    return {
      engine: "mutagen",
      installed: false,
      version: null,
      daemonRunning: false,
      path: null,
      dataDir
    };
  }

  let version = null;
  try {
    const { stdout } = await runMutagenCmd("version");
    version = stdout.trim();
  } catch {}

  let daemonRunning = false;
  try {
    const { stdout } = await runMutagenCmd("daemon status");
    daemonRunning = stdout.toLowerCase().includes("running");
  } catch {}

  return {
    engine: "mutagen",
    installed: true,
    version,
    daemonRunning,
    path: binPath,
    dataDir
  };
}

/**
 * Internal download helper to place binary into binDir
 */
async function downloadAndPlaceBinary(targetVersion) {
  const binDir = getBinDir();
  const platform = process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "amd64";

  if (platform === "darwin" || platform === "linux") {
    const osTag = platform === "darwin" ? "darwin" : "linux";
    const tarName = `mutagen_${osTag}_${arch}_${targetVersion}.tar.gz`;
    const dlUrl = `https://github.com/mutagen-io/mutagen/releases/download/${targetVersion}/${tarName}`;

    const dlCmd = `curl -fsSL "${dlUrl}" | tar -xz -C "${binDir}" mutagen`;
    await execAsync(dlCmd);
    if (platform !== "win32") {
      fs.chmodSync(path.join(binDir, "mutagen"), 0o755);
    }
  } else if (platform === "win32") {
    const zipName = `mutagen_windows_${arch}_${targetVersion}.zip`;
    const dlUrl = `https://github.com/mutagen-io/mutagen/releases/download/${targetVersion}/${zipName}`;
    const destZip = path.join(binDir, zipName);
    const powershellCmd = `Invoke-WebRequest -Uri "${dlUrl}" -OutFile "${destZip}"; Expand-Archive -Path "${destZip}" -DestinationPath "${binDir}" -Force; Remove-Item "${destZip}"`;
    await execAsync(`powershell -Command "${powershellCmd}"`);
  } else {
    throw new Error(`Unsupported OS platform: ${platform}`);
  }
}

/**
 * 2. Automated installation directly into configured binDir (~/.local/bin)
 */
export async function install() {
  const p = await probe();
  if (p.installed) {
    return { success: true, message: `Mutagen is already installed: ${p.version} at ${p.path}` };
  }

  const latestTag = await fetchLatestVersion();
  await downloadAndPlaceBinary(latestTag);

  const check = await probe();
  return {
    success: check.installed,
    message: check.installed
      ? `Installed Mutagen into ${check.path} (${check.version}) with isolated dataDir: ${check.dataDir}`
      : "Installation failed."
  };
}

/**
 * 3. Check for available updates
 */
export async function checkUpdate() {
  const p = await probe();
  if (!p.installed) {
    return { installed: false, hasUpdate: false, message: "Mutagen is not installed." };
  }

  const latestTag = await fetchLatestVersion();
  const cleanCurrent = (p.version || "").replace(/^v/, "").trim();
  const cleanLatest = latestTag.replace(/^v/, "").trim();

  const hasUpdate = cleanCurrent !== cleanLatest;
  return {
    installed: true,
    currentVersion: cleanCurrent,
    latestVersion: cleanLatest,
    hasUpdate
  };
}

/**
 * 4. Upgrade mutagen CLI to the latest version
 */
export async function upgrade({ force = false } = {}) {
  const p = await probe();
  if (!p.installed) {
    return await install();
  }

  const check = await checkUpdate();
  if (!check.hasUpdate && !force) {
    return {
      success: true,
      updated: false,
      message: `Mutagen is already at the latest version: ${check.currentVersion}`
    };
  }

  // 1. Gracefully stop isolated daemon before binary replacement
  try {
    await runMutagenCmd("daemon stop");
  } catch {}

  // 2. Download and replace binary with latest version
  const latestTag = `v${check.latestVersion}`;
  await downloadAndPlaceBinary(latestTag);

  // 3. Verify upgraded version
  const afterProbe = await probe();
  return {
    success: true,
    updated: true,
    previousVersion: check.currentVersion,
    currentVersion: afterProbe.version,
    path: afterProbe.path,
    message: `Successfully upgraded Mutagen: ${check.currentVersion} -> ${afterProbe.version}`
  };
}

/**
 * 5. Safe uninstallation
 */
export async function uninstall() {
  const p = await probe();
  if (!p.installed) {
    return { success: true, message: "Mutagen is not installed." };
  }

  // 1. Gracefully stop isolated daemon
  try {
    await runMutagenCmd("daemon stop");
  } catch {}

  // 2. Remove binary from binDir
  if (p.path && fs.existsSync(p.path)) {
    try {
      fs.unlinkSync(p.path);
    } catch {}
  }

  const check = await probe();
  return {
    success: !check.installed,
    message: "Mutagen binary has been removed and isolated daemon stopped."
  };
}

/**
 * 6. Create sync session
 */
export async function createSession({
  name,
  localPath,
  remotePath,
  hostAlias,
  syncMode = "two-way-resolved",
  ignores = []
}) {
  const p = await probe();
  if (!p.installed) {
    throw new Error("Mutagen CLI is not installed. Please install it first.");
  }

  const host = getHost(hostAlias);
  if (!host) {
    throw new Error(`Target host alias '${hostAlias}' not found in config.json.`);
  }

  const absLocalPath = path.resolve(localPath);
  if (!fs.existsSync(absLocalPath)) {
    fs.mkdirSync(absLocalPath, { recursive: true });
  }

  // Format: user@host:port:remotePath
  const remoteUrl = `${host.username}@${host.host}:${host.port}:${remotePath}`;

  // Merge default ignores with user-supplied ignores
  const mergedIgnores = Array.from(new Set([...DEFAULT_IGNORES, ...ignores]));
  const ignoreArgs = mergedIgnores.map((rule) => `--ignore="${rule}"`).join(" ");

  const sessionName = name || path.basename(absLocalPath);
  const cmdArgs = `sync create "${absLocalPath}" "${remoteUrl}" --name="${sessionName}" --sync-mode=${syncMode} ${ignoreArgs}`;

  const { stdout, stderr } = await runMutagenCmd(cmdArgs, host);

  // Record active session in config.json
  const cfg = loadConfig();
  if (!cfg.sessions) cfg.sessions = {};
  cfg.sessions[sessionName] = {
    name: sessionName,
    engine: "mutagen",
    localPath: absLocalPath,
    remoteUrl,
    hostAlias: host.alias,
    remotePath,
    dataDir: p.dataDir,
    createdAt: new Date().toISOString()
  };
  saveConfig(cfg);

  return {
    success: true,
    name: sessionName,
    localPath: absLocalPath,
    remoteUrl,
    dataDir: p.dataDir,
    output: (stdout || stderr).trim()
  };
}

/**
 * 7. List sync sessions
 */
export async function listSessions(name = "") {
  const p = await probe();
  if (!p.installed) {
    return { installed: false, sessions: [] };
  }

  const cmdArgs = name ? `sync list "${name}"` : "sync list";
  try {
    const { stdout } = await runMutagenCmd(cmdArgs);
    return parseMutagenList(stdout);
  } catch (err) {
    return { installed: true, raw: err.message, sessions: [] };
  }
}

/**
 * Simple parser for `mutagen sync list` text output
 */
function parseMutagenList(rawText) {
  const sessions = [];
  const blocks = rawText.split(/----------------------------------------------------------------/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const nameMatch = block.match(/Name:\s+(.+)/);
    const idMatch = block.match(/Identifier:\s+(.+)/);
    const statusMatch = block.match(/Status:\s+(.+)/);
    const alphaMatch = block.match(/Alpha:\s*\n\s*URL:\s+(.+)/);
    const betaMatch = block.match(/Beta:\s*\n\s*URL:\s+(.+)/);

    if (nameMatch || idMatch) {
      sessions.push({
        name: nameMatch ? nameMatch[1].trim() : (idMatch ? idMatch[1].trim() : "unnamed"),
        id: idMatch ? idMatch[1].trim() : "",
        status: statusMatch ? statusMatch[1].trim() : "Unknown",
        alpha: alphaMatch ? alphaMatch[1].trim() : "",
        beta: betaMatch ? betaMatch[1].trim() : ""
      });
    }
  }

  return { installed: true, count: sessions.length, sessions, raw: rawText.trim() };
}

/**
 * 8. Pause session
 */
export async function pauseSession(name) {
  const { stdout } = await runMutagenCmd(`sync pause "${name}"`);
  return { success: true, message: stdout.trim() };
}

/**
 * 9. Resume session
 */
export async function resumeSession(name, hostAlias = null) {
  const host = getHost(hostAlias);
  const { stdout } = await runMutagenCmd(`sync resume "${name}"`, host);
  return { success: true, message: stdout.trim() };
}

/**
 * 10. Flush session
 */
export async function flushSession(name, hostAlias = null) {
  const host = getHost(hostAlias);
  const { stdout } = await runMutagenCmd(`sync flush "${name}"`, host);
  return { success: true, message: stdout.trim() };
}

/**
 * 11. Terminate session
 */
export async function terminateSession(name) {
  const cmdArgs = name === "--all" ? "sync terminate --all" : `sync terminate "${name}"`;
  const { stdout } = await runMutagenCmd(cmdArgs);

  const cfg = loadConfig();
  if (cfg.sessions) {
    if (name === "--all") {
      cfg.sessions = {};
    } else {
      delete cfg.sessions[name];
    }
    saveConfig(cfg);
  }

  return { success: true, message: stdout.trim() };
}
