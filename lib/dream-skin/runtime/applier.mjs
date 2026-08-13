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

async function defaultExists(path) {
  // Windows package paths include a version wildcard (OpenAI.Codex_*\app).
  // Resolve it by scanning the parent directory for a matching name.
  if (process.platform === "win32" && String(path).includes("*")) {
    const normalized = String(path).replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    const parent = normalized.slice(0, lastSlash);
    const pattern = normalized.slice(lastSlash + 1);
    try {
      const entries = await fs.promises.readdir(parent);
      const match = entries.find((entry) => {
        if (!pattern.includes("*")) return entry === pattern;
        const regex = new RegExp("^" + pattern.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
        return regex.test(entry);
      });
      if (match) return parent + "/" + match;
    } catch {
      return false;
    }
  }
  return fs.promises.access(path).then(() => path).catch(() => false);
}

function defaultSpawn(executable, args, options) {
  return nodeSpawn(executable, args, options);
}

function defaultSpawnSync(executable, args, options) {
  return nodeSpawnSync(executable, args, { ...options, encoding: "utf8" });
}

export function createDreamSkinApplier({
  platform = process.platform,
  requestJson = defaultRequestJson,
  exists = defaultExists,
  spawn = defaultSpawn,
  spawnSync = defaultSpawnSync,
  localAppData = process.env.LOCALAPPDATA || "",
  programFiles = process.env.ProgramFiles || process.env["ProgramFiles(x86)"] || "",
  sleep = async () => {},
  debugPort = DEFAULT_DEBUG_PORT,
  logger = console,
} = {}) {
  const targetClient = createTargetClient({ requestJson, sleep });
  const launcher = createCodexLauncher({
    platform,
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
  } = {}) {
    const { theme, backgroundDataUri } = loadRuntimeTheme({ themeJsonBytes, imageBytes });
    const script = buildInjectionScript({ theme, backgroundDataUri });

    const launch = await launcher.launchWithDebugPort({
      appPath,
      debugPort: port,
      maxWaitMs,
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
