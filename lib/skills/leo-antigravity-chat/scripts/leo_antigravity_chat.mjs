import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CHAT_MODEL,
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
  buildChatGenerateRequest,
  chatViaGrpc,
  retrieveQuotaViaGrpc,
} from "./lib/client.mjs";
import {
  loadSession,
  saveSession,
  listSessions,
  clearSession,
} from "./lib/session.mjs";

export {
  DEFAULT_CHAT_MODEL,
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
    command: "ask",
    imagePaths: [],
  };

  let startIndex = 0;
  const first = argv[0];
  if (first === "ask") {
    args.command = "ask";
    startIndex = 1;
  } else if (first === "list") {
    args.command = "list";
    startIndex = 1;
  } else if (first === "quota") {
    args.command = "quota";
    startIndex = 1;
  } else if (first === "login") {
    args.command = "login";
    startIndex = 1;
  } else if (first === "config") {
    args.command = "config";
    args.configAction = argv[1] && !argv[1].startsWith("-") ? argv[1] : "get";
    startIndex = argv[1] && !argv[1].startsWith("-") ? 2 : 1;
  } else if (first === "session") {
    args.command = "session";
    args.sessionAction = argv[1] && !argv[1].startsWith("-") ? argv[1] : "list";
    startIndex = argv[1] && !argv[1].startsWith("-") ? 2 : 1;
    if ((args.sessionAction === "show" || args.sessionAction === "clear") && argv[startIndex] && !argv[startIndex].startsWith("-")) {
      args.sessionId = argv[startIndex];
      startIndex += 1;
    }
  }

  for (let i = startIndex; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--prompt" || key === "-p") { args.prompt = val; i++; }
    else if (key === "--system" || key === "-s") { args.system = val; i++; }
    else if (key === "--system-file") { args.systemFile = val; i++; }
    else if (key === "--images" || key === "--image" || key === "-i") {
      if (val) {
        args.imagePaths.push(...val.split(",").map((s) => s.trim()).filter(Boolean));
      }
      i++;
    }
    else if (key === "--session") { args.sessionId = val; i++; }
    else if (key === "--model" || key === "-m") { args.model = val; i++; }
    else if (key === "--models") { args.models = val; i++; }
    else if (key === "--remove-model") { args.removeModel = val; i++; }
    else if (key === "--default-model") { args.defaultModel = val; i++; }
    else if (key === "--temperature") { args.temperature = Number(val); i++; }
    else if (key === "--top-p") { args.topP = Number(val); i++; }
    else if (key === "--max-tokens" || key === "--max-output-tokens") { args.maxOutputTokens = Number(val); i++; }
    else if (key === "--thinking-budget") { args.thinkingBudget = Number(val); i++; }
    else if (key === "--show-thinking") { args.showThinking = true; }
    else if (key === "--stream") { args.stream = true; }
    else if (key === "--json") { args.json = true; }
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
  log(`[leo-antigravity-chat] 配置文件: ${configPath}`);
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
💬 leo-antigravity-chat - 独立运行版 Google Antigravity 订阅 CLI 问答 Skill

特点:
  ✅ 零网关依赖、零第三方 npm 依赖，纯 Node.js 原生 HTTP/2 gRPC 直连
  ✅ 凭据严格隔离：仅读写 ~/.shrimp/skills/leo-antigravity-chat/config.json (0600)
  ✅ 令牌过期前使用同文件内 refresh_token 自动续期并原子写回
  ✅ 支持多轮会话 (--session)、图片多模态 (--image)、流式输出 (--stream) 与 --json

用法:
  1. 问答 (默认命令 / ask):
     node leo_antigravity_chat.mjs --prompt "你的问题" [--model gemini-3.8-flash-high] [--session s1]
     echo "分析这段代码..." | node leo_antigravity_chat.mjs --model claude-sonnet-5-5-high

  2. 查看模型与远端发现:
     node leo_antigravity_chat.mjs list [--remote] [--sync] [--json]

  3. 查询当前订阅配额:
     node leo_antigravity_chat.mjs quota [--json]

  4. 浏览器 OAuth 登录:
     node leo_antigravity_chat.mjs login [--no-browser]

  5. 配置与密钥管理:
     node leo_antigravity_chat.mjs config get
     node leo_antigravity_chat.mjs config import --from /path/to/secrets.json
     node leo_antigravity_chat.mjs config set [--models m1,m2] [--default-model m] [--proxy http://127.0.0.1:7897]

  6. 多轮会话管理:
     node leo_antigravity_chat.mjs session list
     node leo_antigravity_chat.mjs session show <id>
     node leo_antigravity_chat.mjs session clear [id]

问答参数:
  --prompt, -p <text>      提问内容（传 - 或不传时若存在 stdin 管道输入则自动读取）
  --model, -m <model>      模型 ID（默认取 default_model，即 ${DEFAULT_CHAT_MODEL}）
  --system, -s <text>      追加系统提示词
  --system-file <path>     从文件读取系统提示词
  --images, -i <p1,p2>     附带图片路径或 URL（逗号分隔或重复传 --image）
  --session <id>           启用/续接多轮对话会话（持久化于 ~/.shrimp/skills/leo-antigravity-chat/sessions/）
  --temperature <num>      采样温度
  --top-p <num>            nucleus sampling 阈值
  --max-tokens <num>       最大输出 token 数
  --thinking-budget <num>  思考预算 token 数
  --show-thinking          在文本输出时附带展示思考过程
  --stream                 流式输出（仅非 --json 模式生效）
  --json                   输出结构化 JSON（含 text / thinking / usage / finish_reason）
  --proxy <url> / --no-proxy  覆盖或禁用代理
  --dry-run                预检模式：打印配置、代理与请求结构，不发起请求
  --help, -h               显示帮助说明
`);
}

async function readStdinText() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function resolveProject({ auth, proxyUrl, env }) {
  if (auth.project) return { project: auth.project, cached: true };
  const loaded = await loadCodeAssist({
    accessToken: auth.access_token,
    proxyUrl,
    env,
  });
  updateSkillAuth({ project: loaded.project }, env);
  return { project: loaded.project, cached: false };
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    env = process.env,
    log = console.log,
    writeStdout = (chunk) => process.stdout.write(chunk),
    writeStderr = (chunk) => process.stderr.write(chunk),
    stdinText = null,
  } = {},
) {
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
    if (args.remote) {
      const auth = await ensureFreshAuth({ env, proxyUrl: proxyInfo.url });
      const { project } = await resolveProject({ auth, proxyUrl: proxyInfo.url, env });
      const remote = await fetchRemoteModels({
        accessToken: auth.access_token,
        project,
        proxyUrl: proxyInfo.url,
        env,
      });
      if (args.sync && remote.chatModels.length > 0) {
        const latest = loadSkillConfig(env);
        const merged = [...new Set([...latest.models, ...remote.chatModels.map((m) => m.id)])];
        saveSkillConfig({ ...latest, models: merged }, env);
      }
      if (args.json) {
        log(JSON.stringify({
          ok: true,
          default_model: cfg.default_model,
          local_models: loadSkillConfig(env).models,
          remote_chat_models: remote.chatModels,
          remote_all_models: remote.allModels,
        }, null, 2));
        return;
      }
      log("[leo-antigravity-chat] 本地已配置模型:");
      for (const m of loadSkillConfig(env).models) {
        log(`  - ${m}${m === cfg.default_model ? " (default)" : ""}`);
      }
      log("\n[leo-antigravity-chat] 远端订阅当前开放模型 (fetchAvailableModels):");
      for (const rm of remote.chatModels) {
        log(`  - ${rm.id} (${rm.displayName})`);
      }
      if (args.sync) {
        log(`\n[leo-antigravity-chat] 已将远端对话模型同步至 ${resolveSkillConfigPath(env)}`);
      }
      return;
    }

    if (args.json) {
      log(JSON.stringify({
        ok: true,
        default_model: cfg.default_model,
        models: cfg.models,
        auth_status: summarizeAuthState(cfg.auth),
        proxy: proxyInfo,
      }, null, 2));
      return;
    }

    log("[leo-antigravity-chat] 本地已配置模型:");
    for (const m of cfg.models) {
      log(`  - ${m}${m === cfg.default_model ? " (default)" : ""}`);
    }
    log(`  登录状态: ${summarizeAuthState(cfg.auth)}`);
    log(`  生效代理: ${proxyInfo.url || "(直连)"} [${proxyInfo.source}]`);
    return;
  }

  if (args.command === "quota") {
    const auth = await ensureFreshAuth({ env, proxyUrl: proxyInfo.url });
    const quota = await retrieveQuotaViaGrpc({
      accessToken: auth.access_token,
      proxyUrl: proxyInfo.url,
      env,
    });
    if (args.json) {
      log(JSON.stringify({ ok: quota.available, ...quota }, null, 2));
      return;
    }
    if (!quota.available) {
      throw new Error(quota.error?.message || "未获取到配额信息");
    }
    log("[leo-antigravity-chat] 当前订阅配额:");
    for (const limit of quota.limits) {
      const pct = limit.remaining_percent != null ? `${limit.remaining_percent.toFixed(1)}%` : "未知";
      const reset = limit.reset_after ? ` (重置: ${limit.reset_after})` : "";
      log(`  - [${limit.group}] ${limit.label}: 剩余 ${pct}${reset}`);
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
      log(`[leo-antigravity-chat] 提示: 预解析 project 暂未完成 (${err.message})，将在首次问答时自动重试。`);
    }
    const finalCfg = loadSkillConfig(env);
    log(`[leo-antigravity-chat] 登录成功！凭据已保存至 ${resolveSkillConfigPath(env)}`);
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
      log(`[leo-antigravity-chat] 已导入密钥至 ${resolveSkillConfigPath(env)}`);
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
      log(`[leo-antigravity-chat] 配置已保存至 ${resolveSkillConfigPath(env)}`);
      printConfigSummary(saved, updatedProxy, resolveSkillConfigPath(env), log);
      return;
    }
    throw new Error(`未知的 config 子命令: ${action}（可选: get / set / import）`);
  }

  if (args.command === "session") {
    const action = args.sessionAction || "list";
    if (action === "list") {
      const items = listSessions(env);
      if (args.json) {
        log(JSON.stringify({ ok: true, sessions: items }, null, 2));
        return;
      }
      if (items.length === 0) {
        log("[leo-antigravity-chat] 暂无本地会话记录。");
        return;
      }
      log("[leo-antigravity-chat] 本地会话列表:");
      for (const s of items) {
        log(`  - ${s.id} (turns=${s.turn_count}, model=${s.model || "-"}, updated=${s.updated_at})`);
      }
      return;
    }
    if (action === "show") {
      if (!args.sessionId) throw new Error("请指定会话 ID：session show <id>");
      const s = loadSession(args.sessionId, env);
      log(JSON.stringify(s, null, 2));
      return;
    }
    if (action === "clear") {
      const removed = clearSession(args.sessionId || "", env);
      log(
        args.sessionId
          ? `[leo-antigravity-chat] 已清除会话 ${args.sessionId} (${removed} 条)。`
          : `[leo-antigravity-chat] 已清除全部会话 (${removed} 个)。`,
      );
      return;
    }
    throw new Error(`未知的 session 子命令: ${action}（可选: list / show / clear）`);
  }

  // Default command: ask
  let promptText = args.prompt;
  if (promptText === "-" || promptText === undefined) {
    const piped = stdinText != null ? stdinText : await readStdinText();
    if (piped) promptText = piped;
  }
  if (!promptText || !String(promptText).trim()) {
    throw new Error("请提供 --prompt <内容> 或通过 stdin 管道传入提问内容。使用 --help 查看帮助。");
  }
  promptText = String(promptText);

  let systemText = args.system || "";
  if (args.systemFile) {
    const resolvedSys = path.resolve(args.systemFile);
    if (!fs.existsSync(resolvedSys)) {
      throw new Error(`系统提示词文件不存在: ${resolvedSys}`);
    }
    systemText = [systemText, fs.readFileSync(resolvedSys, "utf8")].filter(Boolean).join("\n\n");
  }

  const session = args.sessionId ? loadSession(args.sessionId, env) : null;
  const effectiveSystem = systemText || session?.system || "";
  const chosenModel =
    (args.model && args.model.trim()) ||
    session?.model ||
    cfg.default_model ||
    DEFAULT_CHAT_MODEL;

  const userPartsPreview = [{ text: promptText }];
  if (args.dryRun) {
    const contentsPreview = [
      ...(session?.turns || []),
      { role: "user", parts: userPartsPreview },
    ];
    const reqPreview = buildChatGenerateRequest({
      contents: contentsPreview,
      system: effectiveSystem,
      model: chosenModel,
      temperature: args.temperature,
      topP: args.topP,
      maxOutputTokens: args.maxOutputTokens,
      thinkingBudget: args.thinkingBudget,
      includeThoughts: args.showThinking ? true : undefined,
      project: cfg.auth.project || "<auto-resolve>",
      accountId: cfg.auth.account_id || "",
    });
    const drySummary = {
      dry_run: true,
      config_path: resolveSkillConfigPath(env),
      auth_status: summarizeAuthState(cfg.auth),
      model: chosenModel,
      session_id: session?.id || null,
      history_turns: session?.turns?.length || 0,
      image_count: args.imagePaths.length,
      proxy: proxyInfo,
      generation_config: reqPreview.request.generationConfig || {},
    };
    if (args.json) {
      log(JSON.stringify(drySummary, null, 2));
    } else {
      log("[leo-antigravity-chat] [dry-run] 预检模式:");
      log(`  配置文件: ${drySummary.config_path}`);
      log(`  登录状态: ${drySummary.auth_status}`);
      log(`  使用模型: ${chosenModel}`);
      if (session) log(`  会话 ID:  ${session.id} (已有 ${session.turns.length} 条历史轮次)`);
      if (args.imagePaths.length) log(`  附带图片: ${args.imagePaths.join(", ")}`);
      log(`  生效代理: ${proxyInfo.url || "(直连)"} [来源: ${proxyInfo.source}]`);
    }
    return drySummary;
  }

  const auth = await ensureFreshAuth({ env, proxyUrl: proxyInfo.url });
  let { project, cached: usedCachedProject } = await resolveProject({
    auth,
    proxyUrl: proxyInfo.url,
    env,
  });

  const userParts = [{ text: promptText }];
  for (const imgPath of args.imagePaths) {
    userParts.push(await toImagePart(imgPath, { proxyUrl: proxyInfo.url }));
  }

  const contents = [
    ...(session?.turns || []),
    { role: "user", parts: userParts },
  ];

  const streamToStdout = Boolean(args.stream && !args.json);
  let streamedHeaderPrinted = false;
  let streamedTextStarted = false;

  const executeChat = async (proj) => {
    const reqBody = buildChatGenerateRequest({
      contents,
      system: effectiveSystem,
      model: chosenModel,
      temperature: args.temperature,
      topP: args.topP,
      maxOutputTokens: args.maxOutputTokens,
      thinkingBudget: args.thinkingBudget,
      includeThoughts: args.showThinking || args.json ? true : undefined,
      project: proj,
      accountId: auth.account_id || "",
    });
    return chatViaGrpc({
      accessToken: auth.access_token,
      body: reqBody,
      proxyUrl: proxyInfo.url,
      env,
      onThought: streamToStdout && args.showThinking
        ? (delta) => {
            if (!streamedHeaderPrinted) {
              writeStderr("[thinking]\n");
              streamedHeaderPrinted = true;
            }
            writeStderr(delta);
          }
        : null,
      onText: streamToStdout
        ? (delta) => {
            if (streamedHeaderPrinted && !streamedTextStarted) {
              writeStderr("\n[/thinking]\n");
            }
            streamedTextStarted = true;
            writeStdout(delta);
          }
        : null,
    });
  };

  let result;
  try {
    result = await executeChat(project);
  } catch (err) {
    if (usedCachedProject && err.grpcStatus === "7") {
      const reloaded = await loadCodeAssist({
        accessToken: auth.access_token,
        proxyUrl: proxyInfo.url,
        env,
      });
      project = reloaded.project;
      updateSkillAuth({ project }, env);
      result = await executeChat(project);
    } else {
      throw err;
    }
  }

  if (streamToStdout) {
    if (streamedHeaderPrinted && !streamedTextStarted) {
      writeStderr("\n[/thinking]\n");
    }
    writeStdout("\n");
  }

  if (session) {
    // Store clean user/model turns for multi-turn continuity.
    session.model = chosenModel;
    if (effectiveSystem) session.system = effectiveSystem;
    session.turns.push({ role: "user", parts: userParts });
    if (result.text) {
      session.turns.push({ role: "model", parts: [{ text: result.text }] });
    }
    saveSession(session, env);
  }

  if (args.model) {
    registerModel(chosenModel, env);
  }

  if (args.json) {
    const out = {
      ok: true,
      model: chosenModel,
      model_version: result.modelVersion || null,
      session_id: session?.id || null,
      text: result.text,
      ...(result.thinking ? { thinking: result.thinking } : {}),
      finish_reason: result.finishReason,
      ...(result.finishMessage ? { finish_message: result.finishMessage } : {}),
      usage: result.usage || null,
      ...(result.remainingCredits != null ? { remaining_credits: result.remainingCredits } : {}),
    };
    log(JSON.stringify(out, null, 2));
    return out;
  }

  if (!streamToStdout) {
    if (args.showThinking && result.thinking) {
      log(`[thinking]\n${result.thinking}\n[/thinking]\n`);
    }
    log(result.text);
  }

  return result;
}

const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1]
  ? fs.existsSync(process.argv[1])
    ? fs.realpathSync(process.argv[1])
    : path.resolve(process.argv[1])
  : "";

if (currentFilePath === executedFilePath) {
  runCli().catch((err) => {
    console.error(`问答调用失败: ${err.message || err}`);
    process.exit(1);
  });
}
