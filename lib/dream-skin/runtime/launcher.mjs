/**
 * Runtime launcher: dependency-injected process command builder.
 * Importing this module never spawns processes. All adapters are injected.
 */

import { DreamSkinError } from "../domain/errors.mjs";

export const DEFAULT_DEBUG_PORT = 19222;

// --- Pure command builders ---

export function resolveCodexAppCandidates(homeDir = "") {
  const home = homeDir ? String(homeDir).replace(/[\\/]+$/, "") : "";
  const candidates = [];
  if (home) {
    candidates.push(`${home}/Applications/ChatGPT.app`);
    candidates.push(`${home}/Applications/Codex.app`);
  }
  candidates.push("/Applications/ChatGPT.app");
  candidates.push("/Applications/Codex.app");
  return candidates;
}

export function buildMacOSOpenCommand({ appPath, debugPort, extraArgs = [] }) {
  if (!appPath || typeof appPath !== "string") {
    throw new DreamSkinError("invalid_request", "appPath is required");
  }
  if (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535) {
    throw new DreamSkinError("invalid_request", `invalid debug port: ${debugPort}`);
  }
  const args = [
    "-W",
    "-a",
    appPath,
    "--args",
    `--remote-debugging-port=${debugPort}`,
    `--remote-allow-origins=http://127.0.0.1:${debugPort}`,
    ...extraArgs,
  ];
  return { executable: "open", args };
}

export function buildMacOSQuitCommand(appPath) {
  if (!appPath) {
    throw new DreamSkinError("invalid_request", "appPath is required");
  }
  const appName = String(appPath).split(/[\\/]/).pop().replace(/\.app$/, "");
  return { executable: "osascript", args: ["-e", `tell application "${appName}" to quit`] };
}

export function buildMacOSProcessQuery(appPath) {
  if (!appPath) {
    throw new DreamSkinError("invalid_request", "appPath is required");
  }
  const appName = String(appPath).split(/[\\/]/).pop().replace(/\.app$/, "");
  return { executable: "pgrep", args: ["-fl", appName] };
}

// --- Launcher factory ---

export function createCodexLauncher({
  platform = process.platform,
  homeDir = "",
  exists = async () => false,
  spawn = null,
  spawnSync = null,
  sleep = async () => {},
  waitForDebugEndpoint = async () => {},
  logger = console,
}) {
  async function resolveCodexAppPath(configuredPath = "") {
    if (configuredPath && configuredPath.trim()) {
      const p = configuredPath.trim();
      if (await exists(p)) return p;
      throw new DreamSkinError("invalid_request", `configured Codex app path does not exist: ${p}`);
    }
    const candidates = resolveCodexAppCandidates(homeDir);
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate;
    }
    throw new DreamSkinError(
      "invalid_request",
      "Codex desktop app not found. Set codexAppPath in dream-skin config.",
    );
  }

  async function isRunning(appPath) {
    if (platform !== "darwin") return false;
    if (!spawnSync) {
      throw new DreamSkinError("invalid_request", "spawnSync adapter is required for isRunning");
    }
    const cmd = buildMacOSProcessQuery(appPath);
    const result = await spawnSync(cmd.executable, cmd.args);
    return Boolean(result && result.stdout && result.stdout.trim().length > 0);
  }

  async function quit(appPath) {
    if (platform !== "darwin") return;
    if (!spawn) {
      throw new DreamSkinError("invalid_request", "spawn adapter is required for quit");
    }
    const cmd = buildMacOSQuitCommand(appPath);
    await spawn(cmd.executable, cmd.args);
  }

  async function launchWithDebugPort({ appPath = "", debugPort = DEFAULT_DEBUG_PORT, extraArgs = [], maxWaitMs = 20000 } = {}) {
    if (platform !== "darwin") {
      throw new DreamSkinError(
        "unsupported_feature",
        `dream-skin launcher currently only supports macOS (got ${platform})`,
      );
    }
    if (!spawn) {
      throw new DreamSkinError("invalid_request", "spawn adapter is required for launchWithDebugPort");
    }

    const resolvedAppPath = await resolveCodexAppPath(appPath);

    // Quit first so --remote-debugging-port is picked up on relaunch
    const running = await isRunning(resolvedAppPath).catch(() => false);
    if (running) {
      logger?.log?.("[dream-skin] Codex is already running, quitting to relaunch with debug port...");
      await quit(resolvedAppPath);
      for (let i = 0; i < 16; i++) {
        if (!(await isRunning(resolvedAppPath).catch(() => false))) break;
        await sleep(500);
      }
    }

    const cmd = buildMacOSOpenCommand({ appPath: resolvedAppPath, debugPort, extraArgs });
    const child = await spawn(cmd.executable, cmd.args, { stdio: "ignore", detached: false });

    await waitForDebugEndpoint(debugPort, { maxWaitMs });

    return { child, appPath: resolvedAppPath, debugPort };
  }

  return { resolveCodexAppPath, isRunning, quit, launchWithDebugPort };
}