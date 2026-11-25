#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function findShrimpRoot() {
  let curr = __dirname;
  while (curr && curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, "lib", "skills", "leo-to-skill-router"))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return path.resolve(__dirname, "../../../..");
}

export function detectDefaultSkillsDir() {
  const shrimpRoot = findShrimpRoot();
  const libSkills = path.join(shrimpRoot, "lib", "skills");
  if (fs.existsSync(libSkills)) {
    return libSkills;
  }
  const parent = path.dirname(path.dirname(__dirname));
  if (path.basename(parent) === "skills" && fs.existsSync(parent)) {
    return parent;
  }
  const cwdSkills = path.join(process.cwd(), ".agents", "skills");
  if (fs.existsSync(cwdSkills)) {
    return cwdSkills;
  }
  return path.join(os.homedir(), ".agents", "skills");
}

const SHRIMP_ROOT = findShrimpRoot();

export function getConfigPath() {
  if (process.env.LEO_TO_SKILL_ROUTER_CONFIG_PATH) {
    return path.resolve(process.env.LEO_TO_SKILL_ROUTER_CONFIG_PATH);
  }
  return path.join(os.homedir(), ".shrimp", "skills", "leo-to-skill-router", "config.json");
}

export function getDefaultConfig() {
  const defaultOutputDir = detectDefaultSkillsDir();
  const defaultArtifactsDir = path.join(os.homedir(), "素材", "to-skill");
  const defaultVenvPath = path.join(os.homedir(), ".shrimp", "skills", "leo-to-skill-router", ".venv");

  return {
    output_skills_dir: defaultOutputDir,
    artifacts_dir: defaultArtifactsDir,
    python_venv_path: defaultVenvPath,
    auto_clean_media: false,
    default_book_type: "technical",
    updated_at: new Date().toISOString(),
  };
}

export function readConfig() {
  const configPath = getConfigPath();
  const defaults = getDefaultConfig();
  if (!fs.existsSync(configPath)) {
    return defaults;
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
    };
  } catch (err) {
    console.error(`[warn] Failed to read config from ${configPath}: ${err.message}`);
    return defaults;
  }
}

export function saveConfig(patch) {
  const configPath = getConfigPath();
  const current = readConfig();
  const updated = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf8");
  return updated;
}

export function resolveOutputDir(customDir) {
  if (customDir && typeof customDir === "string" && customDir.trim().length > 0) {
    const resolved = customDir.startsWith("~")
      ? path.join(os.homedir(), customDir.slice(1))
      : path.resolve(customDir);
    return resolved;
  }
  const cfg = readConfig();
  const dir = cfg.output_skills_dir || detectDefaultSkillsDir();
  return dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : path.resolve(dir);
}

export function getTodayDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatArtifactsFolderName(slug, dateStr = "") {
  if (!slug || typeof slug !== "string") return "";
  const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (/^\d{4}-\d{2}-\d{2}/.test(cleanSlug)) {
    return cleanSlug;
  }
  const date = dateStr || getTodayDateString();
  return `${date}-${cleanSlug}`;
}

export function resolveArtifactsDir(customDir, slug = "", dateStr = "") {
  let baseDir;
  if (customDir && typeof customDir === "string" && customDir.trim().length > 0) {
    baseDir = customDir.startsWith("~")
      ? path.join(os.homedir(), customDir.slice(1))
      : path.resolve(customDir);
  } else {
    const cfg = readConfig();
    const dir = cfg.artifacts_dir || path.join(os.homedir(), "素材", "to-skill");
    baseDir = dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : path.resolve(dir);
  }

  if (slug && slug.trim().length > 0) {
    const folderName = formatArtifactsFolderName(slug, dateStr);
    return path.join(baseDir, folderName);
  }
  return baseDir;
}

function parseCliArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--output-dir" && i + 1 < args.length) {
      options.output_skills_dir = args[++i];
    } else if (arg === "--artifacts-dir" && i + 1 < args.length) {
      options.artifacts_dir = args[++i];
    } else if (arg === "--venv-path" && i + 1 < args.length) {
      options.python_venv_path = args[++i];
    } else if (arg === "--auto-clean" && i + 1 < args.length) {
      options.auto_clean_media = args[++i] === "true";
    }
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const command = process.argv[2] || "status";
  if (command === "status") {
    const cfg = readConfig();
    console.log(JSON.stringify(cfg, null, 2));
  } else if (command === "set") {
    const options = parseCliArgs(process.argv.slice(3));
    const saved = saveConfig(options);
    console.log("Config updated successfully:");
    console.log(JSON.stringify(saved, null, 2));
  } else {
    console.error(`Unknown command: ${command}. Usage: node config.mjs [status|set --output-dir <path> --artifacts-dir <path>]`);
    process.exit(1);
  }
}
