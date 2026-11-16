import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Returns the path to the configuration file.
 * Defaults to ~/.shrimp/skills/leo-musicdl/config.json
 */
export function getConfigPath() {
  if (process.env.LEO_MUSICDL_CONFIG_PATH) {
    return path.resolve(process.env.LEO_MUSICDL_CONFIG_PATH);
  }
  return path.join(os.homedir(), ".shrimp", "skills", "leo-musicdl", "config.json");
}

/**
 * Returns default fallback output directory: ./downloads/music
 */
export function getDefaultOutputDir() {
  return path.resolve(process.cwd(), "downloads", "music");
}

/**
 * Reads configuration from ~/.shrimp/skills/leo-musicdl/config.json.
 * Returns default config object if not present.
 */
export function readConfig() {
  const cfgPath = getConfigPath();
  const defaults = {
    output_dir: "",
    folder_structure: "smart", // "smart" | "flat" | "artist_album"
    updated_at: null,
  };

  if (!fs.existsSync(cfgPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(cfgPath, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch (err) {
    console.warn(`[leo-musicdl] Failed to parse config at ${cfgPath}, using defaults:`, err.message);
    return defaults;
  }
}

/**
 * Writes or patches configuration to ~/.shrimp/skills/leo-musicdl/config.json.
 */
export function writeConfig(patch) {
  const cfgPath = getConfigPath();
  const dir = path.dirname(cfgPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const current = readConfig();
  const updated = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  fs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

/**
 * Resolves the effective output directory:
 * 1. CLI / Explicitly specified path (highest priority; saves to config if provided)
 * 2. Stored config output_dir (from ~/.shrimp/skills/leo-musicdl/config.json)
 * 3. Default fallback (./downloads/music)
 */
export function resolveOutputDir(cliDir = "") {
  if (cliDir && typeof cliDir === "string" && cliDir.trim()) {
    const resolved = path.resolve(cliDir.trim());
    writeConfig({ output_dir: resolved });
    return resolved;
  }

  const cfg = readConfig();
  if (cfg.output_dir && typeof cfg.output_dir === "string" && cfg.output_dir.trim()) {
    return path.resolve(cfg.output_dir.trim());
  }

  return getDefaultOutputDir();
}

// CLI Direct Execution Support
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  if (args.includes("--get-dir") || args.length === 0) {
    console.log(resolveOutputDir());
  } else if (args[0] === "--set-dir" && args[1]) {
    const saved = writeConfig({ output_dir: path.resolve(args[1]) });
    console.log(`[leo-musicdl] Output directory updated: ${saved.output_dir}`);
  } else if (args[0] === "--show-config") {
    console.log(JSON.stringify(readConfig(), null, 2));
  } else {
    console.log("Usage: node config.mjs [--get-dir | --set-dir <path> | --show-config]");
  }
}
