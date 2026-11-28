import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CHAT_MODEL = "gemini-3.8-flash-high";
export const AUTH_FIELDS = [
  "client_id",
  "client_secret",
  "access_token",
  "refresh_token",
  "expires_at",
  "account_id",
  "project",
];

export function toList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
}

export function resolveHomeDir(env = process.env) {
  return env?.HOME || env?.USERPROFILE || os.homedir();
}

export function resolveSkillConfigPath(env = process.env) {
  if (env?.LEO_ANTIGRAVITY_CHAT_CONFIG_PATH) {
    return path.resolve(env.LEO_ANTIGRAVITY_CHAT_CONFIG_PATH);
  }
  const home = resolveHomeDir(env);
  return path.join(home, ".shrimp", "skills", "leo-antigravity-chat", "config.json");
}

export function resolveSessionsDir(env = process.env) {
  if (env?.LEO_ANTIGRAVITY_CHAT_SESSIONS_DIR) {
    return path.resolve(env.LEO_ANTIGRAVITY_CHAT_SESSIONS_DIR);
  }
  const home = resolveHomeDir(env);
  return path.join(home, ".shrimp", "skills", "leo-antigravity-chat", "sessions");
}

export function normalizeAuth(rawAuth = {}, fallbackFlat = {}) {
  const out = {};
  for (const key of AUTH_FIELDS) {
    const val = rawAuth?.[key] ?? fallbackFlat?.[key];
    if (val === undefined || val === null || val === "") continue;
    if (key === "expires_at") {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) out.expires_at = Math.floor(n);
    } else {
      out[key] = String(val).trim();
    }
  }
  return out;
}

export function normalizeConfig(raw = {}) {
  let models = toList(raw?.models);
  const explicitDefault = typeof raw?.default_model === "string" ? raw.default_model.trim() : "";
  if (models.length === 0) {
    models = [explicitDefault || DEFAULT_CHAT_MODEL];
  } else if (explicitDefault && !models.includes(explicitDefault)) {
    models = [explicitDefault, ...models];
  }
  const default_model = explicitDefault || models[0] || DEFAULT_CHAT_MODEL;
  const proxy = typeof raw?.proxy === "string" ? raw.proxy.trim() : "";
  const auth = normalizeAuth(raw?.auth, raw);

  const normalized = {
    default_model,
    models,
    proxy,
    auth,
  };
  if (raw?.updated_at) normalized.updated_at = raw.updated_at;
  return normalized;
}

export function loadSkillConfig(env = process.env) {
  const configPath = resolveSkillConfigPath(env);
  if (!fs.existsSync(configPath)) return normalizeConfig({});
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) || {};
    return normalizeConfig(parsed);
  } catch (err) {
    console.warn(`[leo-antigravity-chat] 警告: 读取配置文件失败 (${configPath}): ${err.message}`);
    return normalizeConfig({});
  }
}

export function saveSkillConfig(config = {}, env = process.env) {
  const configPath = resolveSkillConfigPath(env);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const { updated_at: _ignored, ...normalized } = normalizeConfig(config);
  const saved = {
    ...normalized,
    updated_at: new Date().toISOString(),
  };
  const payload = `${JSON.stringify(saved, null, 2)}\n`;
  const tmpPath = `${configPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, payload, { encoding: "utf8", mode: 0o600 });
  try {
    fs.renameSync(tmpPath, configPath);
  } catch {
    fs.writeFileSync(configPath, payload, { encoding: "utf8", mode: 0o600 });
    try { fs.unlinkSync(tmpPath); } catch {}
  }
  if (process.platform !== "win32") {
    try { fs.chmodSync(configPath, 0o600); } catch {}
  }
  return saved;
}

export function updateSkillAuth(partialAuth = {}, env = process.env) {
  const current = loadSkillConfig(env);
  const mergedAuth = { ...current.auth };
  for (const [k, v] of Object.entries(partialAuth || {})) {
    if (!AUTH_FIELDS.includes(k)) continue;
    if (v === null || v === "") {
      delete mergedAuth[k];
    } else if (v !== undefined) {
      mergedAuth[k] = v;
    }
  }
  return saveSkillConfig({ ...current, auth: mergedAuth }, env);
}

export function registerModel(model, env = process.env) {
  const clean = typeof model === "string" ? model.trim() : "";
  if (!clean) return false;
  const current = loadSkillConfig(env);
  if (current.models.includes(clean)) return false;
  saveSkillConfig({ ...current, models: [...current.models, clean] }, env);
  return true;
}

// Strict isolation: only import when the user explicitly provides --from <path>.
export function importSecretsFromFile(explicitPath = "", env = process.env) {
  const cleanPath = String(explicitPath || "").trim();
  if (!cleanPath) {
    throw new Error("请通过 --from <path> 显式指定要导入的密钥 JSON 文件路径。");
  }
  const srcPath = path.resolve(cleanPath);
  if (!fs.existsSync(srcPath)) {
    throw new Error(`指定的密钥文件不存在: ${srcPath}`);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(srcPath, "utf8")) || {};
  } catch (err) {
    throw new Error(`解析密钥文件失败 (${srcPath}): ${err.message}`);
  }
  const importedAuth = normalizeAuth(raw?.auth, raw);
  if (Object.keys(importedAuth).length === 0) {
    throw new Error(`密钥文件 (${srcPath}) 中未检测到有效的 Antigravity 凭据字段。`);
  }
  const current = loadSkillConfig(env);
  return saveSkillConfig(
    {
      ...current,
      auth: {
        ...current.auth,
        ...importedAuth,
      },
    },
    env,
  );
}

export function maskSecret(value) {
  if (!value || typeof value !== "string") return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
