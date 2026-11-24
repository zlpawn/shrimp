#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SHRIMP_DIR = path.join(os.homedir(), ".shrimp", "skills", "leo-workspace-router");
const CONFIG_FILE = path.join(SHRIMP_DIR, "config.json");
const LEGACY_HOSTS_FILE = path.join(SHRIMP_DIR, "hosts.json");

/**
 * Resolve ~ to home directory and normalize path
 */
export function resolvePath(p) {
  if (!p) return "";
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

/**
 * Ensure storage directory and config.json exist with strict 0600 permissions
 */
export function ensureConfig() {
  if (!fs.existsSync(SHRIMP_DIR)) {
    fs.mkdirSync(SHRIMP_DIR, { recursive: true, mode: 0o700 });
  }

  // Handle migration from legacy hosts.json if config.json does not exist yet
  let migratedData = null;
  if (!fs.existsSync(CONFIG_FILE) && fs.existsSync(LEGACY_HOSTS_FILE)) {
    try {
      const rawLegacy = fs.readFileSync(LEGACY_HOSTS_FILE, "utf-8");
      migratedData = JSON.parse(rawLegacy);
    } catch {}
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    const initial = {
      version: 1,
      binDir: "~/.local/bin",
      dataDir: "~/.shrimp/skills/leo-workspace-router/data",
      default_host: migratedData?.default_host || null,
      hosts: migratedData?.hosts || {},
      sessions: migratedData?.sessions || {}
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initial, null, 2), { mode: 0o600 });
  } else {
    try {
      if (process.platform !== "win32") {
        fs.chmodSync(CONFIG_FILE, 0o600);
      }
    } catch {}
  }
}

/**
 * Load raw config
 */
export function loadConfig() {
  ensureConfig();
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.binDir) parsed.binDir = "~/.local/bin";
    if (!parsed.dataDir) parsed.dataDir = "~/.shrimp/skills/leo-workspace-router/data";
    return parsed;
  } catch (err) {
    return {
      version: 1,
      binDir: "~/.local/bin",
      dataDir: "~/.shrimp/skills/leo-workspace-router/data",
      default_host: null,
      hosts: {},
      sessions: {}
    };
  }
}

/**
 * Save config safely
 */
export function saveConfig(cfg) {
  ensureConfig();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/**
 * Get resolved binary directory (ensures it exists on disk)
 */
export function getBinDir() {
  const cfg = loadConfig();
  const resolved = resolvePath(cfg.binDir || "~/.local/bin");
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o755 });
  }
  return resolved;
}

/**
 * Get resolved data directory for a specific engine (ensures namespace isolation)
 * Example: ~/.shrimp/skills/leo-workspace-router/data/mutagen
 * Example: ~/.shrimp/skills/leo-workspace-router/data/cloudflare
 */
export function getEngineDataDir(engine = "mutagen") {
  const cfg = loadConfig();
  const rootDataDir = resolvePath(cfg.dataDir || "~/.shrimp/skills/leo-workspace-router/data");
  const engineDir = path.join(rootDataDir, engine);
  if (!fs.existsSync(engineDir)) {
    fs.mkdirSync(engineDir, { recursive: true, mode: 0o700 });
  }
  return engineDir;
}

/**
 * Get host by alias (returns password for internal script use)
 */
export function getHost(alias) {
  const cfg = loadConfig();
  const target = alias || cfg.default_host;
  if (!target) return null;
  return cfg.hosts[target] || null;
}

/**
 * Get masked host for display (password masked as '******')
 */
export function getMaskedHosts() {
  const cfg = loadConfig();
  const out = {};
  for (const [key, val] of Object.entries(cfg.hosts || {})) {
    out[key] = {
      ...val,
      password: val.password ? "******" : undefined
    };
  }
  return {
    binDir: cfg.binDir,
    dataDir: cfg.dataDir,
    default_host: cfg.default_host,
    hosts: out
  };
}

/**
 * Add or update a host
 */
export function setHost(alias, { host, port = 22, username, password, identityFile, description }) {
  if (!alias || !host || !username) {
    throw new Error("Alias, host (IP/domain), and username are required");
  }
  const cfg = loadConfig();
  if (!cfg.hosts) cfg.hosts = {};

  const existing = cfg.hosts[alias] || {};
  cfg.hosts[alias] = {
    alias,
    host,
    port: Number(port) || 22,
    username,
    auth_type: password ? "password" : (identityFile ? "key" : "default"),
    password: password || existing.password || undefined,
    identityFile: identityFile || existing.identityFile || undefined,
    description: description || existing.description || "",
    updated_at: new Date().toISOString()
  };

  if (!cfg.default_host) {
    cfg.default_host = alias;
  }

  saveConfig(cfg);
  return getMaskedHosts().hosts[alias];
}

/**
 * Remove a host
 */
export function removeHost(alias) {
  const cfg = loadConfig();
  if (!cfg.hosts || !cfg.hosts[alias]) return false;
  delete cfg.hosts[alias];
  if (cfg.default_host === alias) {
    const remaining = Object.keys(cfg.hosts);
    cfg.default_host = remaining.length > 0 ? remaining[0] : null;
  }
  saveConfig(cfg);
  return true;
}

// CLI handler if executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [,, cmd, ...args] = process.argv;
  if (cmd === "list") {
    console.log(JSON.stringify(getMaskedHosts(), null, 2));
  } else if (cmd === "get") {
    const alias = args[0];
    const h = getHost(alias);
    if (h) {
      const masked = { ...h, password: h.password ? "******" : undefined };
      console.log(JSON.stringify(masked, null, 2));
    } else {
      console.error(`Host '${alias}' not found.`);
      process.exit(1);
    }
  } else if (cmd === "remove") {
    const alias = args[0];
    if (removeHost(alias)) {
      console.log(`Host '${alias}' removed.`);
    } else {
      console.error(`Host '${alias}' not found.`);
      process.exit(1);
    }
  } else {
    console.log("Usage: node scripts/config.mjs [list|get <alias>|remove <alias>]");
  }
}
