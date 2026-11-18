import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_IMAGE_MODEL,
  toList,
  resolveSkillConfigPath,
  normalizeConfig,
  loadSkillConfig,
  saveSkillConfig,
  updateSkillAuth,
  registerModel,
  importSecretsFromFile,
  maskSecret,
} from "./lib/config.mjs";
import { resolveProxyInfo, resolveProxyUrl, toImagePart } from "./lib/proxy.mjs";
import { ensureFreshAuth, runInteractiveLogin } from "./lib/oauth.mjs";
import {
  loadCodeAssist,
  fetchRemoteModels,
  normalizeImageSize,
  buildImageGenerateRequest,
  generateImageViaGrpc,
} from "./lib/client.mjs";

export {
  DEFAULT_IMAGE_MODEL,
  resolveSkillConfigPath,
  normalizeConfig,
  loadSkillConfig,
  saveSkillConfig,
  registerModel,
  importSecretsFromFile,
  maskSecret,
  resolveProxyInfo,
  resolveProxyUrl,
};

export function parseCliArgs(argv = []) {
  const args = {
    command: "generate",
    imagePaths: [],
  };

  let startIndex = 0;
  if (argv[0] === "list") {
    args.command = "list";
    startIndex = 1;
  } else if (argv[0] === "login") {
    args.command = "login";
    startIndex = 1;
  } else if (argv[0] === "config") {
    args.command = "config";
    args.configAction = argv[1] && !argv[1].startsWith("-") ? argv[1] : "get";
    startIndex = argv[1] && !argv[1].startsWith("-") ? 2 : 1;
  }

  for (let i = startIndex; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--prompt") { args.prompt = val; i++; }
    else if (key === "--images" || key === "--image") {
      if (val) {
        args.imagePaths.push(...val.split(",").map((s) => s.trim()).filter(Boolean));
      }
      i++;
    }
    else if (key === "--model") { args.model = val; i++; }
    else if (key === "--models") { args.models = val; i++; }
    else if (key === "--remove-model") { args.removeModel = val; i++; }
    else if (key === "--default-model") { args.defaultModel = val; i++; }
    else if (key === "--aspect-ratio") { args.aspectRatio = val; i++; }
    else if (key === "--image-size" || key === "--size") { args.imageSize = val; i++; }
    else if (key === "--quality") { args.quality = val; i++; }
    else if (key === "--output-dir") { args.outputDir = val; i++; }
    else if (key === "--category" || key === "--cat") { args.category = val; i++; }
    else if (key === "--topic") { args.topic = val; i++; }
    else if (key === "--style") { args.style = val; i++; }
    else if (key === "--filename" || key === "--image-name") { args.filename = val; i++; }
    else if (key === "--proxy") { args.proxy = val ?? ""; i++; }
    else if (key === "--no-proxy") { args.noProxy = true; }
    else if (key === "--from") { args.from = val; i++; }
    else if (key === "--client-id") { args.clientId = val; i++; }
    else if (key === "--client-secret") { args.clientSecret = val; i++; }
    else if (key === "--refresh-token") { args.refreshToken = val; i++; }
    else if (key === "--access-token") { args.accessToken = val; i++; }
    else if (key === "--expires-at") { args.expiresAt = val; i++; }
    else if (key === "--account-id") { args.accountId = val; i++; }
    else if (key === "--project") { args.project = val; i++; }
    else if (key === "--port") { args.port = Number(val); i++; }
    else if (key === "--no-browser") { args.noBrowser = true; }
    else if (key === "--remote") { args.remote = true; }
    else if (key === "--sync") { args.sync = true; }
    else if (key === "--dry-run") { args.dryRun = true; }
    else if (key === "--help" || key === "-h") { args.help = true; }
  }
  return args;
}

export function slugifyPrompt(prompt, maxLength = 35) {
  if (!prompt) return "media";
  let slug = prompt
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

export function formatDateYYYYMMDD(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatTimestampCompact(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}` +
    `${pad(date.getMonth() + 1)}` +
    `${pad(date.getDate())}_` +
    `${pad(date.getHours())}` +
    `${pad(date.getMinutes())}` +
    `${pad(date.getSeconds())}`
  );
}

export function sanitizeSegment(str, defaultVal = "misc") {
  if (!str) return defaultVal;
  const clean = String(str)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/\s+/g, "")
    .replace(/^_+|_+$/g, "");
  return clean || defaultVal;
}

export function inferTopicAndStyleFromPrompt(prompt = "") {
  const clauses = String(prompt || "")
    .split(/[，,。；;！!？?、|\n—\-:：]+/)
    .map((s) => sanitizeSegment(s, ""))
    .filter(Boolean);
  if (clauses.length === 0) {
    return { topic: "AI生图", style: "通用风格" };
  }
  const clip = (s, max = 14) => (s.length > max ? s.slice(0, max).replace(/_+$/, "") : s);
  const topic = clip(clauses[0], 14) || "AI生图";
  const rawStyle = clauses.length >= 2 ? clauses[clauses.length - 1] : "通用风格";
  const style = clip(rawStyle, 14) || "通用风格";
  return { topic, style };
}

export function detectBufferExt(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
  return null;
}

export function generateSemanticFilename(
  prompt,
  ext = "png",
  explicitFilename = null,
  { topic = "", style = "", date = new Date() } = {},
) {
  if (explicitFilename) return explicitFilename;
  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
  const inferred = inferTopicAndStyleFromPrompt(prompt);
  const finalTopic = sanitizeSegment(topic, "") || inferred.topic;
  const finalStyle = sanitizeSegment(style, "") || inferred.style;
  return `${finalTopic}_${finalStyle}_${formatTimestampCompact(date)}.${cleanExt}`;
}

export function expandHomePath(rawPath, home = os.homedir()) {
  if (!rawPath) return "";
  const str = String(rawPath).trim();
  if (str === "~") return home;
  if (str.startsWith("~/") || str.startsWith("~\\")) {
    return path.join(home, str.slice(2));
  }
  return path.resolve(str);
}

export function resolveTargetOutputDir(
  explicitOutputDir = "",
  env = process.env,
  { category = "", date = new Date() } = {},
) {
  const home = env?.HOME || env?.USERPROFILE || os.homedir();
  if (explicitOutputDir && String(explicitOutputDir).trim()) {
    const resolvedExplicit = expandHomePath(explicitOutputDir, home);
    if (category && String(category).trim()) {
      return path.join(resolvedExplicit, sanitizeSegment(category, "通用出图"), formatDateYYYYMMDD(date));
    }
    return resolvedExplicit;
  }

  let baseDir = path.resolve("./images");
  let folderStructure = "category_date";
  const routerCfgPath = env?.LEO_IMAGINE_ROUTER_CONFIG_PATH
    ? expandHomePath(env.LEO_IMAGINE_ROUTER_CONFIG_PATH, home)
    : path.join(home, ".shrimp", "skills", "leo-imagine-router", "config.json");
  if (fs.existsSync(routerCfgPath)) {
    try {
      const rcfg = JSON.parse(fs.readFileSync(routerCfgPath, "utf8").replace(/^\uFEFF/, ""));
      if (rcfg?.output_dir) {
        baseDir = expandHomePath(rcfg.output_dir, home);
      }
      if (rcfg?.folder_structure) {
        folderStructure = rcfg.folder_structure;
      }
    } catch {
      // fall through to defaults
    }
  }

  if (folderStructure === "flat" && !category) {
    return baseDir;
  }
  const cleanCat = sanitizeSegment(category, "通用出图");
  return path.join(baseDir, cleanCat, formatDateYYYYMMDD(date));
}

function summarizeAuthState(auth = {}) {
  if (!auth.refresh_token && !auth.access_token) return "未登录 (missing_credentials)";
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(auth.expires_at || 0);
  if (auth.access_token && exp > now) {
    const mins = Math.round((exp - now) / 60);
    return `已登录 (有效剩余 ${mins} 分钟${auth.account_id ? `, ${auth.account_id}` : ""})`;
  }
  if (auth.refresh_token) {
    return `已绑定刷新令牌 (将在调用时自动刷新${auth.account_id ? `, ${auth.account_id}` : ""})`;
  }
  return "令牌已过期且无 refresh_token";
}

function printConfigSummary(cfg, proxyInfo, configPath, log = console.log) {
  log(`[leo-antigravity-imagine] 配置文件: ${configPath}`);
  log(`  default_model: ${cfg.default_model}`);
  log(`  models:        ${cfg.models.join(", ")}`);
  log(`  config_proxy:  ${cfg.proxy || "(自动继承本机环境变量/系统代理)"}`);
  log(`  active_proxy:  ${proxyInfo.url || "(直连)"} [来源: ${proxyInfo.source}]`);
  log(`  auth_status:   ${summarizeAuthState(cfg.auth)}`);
  log(`  auth.account:  ${cfg.auth.account_id || "(未设置)"}`);
  log(`  auth.project:  ${cfg.auth.project || "(首次调用自动解析)"}`);
  log(`  client_id:     ${cfg.auth.client_id ? maskSecret(cfg.auth.client_id) : "(未设置)"}`);
  log(`  client_secret: ${cfg.auth.client_secret ? maskSecret(cfg.auth.client_secret) : "(未设置)"}`);
  log(`  refresh_token: ${cfg.auth.refresh_token ? maskSecret(cfg.auth.refresh_token) : "(未设置)"}`);
  log(`  access_token:  ${cfg.auth.access_token ? maskSecret(cfg.auth.access_token) : "(未设置)"}`);
  if (cfg.updated_at) log(`  updated_at:    ${cfg.updated_at}`);
}

function showHelp(log = console.log) {
  log(`
🎨 leo-antigravity-imagine - 独立运行版 Google Antigravity 订阅图片生成 Skill

特点:
  ✅ 零网关依赖、零第三方 npm 依赖，纯 Node.js 原生 HTTP/2 gRPC 直连
  ✅ 模型列表与 OAuth 密钥统一持久化于 ~/.shrimp/skills/leo-antigravity-imagine/config.json (0600)
  ✅ 自动继承本机代理 (--proxy > config.proxy > HTTPS_PROXY/HTTP_PROXY > macOS scutil / Windows 系统代理)
  ✅ 原生支持画面比例 (--aspect-ratio) 与高清分辨率 (--image-size 1K/2K/4K) 及多张参考图

用法:
  1. 生成图片:
     node leo_antigravity_imagine.mjs --prompt "提示词" [--model <model>] [--aspect-ratio 16:9] [--image-size 2K]

  2. 查看模型与远端可用模型发现:
     node leo_antigravity_imagine.mjs list [--remote] [--sync]

  3. 浏览器 OAuth 登录 (自动从本机 Antigravity.app 提取客户端凭据):
     node leo_antigravity_imagine.mjs login [--no-browser]

  4. 配置与密钥管理:
     node leo_antigravity_imagine.mjs config get
     node leo_antigravity_imagine.mjs config import [--from /path/to/antigravity.secrets.json]
     node leo_antigravity_imagine.mjs config set [--models m1,m2] [--default-model m] [--proxy http://127.0.0.1:7897]

生图参数:
  --prompt <text>          图片描述提示词（必填）
  --images <p1,p2>         参考图路径或 URL（逗号分隔或多次传 --image）
  --model <model>          生图模型（默认取 default_model，即 gemini-3.1-flash-image）
  --aspect-ratio <ratio>   画面比例 (1:1 / 16:9 / 9:16 / 3:4 / 4:3 / 3:2 / 2:3 / 21:9, 默认 auto)
  --image-size <size>      分辨率档位 (512 / 1K / 2K / 4K, 可选)
  --quality <level>        画质档位 (low=1K / medium=2K / high=4K)
  --category, --cat <cat>  归档场景大类 (海报艺术/拆解图鉴/商业包装/视觉信息图/古代书画/影视分镜/脑洞跨界/通用出图，默认 通用出图)
  --topic <topic>          归档文件主题词 (用于生成 <主题>_<细分风格>_<YYYYMMDD_HHmmss>.<ext>)
  --style <style>          归档文件细分风格词
  --output-dir <dir>       输出目录 (未指定时自动按 <Router配置或./images>/<场景大类>/<YYYY-MM-DD>/ 分层归档)
  --filename <name>        自定义输出文件名 (别名 --image-name)
  --proxy <url>            临时指定代理地址
  --no-proxy               本次请求强制直连，不使用任何代理
  --dry-run                预检模式：打印配置、代理与请求摘要，不实际发起生图
  --help, -h               显示帮助说明
`);
}

export async function runCli(argv = process.argv.slice(2), { env = process.env, log = console.log } = {}) {
  const args = parseCliArgs(argv);
  if (args.help) {
    showHelp(log);
    return;
  }

  const cfg = loadSkillConfig(env);
  const proxyInfo = resolveProxyInfo({
    cliProxy: args.proxy,
    noProxy: args.noProxy,
    configProxy: cfg.proxy,
    env,
  });

  if (args.command === "list") {
    log("[leo-antigravity-imagine] 本地已配置模型:");
    for (const m of cfg.models) {
      log(`  - ${m}${m === cfg.default_model ? " (default)" : ""}`);
    }
    log(`  登录状态: ${summarizeAuthState(cfg.auth)}`);
    log(`  生效代理: ${proxyInfo.url || "(直连)"} [${proxyInfo.source}]`);

    if (args.remote) {
      const auth = await ensureFreshAuth({ env, proxyUrl: proxyInfo.url });
      let project = auth.project || "";
      if (!project) {
        const loaded = await loadCodeAssist({ accessToken: auth.access_token, proxyUrl: proxyInfo.url, env });
        project = loaded.project;
        updateSkillAuth({ project }, env);
      }
      const remote = await fetchRemoteModels({
        accessToken: auth.access_token,
        project,
        proxyUrl: proxyInfo.url,
        env,
      });
      log("\n[leo-antigravity-imagine] 远端订阅当前开放的生图模型 (fetchAvailableModels):");
      if (remote.imageModels.length === 0) {
        log("  (未筛选到名称含 image 的模型)");
      } else {
        for (const rm of remote.imageModels) {
          log(`  - ${rm.id} (${rm.displayName})`);
        }
      }
      if (args.sync && remote.imageModels.length > 0) {
        const latest = loadSkillConfig(env);
        const mergedModels = [...new Set([...latest.models, ...remote.imageModels.map((x) => x.id)])];
        saveSkillConfig({ ...latest, models: mergedModels }, env);
        log(`[leo-antigravity-imagine] 已同步远端生图模型至配置文件: ${mergedModels.join(", ")}`);
      }
    }
    return;
  }

  if (args.command === "login") {
    const saved = await runInteractiveLogin({
      env,
      proxyUrl: proxyInfo.url,
      port: args.port || 18789,
      noBrowser: Boolean(args.noBrowser),
      log,
    });
    try {
      const { project } = await loadCodeAssist({
        accessToken: saved.auth.access_token,
        proxyUrl: proxyInfo.url,
        env,
      });
      updateSkillAuth({ project }, env);
    } catch (err) {
      log(`[leo-antigravity-imagine] 提示: 预解析 project 暂未完成 (${err.message})，将在首次生图时自动重试。`);
    }
    const finalCfg = loadSkillConfig(env);
    log(`[leo-antigravity-imagine] 登录成功！凭据已保存至 ${resolveSkillConfigPath(env)}`);
    printConfigSummary(finalCfg, proxyInfo, resolveSkillConfigPath(env), log);
    return;
  }

  if (args.command === "config") {
    const action = args.configAction || "get";
    if (action === "get") {
      printConfigSummary(cfg, proxyInfo, resolveSkillConfigPath(env), log);
      return;
    }
    if (action === "import") {
      const saved = importSecretsFromFile(args.from, env);
      log(`[leo-antigravity-imagine] 已成功导入 Antigravity 密钥至 ${resolveSkillConfigPath(env)}`);
      printConfigSummary(saved, proxyInfo, resolveSkillConfigPath(env), log);
      return;
    }
    if (action === "set") {
      const next = {
        ...cfg,
        models: [...cfg.models],
        auth: { ...cfg.auth },
      };
      if (args.models || args.model) {
        const added = [...toList(args.models), ...toList(args.model)];
        next.models = args.models ? added : [...new Set([...next.models, ...added])];
      }
      if (args.removeModel) {
        next.models = next.models.filter((m) => m !== args.removeModel);
      }
      if (args.defaultModel) {
        next.default_model = args.defaultModel.trim();
        if (!next.models.includes(next.default_model)) {
          next.models.unshift(next.default_model);
        }
      }
      if (args.noProxy) {
        next.proxy = "direct";
      } else if (args.proxy !== undefined) {
        next.proxy = String(args.proxy).trim();
      }
      if (args.clientId !== undefined) next.auth.client_id = args.clientId;
      if (args.clientSecret !== undefined) next.auth.client_secret = args.clientSecret;
      if (args.refreshToken !== undefined) next.auth.refresh_token = args.refreshToken;
      if (args.accessToken !== undefined) next.auth.access_token = args.accessToken;
      if (args.expiresAt !== undefined) next.auth.expires_at = Number(args.expiresAt) || 0;
      if (args.accountId !== undefined) next.auth.account_id = args.accountId;
      if (args.project !== undefined) next.auth.project = args.project;

      const saved = saveSkillConfig(next, env);
      const updatedProxy = resolveProxyInfo({ configProxy: saved.proxy, env });
      log(`[leo-antigravity-imagine] 配置已保存至 ${resolveSkillConfigPath(env)}`);
      printConfigSummary(saved, updatedProxy, resolveSkillConfigPath(env), log);
      return;
    }
    throw new Error(`未知的 config 子命令: ${action}（可选: get / set / import）`);
  }

  // Default command: generate
  if (!args.prompt) {
    throw new Error("--prompt 为必填参数。使用 --help 查看完整用法。");
  }

  const nowDate = new Date();
  const chosenModel = (args.model && args.model.trim()) || cfg.default_model || DEFAULT_IMAGE_MODEL;
  const effectiveImageSize = normalizeImageSize(args.imageSize, args.quality);
  const outputDir = resolveTargetOutputDir(args.outputDir, env, {
    category: args.category,
    date: nowDate,
  });
  const filename = generateSemanticFilename(args.prompt, "png", args.filename, {
    topic: args.topic,
    style: args.style,
    date: nowDate,
  });
  const filePath = path.join(outputDir, filename);

  if (args.dryRun) {
    const previewReq = buildImageGenerateRequest({
      prompt: args.prompt,
      model: chosenModel,
      aspectRatio: args.aspectRatio || "auto",
      imageSize: effectiveImageSize,
      imageParts: [],
      project: cfg.auth.project || "<auto-resolve>",
      accountId: cfg.auth.account_id || "",
    });
    log("[leo-antigravity-imagine] [dry-run] 预检模式:");
    log(`  配置文件: ${resolveSkillConfigPath(env)}`);
    log(`  登录状态: ${summarizeAuthState(cfg.auth)}`);
    log(`  使用模型: ${chosenModel}`);
    log(`  画面比例: ${args.aspectRatio || "auto"}`);
    if (effectiveImageSize) log(`  分辨档位: ${effectiveImageSize}`);
    if (args.imagePaths.length > 0) log(`  参考图片: ${args.imagePaths.length} 张 (${args.imagePaths.join(", ")})`);
    log(`  生效代理: ${proxyInfo.url || "(直连)"} [来源: ${proxyInfo.source}]`);
    log(`  输出文件: ${filePath}`);
    log(`  generationConfig: ${JSON.stringify(previewReq.request.generationConfig)}`);
    return;
  }

  const auth = await ensureFreshAuth({ env, proxyUrl: proxyInfo.url });
  let project = auth.project || "";
  let usedCachedProject = Boolean(project);
  if (!project) {
    const loaded = await loadCodeAssist({
      accessToken: auth.access_token,
      proxyUrl: proxyInfo.url,
      env,
    });
    project = loaded.project;
    updateSkillAuth({ project }, env);
  }

  const imageParts = [];
  for (const imgPath of args.imagePaths) {
    imageParts.push(await toImagePart(imgPath, { proxyUrl: proxyInfo.url }));
  }

  const executeGrpc = async (proj) => {
    const reqBody = buildImageGenerateRequest({
      prompt: args.prompt,
      model: chosenModel,
      aspectRatio: args.aspectRatio || "auto",
      imageSize: effectiveImageSize,
      imageParts,
      project: proj,
      accountId: auth.account_id || "",
    });
    return generateImageViaGrpc({
      accessToken: auth.access_token,
      body: reqBody,
      proxyUrl: proxyInfo.url,
      env,
      onProgress: (received, total) => {
        const pct = Math.min(100, Math.round((received / total) * 100));
        log(
          `[leo-antigravity-imagine] 接收图像数据中: ${(received / 1048576).toFixed(2)} MB / ${(total / 1048576).toFixed(2)} MB (${pct}%)`,
        );
      },
    });
  };

  log(
    `[leo-antigravity-imagine] 正在调用 Antigravity (${chosenModel}${args.aspectRatio && args.aspectRatio !== "auto" ? `, ${args.aspectRatio}` : ""}${effectiveImageSize ? `, ${effectiveImageSize}` : ""}) 生成图片...`,
  );

  let result;
  try {
    result = await executeGrpc(project);
  } catch (err) {
    if (usedCachedProject && err.grpcStatus === "7") {
      const reloaded = await loadCodeAssist({
        accessToken: auth.access_token,
        proxyUrl: proxyInfo.url,
        env,
      });
      project = reloaded.project;
      updateSkillAuth({ project }, env);
      result = await executeGrpc(project);
    } else {
      throw err;
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const imgBuf = Buffer.from(result.b64, "base64");
  let finalFilePath = filePath;
  if (!args.filename) {
    const detectedExt = detectBufferExt(imgBuf);
    if (detectedExt && detectedExt !== "png") {
      finalFilePath = filePath.replace(/\.[^.]+$/, `.${detectedExt}`);
    }
  }
  fs.writeFileSync(finalFilePath, imgBuf);

  if (args.model && registerModel(chosenModel, env)) {
    log(`[leo-antigravity-imagine] 已将模型 ${chosenModel} 自动登记到 config.json。`);
  }

  log(`SUCCESS: 图片已生成并保存至本地！`);
  log(`![Generated Image](${finalFilePath})`);
}

const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1]
  ? fs.existsSync(process.argv[1])
    ? fs.realpathSync(process.argv[1])
    : path.resolve(process.argv[1])
  : "";

if (currentFilePath === executedFilePath) {
  runCli().catch((err) => {
    console.error(`图片生成失败: ${err.message || err}`);
    process.exit(1);
  });
}
