import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CODEX_IMAGE_URL = "https://chatgpt.com/backend-api/codex/images/generations";
export const OPENAI_API_IMAGE_URL = "https://api.openai.com/v1/images/generations";
export const OPENAI_AUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/**
 * Resolve config path in ~/.shrimp/skills/leo-codex-imagine/config.json
 */
export function resolveSkillConfigPath() {
  if (process.env.LEO_CODEX_CONFIG_PATH) return path.resolve(process.env.LEO_CODEX_CONFIG_PATH);
  return path.join(os.homedir(), ".shrimp", "skills", "leo-codex-imagine", "config.json");
}

/**
 * Load persistent config from ~/.shrimp/skills/leo-codex-imagine/config.json
 */
export function loadSkillConfig() {
  const configPath = resolveSkillConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) || {};
  } catch (e) {
    console.warn(`[leo-codex-imagine] 警告: 读取配置文件失败 (${configPath}): ${e.message}`);
    return {};
  }
}

/**
 * Save persistent config to ~/.shrimp/skills/leo-codex-imagine/config.json
 */
export function saveSkillConfig(updates = {}) {
  const configPath = resolveSkillConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const current = loadSkillConfig();
  const merged = {
    ...current,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

/**
 * Mask API key for secure logging
 */
export function maskApiKey(key) {
  if (!key || typeof key !== "string") return "";
  if (key.length <= 8) return "********";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Normalize API base URL into OpenAI compatible image generations endpoint
 */
export function normalizeApiUrl(rawUrl) {
  if (!rawUrl) return "";
  let clean = rawUrl.trim().replace(/\/+$/, "");
  if (!clean.endsWith("/v1/images/generations")) {
    if (clean.endsWith("/v1")) {
      clean = `${clean}/images/generations`;
    } else {
      clean = `${clean}/v1/images/generations`;
    }
  }
  return clean;
}

/**
 * CLI Argument Parser
 */
export function parseCliArgs(argv) {
  const args = {
    command: "generate",
    imagePaths: [],
  };

  let startIndex = 0;
  if (argv.length > 0 && argv[0] === "config") {
    args.command = "config";
    args.configAction = argv[1] || "get";
    startIndex = 2;
  }

  for (let i = startIndex; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--prompt") { args.prompt = val; i++; }
    else if (key === "--image" || key === "--images") {
      if (val) {
        const split = val.split(",").map(s => s.trim()).filter(Boolean);
        args.imagePaths.push(...split);
      }
      i++;
    }
    else if (key === "--aspect-ratio") { args.aspectRatio = val; i++; }
    else if (key === "--size") { args.size = val; i++; }
    else if (key === "--quality") { args.quality = val; i++; }
    else if (key === "--output-dir") { args.outputDir = val; i++; }
    else if (key === "--filename") { args.filename = val; i++; }
    else if (key === "--api-key") { args.apiKey = val; i++; }
    else if (key === "--api-url") { args.apiUrl = val; i++; }
    else if (key === "--model") { args.model = val; i++; }
    else if (key === "--gateway-url") { args.gatewayUrl = val; i++; }
    else if (key === "--endpoint-id") { args.endpointId = val; i++; }
    else if (key === "--dry-run") { args.dryRun = true; }
    else if (key === "--help" || key === "-h") { args.help = true; }
  }
  return args;
}

/**
 * Prompt slug helper
 */
export function slugifyPrompt(prompt, maxLength = 35) {
  if (!prompt) return "media";
  let slug = prompt.toLowerCase().trim().replace(/[^\w\u4e00-\u9fa5]+/g, "_").replace(/^_+|_+$/g, "");
  if (!slug) slug = "media";
  if (slug.length > maxLength) slug = slug.substring(0, maxLength).replace(/_+$/, "");
  return slug;
}

export function formatDateYYYYMMDDHHmmss(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

export function generateSemanticFilename(prompt, ext = "png", prefix = "codex", explicitFilename = null) {
  if (explicitFilename) return explicitFilename;
  const slug = slugifyPrompt(prompt);
  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
  return `${prefix}_${slug}_${formatDateYYYYMMDDHHmmss()}.${cleanExt}`;
}

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
 * Resolve Auth, Target Endpoint, and Model with 3-tier precedence:
 * 1. Explicit CLI arguments (--api-key / --api-url / --model)
 * 2. Persistent Skill config (~/.shrimp/skills/leo-codex-imagine/config.json)
 * 3. Local Codex subscription (~/.codex/auth.json)
 * (No environment variables checked)
 */
export async function resolveAuthAndEndpoint(args = {}) {
  const config = loadSkillConfig();

  const explicitApiKey = args.apiKey;
  const explicitApiUrl = args.apiUrl;
  const explicitModel = args.model;

  const finalApiKey = explicitApiKey || config.api_key || null;
  const finalApiUrl = explicitApiUrl || config.api_url || null;
  const finalModel = explicitModel || config.model || null;

  // Tier 1 & Tier 2: Custom API Key / API URL from CLI or ~/.shrimp config
  if (finalApiKey || finalApiUrl) {
    if (!finalApiKey) {
      throw new Error("检测到已指定 API URL，但缺少 API Key。请通过 --api-key 或在对话中配置 API Key。");
    }
    const targetUrl = finalApiUrl ? normalizeApiUrl(finalApiUrl) : OPENAI_API_IMAGE_URL;
    return {
      authType: "api-key",
      targetUrl,
      apiKey: finalApiKey,
      model: finalModel || (targetUrl === OPENAI_API_IMAGE_URL ? "dall-e-3" : "gpt-image-2"),
    };
  }

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
    model: finalModel || "gpt-image-2",
  };
}

/**
 * Download remote image URL and write to local destination file
 */
export async function downloadImageToFile(url, destPath) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
      return;
    }
    console.warn(`[leo-codex-imagine] fetch 下载图片返回 HTTP ${res.status}，切换 curl 尝试...`);
  } catch (fetchErr) {
    console.warn(`[leo-codex-imagine] fetch 下载图片失败 (${fetchErr.message})，正自动切换系统 curl 下载...`);
  }

  const escapedDest = destPath.replace(/"/g, '\\"');
  const escapedUrl = url.replace(/"/g, '\\"');
  execSync(`curl -sSL -m 120 -o "${escapedDest}" "${escapedUrl}"`, { windowsHide: true });
  if (!fs.existsSync(destPath) || fs.statSync(destPath).size === 0) {
    throw new Error(`下载图片失败，文件未生成或为空: ${destPath}`);
  }
}

/**
 * High-Availability POST JSON with native fetch & curl fallback
 */
async function postJsonWithCurlFallback(url, headers, bodyObj, timeoutMs = 180000) {
  const bodyStr = JSON.stringify(bodyObj);

  // 1. Try native fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: bodyStr,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }

    if (!res.ok) {
      const errMsg = json?.error?.message || json?.error || text.slice(0, 300);
      throw new Error(`HTTP ${res.status}: ${errMsg}`);
    }

    if (json) return json;
    throw new Error(`响应非有效 JSON: ${text.slice(0, 200)}`);
  } catch (fetchErr) {
    if (fetchErr.message && fetchErr.message.startsWith("HTTP ")) {
      throw fetchErr;
    }
    console.warn(`[leo-codex-imagine] Node.js fetch 遇到网络限制 (${fetchErr.message})，正自动切换系统 curl 直连通道...`);
  }

  // 2. Fallback to system curl
  const tempPayload = path.join(os.tmpdir(), `codex_req_${Date.now()}.json`);
  try {
    fs.writeFileSync(tempPayload, bodyStr, "utf8");
    const escapedTemp = tempPayload.replace(/"/g, '\\"');
    const headerArgs = Object.entries(headers)
      .map(([k, v]) => `-H "${k}: ${v.replace(/"/g, '\\"')}"`)
      .join(" ");

    const out = execSync(
      `curl -sSL --connect-timeout 20 -m ${Math.ceil(timeoutMs / 1000)} -X POST "${url}" ${headerArgs} -d @"${escapedTemp}"`,
      { encoding: "utf8", windowsHide: true, maxBuffer: 50 * 1024 * 1024 }
    );

    const json = JSON.parse(out);
    if (json.error) {
      throw new Error(json.error.message || JSON.stringify(json.error));
    }
    return json;
  } catch (curlErr) {
    throw new Error(`生成请求失败 (curl): ${curlErr.message}`);
  } finally {
    try { if (fs.existsSync(tempPayload)) fs.unlinkSync(tempPayload); } catch {}
  }
}

/**
 * Detect image MIME type
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

/**
 * Print CLI Help Instructions
 */
function showHelp() {
  console.log(`
🎨 leo-codex-imagine - ChatGPT Codex & OpenAI 协议通用图片生成 Skill

特点:
  ✅ 支持 ChatGPT Codex 订阅免 Key 与 OpenAI 协议自定义 API 双模式
  ✅ 配置由 Agent 读写保存在 ~/.shrimp/skills/leo-codex-imagine/config.json
  ✅ 支持自定义 API URL（自动补充 /v1/images/generations）与自定义 --model
  ✅ 支持远程图片 URL 与 Base64 双通道自动下载落盘
  ✅ 支持参考图局部修改 (Image Edit) 与尺寸画质控制

用法 (Usage):
  1. 图像生成:
     node leo_codex_imagine.mjs --prompt "描述词" [options]

  2. 配置管理 (Agent / CLI):
     node leo_codex_imagine.mjs config set --api-url <url> --api-key <key> [--model <model>]
     node leo_codex_imagine.mjs config get

生图选项 (Options):
  --prompt <string>        图片描述提示词（必填）
  --images <path1,path2>   参考图路径（支持逗号分隔多张或多次指定）
  --image <path>           单张参考图路径
  --aspect-ratio <ratio>   画面比例 (默认: auto, 例如 16:9, 1:1, 9:16)
  --size <size>            图片尺寸 (默认: auto, 例如 1024x1024)
  --quality <quality>      质量 low / medium / high (默认: medium)
  --output-dir <path>      输出目录 (默认: ./images)
  --filename <name>        自定义文件名 (默认根据提示词自动语义生成)
  --api-url <url>          自定义 API URL (覆盖持久化配置)
  --api-key <key>          自定义 API Key (覆盖持久化配置)
  --model <model>          指定模型名称 (例如 gpt-image-2, dall-e-3, flux-pro)
  --gateway-url <url>      指定网关代理 URL (可选)
  --endpoint-id <id>       网关指定 endpoint (可选)
  --dry-run                预检模式：校验凭据与参数，不实际调用生图
  --help, -h               显示此帮助信息
`);
}

/**
 * Main Execution Entry
 */
async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) { showHelp(); return; }

  // Subcommand: config
  if (args.command === "config") {
    if (args.configAction === "set") {
      const updates = {};
      if (args.apiUrl) updates.api_url = args.apiUrl;
      if (args.apiKey) updates.api_key = args.apiKey;
      if (args.model) updates.model = args.model;
      const saved = saveSkillConfig(updates);
      console.log(`[leo-codex-imagine] 配置已成功保存至 ${resolveSkillConfigPath()}:`);
      console.log(`  api_url: ${saved.api_url || "(未设置)"}`);
      console.log(`  api_key: ${saved.api_key ? maskApiKey(saved.api_key) : "(未设置)"}`);
      console.log(`  model:   ${saved.model || "(未设置)"}`);
      return;
    }
    if (args.configAction === "get") {
      const cfg = loadSkillConfig();
      console.log(`[leo-codex-imagine] 当前持久化配置 (${resolveSkillConfigPath()}):`);
      console.log(`  api_url: ${cfg.api_url || "(未设置)"}`);
      console.log(`  api_key: ${cfg.api_key ? maskApiKey(cfg.api_key) : "(未设置)"}`);
      console.log(`  model:   ${cfg.model || "(未设置)"}`);
      console.log(`  updated: ${cfg.updated_at || "(未设置)"}`);
      return;
    }
    console.error("错误: 未知的 config 操作。请使用 'config get' 或 'config set'。");
    process.exit(1);
  }

  // Generation flow
  if (!args.prompt) {
    console.error("错误: --prompt 为必填参数。使用 --help 查看完整说明。");
    process.exit(1);
  }

  const outputDir = path.resolve(args.outputDir || "./images");
  const filename = generateSemanticFilename(args.prompt, "png", "codex", args.filename);
  const filePath = path.join(outputDir, filename);

  // Mode 1: Explicit Gateway URL provided
  if (args.gatewayUrl) {
    console.log(`[leo-codex-imagine] 正在通过指定的网关代理请求: ${args.gatewayUrl}...`);
    const body = {
      prompt: args.prompt,
      aspectRatio: args.aspectRatio || "auto",
      size: args.size,
      quality: args.quality,
      output_format: "png",
    };
    if (args.imagePaths.length > 0) body.image_paths = args.imagePaths;
    if (args.endpointId) body.endpoint_id = args.endpointId;

    const res = await fetch(`${args.gatewayUrl}/v1/media/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gateway-Client": "codex" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`网关错误: ${json?.error?.message || JSON.stringify(json)}`);
    console.log(`![Generated Image](${json.file_path || json.filePath || filePath})`);
    return;
  }

  // Resolve Auth, Target URL, Model
  const auth = await resolveAuthAndEndpoint(args);

  if (args.dryRun) {
    console.log("[leo-codex-imagine] [dry-run] 预检模式:");
    console.log("  鉴权类型:", auth.authType);
    console.log("  目标 URL:", auth.targetUrl);
    console.log("  使用模型:", auth.model);
    console.log("  Prompt:", args.prompt);
    console.log("  参考图数量:", args.imagePaths.length);
    console.log("  Aspect Ratio:", args.aspectRatio || "auto");
    console.log("  Size:", args.size || "auto");
    console.log("  Quality:", args.quality || "medium");
    console.log("  输出文件:", filePath);
    return;
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const payload = {
    model: auth.model,
    prompt: args.prompt,
    n: 1,
    size: args.size || "auto",
    quality: args.quality || "medium",
  };

  // Handle reference images
  if (args.imagePaths.length > 0) {
    const inputImages = [];
    for (const imgPath of args.imagePaths) {
      const resolved = path.resolve(imgPath);
      if (!fs.existsSync(resolved)) {
        throw new Error(`参考图片未找到: ${resolved}`);
      }
      const mime = getMimeType(resolved);
      const b64 = fs.readFileSync(resolved).toString("base64");
      inputImages.push({ image_url: `data:${mime};base64,${b64}` });
    }
    payload.input_images = inputImages;
  }

  let headers = {};
  if (auth.authType === "codex-subscription") {
    console.log(`[leo-codex-imagine] 正在通过本机 Codex 订阅凭据调用官方图像生成引擎 (${auth.model})...`);
    payload.output_format = "png";
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
      "OpenAI-Beta": "responses=experimental",
      originator: "codex_cli_rs",
      "User-Agent": "codex_cli_rs/0.0.0",
    };
    if (auth.accountId) {
      headers["chatgpt-account-id"] = auth.accountId;
    }
  } else {
    console.log(`[leo-codex-imagine] 正在调用 OpenAI 协议接口 (${auth.targetUrl} | 模型: ${auth.model})...`);
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.apiKey}`,
    };
    payload.response_format = "b64_json";
  }

  const responseJson = await postJsonWithCurlFallback(auth.targetUrl, headers, payload, 180000);

  // Extract Base64 or remote URL
  const b64Data = responseJson.data?.[0]?.b64_json;
  if (b64Data) {
    const buffer = Buffer.from(b64Data, "base64");
    fs.writeFileSync(filePath, buffer);
  } else if (responseJson.data?.[0]?.url) {
    const remoteUrl = responseJson.data[0].url;
    console.log(`[leo-codex-imagine] 接口返回图片下载地址，正在保存至本地文件...`);
    await downloadImageToFile(remoteUrl, filePath);
  } else {
    throw new Error(`响应中未包含有效的图像数据: ${JSON.stringify(responseJson).slice(0, 300)}`);
  }

  console.log(`\nSUCCESS: 图片已成功生成并保存！`);
  console.log(`![Generated Image](${filePath})`);
}

// Cross-platform direct CLI execution guard
const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (currentFilePath === executedFilePath) {
  main().catch((err) => {
    console.error(`\nERROR: ${err.message || err}`);
    process.exit(1);
  });
}
