import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexAdapter } from "./codex.mjs";
import { createJsonClientAdapter } from "./json-client.mjs";

const claudeDesktopAdapter = createJsonClientAdapter({
  id: "claude",
  label: "Claude Desktop",
  listKey: "managedMcpServers",
  entryFormat: "array",
  defaultPath(home, platform) {
    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      return path.join(appData, "Claude", "claude_desktop_config.json");
    }
    if (platform === "darwin") {
      const configLibrary = path.join(home, "Library", "Application Support", "Claude-3p", "configLibrary");
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(configLibrary, "_meta.json"), "utf8"));
        const appliedId = meta?.appliedId || meta?.entries?.find((entry) => entry?.id)?.id;
        return appliedId
          ? path.join(configLibrary, appliedId + ".json")
          : path.join(configLibrary, "claude_desktop_config.json");
      } catch {
        return path.join(configLibrary, "claude_desktop_config.json");
      }
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

function createCustomAdapter(client) {
  const stripped = String(client || "").replace(/[-_]/g, "");
  return createJsonClientAdapter({
    id: client,
    label: client,
    listKey: "mcpServers",
    entryFormat: "object",
    defaultPath(home) {
      return path.join(home, `.${stripped}`, "mcp.json");
    },
  });
}

export function listClientAdapters(customClientIds = []) {
  const custom = Array.isArray(customClientIds) ? customClientIds : [];
  const list = [...adapters];
  for (const id of custom) {
    const cleanId = String(id || "").trim();
    if (cleanId && !byId.has(cleanId)) {
      list.push(getClientAdapter(cleanId));
    }
  }
  return list;
}

export function getClientAdapter(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  if (byId.has(key)) return byId.get(key);
  return createCustomAdapter(key);
}
