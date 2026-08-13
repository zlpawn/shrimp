/**
 * Dream Skin applier: probes/launches Codex and injects a theme over CDP.
 * Composes the launcher, CDP client, and injector from this runtime/ folder.
 * Everything is dependency-injected so tests can run without real processes.
 */

import { createCodexLauncher, DEFAULT_DEBUG_PORT } from "./launcher.mjs";
import {
  createTargetClient,
  createCdpSession,
} from "./cdp-client.mjs";
import { loadRuntimeTheme, buildInjectionScript } from "./injector.mjs";
import fs from "node:fs";
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import { activatePackagedApp } from "./win-com.mjs";
import { DreamSkinError } from "../domain/errors.mjs";

function defaultRequestJson(url, { timeoutMs = 3000 } = {}) {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then((res) => res.json());
}

export function wildcardToRegExp(pattern) {
  const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`, "i");
}

export async function resolveWildcardPath(path) {
  const normalized = String(path).replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  // Keep Windows drive letter if present (e.g. C:).
  const hasDrive = /^[A-Za-z]:$/.test(parts[0] || "");
  let current = hasDrive ? `${parts[0]}/` : "/";
  const segments = hasDrive ? parts.slice(1) : parts;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment.includes("*")) {
      current = current.endsWith("/") ? `${current}${segment}` : `${current}/${segment}`;
      continue;
    }
    let entries;
    try {
      entries = await fs.promises.readdir(current);
    } catch {
      return false;
    }
    const regex = wildcardToRegExp(segment);
    // Prefer the newest package folder when multiple versions exist.
    const matches = entries.filter((entry) => regex.test(entry)).sort().reverse();
    if (matches.length === 0) return false;
    current = current.endsWith("/") ? `${current}${matches[0]}` : `${current}/${matches[0]}`;
  }
  try {
    await fs.promises.access(current);
    return current.replace(/\//g, "\\");
  } catch {
    return false;
  }
}

async function defaultExists(path) {
  // Windows package paths include a version wildcard (OpenAI.Codex_*\\app).
  // Resolve multi-segment wildcards by walking each path segment.
  if (process.platform === "win32" && String(path).includes("*")) {
    return resolveWildcardPath(path);
  }
  return fs.promises.access(path).then(() => path).catch(() => false);
}

function defaultSpawn(executable, args, options) {
  return nodeSpawn(executable, args, options);
}

function defaultSpawnSync(executable, args, options) {
  return nodeSpawnSync(executable, args, { ...options, encoding: "utf8" });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDreamSkinApplier({
  platform = process.platform,
  requestJson = defaultRequestJson,
  exists = defaultExists,
  spawn = defaultSpawn,
  spawnSync = defaultSpawnSync,
  homeDir = process.env.HOME || process.env.USERPROFILE || "",
  localAppData = process.env.LOCALAPPDATA || "",
  programFiles = process.env.ProgramFiles || process.env["ProgramFiles(x86)"] || "",
  sleep = defaultSleep,
  debugPort = DEFAULT_DEBUG_PORT,
  logger = console,
} = {}) {
  const targetClient = createTargetClient({ requestJson, sleep });
  const launcher = createCodexLauncher({
    platform,
    homeDir,
    exists,
    spawn,
    spawnSync,
    localAppData,
    programFiles,
    sleep,
    waitForDebugEndpoint: targetClient.waitForDebugEndpoint,
    listTargets: targetClient.listTargets,
    activatePackagedApp,
    logger,
  });

  async function probe(port = debugPort) {
    try {
      const targets = await targetClient.listTargets(port, { timeoutMs: 1500 });
      return Array.isArray(targets) && targets.length > 0
        ? { available: true, targets }
        : { available: false, targets: [] };
    } catch {
      return { available: false, targets: [] };
    }
  }

  async function applyTheme({
    themeJsonBytes,
    imageBytes,
    appPath = "",
    port = debugPort,
    maxWaitMs = 20000,
    allowRestart = false,
  } = {}) {
    const { theme, backgroundDataUri } = loadRuntimeTheme({
      themeJsonBytes,
      imageBytes,
      allowBuiltin: true,
    });
    const script = buildInjectionScript({ theme, backgroundDataUri });

    const launch = await launcher.launchWithDebugPort({
      appPath,
      debugPort: port,
      maxWaitMs,
      allowRestart,
    });

    const target = await targetClient.pickPrimaryTarget(port);
    const session = createCdpSession({ wsUrl: target.webSocketDebuggerUrl });
    await session.connect();
    try {
      await session.addScriptToNewDocuments(script);
      const result = await session.evaluate(script);
      const ok = result?.result?.value === true;
      if (!ok) {
        throw new DreamSkinError("runtime_inject_failed", "主题注入到 Codex 失败");
      }
      return {
        ok: true,
        kind: launch.kind,
        target: target.title || target.url || "",
        debugPort: port,
      };
    } finally {
      session.close();
    }
  }

  return { probe, applyTheme, launcher, targetClient };
}
