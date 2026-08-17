import path from "node:path";
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

export function normalizeCommandAppsConfig(input = {}, { platform = process.platform } = {}) {
  const apps = {};
  for (const app of listCommandApps()) {
    const configured = app.supportedPlatforms.includes(platform);
    const raw = input?.apps?.[app.id] || {};
    if (!configured && !raw.executablePath) continue;
    apps[app.id] = normalizeSettings(app, raw);
  }
  return { apps };
}

export function validateAppSettings(app, settings = {}, {
  platform = process.platform,
  fileExists = (candidate) => false,
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
  if (!path.isAbsolute(executablePath)) {
    throw new CommandAppsError(
      "invalid_request",
      "executablePath must be an absolute path",
      { field: "executablePath", value: executablePath },
    );
  }
  if (path.extname(executablePath).toLowerCase() !== ".exe") {
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

  return {
    executablePath,
    args: [...app.defaultArgs],
    manuallyConfigured: Boolean(settings.manuallyConfigured),
    lastLaunchedAt: settings.lastLaunchedAt || null,
  };
}
