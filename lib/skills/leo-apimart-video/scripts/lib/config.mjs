import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_API_URL = "https://api.apimart.ai/v1";

export function resolveConfigPath() {
  if (process.env.LEO_APIMART_VIDEO_CONFIG_PATH) return path.resolve(process.env.LEO_APIMART_VIDEO_CONFIG_PATH);
  return path.join(os.homedir(), ".shrimp", "skills", "leo-apimart-video", "config.json");
}

export function normalizeApiUrl(rawUrl) {
  const clean = String(rawUrl || DEFAULT_API_URL).trim().replace(/\/+$/, "");
  return clean.endsWith("/v1") ? clean : `${clean}/v1`;
}

export function loadConfig() {
  const p = resolveConfigPath();
  const raw = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
  return { ...raw, api_url: normalizeApiUrl(raw.api_url) };
}

export function saveConfig(config) {
  const p = resolveConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = { ...config, api_url: normalizeApiUrl(config.api_url), updated_at: new Date().toISOString() };
  fs.writeFileSync(p, JSON.stringify(out, null, 2), { mode: 0o600 });
  fs.chmodSync(p, 0o600);
  return out;
}

export function maskApiKey(key) {
  if (!key) return "";
  return key.length <= 8 ? "********" : `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// CLI flags win over the saved config
export function resolveAuth({ apiKey, apiUrl } = {}) {
  const config = loadConfig();
  const auth = { api_key: apiKey || config.api_key, api_url: normalizeApiUrl(apiUrl || config.api_url) };
  if (!auth.api_key) throw new Error("未配置 API Key，先执行: config set --api-key <key>");
  return { auth, config };
}
