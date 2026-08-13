/**
 * Runtime launcher: dependency-injected process command builder.
 * Importing this module never spawns processes. All adapters are injected.
 */

import { DreamSkinError } from "../domain/errors.mjs";

export const DEFAULT_DEBUG_PORT = 19222;

// --- Pure command builders ---

export function resolveWindowsAppCandidates({ localAppData = "", programFiles = "" } = {}) {
  const candidates = [];
  if (programFiles) {
    const pf = programFiles.replace(/[\\/]+$/, "");
    candidates.push(`${pf}\\WindowsApps\\OpenAI.Codex_*\\app`);
    candidates.push(`${pf}\\WindowsApps\\OpenAI.CodexBeta_*\\app`);
    candidates.push(`${pf}\\WindowsApps\\OpenAI.ChatGPT-Desktop_*\\app`);
  }
  candidates.push("C:\\Program Files\\WindowsApps\\OpenAI.Codex_*\\app");
  candidates.push("C:\\Program Files\\WindowsApps\\OpenAI.CodexBeta_*\\app");
  candidates.push("C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT-Desktop_*\\app");
  if (localAppData) {
    const local = localAppData.replace(/[\\/]+$/, "");
    candidates.push(`${local}\\OpenAI\\Codex\\bin`);
    candidates.push(`${local}\\OpenAI\\Codex`);
    candidates.push(`${local}\\Programs\\OpenAI\\Codex`);
  }
  return candidates;
}

export function buildWindowsLaunchArgs({ debugPort, extraArgs = [] }) {
  if (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535) {
    throw new DreamSkinError("invalid_request", `invalid debug port: ${debugPort}`);
  }
  return [
    `--remote-debugging-port=${debugPort}`,
    `--remote-allow-origins=http://127.0.0.1:${debugPort}`,
    ...extraArgs,
  ];
}

export function buildWindowsPackagedActivation({ appUserModelId, debugPort, extraArgs = [] }) {
  if (!appUserModelId || typeof appUserModelId !== "string") {
    throw new DreamSkinError("invalid_request", "appUserModelId is required");
  }
  const args = buildWindowsLaunchArgs({ debugPort, extraArgs });
  return {
    type: "packaged",
    appUserModelId,
    arguments: args.join(" "),
    executable: "powershell.exe",
  };
}

export function buildWindowsStandaloneCommand({ appPath, debugPort, extraArgs = [] }) {
  if (!appPath || typeof appPath !== "string") {
    throw new DreamSkinError("invalid_request", "appPath is required");
  }
  const args = buildWindowsLaunchArgs({ debugPort, extraArgs });
  return { type: "standalone", executable: appPath, args };
}

export function buildWindowsProcessQuery({ appName = "Codex" } = {}) {
  if (!appName) throw new DreamSkinError("invalid_request", "appName is required");
  return {
    executable: "tasklist",
    args: ["/FI", `IMAGENAME eq ${appName}.exe`, "/NH"],
  };
}

export function buildWindowsQuitCommand({ appName = "Codex" } = {}) {
  if (!appName) throw new DreamSkinError("invalid_request", "appName is required");
  return {
    executable: "taskkill",
    args: ["/IM", `${appName}.exe`, "/F"],
  };
}

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
  localAppData = "",
  programFiles = "",
  exists = async () => false,
  spawn = null,
  spawnSync = null,
  execFile = null,
  sleep = async () => {},
  waitForDebugEndpoint = async () => {},
  listTargets = async () => { throw new DreamSkinError("market_unavailable", "listTargets not provided"); },
  activatePackagedApp = null,
  logger = console,
}) {
  async function resolveCodexAppPath(configuredPath = "") {
    if (configuredPath && configuredPath.trim()) {
      const p = configuredPath.trim();
      if (await exists(p)) return p;
      throw new DreamSkinError("invalid_request", `configured Codex app path does not exist: ${p}`);
    }

    if (platform === "win32") {
      const winCandidates = resolveWindowsAppCandidates({ localAppData, programFiles });
      for (const candidate of winCandidates) {
        const found = await exists(candidate);
        if (found && typeof found === "string") return found;
        if (!found && !/\.exe$/i.test(candidate)) {
          for (const exe of ["Codex.exe", "ChatGPT.exe"]) {
            const exePath = `${candidate.replace(/[\\/]+$/, "")}\\${exe}`;
            const foundExe = await exists(exePath);
            if (foundExe && typeof foundExe === "string") return foundExe;
          }
        }
      }
      throw new DreamSkinError(
        "invalid_request",
        "Codex desktop app not found. Set codexAppPath in dream-skin config.",
      );
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
    if (platform === "win32") {
      if (!spawnSync) {
        throw new DreamSkinError("invalid_request", "spawnSync adapter is required for isRunning");
      }
      const appName = String(appPath).split(/[\\/]/).pop().replace(/\.exe$/, "") || "Codex";
      const cmd = buildWindowsProcessQuery({ appName });
      const result = await spawnSync(cmd.executable, cmd.args);
      // tasklist outputs one line per matching process when running
      return Boolean(result && result.stdout && result.stdout.trim().length > 0);
    }
    if (platform !== "darwin") return false;
    if (!spawnSync) {
      throw new DreamSkinError("invalid_request", "spawnSync adapter is required for isRunning");
    }
    const cmd = buildMacOSProcessQuery(appPath);
    const result = await spawnSync(cmd.executable, cmd.args);
    return Boolean(result && result.stdout && result.stdout.trim().length > 0);
  }

  async function quit(appPath) {
    if (platform === "win32") {
      if (!spawn) {
        throw new DreamSkinError("invalid_request", "spawn adapter is required for quit");
      }
      const appName = String(appPath).split(/[\\/]/).pop().replace(/\.exe$/, "") || "Codex";
      const cmd = buildWindowsQuitCommand({ appName });
      await spawn(cmd.executable, cmd.args, { windowsHide: true });
      return;
    }
    if (platform !== "darwin") return;
    if (!spawn) {
      throw new DreamSkinError("invalid_request", "spawn adapter is required for quit");
    }
    const cmd = buildMacOSQuitCommand(appPath);
    await spawn(cmd.executable, cmd.args);
  }

  async function launchWindowsPackaged({ appUserModelId, debugPort, extraArgs }) {
    if (!activatePackagedApp) {
      throw new DreamSkinError("invalid_request", "activatePackagedApp adapter is required for packaged apps");
    }
    const cmd = buildWindowsPackagedActivation({ appUserModelId, debugPort, extraArgs });
    const processId = await activatePackagedApp(cmd.appUserModelId, cmd.arguments);
    return { pid: processId, appPath: appUserModelId, debugPort, kind: "packaged" };
  }

  async function isPackagedAppRunning(appUserModelId) {
    if (!spawnSync) {
      throw new DreamSkinError("invalid_request", "spawnSync adapter is required for isPackagedAppRunning");
    }
    // Codex packaged apps expose ChatGPT.exe / Codex.exe processes.
    for (const appName of ["ChatGPT", "Codex"]) {
      const cmd = buildWindowsProcessQuery({ appName });
      const result = await spawnSync(cmd.executable, cmd.args);
      if (result && result.stdout && result.stdout.trim().length > 0) return true;
    }
    return false;
  }

  async function launchWithDebugPort({ appPath = "", debugPort = DEFAULT_DEBUG_PORT, extraArgs = [], maxWaitMs = 20000, allowRestart = false } = {}) {
    if (platform !== "darwin" && platform !== "win32") {
      throw new DreamSkinError(
        "unsupported_feature",
        `dream-skin launcher currently only supports macOS and Windows (got ${platform})`,
      );
    }

    // Probe first: if Codex is already running with a debug endpoint, connect
    // directly without restarting the user's app.
    try {
      const targets = await listTargets(debugPort, { timeoutMs: 1500 });
      if (Array.isArray(targets) && targets.length > 0) {
        logger?.log?.("[dream-skin] Codex debug endpoint already reachable, connecting without restart.");
        return { child: null, appPath: appPath || "running", debugPort, kind: "existing" };
      }
    } catch {
      // Debug endpoint not reachable; fall through to launch/relaunch.
    }

    if (platform === "darwin") {
      if (!spawn) {
        throw new DreamSkinError("invalid_request", "spawn adapter is required for launchWithDebugPort");
      }
      const resolvedAppPath = await resolveCodexAppPath(appPath);

      const running = await isRunning(resolvedAppPath).catch(() => false);
      if (running && !allowRestart) {
        // Never force-quit a running Codex unless the user explicitly asked.
        throw new DreamSkinError(
          "runtime_restart_required",
          "Codex 正在运行但没有开启调试端口。请先退出 Codex，或使用 --remote-debugging-port 重新启动后再应用主题。",
        );
      }
      if (running) {
        logger?.log?.("[dream-skin] Codex is running; quitting to relaunch with debug port...");
        await quit(resolvedAppPath);
        for (let i = 0; i < 16; i++) {
          if (!(await isRunning(resolvedAppPath).catch(() => false))) break;
          await sleep(500);
        }
      }

      const cmd = buildMacOSOpenCommand({ appPath: resolvedAppPath, debugPort, extraArgs });
      const child = await spawn(cmd.executable, cmd.args, { stdio: "ignore", detached: false });

      await waitForDebugEndpoint(debugPort, { maxWaitMs });

      return { child, appPath: resolvedAppPath, debugPort, kind: "macos" };
    }

    // Windows
    if (!spawn) {
      throw new DreamSkinError("invalid_request", "spawn adapter is required for launchWithDebugPort");
    }
    const resolvedAppPath = await resolveCodexAppPath(appPath);

    // Packaged MS Store apps need PowerShell activation; standalone can be spawned directly.
    if (resolvedAppPath.includes("WindowsApps") || resolvedAppPath.includes("!App")) {
      const appUserModelId = resolvedAppPath.includes("!App")
        ? resolvedAppPath
        : await resolveAppUserModelId(resolvedAppPath);
      const packagedRunning = await isPackagedAppRunning(appUserModelId).catch(() => false);
      if (packagedRunning && !allowRestart) {
        throw new DreamSkinError(
          "runtime_restart_required",
          "Codex 正在运行但没有开启调试端口。请先退出 Codex，或使用 --remote-debugging-port 重新启动后再应用主题。",
        );
      }
      if (packagedRunning) {
        logger?.log?.("[dream-skin] Codex packaged app is running; quitting before re-activation...");
        for (const appName of ["ChatGPT", "Codex"]) {
          const quitCmd = buildWindowsQuitCommand({ appName });
          await spawn(quitCmd.executable, quitCmd.args, { windowsHide: true });
        }
        for (let i = 0; i < 16; i++) {
          if (!(await isPackagedAppRunning(appUserModelId).catch(() => false))) break;
          await sleep(500);
        }
      }
      const packaged = await launchWindowsPackaged({ appUserModelId, debugPort, extraArgs });
      await waitForDebugEndpoint(debugPort, { maxWaitMs });
      return packaged;
    }

    const running = await isRunning(resolvedAppPath).catch(() => false);
    if (running && !allowRestart) {
      throw new DreamSkinError(
        "runtime_restart_required",
        "Codex 正在运行但没有开启调试端口。请先退出 Codex，或使用 --remote-debugging-port 重新启动后再应用主题。",
      );
    }
    if (running) {
      logger?.log?.("[dream-skin] Codex is running; quitting to relaunch with debug port...");
      await quit(resolvedAppPath);
      for (let i = 0; i < 16; i++) {
        if (!(await isRunning(resolvedAppPath).catch(() => false))) break;
        await sleep(500);
      }
    }

    const cmd = buildWindowsStandaloneCommand({ appPath: resolvedAppPath, debugPort, extraArgs });
    const child = await spawn(cmd.executable, cmd.args, { stdio: "ignore", detached: false, windowsHide: true });

    await waitForDebugEndpoint(debugPort, { maxWaitMs });

    return { child, appPath: resolvedAppPath, debugPort, kind: "windows-standalone" };
  }

  return { resolveCodexAppPath, isRunning, quit, launchWithDebugPort, launchWindowsPackaged, isPackagedAppRunning };
}

/**
 * Derive the AppUserModelId from a WindowsApps package path.
 * Example: C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0.0_neutral__abc123\\app
 * -> OpenAI.Codex_abc123!App
 */
function resolveAppUserModelId(appPath) {
  const parts = String(appPath).replace(/\\/g, "/").split("/").filter(Boolean);
  const packageName = parts.find((part) => /^OpenAI\.(Codex|CodexBeta|ChatGPT-Desktop)_/i.test(part));
  if (!packageName) {
    throw new DreamSkinError("invalid_request", `cannot derive AppUserModelId from path: ${appPath}`);
  }
  // OpenAI.Codex_1.0.0.0_neutral__abc123 -> OpenAI.Codex + abc123
  const sep = packageName.indexOf("__");
  if (sep === -1) {
    throw new DreamSkinError("invalid_request", `cannot parse package name: ${packageName}`);
  }
  const prefix = packageName.slice(0, sep); // OpenAI.Codex_1.0.0.0_neutral
  const publisherId = packageName.slice(sep + 2); // abc123
  // Drop architecture and version segments, keep the identity (e.g. OpenAI.Codex).
  const segments = prefix.split("_");
  segments.pop(); // arch (neutral/x64/arm64)
  segments.pop(); // version (1.0.0.0)
  const identity = segments.join("_");
  return `${identity}_${publisherId}!App`;
}
