// Launches the Codex desktop app with a remote debugging port.
// macOS: uses `open -a <app> --args --remote-debugging-port=<port>`.
// Non-macOS: currently unsupported (would need platform-specific launch).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { waitForDebugEndpoint } from "./cdp-client.mjs";

const DEFAULT_DEBUG_PORT = 19222;

// Common Codex desktop app locations on macOS.
const MACOS_APP_CANDIDATES = [
  "/Applications/ChatGPT.app",
  "/Applications/Codex.app",
  path.join(os.homedir(), "Applications/ChatGPT.app"),
  path.join(os.homedir(), "Applications/Codex.app"),
];

export function resolveCodexAppPath(configuredPath = "") {
  if (configuredPath && configuredPath.trim()) {
    const p = configuredPath.trim();
    if (fs.existsSync(p)) return p;
    throw new Error(`configured Codex app path does not exist: ${p}`);
  }
  for (const candidate of MACOS_APP_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Codex desktop app not found. Set codexAppPath in dream-skin config.",
  );
}

function buildMacOSOpenCommand(appPath, debugPort, extraArgs = []) {
  const args = [
    "-W", // wait for app to exit (we manage lifecycle)
    "-a",
    appPath,
    "--args",
    `--remote-debugging-port=${debugPort}`,
    `--remote-allow-origins=http://127.0.0.1:${debugPort}`,
    ...extraArgs,
  ];
  return ["open", ...args];
}

function isMacOSAppRunning(appPath) {
  const appName = path.basename(appPath, ".app");
  try {
    const result = spawn.sync("pgrep", ["-fl", appName], { encoding: "utf8" });
    return result.stdout && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function launchCodexWithDebugPort({
  appPath = "",
  debugPort = DEFAULT_DEBUG_PORT,
  extraArgs = [],
  maxWaitMs = 20000,
} = {}) {
  if (process.platform !== "darwin") {
    throw new Error(
      `dream-skin launcher currently only supports macOS (got ${process.platform})`,
    );
  }

  const resolvedAppPath = resolveCodexAppPath(appPath);
  const wasAlreadyRunning = isMacOSAppRunning(resolvedAppPath);

  const command = buildMacOSOpenCommand(resolvedAppPath, debugPort, extraArgs);
  const [executable, ...args] = command;

  // Spawn the open command. It stays alive while the app runs.
  const child = spawn(executable, args, {
    stdio: "ignore",
    detached: false,
  });

  // Wait for the CDP endpoint to become available.
  await waitForDebugEndpoint(debugPort, { maxWaitMs });

  return {
    child,
    appPath: resolvedAppPath,
    debugPort,
    wasAlreadyRunning,
  };
}

// Gracefully request the macOS app to quit (only if we launched it).
export async function quitCodexApp(appPath) {
  if (process.platform !== "darwin") return;
  const appName = path.basename(appPath, ".app");
  return new Promise((resolve) => {
    const proc = spawn(
      "osascript",
      ["-e", `tell application "${appName}" to quit`],
      { stdio: "ignore" },
    );
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}

export { DEFAULT_DEBUG_PORT };
