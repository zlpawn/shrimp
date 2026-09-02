import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CommandAppsError } from "../domain/errors.mjs";

const LLM_KEYS = Object.freeze({
  provider: "HINDSIGHT_API_LLM_PROVIDER",
  baseUrl: "HINDSIGHT_API_LLM_BASE_URL",
  apiKey: "HINDSIGHT_API_LLM_API_KEY",
  model: "HINDSIGHT_API_LLM_MODEL",
});

const OPTION_KEYS = Object.freeze({
  host: "HINDSIGHT_API_HOST",
  port: "HINDSIGHT_API_PORT",
  logLevel: "HINDSIGHT_API_LOG_LEVEL",
  reasoningEffort: "HINDSIGHT_API_LLM_REASONING_EFFORT",
  temperature: "HINDSIGHT_API_LLM_TEMPERATURE",
  strictSchema: "HINDSIGHT_API_LLM_STRICT_SCHEMA",
  embeddingsProvider: "HINDSIGHT_API_EMBEDDINGS_PROVIDER",
  embeddingsModel: "HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL",
  embeddingsApiKey: "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY",
  rerankerProvider: "HINDSIGHT_API_RERANKER_PROVIDER",
  rerankerModel: "HINDSIGHT_API_RERANKER_SILICONFLOW_MODEL",
});

const UNCHANGED_API_KEY = "__unchanged__";
const SECRET_FIELDS = new Set(["embeddingsApiKey"]);

export function defaultHindsightHome(homeDir = os.homedir()) {
  return path.join(homeDir, ".hindsight");
}

export function normalizeHindsightProfileName(name = "default") {
  const value = String(name || "default").trim() || "default";
  return value === "default" ? "default" : value;
}

export function defaultHindsightConfigPath(homeDir = os.homedir(), profileName = "default") {
  const home = defaultHindsightHome(homeDir);
  const name = normalizeHindsightProfileName(profileName);
  return name === "default" ? path.join(home, "embed") : path.join(home, "profiles", `${name}.env`);
}

export function defaultHindsightLockPath(homeDir = os.homedir(), profileName = "default") {
  const home = defaultHindsightHome(homeDir);
  const name = normalizeHindsightProfileName(profileName);
  return name === "default" ? path.join(home, "daemon.lock.owner") : path.join(home, "profiles", `${name}.lock.owner`);
}

export function defaultHindsightLogPath(homeDir = os.homedir(), profileName = "default") {
  const home = defaultHindsightHome(homeDir);
  const name = normalizeHindsightProfileName(profileName);
  return name === "default" ? path.join(home, "daemon.log") : path.join(home, "profiles", `${name}.log`);
}

export function defaultHindsightPort(profileName = "default", configuredPort = null) {
  const port = Number(configuredPort);
  if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  const name = normalizeHindsightProfileName(profileName);
  if (name === "coding-agent") return 9077;
  return 8888;
}

export function codingAgentConfigPath(homeDir = os.homedir()) {
  return path.join(defaultHindsightHome(homeDir), "coding-agent.json");
}

export function readCodingAgentPluginConfig({
  homeDir = os.homedir(),
  fileExists = (filePath) => fs.existsSync(filePath),
  readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
} = {}) {
  const configPath = codingAgentConfigPath(homeDir);
  if (!fileExists(configPath)) {
    return {
      exists: false,
      configPath,
      serverMode: null,
      daemonProfile: "coding-agent",
      apiPort: 9077,
    };
  }
  try {
    const raw = JSON.parse(readFile(configPath) || "{}") || {};
    const daemonProfile = normalizeHindsightProfileName(raw.daemonProfile || "coding-agent");
    const apiPort = Number(raw.apiPort);
    return {
      exists: true,
      configPath,
      serverMode: raw.serverMode || "daemon",
      daemonProfile,
      apiPort: Number.isInteger(apiPort) && apiPort > 0 && apiPort < 65536 ? apiPort : defaultHindsightPort(daemonProfile),
    };
  } catch (error) {
    throw new CommandAppsError("storage_error", "Failed to read coding-agent.json", {
      reason: error.message,
    });
  }
}

export function writeCodingAgentPluginConfig(patch = {}, {
  homeDir = os.homedir(),
  fileExists = (filePath) => fs.existsSync(filePath),
  readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
  writeFile = (filePath, content) => fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 }),
} = {}) {
  const current = readCodingAgentPluginConfig({ homeDir, fileExists, readFile });
  const next = {
    serverMode: patch.serverMode !== undefined ? patch.serverMode : (current.serverMode || "daemon"),
    daemonProfile: patch.daemonProfile !== undefined
      ? normalizeHindsightProfileName(patch.daemonProfile)
      : current.daemonProfile,
    apiPort: patch.apiPort !== undefined ? Number(patch.apiPort) : current.apiPort,
  };
  if (!Number.isInteger(next.apiPort) || next.apiPort <= 0 || next.apiPort >= 65536) {
    next.apiPort = defaultHindsightPort(next.daemonProfile);
  }
  const body = {};
  if (fileExists(current.configPath)) {
    try { Object.assign(body, JSON.parse(readFile(current.configPath) || "{}") || {}); } catch {}
  }
  body.serverMode = next.serverMode;
  body.daemonProfile = next.daemonProfile;
  body.apiPort = next.apiPort;
  writeFile(current.configPath, `${JSON.stringify(body, null, 2)}
`);
  return readCodingAgentPluginConfig({ homeDir, fileExists, readFile });
}

export function listHindsightProfileFiles({
  homeDir = os.homedir(),
  fileExists = (filePath) => fs.existsSync(filePath),
  readDir = (dirPath) => fs.readdirSync(dirPath),
  readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
} = {}) {
  const home = defaultHindsightHome(homeDir);
  const profiles = [];
  const seen = new Set();
  function add(name, extra = {}) {
    const normalized = normalizeHindsightProfileName(name);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    profiles.push({
      name: normalized,
      configPath: defaultHindsightConfigPath(homeDir, normalized),
      port: defaultHindsightPort(normalized, extra.port),
      declaredByPlugin: Boolean(extra.declaredByPlugin),
      exists: fileExists(defaultHindsightConfigPath(homeDir, normalized)),
    });
  }
  add("default");
  const plugin = readCodingAgentPluginConfig({ homeDir, fileExists, readFile });
  const pluginRuntimeDir = path.join(home, "coding-agents");
  const pluginPresent = Boolean(plugin.exists || fileExists(pluginRuntimeDir));
  if (pluginPresent) {
    add("coding-agent", {
      port: plugin.daemonProfile === "coding-agent" ? plugin.apiPort : defaultHindsightPort("coding-agent"),
      declaredByPlugin: true,
    });
    if (plugin.daemonProfile && plugin.daemonProfile !== "coding-agent") {
      add(plugin.daemonProfile, { port: plugin.apiPort });
    }
  }
  const profilesDir = path.join(home, "profiles");
  if (fileExists(profilesDir)) {
    for (const entry of readDir(profilesDir)) {
      if (!String(entry).endsWith(".env")) continue;
      add(String(entry).slice(0, -4));
    }
  }
  return profiles.sort((a, b) => {
    if (a.name === "default") return -1;
    if (b.name === "default") return 1;
    return a.name.localeCompare(b.name);
  });
}

export function hindsightDaemonArgs(action = "start", profileName = "default") {
  const args = ["daemon", action];
  const name = normalizeHindsightProfileName(profileName);
  if (name !== "default") args.unshift("-p", name);
  return args;
}

export function parseEnvFile(text = "") {
  const values = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function quoteEnvValue(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (/^[A-Za-z0-9_.:/@%+=,-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

export function renderEnvFile(values = {}, previousText = "") {
  const next = { ...values };
  const used = new Set();
  const lines = [];
  const source = String(previousText || "");
  if (source) {
    for (const raw of source.split(/\n/)) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        lines.push(raw.replace(/\r$/, ""));
        continue;
      }
      let line = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
      const key = line.split("=", 1)[0].trim();
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        const value = next[key];
        used.add(key);
        if (value == null || value === "") {
          lines.push(`# ${key}=`);
        } else {
          lines.push(`${key}=${quoteEnvValue(value)}`);
        }
      } else {
        lines.push(raw.replace(/\r$/, ""));
      }
    }
  }
  const remaining = Object.entries(next).filter(([key, value]) => !used.has(key) && value != null && value !== "");
  if (remaining.length) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push("# Hindsight Embed settings");
    for (const [key, value] of remaining) {
      lines.push(`${key}=${quoteEnvValue(value)}`);
    }
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function maskSecret(value) {
  const text = String(value || "");
  if (!text) return null;
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

export function publicLlmConfig(values = {}) {
  const apiKey = String(values[LLM_KEYS.apiKey] || "").trim();
  const publicConfig = {
    provider: String(values[LLM_KEYS.provider] || "").trim(),
    baseUrl: String(values[LLM_KEYS.baseUrl] || "").trim(),
    model: String(values[LLM_KEYS.model] || "").trim(),
    hasApiKey: Boolean(apiKey),
    apiKeyMasked: maskSecret(apiKey),
  };
  for (const [name, envName] of Object.entries(OPTION_KEYS)) {
    if (SECRET_FIELDS.has(name)) {
      publicConfig.hasEmbeddingsApiKey = Boolean(String(values[envName] || "").trim());
    } else {
      publicConfig[name] = String(values[envName] || "").trim();
    }
  }
  return publicConfig;
}

export function readHindsightConfig({
  profileName = "default",
  configPath = defaultHindsightConfigPath(os.homedir(), profileName),
  readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
  fileExists = (filePath) => fs.existsSync(filePath),
} = {}) {
  if (!fileExists(configPath)) return {};
  try {
    return parseEnvFile(readFile(configPath));
  } catch (error) {
    throw new CommandAppsError("storage_error", "Failed to read Hindsight config", {
      reason: error.message,
    });
  }
}

export function writeHindsightLlmConfig(patch = {}, {
  profileName = "default",
  configPath = defaultHindsightConfigPath(os.homedir(), profileName),
  readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
  writeFile = (filePath, content) => fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 }),
  mkdir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
  fileExists = (filePath) => fs.existsSync(filePath),
} = {}) {
  const previousText = fileExists(configPath) ? readFile(configPath) : "";
  const current = parseEnvFile(previousText);
  const next = { ...current };

  if (patch.provider !== undefined) {
    const provider = String(patch.provider || "").trim();
    if (provider) next[LLM_KEYS.provider] = provider;
    else delete next[LLM_KEYS.provider];
  }
  if (patch.baseUrl !== undefined) {
    const baseUrl = String(patch.baseUrl || "").trim();
    if (baseUrl) next[LLM_KEYS.baseUrl] = baseUrl;
    else delete next[LLM_KEYS.baseUrl];
  }
  if (patch.model !== undefined) {
    const model = String(patch.model || "").trim();
    if (model) next[LLM_KEYS.model] = model;
    else delete next[LLM_KEYS.model];
  }
  if (patch.apiKey !== undefined && patch.apiKey !== UNCHANGED_API_KEY && patch.apiKey !== null) {
    const apiKey = String(patch.apiKey || "").trim();
    if (apiKey) next[LLM_KEYS.apiKey] = apiKey;
    else delete next[LLM_KEYS.apiKey];
  }
  for (const [name, envName] of Object.entries(OPTION_KEYS)) {
    if (patch[name] === undefined) continue;
    const value = String(patch[name] ?? "").trim();
    if (value) next[envName] = value;
    else delete next[envName];
  }

  mkdir(path.dirname(configPath));
  writeFile(configPath, renderEnvFile(next, previousText));
  try { fs.chmodSync(configPath, 0o600); } catch {}
  return next;
}

export { LLM_KEYS, UNCHANGED_API_KEY };
