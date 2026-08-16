import os from "node:os";
import path from "node:path";
import { codexAdapter } from "./codex.mjs";
import { createJsonClientAdapter } from "./json-client.mjs";

const claudeDesktopAdapter = createJsonClientAdapter({
  id: "claude",
  label: "Claude Desktop",
  defaultPath(home, platform) {
    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      return path.join(appData, "Claude", "claude_desktop_config.json");
    }
    if (platform === "darwin") {
      return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    }
    return path.join(home, ".config", "Claude", "claude_desktop_config.json");
  },
});

const claudeCodeAdapter = createJsonClientAdapter({
  id: "claude_code",
  label: "Claude Code",
  defaultPath(home) {
    return path.join(home, ".claude.json");
  },
});

const antigravityAdapter = createJsonClientAdapter({
  id: "antigravity",
  label: "Google Antigravity",
  defaultPath(home) {
    return path.join(home, ".gemini", "config", "mcp_config.json");
  },
});

const adapters = [codexAdapter, claudeDesktopAdapter, claudeCodeAdapter, antigravityAdapter];
const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));

export function listClientAdapters() {
  return adapters;
}

export function getClientAdapter(id) {
  return byId.get(String(id || "")) || null;
}
