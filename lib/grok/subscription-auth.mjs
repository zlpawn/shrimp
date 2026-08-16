// Grok CLI subscription auth provider.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { createProxyAgent } from "../config/proxy-resolver.mjs";

const DEFAULT_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
const DEFAULT_OIDC_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const DEFAULT_OIDC_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const EXPIRING_SOON_SECONDS = 15 * 60;

export function resolveGrokAuthPath({ env = process.env, home = os.homedir(), authPath = "" } = {}) {
  const value = authPath || env.GROK_AUTH_PATH || path.join(home, ".grok", "auth.json");
  return value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
}

export function readGrokCredential(authPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const properties = Object.entries(parsed || {});
    const hit = properties.find(([, value]) => value?.key) || properties[0];
    if (!hit || !hit[1]?.key) return null;
    return { ...hit[1], scope: hit[0] };
  } catch {
    return null;
  }
}

export function writeGrokCredential(authPath, updatedFields = {}) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch {
    data = {};
  }
  const scopes = Object.keys(data);
  const scope =
    scopes.find((s) => s.startsWith("https://auth.x.ai")) ||
    scopes[0] ||
    `https://auth.x.ai::${updatedFields.oidc_client_id || DEFAULT_OIDC_CLIENT_ID}`;
  const currentEntry = data[scope] || {};
  data[scope] = {
    ...currentEntry,
    ...updatedFields,
  };

  const dir = path.dirname(authPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.auth.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, authPath);
  return { ...data[scope], scope };
}

function summarizeNodes(config = {}) {
  const endpoints = Object.values(config.clients || {}).flatMap((client) => client?.endpoints || []);
  return endpoints.filter((endpoint) => ["grok", "grok-subscription"].includes(String(endpoint?.type || "").toLowerCase()));
}

function unavailableUsage(code, message) {
  return {
    available: false,
    used_percent: null,
    remaining_percent: null,
    reset_at: null,
    period: null,
    prepaid_balance_usd: null,
    on_demand_used_usd: null,
    on_demand_cap_usd: null,
    updated_at: null,
    error: { code, message },
  };
}

function centsToUsd(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(value) / 100;
}

function normalizeGrokBilling(payload) {
  const config = payload?.config || {};
  const usedPercent = Number(config.creditUsagePercent);
  if (!Number.isFinite(usedPercent)) {
    throw new Error("Grok billing response has no creditUsagePercent");
  }
  const period = config.currentPeriod || (config.billingPeriodStart || config.billingPeriodEnd
    ? {
      type: "",
      start: config.billingPeriodStart || null,
      end: config.billingPeriodEnd || null,
    }
    : null);
  return {
    available: true,
    used_percent: usedPercent,
    remaining_percent: Math.max(0, 100 - usedPercent),
    reset_at: period?.end || null,
    period,
    prepaid_balance_usd: centsToUsd(config.prepaidBalance?.val),
    on_demand_used_usd: centsToUsd(config.onDemandUsed?.val),
    on_demand_cap_usd: centsToUsd(config.onDemandCap?.val),
    updated_at: new Date().toISOString(),
    error: null,
  };
}

export function getGrokAuthStatus({
  env = process.env,
  home = os.homedir(),
  config = {},
  authPath = "",
} = {}) {
  const resolvedPath = resolveGrokAuthPath({ env, home, authPath });
  const credential = readGrokCredential(resolvedPath);
  const expiresAt = credential?.expires_at ? Date.parse(credential.expires_at) : null;
  const expiresIn = Number.isFinite(expiresAt) ? Math.floor((expiresAt - Date.now()) / 1000) : null;
  const nodes = summarizeNodes(config);
  const hasKey = Boolean(credential?.key);
  const hasRefresh = Boolean(credential?.refresh_token);
  const isExpired = expiresIn !== null && expiresIn <= 0;

  let state = "missing_auth";
  let stateLabel = "未登录";
  if (!credential || !hasKey) {
    state = "missing_auth";
    stateLabel = "未登录";
  } else if (isExpired && !hasRefresh) {
    state = "token_expired";
    stateLabel = "Token 已过期";
  } else if (isExpired && hasRefresh) {
    state = "ready";
    stateLabel = "可自动刷新";
  } else if (hasKey) {
    state = expiresIn !== null && expiresIn <= EXPIRING_SOON_SECONDS ? "expiring_soon" : "ready";
    stateLabel = state === "expiring_soon" ? "即将过期" : "已就绪";
  }

  return {
    provider: "grok",
    label: "接入 Grok 订阅",
    description: "读取本机 Grok CLI 登录态，把官方 Grok 模型节点提供给其他客户端。",
    state,
    state_label: stateLabel,
    auth_path: resolvedPath,
    token: {
      account_id: credential?.email || credential?.user_id || "",
      access_token_configured: hasKey,
      refresh_token_configured: hasRefresh,
      expires_at: credential?.expires_at || "",
      expires_in_seconds: expiresIn,
      expired: isExpired,
    },
    nodes: {
      configured: nodes.length > 0,
      count: nodes.length,
      type: "grok",
      endpoints: nodes,
    },
    usage: unavailableUsage("usage_not_loaded", "打开详情或刷新后获取订阅剩余用量。"),
    notes: [
      "Grok 订阅节点读取本机 ~/.grok/auth.json，支持基于 OIDC refresh_token 自动刷新。",
      "真实上游是 cli-chat-proxy.grok.com/v1，不是普通 xAI API Key 接口。",
    ],
    commands: {
      status: "shrimp upstream grok status",
      usage: "shrimp upstream grok usage",
      refresh: "shrimp upstream grok refresh",
    },
  };
}

export async function refreshGrokToken({
  env = process.env,
  home = os.homedir(),
  authPath = "",
  proxyUrl = env.GROK_PROXY || null,
  fetchImpl = null,
} = {}) {
  const resolvedPath = resolveGrokAuthPath({ env, home, authPath });
  const credential = readGrokCredential(resolvedPath);
  if (!credential?.refresh_token) {
    const error = new Error("未找到 Grok refresh_token，无法自动刷新。请运行 `grok login` 重新登录。");
    error.code = "grok_refresh_token_missing";
    throw error;
  }

  const issuer = String(credential.oidc_issuer || "https://auth.x.ai").replace(/\/+$/, "");
  const tokenUrl = `${issuer}/oauth2/token`;
  const clientId = credential.oidc_client_id || DEFAULT_OIDC_CLIENT_ID;

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credential.refresh_token,
    client_id: clientId,
  });
  const body = params.toString();
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": String(Buffer.byteLength(body)),
    Accept: "application/json",
    "User-Agent": "grok-cli/0.2.101",
  };

  let response;
  if (fetchImpl) {
    response = await fetchImpl(tokenUrl, { method: "POST", headers, body });
  } else if (proxyUrl) {
    const agent = createProxyAgent(proxyUrl);
    const transport = new URL(tokenUrl).protocol === "http:" ? http : https;
    response = await new Promise((resolve, reject) => {
      const req = transport.request(tokenUrl, { method: "POST", headers, agent }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const rawText = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => rawText,
            json: async () => JSON.parse(rawText),
          });
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  } else {
    response = await fetch(tokenUrl, { method: "POST", headers, body });
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errJson = JSON.parse(rawText);
      errorMsg = errJson.error_description || errJson.error || errorMsg;
    } catch {}
    const error = new Error(`Grok Token 刷新失败 (${errorMsg})。请运行 \`grok login\` 重新登录。`);
    error.code = "grok_refresh_failed";
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    const error = new Error("Grok 刷新接口未返回 access_token");
    error.code = "grok_invalid_refresh_response";
    throw error;
  }

  const expiresIn = Number(payload.expires_in) || 21600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const updated = writeGrokCredential(resolvedPath, {
    key: payload.access_token,
    refresh_token: payload.refresh_token || credential.refresh_token,
    expires_at: expiresAt,
  });

  return {
    ok: true,
    access_token: payload.access_token,
    refresh_token: updated.refresh_token,
    expires_at: expiresAt,
    expires_in_seconds: expiresIn,
  };
}

export async function ensureFreshGrokAuth({
  env = process.env,
  home = os.homedir(),
  authPath = "",
  proxyUrl = env.GROK_PROXY || null,
  skewSeconds = 300,
  fetchImpl = null,
} = {}) {
  const resolvedPath = resolveGrokAuthPath({ env, home, authPath });
  const credential = readGrokCredential(resolvedPath);
  if (!credential?.key) {
    const error = new Error("未找到本机 Grok 登录态，请先运行 `grok login`。");
    error.code = "grok_auth_missing";
    throw error;
  }

  const expiresAt = credential.expires_at ? Date.parse(credential.expires_at) : null;
  const expiresIn = Number.isFinite(expiresAt) ? Math.floor((expiresAt - Date.now()) / 1000) : null;

  const needsRefresh = expiresIn !== null && expiresIn <= skewSeconds;
  if (!needsRefresh) {
    return { ...credential, authPath: resolvedPath };
  }

  if (!credential.refresh_token) {
    if (expiresIn !== null && expiresIn <= 0) {
      const error = new Error("Grok session token 已过期且没有 refresh_token，请运行 `grok login` 重新登录。");
      error.code = "grok_token_expired";
      throw error;
    }
    return { ...credential, authPath: resolvedPath };
  }

  try {
    const refreshed = await refreshGrokToken({ env, home, authPath: resolvedPath, proxyUrl, fetchImpl });
    return {
      ...credential,
      key: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: refreshed.expires_at,
      authPath: resolvedPath,
    };
  } catch (err) {
    // If refresh failed but token is not strictly expired yet (e.g. within skew), return current
    if (expiresIn !== null && expiresIn > 0) {
      return { ...credential, authPath: resolvedPath };
    }
    throw err;
  }
}

export async function getGrokUsage({
  env = process.env,
  home = os.homedir(),
  authPath = "",
  baseUrl = env.GROK_MODELS_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = fetch,
  proxyUrl = env.GROK_PROXY || null,
} = {}) {
  const resolvedPath = resolveGrokAuthPath({ env, home, authPath });
  let credential = readGrokCredential(resolvedPath);
  if (!credential?.key) {
    return unavailableUsage("grok_auth_missing", "未找到本机 Grok 登录态，请先运行 grok login。");
  }

  // Attempt fresh auth before fetching usage
  try {
    credential = await ensureFreshGrokAuth({ env, home, authPath: resolvedPath, proxyUrl, fetchImpl });
  } catch {}

  const url = `${String(baseUrl).replace(/\/+$/, "")}/billing?format=credits`;
  try {
    const fetchOptions = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credential.key}`,
        "X-XAI-Token-Auth": "xai-grok-cli",
        xuserid: credential.user_id || "",
        "x-grok-client-version": env.GROK_CLIENT_VERSION || "1.0.3",
        "x-grok-client-mode": "headless",
      },
    };
    let response;
    if (proxyUrl) {
      const agent = createProxyAgent(proxyUrl);
      const transport = new URL(url).protocol === "http:" ? http : https;
      response = await new Promise((resolve, reject) => {
        const req = transport.request(url, { method: "GET", headers: fetchOptions.headers, agent }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => Buffer.concat(chunks).toString("utf8"),
            json: async () => JSON.parse(Buffer.concat(chunks).toString("utf8")),
          }));
        });
        req.on("error", reject);
        req.end();
      });
    } else {
      response = await fetchImpl(url, fetchOptions);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return unavailableUsage("grok_billing_http_error", `Grok 用量接口返回 HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return normalizeGrokBilling(await response.json());
  } catch (error) {
    return unavailableUsage("grok_billing_failed", error?.message || String(error));
  }
}

export async function discoverGrokAuth(options = {}) {
  const status = getGrokAuthStatus(options);
  const ok = status.token.access_token_configured && (!status.token.expired || status.token.refresh_token_configured);
  return {
    ok,
    code: status.token.access_token_configured
      ? (status.token.expired && !status.token.refresh_token_configured ? "token_expired" : "ok")
      : "auth_not_found",
    message: status.token.access_token_configured
      ? (status.token.expired && !status.token.refresh_token_configured
          ? "Grok 登录态已过期且无 refresh_token，请运行 grok login 刷新。"
          : (status.token.expired ? "Grok 登录态已过期，调用时将自动刷新。" : "已检测到本机 Grok 登录态。"))
      : "未找到本机 Grok 登录态。请先运行 grok login。",
    status,
  };
}

export const grokSubscriptionAuthProvider = {
  id: "grok",
  label: "接入 Grok 订阅",
  description: "读取本机 Grok CLI 登录态，把官方 Grok 模型节点提供给其他客户端。",
  commands: ["status", "discover", "usage", "refresh"],
  getStatus: getGrokAuthStatus,
  discoverClient: discoverGrokAuth,
  getUsage: getGrokUsage,
  refresh: refreshGrokToken,
  ensureFresh: ensureFreshGrokAuth,
};
