import path from "node:path";
import os from "node:os";
import { CommandAppsError } from "./errors.mjs";
import { listCommandApps } from "./registry.mjs";

function normalizeSettings(app, raw = {}) {
  const executablePath = String(raw.executablePath || "").trim();
  const lastLaunchedAt = String(raw.lastLaunchedAt || "").trim();
  return {
    executablePath,
    args: [...app.defaultArgs],
    manuallyConfigured: Boolean(raw.manuallyConfigured),
    lastLaunchedAt: lastLaunchedAt || null,
  };
}

function normalizeLangBotSettings(app, raw = {}, { homeDir = os.homedir() } = {}) {
  const defaultCwd = path.join(homeDir, ".langbot");
  const port = Number(raw.port);
  return {
    executablePath: String(raw.executablePath || "").trim(),
    args: [...app.defaultArgs],
    manuallyConfigured: Boolean(raw.manuallyConfigured),
    lastLaunchedAt: String(raw.lastLaunchedAt || "").trim() || null,
    cwd: String(raw.cwd || defaultCwd).trim() || defaultCwd,
    dataRoot: String(raw.dataRoot || path.join(defaultCwd, "data")).trim() || path.join(defaultCwd, "data"),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : app.defaultPort,
  };
}

function normalizeSource(raw = {}) {
  const type = String(raw?.type || "custom").trim() || "custom";
  if (!["custom", "gateway", "local"].includes(type)) return null;
  return {
    type,
    client: String(raw?.client || "").trim(),
    endpointId: String(raw?.endpointId || "").trim() || null,
    model: String(raw?.model || "").trim(),
  };
}

function normalizeHindsightProfiles(raw = {}) {
  const profiles = {};
  for (const [name, value] of Object.entries(raw || {})) {
    const profileName = String(name || "").trim();
    if (!profileName) continue;
    profiles[profileName] = {
      displayName: String(value?.displayName || profileName).trim(),
      port: Number.isInteger(value?.port) && value.port > 0 && value.port < 65536 ? value.port : null,
      llmSource: normalizeSource(value?.llmSource),
      embeddingSource: normalizeSource(value?.embeddingSource),
    };
  }
  if (!profiles.default) {
    profiles.default = {
      displayName: "default",
      port: null,
      llmSource: null,
      embeddingSource: null,
    };
  }
  return profiles;
}

export function normalizeCommandAppsConfig(input = {}, { platform = process.platform, homeDir } = {}) {
  const apps = {};
  for (const app of listCommandApps()) {
    const configured = app.supportedPlatforms.includes(platform);
    const raw = input?.apps?.[app.id] || {};
    if (!configured && !raw.executablePath) continue;
    apps[app.id] = app.daemonKind === "langbot"
      ? normalizeLangBotSettings(app, raw, { homeDir })
      : normalizeSettings(app, raw);
  }
  return {
    apps,
    hindsightProfiles: normalizeHindsightProfiles(input?.hindsightProfiles),
  };
}

export function validateAppSettings(app, settings = {}, {
  platform = process.platform,
  fileExists = (candidate) => false,
  homeDir,
} = {}) {
  if (!app) {
    throw new CommandAppsError("app_not_found", "Unknown command app");
  }
  if (!app.supportedPlatforms.includes(platform)) {
    throw new CommandAppsError(
      "unsupported_platform",
      `${app.displayName} is not supported on ${platform}`,
    );
  }

  const executablePath = String(settings.executablePath || "").trim();
  if (!executablePath) {
    throw new CommandAppsError(
      "invalid_request",
      "executablePath is required",
      { field: "executablePath" },
    );
  }
  const pathLib = platform === "win32" ? path.win32 : path.posix;
  const isAbs = pathLib.isAbsolute(executablePath) || path.win32.isAbsolute(executablePath) || path.posix.isAbsolute(executablePath);
  if (!isAbs) {
    throw new CommandAppsError(
      "invalid_request",
      "executablePath must be an absolute path",
      { field: "executablePath", value: executablePath },
    );
  }
  if (app.type === "project") {
    if (!fileExists(executablePath)) {
      throw new CommandAppsError(
        "executable_not_found",
        "Project directory does not exist",
        { field: "executablePath", value: executablePath },
      );
    }
    const pkgPath = pathLib.join(executablePath, "package.json");
    if (!fileExists(pkgPath) && !fileExists(path.join(executablePath, "package.json"))) {
      throw new CommandAppsError(
        "invalid_request",
        "Directory does not contain package.json",
        { field: "executablePath", value: executablePath },
      );
    }
  } else if (app.type === "cli-daemon") {
    const expectedName = String(app.executableName || "").toLowerCase();
    const actualName = pathLib.basename(executablePath).toLowerCase();
    const winName = expectedName ? `${expectedName}.exe` : "";
    if (expectedName && actualName !== expectedName && actualName !== winName) {
      throw new CommandAppsError(
        "invalid_request",
        `executablePath must point to ${app.executableName}`,
        { field: "executablePath", value: executablePath },
      );
    }
    if (!fileExists(executablePath)) {
      throw new CommandAppsError(
        "executable_not_found",
        "CLI executable does not exist",
        { field: "executablePath", value: executablePath },
      );
    }
  } else {
    if (platform === "win32" && pathLib.extname(executablePath).toLowerCase() !== ".exe") {
      throw new CommandAppsError(
        "invalid_request",
        "executablePath must point to a Windows .exe file",
        { field: "executablePath", value: executablePath },
      );
    }
    if (!fileExists(executablePath)) {
      throw new CommandAppsError(
        "executable_not_found",
        "Executable does not exist",
        { field: "executablePath", value: executablePath },
      );
    }
  }

  if (app.daemonKind === "langbot") {
    return normalizeLangBotSettings(app, {
      ...settings,
      executablePath,
    }, { homeDir });
  }

  return {
    executablePath,
    args: [...app.defaultArgs],
    manuallyConfigured: Boolean(settings.manuallyConfigured),
    lastLaunchedAt: settings.lastLaunchedAt || null,
  };
}
