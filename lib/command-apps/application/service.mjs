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
  listHindsightProfileFiles,
  defaultHindsightConfigPath,
  defaultHindsightPort,
  normalizeHindsightProfileName,
  readCodingAgentPluginConfig,
  writeCodingAgentPluginConfig,
} from "../infra/hindsight-config.mjs";
import {
  probeHindsightHealth,
  startHindsightDaemon,
  stopHindsightDaemon,
  daemonUrl,
  sanitizeDaemonEnv,
  inspectHindsightDaemon,
} from "../infra/hindsight-daemon.mjs";
import {
  ensureHindsightControlPlane,
} from "../infra/hindsight-control-plane.mjs";
import {
  langbotDaemonUrl,
  probeLangBotHealth,
  inspectLangBotDaemon,
  startLangBotDaemon,
  stopLangBotDaemon,
  sanitizeLangBotEnv,
} from "../infra/langbot-daemon.mjs";
import {
  findUv,
  installLangBotTool,
  installedLangBotVersion,
  upgradeLangBotTool,
} from "../infra/langbot-package.mjs";
import { terminateUnixProcessGroup } from "../infra/unix-processes.mjs";

function publicApp(app, platform) {
  return {
    id: app.id,
    displayName: app.displayName,
    description: app.description || "",
    type: app.type || "executable",
    command: app.command || (app.defaultArgs ? app.defaultArgs.join(" ") : ""),
    daemonKind: app.daemonKind || null,
    args: [...app.defaultArgs],
    supported: app.supportedPlatforms.includes(platform),
    configurableLlm: app.type === "cli-daemon",
    defaultPort: app.defaultPort || null,
    mcpPath: app.mcpPath || null,
    profileName: app.profileName || (app.id === "hindsight" ? "default" : null),
  };
}

function statusFrom(app, settings, matches = [], managed = null, platform = process.platform, error = null, extras = {}) {
  const configured = Boolean(settings?.executablePath);
  const errorMessage = error ? (error.message || String(error)) : null;
  const urls = app.type === "cli-daemon"
    ? (app.daemonKind === "langbot"
      ? langbotDaemonUrl(app, settings)
      : daemonUrl(app, settings, { llm: extras.llm }))
    : null;
  const plugin = app.type === "cli-daemon" ? (extras.plugin || null) : null;
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
      external: Boolean(app.daemonKind === "langbot" && matches.some((row) => row.external)),
    },
    llm: extras.llm || null,
    llmSource: extras.llmSource || null,
    embeddingSource: extras.embeddingSource || null,
    endpoints: urls ? {
      healthUrl: urls.healthUrl,
      appUrl: urls.appUrl || null,
      mcpUrl: urls.mcpUrl,
      port: urls.port,
    } : null,
    profileName: app.type === "cli-daemon" ? (settings?.profileName || app.profileName || "default") : null,
    configPath: app.type === "cli-daemon" ? (settings?.configPath || extras.configPath || null) : null,
    plugin,
    cwd: app.daemonKind === "langbot" ? settings?.cwd || null : null,
    dataRoot: app.daemonKind === "langbot" ? settings?.dataRoot || null : null,
    version: extras.version || null,
    installable: app.daemonKind === "langbot",
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
  homeDir = undefined,
  uvPath: uvPathValue,
  discovery = (app) => discoverCommandApp(app, { platform }),
  processStore = createCommandAppsProcessStore(),
  listProcesses = () => listWindowsProcesses(),
  terminateProcess,
  terminateUnixProcess = terminateUnixProcessGroup,
  spawnProcess = spawn,
  fileExists = (value) => fs.existsSync(value),
  readFile = (p) => fs.readFileSync(p, "utf8"),
  listHindsightProfiles = () => listHindsightProfileFiles(),
  readHindsightLlm = (profileName = "default") => publicLlmConfig(readHindsightConfig({ profileName })),
  writeHindsightLlm = (patch, profileName = "default") => writeHindsightLlmConfig(patch, { profileName }),
  readCodingAgentPlugin = () => readCodingAgentPluginConfig(),
  writeCodingAgentPlugin = (patch) => writeCodingAgentPluginConfig(patch),
  probeHindsight = (app, settings) => probeHindsightHealth(app, settings),
  inspectHindsight = (app, settings) => inspectHindsightDaemon(app, settings, { probe: probeHindsight }),
  startHindsight = (app, settings, options = {}) => startHindsightDaemon(app, settings, { timeoutMs: 180000, ...options }),
  stopHindsight = (app, settings, options = {}) => stopHindsightDaemon(app, settings, { timeoutMs: 20000, ...options }),
  probeLangbot = (app, settings) => probeLangBotHealth(app, settings),
  inspectLangbot = (app, settings) => inspectLangBotDaemon(app, settings, { probe: probeLangbot }),
  startLangbot = (app, settings, options = {}) => startLangBotDaemon(app, settings, options),
  stopLangbot = (app, settings, options = {}) => stopLangBotDaemon(app, settings, options),
  installLangbotTool: injectInstallLangbotTool = installLangBotTool,
  upgradeLangbotTool: injectUpgradeLangbotTool = upgradeLangBotTool,
  findUvDependency = findUv,
  uvPath = uvPathValue || findUvDependency(),
  installLangbotToolDependency = (...args) => injectInstallLangbotTool(...args),
  upgradeLangbotToolDependency = (...args) => injectUpgradeLangbotTool(...args),
  readLangbotVersion = (options) => installedLangBotVersion(options),
  daemonEnv = () => sanitizeDaemonEnv(),
  ensureControlPlane = ensureHindsightControlPlane,
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

  const normalizeConfig = (value) => normalizeCommandAppsConfig(value, { platform, ...(homeDir ? { homeDir } : {}) });
  const getConfig = () => normalizeConfig(configStore.get() || {});
  const saveConfig = (next) => configStore.save(next);
  const terminateProcessByPlatform = terminateProcess || (
    platform === "win32"
      ? (pid) => terminateProcessTree(pid)
      : terminateUnixProcess
  );

  function profileId(name = "default") {
    const normalized = normalizeHindsightProfileName(name);
    return normalized === "default" ? "hindsight" : `hindsight:${normalized}`;
  }

  function profileNameFromId(appId) {
    const value = String(appId || "");
    if (value === "hindsight") return "default";
    if (value.startsWith("hindsight:")) return normalizeHindsightProfileName(value.slice("hindsight:".length));
    return "default";
  }

  function discoveredProfiles() {
    try {
      return listHindsightProfiles();
    } catch {
      return [{ name: "default", configPath: defaultHindsightConfigPath(), port: 8888 }];
    }
  }

  function requireApp(appId) {
    const rawId = String(appId || "");
    const app = getCommandApp(rawId) || (rawId.startsWith("hindsight") ? getCommandApp("hindsight") : null);
    if (!app) {
      throw new CommandAppsError("app_not_found", `Unknown command app: ${appId}`);
    }
    if (app.id === "hindsight") {
      const name = profileNameFromId(rawId);
      return {
        ...app,
        id: profileId(name),
        profileName: name,
        displayName: name === "default" ? "Hindsight" : `Hindsight · ${name}`,
        command: name === "default" ? app.command : `hindsight-embed -p ${name} daemon start`,
      };
    }
    return app;
  }

  function settingsFor(app) {
    return getConfig().apps[app.id] || null;
  }

  function llmFor(app, profileName = "default") {
    if (app.type !== "cli-daemon") return null;
    try {
      return readHindsightLlm(profileName);
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

  function sourcesFor(profileName = "default") {
    const stored = getConfig().hindsightProfiles?.[normalizeHindsightProfileName(profileName)] || {};
    return {
      llmSource: stored.llmSource || null,
      embeddingSource: stored.embeddingSource || null,
    };
  }

  function daemonExtras(app, profileName = "default") {
    const name = profileName || app.profileName || "default";
    return {
      llm: llmFor(app, name),
      plugin: pluginBinding(name),
      ...sourcesFor(name),
    };
  }

  function pluginBinding(profileName = "default") {
    try {
      const plugin = readCodingAgentPlugin();
      if (!plugin?.exists) return null;
      const current = normalizeHindsightProfileName(profileName);
      return {
        exists: Boolean(plugin.exists),
        configPath: plugin.configPath || null,
        serverMode: plugin.serverMode,
        daemonProfile: plugin.daemonProfile,
        apiPort: plugin.apiPort,
        usedByCodex: normalizeHindsightProfileName(plugin.daemonProfile || "coding-agent") === current,
      };
    } catch {
      return null;
    }
  }

  function settingsWithProfile(app, profileName = "default") {
    const current = settingsFor({ id: "hindsight" }) || settingsFor(app) || {};
    const name = normalizeHindsightProfileName(profileName || app.profileName || "default");
    const stored = getConfig().hindsightProfiles?.[name] || {};
    return {
      ...current,
      profileName: name,
      port: stored.port || defaultHindsightPort(name),
      configPath: defaultHindsightConfigPath(undefined, name),
    };
  }

  function gatewayListenPort() {
    return Number(process.env.PORT || process.env.GATEWAY_PORT || 8787);
  }

  async function openHindsightControlPlane({ bankId = "coding-agent::local-ai-gateway", port } = {}) {
    const plugin = pluginBinding("coding-agent");
    const profileName = normalizeHindsightProfileName(plugin?.daemonProfile || "coding-agent");
    const apiPort = Number(plugin?.apiPort || defaultHindsightPort(profileName));
    const app = requireApp(profileId(profileName));
    const settings = settingsWithProfile(app, profileName);
    const healthy = await probeHindsight(app, settings);
    if (!healthy) {
      throw new CommandAppsError(
        "process_error",
        `Hindsight daemon is not healthy on port ${apiPort}. Start Hindsight before opening the memory page.`,
      );
    }
    const controlPlanePort = Number(port || process.env.HINDSIGHT_CONTROL_PLANE_PORT || 19078);
    return ensureControlPlane({
      apiUrl: `http://127.0.0.1:${apiPort}`,
      port: controlPlanePort,
      bankId,
    });
  }

  function gatewayBaseUrl(client, capability = "") {
    const host = process.env.GATEWAY_HOST || process.env.HOST || "127.0.0.1";
    const hostname = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
    const listenPort = gatewayListenPort();
    const preferredPort = Number(process.env.HINDSIGHT_GATEWAY_PORT || 8787);
    const port = listenPort === preferredPort ? listenPort : preferredPort;
    const suffix = capability ? `/${capability}` : "";
    return `http://${hostname}:${port}/${client}${suffix}/`;
  }

  function renderHindsightSources(config, profileName = "default") {
    const profile = config?.hindsightProfiles?.[profileName];
    if (!profile) return null;
    const patch = {};
    if (profile.llmSource?.type === "gateway") {
      patch.provider = "openai";
      patch.baseUrl = gatewayBaseUrl(profile.llmSource.client);
      patch.model = profile.llmSource.model;
      patch.apiKey = "all";
    }
    if (profile.embeddingSource?.type === "gateway") {
      patch.embeddingsProvider = "openai";
      patch.embeddingsModel = profile.embeddingSource.model;
      patch.embeddingsApiKey = "all";
    } else if (profile.embeddingSource?.type === "local") {
      patch.embeddingsProvider = "local";
      patch.embeddingsModel = "";
      patch.embeddingsApiKey = "";
    }
    return Object.keys(patch).length ? patch : null;
  }

  async function processMatchesFor(app, settings) {
    if (!settings?.executablePath || !app.supportedPlatforms.includes(platform)) return [];
    if (app.daemonKind === "langbot") {
      const inspected = await inspectLangbot(app, settings, { managedPid: processStore.get(app.id)?.pid });
      if (inspected.status === "stopped") return [];
      return [{
        pid: inspected.pid || processStore.get(app.id)?.pid || 0,
        createdAt: settings.lastLaunchedAt || null,
        launching: inspected.status === "launching",
        external: Boolean(inspected.managed) === false,
      }];
    }
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
      return validateAppSettings(app, current, { platform, fileExists, ...(homeDir ? { homeDir } : {}) });
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
    saveConfig(normalizeConfig(saved));
    return validateAppSettings(app, saved.apps[app.id], { platform, fileExists, ...(homeDir ? { homeDir } : {}) });
  }

  return {
    async listApps() {
      const apps = listCommandApps();
      const results = [];
      for (const app of apps) {
        if (app.id === "hindsight") {
          const names = discoveredProfiles().map((item) => item.name);
          if (!names.includes("default")) names.unshift("default");
          for (const name of names) {
            const id = profileId(name);
            try {
              results.push(await this.getStatus(id));
            } catch (error) {
              logger.warn?.(`[command-apps] Failed to get status for ${id}: ${error.message}`);
              const hindsightApp = requireApp(id);
              results.push(statusFrom(hindsightApp, settingsWithProfile(hindsightApp, name), [], processStore.get(id), platform, error, daemonExtras(hindsightApp, name)));
            }
          }
          continue;
        }
        try {
          results.push(await this.getStatus(app.id));
        } catch (error) {
          logger.warn?.(`[command-apps] Failed to get status for ${app.id}: ${error.message}`);
          results.push(statusFrom(app, settingsFor(app), [], processStore.get(app.id), platform, error, daemonExtras(app)));
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
        saveConfig(normalizeConfig(saved));
      }
      return result;
    },

    async getStatus(appId) {
      const app = requireApp(appId);
      if (!app.supportedPlatforms.includes(platform)) {
        return statusFrom(app, settingsWithProfile(app, app.profileName), [], null, platform, null, daemonExtras(app, app.profileName));
      }
      let settings = settingsFor(app);
      let loadError = null;
      if (!settings?.executablePath) {
        try {
          settings = await resolveExecutable(app);
        } catch (error) {
          if (error instanceof CommandAppsError && (error.code === "executable_not_found" || error.code === "unsupported_platform")) {
            return statusFrom(
              app,
              app.daemonKind === "langbot" ? (getConfig().apps[app.id] || {}) : null,
              [],
              processStore.get(app.id),
              platform,
              null,
              daemonExtras(app, app.profileName),
            );
          }
          loadError = error;
        }
      }
      let matches = [];
      if (app.profileName) settings = { ...settings, ...settingsWithProfile(app, app.profileName) };
      if (!loadError && settings?.executablePath) {
        try {
          matches = await processMatchesFor(app, settings);
        } catch (error) {
          loadError = error;
        }
      }
      const profileSettings = app.profileName ? { ...settings, ...settingsWithProfile(app, app.profileName) } : settings;
      return statusFrom(app, profileSettings, matches, processStore.get(app.id), platform, loadError, daemonExtras(app, app.profileName));
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
      if (app.daemonKind === "langbot") {
        const result = await startLangbot(app, settings, {
          spawnProcess,
          env: sanitizeLangBotEnv(),
          platform,
          probe: probeLangbot,
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
              cwd: settings.cwd,
              dataRoot: settings.dataRoot,
              port: settings.port,
              lastLaunchedAt: new Date().toISOString(),
            },
          },
        });
        return this.getStatus(app.id);
      }
      if (app.type === "cli-daemon") {
        const result = await startHindsight(app, { ...settings, ...settingsWithProfile(app, app.profileName) }, {
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

    openHindsightControlPlane,

    async installLangbot(appId = "langbot") {
      const app = requireApp(appId);
      if (app.daemonKind !== "langbot") {
        throw new CommandAppsError("invalid_request", "Only LangBot supports package installation");
      }
      const result = await installLangbotToolDependency({
        uvPath,
        discoverExecutable: async () => {
          const discovered = await discovery(app);
          return discovered?.selected?.path || null;
        },
      });
      const next = getConfig();
      saveConfig({
        ...next,
        apps: {
          ...next.apps,
          [app.id]: {
            ...next.apps[app.id],
            executablePath: result.executablePath,
            args: [...app.defaultArgs],
            manuallyConfigured: false,
            lastLaunchedAt: next.apps[app.id]?.lastLaunchedAt || null,
          },
        },
      });
      const status = await this.getStatus(app.id);
      return {
        ...status,
        version: result.version || await readLangbotVersion({ uvPath }),
      };
    },

    async updateLangbot(appId = "langbot") {
      const app = requireApp(appId);
      if (app.daemonKind !== "langbot") {
        throw new CommandAppsError("invalid_request", "Only LangBot supports package updates");
      }
      const settings = settingsFor(app) || {};
      const result = await upgradeLangbotToolDependency({
        uvPath,
        stop: async () => {
          if (!settings.executablePath) return;
          await stopLangbot(app, settings, {
            probe: probeLangbot,
            managedPid: processStore.get(app.id)?.pid,
            terminateProcess: terminateProcessByPlatform,
          });
          const managed = processStore.get(app.id);
          if (managed?.pid) processStore.clear(app.id, managed.pid);
        },
        discoverExecutable: async () => {
          const discovered = await discovery(app);
          return discovered?.selected?.path || null;
        },
      });
      const next = getConfig();
      saveConfig({
        ...next,
        apps: {
          ...next.apps,
          [app.id]: {
            ...next.apps[app.id],
            executablePath: result.executablePath,
            args: [...app.defaultArgs],
            manuallyConfigured: false,
            lastLaunchedAt: next.apps[app.id]?.lastLaunchedAt || null,
          },
        },
      });
      const status = await this.getStatus(app.id);
      return {
        ...status,
        version: result.version || await readLangbotVersion({ uvPath }),
      };
    },

    async stop(appId) {
      const app = requireApp(appId);
      const settings = settingsFor(app);
      if (app.daemonKind === "langbot") {
        await stopLangbot(app, settings, {
          probe: probeLangbot,
          managedPid: processStore.get(app.id)?.pid,
          terminateProcess: terminateProcessByPlatform,
        });
        const managed = processStore.get(app.id);
        if (managed?.pid) processStore.clear(app.id, managed.pid);
        return this.getStatus(app.id);
      }
      if (app.type === "cli-daemon") {
        await stopHindsight(app, { ...settings, ...settingsWithProfile(app, app.profileName) }, {
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
        await terminateProcessByPlatform(row.pid);
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
      let config = getConfig();
      if (app.type === "cli-daemon" && patch?.daemonProfile !== undefined) {
        writeCodingAgentPlugin({ daemonProfile: patch.daemonProfile });
        if (patch.executablePath === undefined && patch.llmSource === undefined && patch.llm === undefined) {
          return this.getStatus(app.id);
        }
      }
      const hasSourcePatch = patch?.llmSource !== undefined || patch?.embeddingSource !== undefined;
      if (app.type === "cli-daemon" && hasSourcePatch) {
        const name = profileNameFromId(appId);
        const profiles = {
          ...config.hindsightProfiles,
          [name]: {
            ...config.hindsightProfiles[name],
            displayName: config.hindsightProfiles[name]?.displayName || name,
            llmSource: patch.llmSource !== undefined ? patch.llmSource : config.hindsightProfiles[name]?.llmSource,
            embeddingSource: patch.embeddingSource !== undefined ? patch.embeddingSource : config.hindsightProfiles[name]?.embeddingSource,
          },
        };
        config = {
          ...config,
          hindsightProfiles: profiles,
        };
        const sourcePatch = renderHindsightSources(config, name);
        const llmPatch = patch?.llm || null;
        const llmSourceType = config.hindsightProfiles[name]?.llmSource?.type;
        const embeddingSourceType = config.hindsightProfiles[name]?.embeddingSource?.type;
        const safeLlmPatch = llmPatch ? { ...llmPatch } : null;
        if (safeLlmPatch && llmSourceType === "gateway") {
          delete safeLlmPatch.provider;
          delete safeLlmPatch.baseUrl;
          delete safeLlmPatch.model;
          delete safeLlmPatch.apiKey;
        }
        if (safeLlmPatch && embeddingSourceType === "local") {
          safeLlmPatch.embeddingsProvider = "local";
          safeLlmPatch.embeddingsModel = "";
          safeLlmPatch.embeddingsApiKey = "";
        } else if (safeLlmPatch && embeddingSourceType === "gateway") {
          delete safeLlmPatch.embeddingsProvider;
          delete safeLlmPatch.embeddingsModel;
          delete safeLlmPatch.embeddingsApiKey;
        }
        if (sourcePatch || safeLlmPatch) writeHindsightLlm({ ...(safeLlmPatch || {}), ...(sourcePatch || {}) }, name);
        saveConfig(config);
        if (patch.executablePath === undefined) return this.getStatus(app.id);
      }
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
        }, profileNameFromId(appId));
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
