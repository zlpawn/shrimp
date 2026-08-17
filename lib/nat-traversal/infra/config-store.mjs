import fs from "node:fs";
import path from "node:path";
import {
  defaultNatTraversalConfig,
  normalizeNatTraversalConfig,
} from "../domain/config-schema.mjs";

function readJson(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const content = JSON.stringify(data, null, 2) + "\n";
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch (err) {
    console.error("Failed to write JSON to " + filePath + ":", err);
    return false;
  }
}

export function createNatTraversalConfigStore({
  configPath,
  legacyConfigPath,
} = {}) {
  return {
    get() {
      let cfg = readJson(configPath, null);
      if (!cfg && legacyConfigPath) {
        const legacy = readJson(legacyConfigPath, null);
        if (legacy?.natTraversal) {
          cfg = legacy.natTraversal;
        }
      }
      if (!cfg) {
        cfg = defaultNatTraversalConfig();
      }
      return normalizeNatTraversalConfig(cfg);
    },
    save(next) {
      const normalized = normalizeNatTraversalConfig(next);
      if (configPath) {
        writeJson(configPath, normalized);
      }
    },
  };
}
