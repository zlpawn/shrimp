import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { downloadImageToFile, toImageRef } from "./adapters/http.mjs";
import * as codex from "./adapters/codex.mjs";
import * as openai from "./adapters/openai.mjs";
import * as apimart from "./adapters/apimart.mjs";

export const { CODEX_IMAGE_URL } = codex;
export const { OPENAI_API_IMAGE_URL } = openai;

// One adapter per API family; a provider picks one via `type` (auto-detected from the URL when omitted)
export const ADAPTERS = { codex, openai, apimart };

export function detectProviderType(provider = {}) {
  if (provider.type) return provider.type;
  return /(^|\.)apimart\.ai$/.test(hostnameOf(provider.api_url)) ? "apimart" : "openai";
}

/**
 * Resolve config path in ~/.shrimp/skills/leo-codex-imagine/config.json
 */
export function resolveSkillConfigPath() {
  if (process.env.LEO_CODEX_CONFIG_PATH) return path.resolve(process.env.LEO_CODEX_CONFIG_PATH);
  return path.join(os.homedir(), ".shrimp", "skills", "leo-codex-imagine", "config.json");
}

function toList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(list.map(v => String(v).trim()).filter(Boolean))];
}

function hostnameOf(rawUrl) {
  try { return new URL(rawUrl).hostname; } catch { return ""; }
}

/**
 * Normalize config into { providers: [{ name, api_url, api_key, models[] }], default_model }.
 * Legacy flat { api_url, api_key, model } is migrated into a single provider.
 */
export function normalizeConfig(raw = {}) {
  const providers = (Array.isArray(raw.providers) ? raw.providers : []).map(p => ({
    ...p,
    name: p.name || hostnameOf(p.api_url) || "default",
    models: toList(p.models),
  }));
  if (raw.api_url || raw.api_key) {
    providers.push({
      name: hostnameOf(raw.api_url) || "default",
      api_url: raw.api_url || "",
      api_key: raw.api_key || "",
      models: toList(raw.model),
    });
  }
  const config = { providers, default_model: raw.default_model || raw.model || null };
  if (raw.updated_at) config.updated_at = raw.updated_at;
  return config;
}

/**
 * Load persistent config from ~/.shrimp/skills/leo-codex-imagine/config.json
 */
export function loadSkillConfig() {
  const configPath = resolveSkillConfigPath();
  if (!fs.existsSync(configPath)) return normalizeConfig();
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(configPath, "utf8")) || {});
  } catch (e) {
    console.warn(`[leo-codex-imagine] 警告: 读取配置文件失败 (${configPath}): ${e.message}`);
    return normalizeConfig();
  }
}

/**
 * Save the whole config (normalized) to ~/.shrimp/skills/leo-codex-imagine/config.json
 */
export function saveSkillConfig(config = {}) {
  const configPath = resolveSkillConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const { updated_at, ...rest } = normalizeConfig(config);
  const saved = { ...rest, updated_at: new Date().toISOString() };
  fs.writeFileSync(configPath, JSON.stringify(saved, null, 2), { encoding: "utf8", mode: 0o600 });
  return saved;
}

/**
 * Insert or merge a provider (matched by name, then by api_url). Models are unioned.
 */
export function upsertProvider(config, { name, api_url, api_key, models, type } = {}) {
  const providerName = name || hostnameOf(api_url);
  if (!providerName) throw new Error("config set 需要 --name 或 --api-url 来标识服务商。");
  const providers = [...config.providers];
  const idx = providers.findIndex(p => p.name === providerName || (api_url && p.api_url === api_url));
  const current = idx >= 0 ? providers[idx] : { name: providerName, models: [] };
  const merged = {
    ...current,
    ...(api_url ? { api_url } : {}),
    ...(api_key ? { api_key } : {}),
    ...(type ? { type } : {}),
    models: toList([...current.models, ...toList(models)]),
  };
  if (merged.type && !ADAPTERS[merged.type]) throw new Error(`未知的服务商类型 ${merged.type}，可选: ${Object.keys(ADAPTERS).join(", ")}`);
  if (!merged.api_key) throw new Error(`服务商 ${providerName} 缺少 API Key，请通过 --api-key 提供。`);
  if (idx >= 0) providers[idx] = merged; else providers.push(merged);
  return { ...config, providers };
}

/**
 * Human/Agent readable list of configured providers and their models (plus local Codex when logged in).
 */
export function formatProviderList(config) {
  const lines = config.providers.map(p => `  - ${p.name} [${detectProviderType(p)}]  models: ${p.models.join(", ") || "(未登记)"}`);
  if (codex.hasCodexAuth()) lines.push(`  - codex [codex]  models: gpt-image-2  (本机 Codex 订阅)`);
  return lines.join("\n") || "  (未配置任何服务商)";
}

/**
 * Pick provider + model from config. Returns null when no provider is configured.
 * Never guesses the provider from the model (several providers may serve the same model):
 * with more than one provider the caller must pass --provider, otherwise this throws the choice list.
 */
export function pickProvider(config, { provider, model } = {}) {
  const list = config.providers || [];
  let p;
  if (provider) {
    p = list.find(x => x.name === provider);
    if (!p) throw new Error(`未找到名为 ${provider} 的服务商。当前可选:\n${formatProviderList(config)}`);
  } else if (list.length === 0) {
    return null;
  } else if (list.length === 1) {
    p = list[0];
  } else {
    throw new Error(
      `已配置多个服务商，请让用户选择后通过 --provider <name> --model <model> 指定。当前可选:\n${formatProviderList(config)}`
    );
  }
  const wanted = model || (p.models.includes(config.default_model) ? config.default_model : p.models[0]);
  return { provider: p, model: wanted || null };
}

/**
 * Record a model the user explicitly used on a configured provider. Returns true when config changed.
 */
export function registerModel(providerName, model) {
  const config = loadSkillConfig();
  const p = config.providers.find(x => x.name === providerName);
  if (!p || !model || p.models.includes(model)) return false;
  saveSkillConfig(upsertProvider(config, { name: providerName, models: [model] }));
  return true;
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
  if (argv[0] === "list") {
    args.command = "list";
    startIndex = 1;
  } else if (argv.length > 0 && argv[0] === "config") {
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
    else if (key === "--models") { args.models = val; i++; }
    else if (key === "--provider" || key === "--name") { args.provider = val; i++; }
    else if (key === "--type") { args.type = val; i++; }
    else if (key === "--default-model") { args.defaultModel = val; i++; }
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
 * Resolve Auth, Target Endpoint, Model and adapter with 3-tier precedence:
 * 1. Explicit CLI arguments (--api-key / --api-url / --model)
 * 2. Persistent Skill config (~/.shrimp/skills/leo-codex-imagine/config.json)
 * 3. Local Codex subscription (~/.codex/auth.json)
 * (No environment variables checked)
 */
export async function resolveAuthAndEndpoint(args = {}) {
  const config = loadSkillConfig();

  // Tier 1: explicit --api-url / --api-key (URL-only reuses the key of a configured provider with the same URL)
  if (args.provider === "codex") {
    return { ...(await codex.resolveCodexAuth(args.model || null)), adapter: "codex" };
  }

  let picked = null;
  if (args.apiKey || args.apiUrl) {
    const sameUrl = args.apiUrl && config.providers.find(p => normalizeApiUrl(p.api_url) === normalizeApiUrl(args.apiUrl));
    picked = {
      provider: {
        name: sameUrl?.name || "cli",
        type: args.type || sameUrl?.type,
        api_url: args.apiUrl || sameUrl?.api_url,
        api_key: args.apiKey || sameUrl?.api_key,
      },
      model: args.model || sameUrl?.models[0] || null,
    };
  } else {
    // Tier 2: providers[] in ~/.shrimp config
    picked = pickProvider(config, { provider: args.provider, model: args.model });
  }

  if (picked) {
    const { provider } = picked;
    if (!provider.api_key) {
      throw new Error("检测到已指定 API URL，但缺少 API Key。请通过 --api-key 或在对话中配置 API Key。");
    }
    const adapter = detectProviderType(provider);
    if (!ADAPTERS[adapter] || adapter === "codex") throw new Error(`未知的服务商类型 ${adapter}，可选: openai, apimart`);
    const targetUrl = provider.api_url ? normalizeApiUrl(provider.api_url) : OPENAI_API_IMAGE_URL;
    return {
      authType: "api-key",
      adapter,
      providerName: provider.name,
      targetUrl,
      apiKey: provider.api_key,
      model: picked.model || (targetUrl === OPENAI_API_IMAGE_URL ? "dall-e-3" : "gpt-image-2"),
    };
  }

  // Tier 3: local Codex subscription (~/.codex/auth.json)
  return { ...(await codex.resolveCodexAuth(args.model || config.default_model || null)), adapter: "codex" };
}

/**
 * Print CLI Help Instructions
 */
function showHelp() {
  console.log(`
🎨 leo-codex-imagine - ChatGPT Codex & OpenAI 协议通用图片生成 Skill

特点:
  ✅ 支持 ChatGPT Codex 订阅免 Key 与 OpenAI 协议自定义 API 双模式
  ✅ 支持多个服务商 (providers[])，每个服务商可挂多个模型，由用户显式选择服务商
  ✅ 支持同步 (b64/url) 与异步任务 (task_id 轮询) 两种返回
  ✅ 支持参考图 (本地文件或 URL) 与画面比例控制

用法 (Usage):
  1. 图像生成:
     node leo_codex_imagine.mjs --prompt "描述词" [--model <model>] [options]

  2. 查看可选服务商与模型 (多个服务商时必须 --provider 指定):
     node leo_codex_imagine.mjs list

  3. 配置管理 (Agent / CLI):
     node leo_codex_imagine.mjs config set --name <provider> --api-url <url> --api-key <key> --models <m1,m2> [--type openai|apimart] [--default-model <m>]
     node leo_codex_imagine.mjs config set --default-model <model>
     node leo_codex_imagine.mjs config remove --name <provider>
     node leo_codex_imagine.mjs config get

生图选项 (Options):
  --prompt <string>        图片描述提示词（必填）
  --images <path1,path2>   参考图（本地路径或 http(s) URL，逗号分隔或多次指定）
  --image <path>           单张参考图
  --aspect-ratio <ratio>   画面比例 (例如 16:9, 1:1, 9:16；默认 auto)
  --size <size>            图片尺寸 (例如 1024x1024；API Key 模式下优先于 --aspect-ratio)
  --quality <quality>      质量 low / medium / high (API Key 模式下仅在显式传入时发送)
  --output-dir <path>      输出目录 (默认: ./images)
  --filename <name>        自定义文件名 (默认根据提示词自动语义生成)
  --provider <name>        服务商名称 (配置了多个服务商时必填；codex = 本机订阅)
  --model <model>          模型名称 (成功生成后自动登记到该服务商的 models)
  --type <adapter>         服务商协议类型 openai / apimart (config set 或临时 --api-url 时使用，默认按 URL 自动识别)
  --api-url <url>          临时指定 API URL (覆盖持久化配置)
  --api-key <key>          临时指定 API Key (覆盖持久化配置)
  --gateway-url <url>      指定网关代理 URL (可选)
  --endpoint-id <id>       网关指定 endpoint (可选)
  --dry-run                预检模式：打印路由结果与请求体，不实际调用生图
  --help, -h               显示此帮助信息
`);
}

function printConfig(cfg) {
  console.log(`  default_model: ${cfg.default_model || "(未设置)"}`);
  if (cfg.providers.length === 0) console.log("  providers: (未配置，将使用本机 Codex 订阅)");
  for (const p of cfg.providers) {
    console.log(`  - ${p.name} [${detectProviderType(p)}]`);
    console.log(`      api_url: ${p.api_url || "(OpenAI 官方)"}`);
    console.log(`      api_key: ${p.api_key ? maskApiKey(p.api_key) : "(未设置)"}`);
    console.log(`      models:  ${p.models.join(", ") || "(未设置)"}`);
  }
}

/**
 * Main Execution Entry
 */
async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) { showHelp(); return; }

  // Subcommand: list (what the Agent shows the user before asking them to pick)
  if (args.command === "list") {
    const cfg = loadSkillConfig();
    console.log("[leo-codex-imagine] 可用服务商与模型:");
    console.log(formatProviderList(cfg));
    if (cfg.default_model) console.log(`  default_model: ${cfg.default_model}`);
    return;
  }

  // Subcommand: config
  if (args.command === "config") {
    if (args.configAction === "set") {
      let cfg = loadSkillConfig();
      if (args.provider || args.apiUrl || args.apiKey || args.models || args.model || args.type) {
        cfg = upsertProvider(cfg, {
          name: args.provider,
          api_url: args.apiUrl,
          api_key: args.apiKey,
          type: args.type,
          models: [...toList(args.models), ...toList(args.model)],
        });
      }
      if (args.defaultModel) cfg.default_model = args.defaultModel;
      const saved = normalizeConfig(saveSkillConfig(cfg));
      console.log(`[leo-codex-imagine] 配置已成功保存至 ${resolveSkillConfigPath()}:`);
      printConfig(saved);
      return;
    }
    if (args.configAction === "remove") {
      const cfg = loadSkillConfig();
      if (!cfg.providers.some(p => p.name === args.provider)) {
        throw new Error(`未找到名为 ${args.provider} 的服务商。`);
      }
      cfg.providers = cfg.providers.filter(p => p.name !== args.provider);
      const saved = normalizeConfig(saveSkillConfig(cfg));
      console.log(`[leo-codex-imagine] 已删除服务商 ${args.provider}:`);
      printConfig(saved);
      return;
    }
    if (args.configAction === "get") {
      const cfg = loadSkillConfig();
      console.log(`[leo-codex-imagine] 当前持久化配置 (${resolveSkillConfigPath()}):`);
      printConfig(cfg);
      console.log(`  updated: ${cfg.updated_at || "(未设置)"}`);
      return;
    }
    console.error("错误: 未知的 config 操作。请使用 'config get' / 'config set' / 'config remove'。");
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
  const adapter = ADAPTERS[auth.adapter];
  const imageRefs = args.imagePaths.map(toImageRef);
  const payload = adapter.buildPayload(auth, args, imageRefs);

  if (args.dryRun) {
    const short = r => r.slice(0, 40) + (r.length > 40 ? "..." : "");
    const shown = { ...payload };
    for (const k of ["image_urls", "image"]) if (shown[k]) shown[k] = shown[k].map(short);
    if (shown.input_images) shown.input_images = `[${shown.input_images.length} 张]`;
    console.log("[leo-codex-imagine] [dry-run] 预检模式:");
    console.log("  适配器:", auth.adapter);
    if (auth.providerName) console.log("  服务商:", auth.providerName);
    console.log("  目标 URL:", auth.targetUrl);
    console.log("  使用模型:", auth.model);
    console.log("  请求体:", JSON.stringify(shown));
    console.log("  输出文件:", filePath);
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const result = await adapter.generate(auth, payload);
  if (result.b64) {
    fs.writeFileSync(filePath, Buffer.from(result.b64, "base64"));
  } else {
    console.log(`[leo-codex-imagine] 接口返回图片下载地址，正在保存至本地文件...`);
    await downloadImageToFile(result.url, filePath);
  }

  if (auth.authType === "api-key" && args.model && registerModel(auth.providerName, args.model)) {
    console.log(`[leo-codex-imagine] 已将模型 ${args.model} 登记到服务商 ${auth.providerName} 的 models 中。`);
  }

  console.log(`\nSUCCESS: 图片已成功生成并保存！`);
  console.log(`![Generated Image](${filePath})`);
}

// Cross-platform direct CLI execution guard (realpath so symlinked installs still run)
const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1]
  ? (fs.existsSync(process.argv[1]) ? fs.realpathSync(process.argv[1]) : path.resolve(process.argv[1]))
  : "";

if (currentFilePath === executedFilePath) {
  main().catch((err) => {
    console.error(`\nERROR: ${err.message || err}`);
    process.exit(1);
  });
}
