// Grok CLI subscription auth provider.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { createProxyAgent } from "../config/proxy-resolver.mjs";

const DEFAULT_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
const EXPIRING_SOON_SECONDS = 15 * 60;

function resolveGrokAuthPath({ env = process.env, home = os.homedir(), authPath = "" } = {}) {
  const value = authPath || env.GROK_AUTH_PATH || path.join(home, ".grok", "auth.json");
  return value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
}

function readGrokCredential(authPath) {
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
  let state = "missing_auth";
  let stateLabel = "未登录";
  if (credential && Number.isFinite(expiresAt) && expiresIn <= 0) {
    state = "token_expired";
    stateLabel = "Token 已过期";
  } else if (credential) {
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
      access_token_configured: Boolean(credential?.key),
      expires_at: credential?.expires_at || "",
      expires_in_seconds: expiresIn,
      expired: expiresIn !== null && expiresIn <= 0,
    },
    nodes: {
      configured: nodes.length > 0,
      count: nodes.length,
      type: "grok",
      endpoints: nodes,
    },
    usage: unavailableUsage("usage_not_loaded", "打开详情或刷新后获取订阅剩余用量。"),
    notes: [
      "Grok 订阅节点读取本机 ~/.grok/auth.json，由 grok CLI 负责登录和刷新。",
      "真实上游是 cli-chat-proxy.grok.com/v1，不是普通 xAI API Key 接口。",
    ],
    commands: {
      status: "shrimp upstream grok status",
      usage: "shrimp upstream grok usage",
    },
  };
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
  const credential = readGrokCredential(resolvedPath);
  if (!credential?.key) {
    return unavailableUsage("grok_auth_missing", "未找到本机 Grok 登录态，请先运行 grok login。");
  }
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
  return {
    ok: status.token.access_token_configured && !status.token.expired,
    code: status.token.access_token_configured ? (status.token.expired ? "token_expired" : "ok") : "auth_not_found",
    message: status.token.access_token_configured
      ? (status.token.expired ? "Grok 登录态已过期，请运行 grok login 刷新。" : "已检测到本机 Grok 登录态。")
      : "未找到本机 Grok 登录态。请先运行 grok login。",
    status,
  };
}

export const grokSubscriptionAuthProvider = {
  id: "grok",
  label: "接入 Grok 订阅",
  description: "读取本机 Grok CLI 登录态，把官方 Grok 模型节点提供给其他客户端。",
  commands: ["status", "discover", "usage"],
  getStatus: getGrokAuthStatus,
  discoverClient: discoverGrokAuth,
  getUsage: getGrokUsage,
};
