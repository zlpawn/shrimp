import fs from "node:fs";
import path from "node:path";
import { McpManagementError } from "./domain/errors.mjs";
import { normalizeMcpConfig, normalizeMcpSecrets } from "./domain/schema.mjs";

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(filePath, value, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\\n", { mode });
  fs.renameSync(tmp, filePath);
}

export function createMcpStore({ configPath, secretsPath }) {
  const fallbackConfig = normalizeMcpConfig({});
  const fallbackSecrets = normalizeMcpSecrets({});

  function load() {
    let config;
    try {
      config = normalizeMcpConfig(readJson(configPath, fallbackConfig));
    } catch (error) {
      if (error instanceof McpManagementError) throw error;
      throw new McpManagementError("storage_error", "无法读取 mcp.config.json", { reason: error.message });
    }
    return {
      config,
      secrets: normalizeMcpSecrets(readJson(secretsPath, fallbackSecrets)),
    };
  }

  function saveConfig(config) {
    const normalized = normalizeMcpConfig(config);
    writeJson(configPath, normalized, 0o644);
    return normalized;
  }

  function saveSecrets(secrets) {
    const normalized = normalizeMcpSecrets(secrets);
    writeJson(secretsPath, normalized, 0o600);
    return normalized;
  }

  return { load, saveConfig, saveSecrets, configPath, secretsPath };
}

