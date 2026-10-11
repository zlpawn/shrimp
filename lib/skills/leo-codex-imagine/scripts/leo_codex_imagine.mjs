import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CODEX_IMAGE_URL = "https://chatgpt.com/backend-api/codex/images/generations";
const OPENAI_API_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_AUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/**
 * CLI Argument Parser
 */
export function parseCliArgs(argv) {
  const args = {
    imagePaths: [],
  };
  for (let i = 0; i < argv.length; i++) {
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
 * Read and refresh Codex OAuth tokens if needed
 */
async function ensureValidCodexAuth(explicitApiKey = null) {
  if (explicitApiKey || process.env.OPENAI_API_KEY) {
    return {
      authType: "api-key",
      apiKey: explicitApiKey || process.env.OPENAI_API_KEY,
    };
  }

  const authPath = resolveCodexAuthPath();
  if (!fs.existsSync(authPath)) {
    throw new Error(
      `未找到 Codex 登录凭证 (${authPath})，且未设置 OPENAI_API_KEY。\n` +
      `请先在本机执行 'codex' 完成官方账号登录，或通过 --api-key 传入 API 密钥。`
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
      // If expiring within 5 minutes, consider it expired
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

    // Update ~/.codex/auth.json
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
    accessToken,
    accountId,
  };
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
 * High-Availability POST JSON with native fetch & curl fallback
 */
async function postJsonWithCurlFallback(url, headers, bodyObj, timeoutMs = 120000) {
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
    // If it was an API error (not network error), throw directly
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
🎨 leo-codex-imagine - ChatGPT Codex 独立图片生成 Skill

特点:
  ✅ 100% 独立运行，完全脱离本地网关依赖
  ✅ 自动读取本地 ~/.codex/auth.json 订阅凭据
  ✅ 令牌过期自动向官方换新并持久化
  ✅ 支持 Node fetch 与系统 curl 双通道高可用
  ✅ 支持参考图局部修改 (Image Edit) 与尺寸画质控制

用法 (Usage):
  node leo_codex_imagine.mjs --prompt "描述词" [options]

选项 (Options):
  --prompt <string>        图片描述提示词（必填）
  --images <path1,path2>   参考图路径（支持逗号分隔多张或多次指定）
  --image <path>           单张参考图路径
  --aspect-ratio <ratio>   画面比例 (默认: auto, 例如 16:9, 1:1, 9:16)
  --size <size>            图片尺寸 (默认: auto, 例如 1024x1024)
  --quality <quality>      质量 low / medium / high (默认: medium)
  --output-dir <path>      输出目录 (默认: ./images)
  --filename <name>        自定义文件名 (默认根据提示词自动语义生成)
  --api-key <key>          OpenAI API Key (可选，未登录 Codex 时可作为备用)
  --gateway-url <url>      指定网关代理 URL (可选，留空则完全直连官方端点)
  --dry-run                预检模式：校验凭据与参数，不实际调用生图
  --help, -h               显示此帮助信息

示例 (Examples):
  # 基础文生图
  node leo_codex_imagine.mjs --prompt "赛博朋克风未来城市夜景" --aspect-ratio "16:9"

  # 参考图编辑
  node leo_codex_imagine.mjs --prompt "给图中的猫戴上草帽" --images "./cat.png"

  # 预检模式
  node leo_codex_imagine.mjs --prompt "测试" --dry-run
`);
}

/**
 * Main Execution Entry
 */
async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) { showHelp(); return; }
  if (!args.prompt) {
    console.error("错误: --prompt 为必填参数。使用 --help 查看完整说明。");
    process.exit(1);
  }

  const outputDir = path.resolve(args.outputDir || "./images");
  const filename = generateSemanticFilename(args.prompt, "png", "codex", args.filename);
  const filePath = path.join(outputDir, filename);

  // Validate credentials
  const auth = await ensureValidCodexAuth(args.apiKey);

  if (args.dryRun) {
    console.log("[leo-codex-imagine] [dry-run] 预检模式:");
    console.log("  模式:", args.gatewayUrl ? `网关路由 (${args.gatewayUrl})` : "独立官方直连模式 (Standalone Direct)");
    console.log("  鉴权类型:", auth.authType);
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

  // Mode 2: 100% Standalone Direct Mode (Default)
  console.log(`[leo-codex-imagine] 正在以独立直连模式调用 ChatGPT Codex 图像生成引擎 (gpt-image-2)...`);

  const payload = {
    model: "gpt-image-2",
    prompt: args.prompt,
    n: 1,
    size: args.size || "auto",
    quality: args.quality || "medium",
    output_format: "png",
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
  let targetUrl = CODEX_IMAGE_URL;

  if (auth.authType === "codex-subscription") {
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
    // Fallback standard OpenAI API key
    targetUrl = OPENAI_API_IMAGE_URL;
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.apiKey}`,
    };
    payload.model = "dall-e-3";
    payload.response_format = "b64_json";
  }

  const responseJson = await postJsonWithCurlFallback(targetUrl, headers, payload, 180000);

  // Extract Base64 Image
  const b64Data = responseJson.data?.[0]?.b64_json;
  if (!b64Data) {
    const fallbackUrl = responseJson.data?.[0]?.url;
    if (fallbackUrl) {
      console.log(`![Generated Image](${fallbackUrl})`);
      return;
    }
    throw new Error(`响应中未包含有效的图像数据: ${JSON.stringify(responseJson).slice(0, 300)}`);
  }

  // Persist image to disk
  const buffer = Buffer.from(b64Data, "base64");
  fs.writeFileSync(filePath, buffer);

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
