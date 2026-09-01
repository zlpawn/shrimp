import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  CommandAppsError,
} from "../domain/errors.mjs";
import { getCommandApp, listCommandApps } from "../domain/registry.mjs";
import {
  normalizeCommandAppsConfig,
  validateAppSettings,
} from "../domain/schema.mjs";
import { discoverCommandApp } from "../infra/discovery.mjs";
import {
  createCommandAppsProcessStore,
  findProcessesByExecutable,
  listWindowsProcesses,
  terminateProcessTree,
} from "../infra/windows-processes.mjs";
import {
  publicLlmConfig,
  readHindsightConfig,
  writeHindsightLlmConfig,
} from "../infra/hindsight-config.mjs";
import {
  probeHindsightHealth,
  startHindsightDaemon,
  stopHindsightDaemon,
  daemonUrl,
  sanitizeDaemonEnv,
  inspectHindsightDaemon,
} from "../infra/hindsight-daemon.mjs";

function publicApp(app, platform) {
  return {
    id: app.id,
    displayName: app.displayName,
    description: app.description || "",
    type: app.type || "executable",
    command: app.command || (app.defaultArgs ? app.defaultArgs.join(" ") : ""),
    args: [...app.defaultArgs],
    supported: app.supportedPlatforms.includes(platform),
    configurableLlm: app.type === "cli-daemon",
    defaultPort: app.defaultPort || null,
    mcpPath: app.mcpPath || null,
  };
}

function statusFrom(app, settings, matches = [], managed = null, platform = process.platform, error = null, extras = {}) {
  const configured = Boolean(settings?.executablePath);
  const errorMessage = error ? (error.message || String(error)) : null;
  const urls = app.type === "cli-daemon" ? daemonUrl(app, settings) : null;
  return {
    app: publicApp(app, platform),
    configured,
    executablePath: settings?.executablePath || "",
    manuallyConfigured: Boolean(settings?.manuallyConfigured),
    lastLaunchedAt: settings?.lastLaunchedAt
        || (matches.length
          ? matches.map((row) => row.createdAt).filter(Boolean).sort()[0]
          : null),
    error: errorMessage,
    process: {
      status: errorMessage ? "error" : (matches.some((row) => row.launching) ? "launching" : (matches.length ? "running" : "stopped")),
      count: matches.length,
      launchedByPanel: Boolean(managed && matches.some((row) => row.pid === managed.pid)),
    },
    llm: extras.llm || null,
    endpoints: urls ? {
      healthUrl: urls.healthUrl,
      mcpUrl: urls.mcpUrl,
      port: urls.port,
    } : null,
  };
}

function readProjectPidFile(projectDir, { fileExists = (p) => fs.existsSync(p), readFile = (p) => fs.readFileSync(p, "utf8") } = {}) {
  try {
    const jsonPath = path.join(projectDir, "gateway.pid.json");
    if (fileExists(jsonPath)) {
      const data = JSON.parse(readFile(jsonPath).replace(/^\uFEFF/, ""));
      if (data && typeof data.pid === "number") return data;
    }
    const legacyPath = path.join(projectDir, "gateway.pid");
    if (fileExists(legacyPath)) {
      const pid = parseInt(readFile(legacyPath).trim(), 10);
      if (Number.isInteger(pid) && pid > 0) return { pid };
    }
  } catch {}
  return null;
}

export function createCommandAppsService({
  configStore,
  platform = process.platform,
  discovery = (app) => discoverCommandApp(app, { platform }),
  processStore = createCommandAppsProcessStore(),
  listProcesses = () => listWindowsProcesses(),
  terminateProcess = (pid) => terminateProcessTree(pid),
  spawnProcess = spawn,
  fileExists = (value) => fs.existsSync(value),
  readFile = (p) => fs.readFileSync(p, "utf8"),
  readHindsightLlm = () => publicLlmConfig(readHindsightConfig()),
  writeHindsightLlm = (patch) => writeHindsightLlmConfig(patch),
  probeHindsight = (app, settings) => probeHindsightHealth(app, settings),
  inspectHindsight = (app, settings) => inspectHindsightDaemon(app, settings, { probe: probeHindsight }),
  startHindsight = (app, settings, options = {}) => startHindsightDaemon(app, settings, { timeoutMs: 180000, ...options }),
  stopHindsight = (app, settings, options = {}) => stopHindsightDaemon(app, settings, { timeoutMs: 20000, ...options }),
  daemonEnv = () => sanitizeDaemonEnv(),
  isPidAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return !err || err.code === "EPERM";
    }
  },
  logger = console,
} = {}) {
  if (!configStore) throw new Error("configStore is required");

  const getConfig = () => normalizeCommandAppsConfig(configStore.get() || {}, { platform });
  const saveConfig = (next) => configStore.save(next);

  function requireApp(appId) {
    const app = getCommandApp(appId);
    if (!app) {
      throw new CommandAppsError("app_not_found", `Unknown command app: ${appId}`);
    }
    return app;
  }

  function settingsFor(app) {
    return getConfig().apps[app.id] || null;
  }

  function llmFor(app) {
    if (app.type !== "cli-daemon") return null;
    try {
      return readHindsightLlm();
    } catch {
      return {
        provider: "",
        baseUrl: "",
        model: "",
        hasApiKey: false,
        apiKeyMasked: null,
      };
    }
  }

  async function processMatchesFor(app, settings) {
    if (!settings?.executablePath || !app.supportedPlatforms.includes(platform)) return [];
    if (app.type === "cli-daemon") {
      const inspected = await inspectHindsight(app, settings);
      if (inspected.status === "stopped") return [];
      return [{
        pid: inspected.pid || processStore.get(app.id)?.pid || 0,
        createdAt: settings.lastLaunchedAt || null,
        launching: inspected.status === "launching",
      }];
    }
    if (app.type === "project") {
      const pidInfo = readProjectPidFile(settings.executablePath, { fileExists, readFile });
      if (pidInfo?.pid && isPidAlive(pidInfo.pid)) {
        return [{ pid: pidInfo.pid, createdAt: pidInfo.startedAt || null }];
      }
      return [];
    }
    let rows = [];
    try {
      rows = await listProcesses();
    } catch (error) {
      logger.warn?.(`[command-apps] process listing failed: ${error.message}`);
      return [];
    }
    return findProcessesByExecutable(rows, settings.executablePath, { platform });
  }

  async function resolveExecutable(app, { allowDiscovery = true } = {}) {
    if (!app.supportedPlatforms.includes(platform)) {
      return null;
    }
    const current = settingsFor(app);
    if (current?.executablePath) {
      return validateAppSettings(app, current, { platform, fileExists });
    }
    if (!allowDiscovery) {
      return null;
    }
    const result = await discovery(app);
    if (!result?.selected?.path) {
      throw new CommandAppsError(
        "executable_not_found",
        `${app.displayName} executable was not found`,
      );
    }
    const next = getConfig();
    const saved = {
      ...next,
      apps: {
        ...next.apps,
        [app.id]: {
          executablePath: result.selected.path,
          args: [...app.defaultArgs],
          manuallyConfigured: false,
          lastLaunchedAt: current?.lastLaunchedAt || null,
        },
      },
    };
    saveConfig(normalizeCommandAppsConfig(saved, { platform }));
    return validateAppSettings(app, saved.apps[app.id], { platform, fileExists });
  }

  return {
    async listApps() {
      const apps = listCommandApps();
      const results = [];
      for (const app of apps) {
        try {
          results.push(await this.getStatus(app.id));
        } catch (error) {
          logger.warn?.(`[command-apps] Failed to get status for ${app.id}: ${error.message}`);
          results.push(statusFrom(app, settingsFor(app), [], processStore.get(app.id), platform, error, { llm: llmFor(app) }));
        }
      }
      return results;
    },

    async discover(appId) {
      const app = requireApp(appId);
      if (!app.supportedPlatforms.includes(platform)) {
        throw new CommandAppsError(
          "unsupported_platform",
          `${app.displayName} is not supported on ${platform}`,
        );
      }
      const result = await discovery(app);
      if (result?.selected?.path) {
        const next = getConfig();
        const current = settingsFor(app);
        const saved = {
          ...next,
          apps: {
            ...next.apps,
            [app.id]: {
              executablePath: result.selected.path,
              args: [...app.defaultArgs],
              manuallyConfigured: false,
              lastLaunchedAt: current?.lastLaunchedAt || null,
            },
          },
        };
        saveConfig(normalizeCommandAppsConfig(saved, { platform }));
      }
      return result;
    },

    async getStatus(appId) {
      const app = requireApp(appId);
      if (!app.supportedPlatforms.includes(platform)) {
        return statusFrom(app, settingsFor(app), [], null, platform, null, { llm: llmFor(app) });
      }
      let settings = settingsFor(app);
      let loadError = null;
      if (!settings?.executablePath) {
        try {
          settings = await resolveExecutable(app);
        } catch (error) {
          if (error instanceof CommandAppsError && (error.code === "executable_not_found" || error.code === "unsupported_platform")) {
            return statusFrom(app, null, [], processStore.get(app.id), platform, null, { llm: llmFor(app) });
          }
          loadError = error;
        }
      }
      let matches = [];
      if (!loadError && settings?.executablePath) {
        try {
          matches = await processMatchesFor(app, settings);
        } catch (error) {
          loadError = error;
        }
      }
      return statusFrom(app, settings, matches, processStore.get(app.id), platform, loadError, { llm: llmFor(app) });
    },

    async launch(appId) {
      const app = requireApp(appId);
      if (!app.supportedPlatforms.includes(platform)) {
        throw new CommandAppsError(
          "unsupported_platform",
          `${app.displayName} is not supported on ${platform}`,
        );
      }
      const settings = await resolveExecutable(app);
      if (!settings) {
        throw new CommandAppsError("executable_not_found", `${app.displayName} executable is not configured`);
      }

      let child;
      if (app.type === "cli-daemon") {
        const result = await startHindsight(app, settings, {
          spawnProcess,
          env: daemonEnv(),
          platform,
          probe: probeHindsight,
          timeoutMs: 0,
          pollMs: 0,
        });
        if (result?.pid) processStore.record(app.id, { pid: result.pid });
        const config = getConfig();
        saveConfig({
          ...config,
          apps: {
            ...config.apps,
            [app.id]: {
              ...config.apps[app.id],
              executablePath: settings.executablePath,
              args: [...app.defaultArgs],
              lastLaunchedAt: new Date().toISOString(),
            },
          },
        });
        return this.getStatus(app.id);
      }
      if (app.type === "project") {
        const scriptPath = path.join(settings.executablePath, "scripts", "gateway.mjs");
        if (fileExists(scriptPath)) {
          if (platform === "win32") {
            const escapedNode = process.execPath.replace(/'/g, "''");
            const escapedScript = scriptPath.replace(/'/g, "''");
            const escapedCwd = settings.executablePath.replace(/'/g, "''");
            child = await spawnProcess("powershell.exe", [
              "-NoProfile",
              "-NonInteractive",
              "-WindowStyle",
              "Hidden",
              "-Command",
              `Start-Process -FilePath '${escapedNode}' -ArgumentList '${escapedScript}', 'restart' -WorkingDirectory '${escapedCwd}' -WindowStyle Hidden`,
            ], {
              detached: true,
              stdio: "ignore",
              windowsHide: true,
            });
          } else {
            child = await spawnProcess(process.execPath, [scriptPath, "restart"], {
              cwd: settings.executablePath,
              detached: true,
              stdio: "ignore",
            });
          }
        } else if (platform === "win32") {
          child = await spawnProcess("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            `Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'gateway:restart' -WorkingDirectory '${settings.executablePath.replace(/'/g, "''")}' -WindowStyle Hidden`,
          ], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          child = await spawnProcess("npm", [...app.defaultArgs], {
            cwd: settings.executablePath,
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          });
        }
      } else {
        child = await spawnProcess(settings.executablePath, [...app.defaultArgs], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
      }

      if (typeof child?.unref === "function") child.unref();
      processStore.record(app.id, child);
      const config = getConfig();
      saveConfig({
        ...config,
        apps: {
          ...config.apps,
          [app.id]: {
            ...config.apps[app.id],
            executablePath: settings.executablePath,
            args: [...app.defaultArgs],
            lastLaunchedAt: new Date().toISOString(),
          },
        },
      });
      return this.getStatus(app.id);
    },

    async stop(appId) {
      const app = requireApp(appId);
      const settings = settingsFor(app);
      if (app.type === "cli-daemon") {
        await stopHindsight(app, settings, {
          spawnProcess,
          env: daemonEnv(),
          platform,
          probe: probeHindsight,
        });
        const managed = processStore.get(app.id);
        if (managed?.pid) processStore.clear(app.id, managed.pid);
        return this.getStatus(app.id);
      }
      if (app.type === "project" && settings?.executablePath) {
        const scriptPath = path.join(settings.executablePath, "scripts", "gateway.mjs");
        if (fileExists(scriptPath)) {
          try {
            if (platform === "win32") {
              const escapedNode = process.execPath.replace(/'/g, "''");
              const escapedScript = scriptPath.replace(/'/g, "''");
              const escapedCwd = settings.executablePath.replace(/'/g, "''");
              const stopChild = await spawnProcess("powershell.exe", [
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                `Start-Process -FilePath '${escapedNode}' -ArgumentList '${escapedScript}', 'stop' -WorkingDirectory '${escapedCwd}' -WindowStyle Hidden`,
              ], {
                detached: true,
                stdio: "ignore",
                windowsHide: true,
              });
              if (typeof stopChild?.unref === "function") stopChild.unref();
            } else {
              const stopChild = await spawnProcess(process.execPath, [scriptPath, "stop"], {
                cwd: settings.executablePath,
                detached: true,
                stdio: "ignore",
              });
              if (typeof stopChild?.unref === "function") stopChild.unref();
            }
          } catch {}
        }
      }
      const matches = await processMatchesFor(app, settings);
      for (const row of matches) {
        await terminateProcess(row.pid);
        processStore.clear(app.id, row.pid);
      }
      return this.getStatus(app.id);
    },

    async updateConfig(appId, patch = {}) {
      const app = requireApp(appId);
      if (patch && patch.args !== undefined) {
        throw new CommandAppsError("invalid_request", "Arguments cannot be changed");
      }
      const current = settingsFor(app);
      const llmPatch = patch?.llm || null;
      const hasLlmPatch = Boolean(
        llmPatch
        || patch?.provider !== undefined
        || patch?.baseUrl !== undefined
        || patch?.model !== undefined
        || patch?.apiKey !== undefined
      );
      if (app.type === "cli-daemon" && hasLlmPatch) {
        writeHindsightLlm(llmPatch || {
          provider: patch.provider,
          baseUrl: patch.baseUrl,
          model: patch.model,
          apiKey: patch.apiKey,
        });
        if (patch.executablePath === undefined) {
          return this.getStatus(app.id);
        }
      }
      const executablePath = patch?.executablePath !== undefined ? patch.executablePath : current?.executablePath;
      const validated = validateAppSettings(app, {
        executablePath,
        manuallyConfigured: patch?.executablePath !== undefined ? true : Boolean(current?.manuallyConfigured),
        lastLaunchedAt: current?.lastLaunchedAt || null,
      }, { platform, fileExists });
      const config = getConfig();
      saveConfig({
        ...config,
        apps: {
          ...config.apps,
          [app.id]: validated,
        },
      });
      return this.getStatus(app.id);
    },
  };
}


