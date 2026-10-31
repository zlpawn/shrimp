import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { requestJsonWithCurlFallback } from "./http.mjs";

export const CODEX_IMAGE_URL = "https://chatgpt.com/backend-api/codex/images/generations";
export const OPENAI_AUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/**
 * Decode JWT without third-party library
 */
function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Resolve local ~/.codex/auth.json path
 */
export function hasCodexAuth() {
  return fs.existsSync(resolveCodexAuthPath());
}

function resolveCodexAuthPath() {
  if (process.env.CODEX_AUTH_PATH) return path.resolve(process.env.CODEX_AUTH_PATH);
  if (process.env.CODEX_HOME) return path.resolve(process.env.CODEX_HOME, "auth.json");
  return path.join(os.homedir(), ".codex", "auth.json");
}

/**
 * Exchange refresh_token for a new access_token
 */
async function requestTokenRefresh(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CODEX_OAUTH_CLIENT_ID,
  });

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  // 1. Try Node fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(OPENAI_AUTH_TOKEN_URL, {
      method: "POST",
      headers,
      body: body.toString(),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn(`[leo-codex-imagine] fetch 刷新令牌网络受限 (${err.message})，正自动切换系统 curl 请求...`);
  }

  // 2. Fallback to system curl
  const tempPayload = path.join(os.tmpdir(), `codex_refresh_${Date.now()}.txt`);
  try {
    fs.writeFileSync(tempPayload, body.toString(), "utf8");
    const escapedTemp = tempPayload.replace(/"/g, '\\"');
    const out = execSync(
      `curl -sSL --connect-timeout 15 -m 30 -X POST "${OPENAI_AUTH_TOKEN_URL}" -H "Content-Type: application/x-www-form-urlencoded" -H "Accept: application/json" -d @"${escapedTemp}"`,
      { encoding: "utf8", windowsHide: true }
    );
    const json = JSON.parse(out);
    if (json.access_token) return json;
    throw new Error(json.error_description || json.error || out.slice(0, 200));
  } catch (curlErr) {
    throw new Error(`Codex 令牌自动刷新失败: ${curlErr.message}`);
  } finally {
    try { if (fs.existsSync(tempPayload)) fs.unlinkSync(tempPayload); } catch {}
  }
}

/**
 * Resolve local Codex subscription auth (~/.codex/auth.json), refreshing the JWT when it is about to expire
 */
export async function resolveCodexAuth(model) {
  // Tier 3: Fallback to local Codex subscription (~/.codex/auth.json)
  const authPath = resolveCodexAuthPath();
  if (!fs.existsSync(authPath)) {
    throw new Error(
      `未配置 API Key（~/.shrimp/skills/leo-codex-imagine/config.json 中未配置），且未找到本机 Codex 登录凭证 (${authPath})。\n` +
      `请在对话中让 Agent 帮您配置生图 API，或在本机执行 'codex' 完成官方账号登录。`
    );
  }

  let auth;
  try {
    auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch (err) {
    throw new Error(`读取 Codex 凭证失败 (${authPath}): ${err.message}`);
  }

  const tokens = auth.tokens || {};
  let accessToken = tokens.access_token || auth.access_token || auth.credentials?.access_token;
  const refreshToken = tokens.refresh_token || auth.refresh_token;
  const accountId = tokens.account_id || auth.account_id || "";

  // Check if accessToken is expired
  let isExpired = false;
  if (accessToken) {
    const payload = decodeJwtPayload(accessToken);
    if (payload?.exp) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp - nowSeconds < 300) {
        isExpired = true;
      }
    }
  } else {
    isExpired = true;
  }

  if (isExpired) {
    if (!refreshToken) {
      throw new Error(`Codex Access Token 已过期，且凭证中未包含 refresh_token。请在终端重新登录 Codex。`);
    }

    console.log(`[leo-codex-imagine] 检测到 Codex 访问令牌已过期，正在自动向官方服务器换取新令牌...`);
    const refreshed = await requestTokenRefresh(refreshToken);
    accessToken = refreshed.access_token;

    try {
      if (!auth.tokens) auth.tokens = {};
      auth.tokens.access_token = refreshed.access_token;
      if (refreshed.refresh_token) auth.tokens.refresh_token = refreshed.refresh_token;
      auth.tokens.last_refresh = new Date().toISOString();
      fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), "utf8");
      console.log(`[leo-codex-imagine] 令牌刷新成功并已持久化保存至本地。`);
    } catch (writeErr) {
      console.warn(`[leo-codex-imagine] 警告: 令牌刷新成功，但写入 ${authPath} 失败: ${writeErr.message}`);
    }
  }

  return {
    authType: "codex-subscription",
    targetUrl: CODEX_IMAGE_URL,
    accessToken,
    accountId,
    model: model || "gpt-image-2",
  };
}

export function buildPayload(auth, args, imageRefs = []) {
  const payload = {
    model: auth.model,
    prompt: args.prompt,
    n: 1,
    size: args.size || "auto",
    quality: args.quality || "medium",
    output_format: "png",
  };
  if (args.aspectRatio && args.aspectRatio !== "auto") payload.aspect_ratio = args.aspectRatio;
  if (imageRefs.length > 0) payload.input_images = imageRefs.map(image_url => ({ image_url }));
  return payload;
}

export async function generate(auth, payload) {
  console.log(`[leo-codex-imagine] 正在通过本机 Codex 订阅凭据调用官方图像生成引擎 (${auth.model})...`);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.accessToken}`,
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs/0.0.0",
  };
  if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId;
  const json = await requestJsonWithCurlFallback(auth.targetUrl, { method: "POST", headers, body: payload }, 180000);
  const first = json.data?.[0];
  if (first?.b64_json) return { b64: first.b64_json };
  if (first?.url) return { url: first.url };
  throw new Error(`响应中未包含有效的图像数据: ${JSON.stringify(json).slice(0, 300)}`);
}
