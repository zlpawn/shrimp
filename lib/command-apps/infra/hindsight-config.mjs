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

const UNCHANGED_API_KEY = "__unchanged__";

export function defaultHindsightConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".hindsight", "embed");
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
  return {
    provider: String(values[LLM_KEYS.provider] || "").trim(),
    baseUrl: String(values[LLM_KEYS.baseUrl] || "").trim(),
    model: String(values[LLM_KEYS.model] || "").trim(),
    hasApiKey: Boolean(apiKey),
    apiKeyMasked: maskSecret(apiKey),
  };
}

export function readHindsightConfig({
  configPath = defaultHindsightConfigPath(),
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
  configPath = defaultHindsightConfigPath(),
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

  mkdir(path.dirname(configPath));
  writeFile(configPath, renderEnvFile(next, previousText));
  try { fs.chmodSync(configPath, 0o600); } catch {}
  return next;
}

export { LLM_KEYS, UNCHANGED_API_KEY };
