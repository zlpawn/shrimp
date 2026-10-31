import { syncClaudeCodeSettings } from "../../../lib/config/claude-code-settings.mjs";

export function syncClaudeCodeSettingsIfEnabledInternal(config, { settingsPath } = {}) {
  if (config?.clients?.code?.sync_settings !== true) {
    return { updated: false, reason: "disabled-by-client-config" };
  }
  return syncClaudeCodeSettings({
    config,
    settingsPath,
    authToken: "all",
    gatewayBaseUrl: "http://127.0.0.1:8787/code",
  });
}
