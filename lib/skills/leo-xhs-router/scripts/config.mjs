import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Returns the path to the configuration file.
 * Defaults to ~/.shrimp/skills/leo-xhs-router/config.json
 */
export function getConfigPath() {
  if (process.env.LEO_XHS_CONFIG_PATH) {
    return path.resolve(process.env.LEO_XHS_CONFIG_PATH);
  }
  return path.join(os.homedir(), ".shrimp", "skills", "leo-xhs-router", "config.json");
}

/**
 * Returns default fallback output directory: ~/.shrimp/skills/leo-xhs-router/output
 */
export function getDefaultOutputDir() {
  return path.join(os.homedir(), ".shrimp", "skills", "leo-xhs-router", "output");
}

/**
 * Reads configuration from ~/.shrimp/skills/leo-xhs-router/config.json.
 * Returns default config object if not present.
 */
export function readConfig() {
  const cfgPath = getConfigPath();
  const defaults = {
    source_repo_dir: "",
    workspace_dir: "",
    default_image_engine: "leo-codex-imagine",
    auto_publish: false,
    updated_at: null,
  };

  if (!fs.existsSync(cfgPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch (err) {
    console.warn(`[leo-xhs-router] Failed to parse config at ${cfgPath}, using defaults:`, err.message);
    return defaults;
  }
}

/**
 * Writes configuration to ~/.shrimp/skills/leo-xhs-router/config.json
 */
export function writeConfig(config) {
  const cfgPath = getConfigPath();
  const dir = path.dirname(cfgPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = {
    ...config,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(cfgPath, JSON.stringify(payload, null, 2), "utf-8");
  return payload;
}

/**
 * Updates partial configuration fields and persists.
 */
export function updateConfig(partial) {
  const current = readConfig();
  const merged = { ...current, ...partial };
  return writeConfig(merged);
}

/**
 * Resolves effective workspace directory with smart persistence:
 * 1. If user explicitly specified a directory:
 *    - persists to config.json as workspace_dir
 *    - returns { dir: userSpecifiedDir, source: "user_specified", persisted: true }
 * 2. Else if config has workspace_dir:
 *    - returns { dir: config.workspace_dir, source: "config", persisted: false }
 * 3. Else fallback to ~/.shrimp/skills/leo-xhs-router/output:
 *    - returns { dir: defaultOutputDir, source: "default", persisted: false }
 */
export function resolveWorkspaceDir(userSpecifiedDir = null) {
  if (userSpecifiedDir && typeof userSpecifiedDir === "string" && userSpecifiedDir.trim()) {
    const resolved = path.resolve(userSpecifiedDir.trim());
    updateConfig({ workspace_dir: resolved });
    return { dir: resolved, source: "user_specified", persisted: true };
  }

  const cfg = readConfig();
  if (cfg.workspace_dir && typeof cfg.workspace_dir === "string" && cfg.workspace_dir.trim()) {
    return { dir: path.resolve(cfg.workspace_dir.trim()), source: "config", persisted: false };
  }

  const defDir = getDefaultOutputDir();
  return { dir: defDir, source: "default", persisted: false };
}

/**
 * Formats a topic into standard YYYY-MM-DD-topic folder name.
 */
export function formatPostFolderName(topic, date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const datePrefix = `${yyyy}-${mm}-${dd}`;

  const topicBase = path.basename((topic || "未命名笔记").trim());
  const cleanTopic = topicBase
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

  // If topic already starts with YYYY-MM-DD, keep it
  if (/^\d{4}-\d{2}-\d{2}/.test(cleanTopic)) {
    return cleanTopic;
  }
  return `${datePrefix}-${cleanTopic}`;
}

/**
 * Resolves standard post directory path under the effective workspace.
 */
export function resolvePostDir(topic, userSpecifiedDir = null, date = new Date()) {
  const ws = resolveWorkspaceDir(userSpecifiedDir);
  const folderName = formatPostFolderName(topic, date);
  const postPath = path.join(ws.dir, folderName);
  return {
    postPath,
    folderName,
    workspaceDir: ws.dir,
    workspaceSource: ws.source,
    persisted: ws.persisted,
  };
}
