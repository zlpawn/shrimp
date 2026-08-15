import fs from "node:fs";
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

function publicApp(app, platform) {
  return {
    id: app.id,
    displayName: app.displayName,
    args: [...app.defaultArgs],
    supported: app.supportedPlatforms.includes(platform),
  };
}

function statusFrom(app, settings, matches, managed, platform) {
  const configured = Boolean(settings?.executablePath);
  return {
    app: publicApp(app, platform),
    configured,
    executablePath: settings?.executablePath || "",
    manuallyConfigured: Boolean(settings?.manuallyConfigured),
    lastLaunchedAt: settings?.lastLaunchedAt || null,
    process: {
      status: matches.length ? "running" : "stopped",
      count: matches.length,
      launchedByPanel: Boolean(managed && matches.some((row) => row.pid === managed.pid)),
    },
  };
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

  async function processMatchesFor(app, settings) {
    if (!settings?.executablePath || !app.supportedPlatforms.includes(platform)) return [];
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
      const config = getConfig();
      return listCommandApps().map((app) => statusFrom(
        app,
        config.apps[app.id],
        [],
        processStore.get(app.id),
      ));
    },

    async discover(appId) {
      const app = requireApp(appId);
      if (!app.supportedPlatforms.includes(platform)) {
        throw new CommandAppsError(
          "unsupported_platform",
          `${app.displayName} is not supported on ${platform}`,
        );
      }
      return discoverCommandApp(app, { platform });
    },

    async getStatus(appId) {
      const app = requireApp(appId);
      const settings = settingsFor(app);
      const matches = await processMatchesFor(app, settings);
      return statusFrom(app, settings, matches, processStore.get(app.id), platform);
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
      const child = await spawnProcess(settings.executablePath, [...app.defaultArgs], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
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
      const validated = validateAppSettings(app, {
        executablePath: patch?.executablePath,
        manuallyConfigured: true,
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

