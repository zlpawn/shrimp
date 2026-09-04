import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type ModelSource = {
  type: "custom" | "gateway" | "local";
  client: string;
  endpointId: string | null;
  model: string;
};

type CommandAppLlm = {
  provider?: string;
  baseUrl?: string;
  model?: string;
  hasApiKey?: boolean;
  apiKeyMasked?: string | null;
  host?: string;
  port?: string;
  logLevel?: string;
  reasoningEffort?: string;
  temperature?: string;
  strictSchema?: string;
  embeddingsProvider?: string;
  embeddingsModel?: string;
  hasEmbeddingsApiKey?: boolean;
  rerankerProvider?: string;
  rerankerModel?: string;
};

type CommandAppStatus = {
  app?: {
    id?: string;
    displayName?: string;
    description?: string;
    type?: "executable" | "project" | "cli-daemon";
    command?: string;
    args?: string[];
    supported?: boolean;
    configurableLlm?: boolean;
    profileName?: string;
  };
  profileName?: string;
  configPath?: string;
  plugin?: {
    exists?: boolean;
    serverMode?: string | null;
    daemonProfile?: string;
    apiPort?: number;
    usedByCodex?: boolean;
  } | null;
  configured?: boolean;
  executablePath?: string;
  manuallyConfigured?: boolean;
  lastLaunchedAt?: string | null;
  error?: string | null;
  process?: {
    status?: "stopped" | "running" | "launching" | "error";
    count?: number;
    launchedByPanel?: boolean;
  };
  llm?: CommandAppLlm | null;
  llmSource?: ModelSource | null;
  embeddingSource?: ModelSource | null;
  endpoints?: {
    healthUrl?: string;
    mcpUrl?: string;
    port?: number;
  } | null;
};

type HindsightToolStatus = {
  uvAvailable: boolean;
  installed: boolean;
  managedByUv: boolean;
  version: string | null;
  executablePath: string | null;
  installCommand: string;
  updateCommand: string;
};

const HINDSIGHT_TOOL_ACTION_ENDPOINTS = {
  install: "/v1/command-apps/hindsight/install",
  update: "/v1/command-apps/hindsight/update",
} as const;

const state: {
  loading: boolean;
  error: string;
  apps: CommandAppStatus[];
  editingAppId: string | null;
  editingLlmAppId: string | null;
  pathDrafts: Record<string, string>;
  llmDrafts: Record<string, Required<CommandAppLlm>>;
  modelSources: Record<string, { llm: ModelSource; embedding: ModelSource }>;
  actionBusy: Record<string, "" | "launch" | "restart" | "stop" | "rescan" | "save" | "save-llm">;
  hindsightTool: HindsightToolStatus | null;
  hindsightToolError: string;
  hindsightToolBusy: "" | "install" | "update";
  memoryPageBusy: boolean;
  view: "list" | "hindsight";
} = {
  loading: false,
  error: "",
  apps: [],
  editingAppId: null,
  editingLlmAppId: null,
  pathDrafts: {},
  llmDrafts: {},
  modelSources: {},
  actionBusy: {},
  hindsightTool: null,
  hindsightToolError: "",
  hindsightToolBusy: "",
  memoryPageBusy: false,
  view: "list",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data as T;
}

function rootEl(): HTMLElement | null {
  return document.getElementById("command-apps-root");
}

function formatTime(value?: string | null): string {
  if (!value) return "尚未启动";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间无效";
  return date.toLocaleString();
}

function statusMeta(status: CommandAppStatus): { className: string; text: string } {
  if (status.error || status.process?.status === "error") {
    return { className: "is-error", text: "加载异常" };
  }
  if (status.app?.supported === false) {
    return { className: "is-neutral", text: "当前系统暂不支持" };
  }
  if (status.process?.status === "running") {
    return { className: "is-running", text: "运行中" };
  }
  if (status.process?.status === "launching") {
    return { className: "is-neutral", text: "启动中" };
  }
  return { className: "is-stopped", text: "已停止" };
}

function renderLoading(): string {
  return `
    <div class="command-apps-card">
      <div class="command-apps-header">
        <div>
          <h3>Shrimp</h3>
          <p>正在检测本机安装位置和运行状态</p>
        </div>
        <span class="command-apps-skeleton command-apps-skeleton-badge"></span>
      </div>
      <div class="command-apps-meta">
        <div class="command-apps-skeleton command-apps-skeleton-row"></div>
        <div class="command-apps-skeleton command-apps-skeleton-row"></div>
      </div>
    </div>
  `;
}

function llmDraftFor(status: CommandAppStatus): Required<CommandAppLlm> {
  const appId = status.app?.id || "unknown";
  return state.llmDrafts[appId] || llmDraftFromStatus(status.llm);
}

function llmDraftFromStatus(llm?: CommandAppLlm | null): Required<CommandAppLlm> {
  return {
    provider: llm?.provider || "openai",
    baseUrl: llm?.baseUrl || "",
    model: llm?.model || "",
    apiKey: "",
    host: llm?.host || "",
    port: llm?.port || "",
    logLevel: llm?.logLevel || "",
    reasoningEffort: llm?.reasoningEffort || "",
    temperature: llm?.temperature || "",
    strictSchema: llm?.strictSchema || "",
    embeddingsProvider: llm?.embeddingsProvider || "",
    embeddingsModel: llm?.embeddingsModel || "",
    embeddingsApiKey: "",
    rerankerProvider: llm?.rerankerProvider || "",
    rerankerModel: llm?.rerankerModel || "",
  };
}

function defaultModelSource(type: ModelSource["type"] = "gateway"): ModelSource {
  return { type, client: type === "local" ? "" : (clientNames()[0] || "codex"), endpointId: null, model: "" };
}

function normalizeModelSource(raw?: ModelSource | null, fallbackType: ModelSource["type"] = "gateway"): ModelSource {
  const type = raw?.type || fallbackType;
  return {
    type,
    client: String(raw?.client || (type === "gateway" ? (clientNames()[0] || "codex") : "")),
    endpointId: raw?.endpointId || null,
    model: String(raw?.model || ""),
  };
}

function sourcesFromStatus(status?: CommandAppStatus | null): { llm: ModelSource; embedding: ModelSource } {
  const llm = normalizeModelSource(status?.llmSource, "gateway");
  const embedding = normalizeModelSource(status?.embeddingSource, "local");
  if (llm.type === "gateway") llm.model = resolvedGatewayModel(llm);
  if (embedding.type === "gateway") embedding.model = resolvedGatewayModel(embedding, "embedding");
  return { llm, embedding };
}

function resolvedGatewayModel(source: ModelSource, purpose?: string): string {
  if (source.model && modelOptionsFor(source, purpose).includes(source.model)) return source.model;
  return modelOptionsFor(source, purpose)[0] || source.model || "";
}

function modeButtons(appId: string, kind: "llm" | "embedding", source: ModelSource): string {
  const modes = kind === "llm"
    ? [["gateway", "使用网关模型"], ["custom", "自定义上游"]]
    : [["gateway", "使用网关模型"], ["local", "本地默认"], ["custom", "自定义上游"]];
  return modes.map(([value, label]) => `
    <button type="button" class="command-apps-mode-btn ${source.type === value ? "active" : ""}" onclick="window.__commandAppsSourceModeChange('${escapeHtml(appId)}', '${kind}', '${value}')">${label}</button>
  `).join("");
}

function gatewayConfig(): any {
  const getConfig = (window as any).__gatewayConfig;
  return typeof getConfig === "function" ? getConfig() : { clients: {} };
}

function publicModelsFor(endpoint?: any): string[] {
  return [...new Set([
    ...(Array.isArray(endpoint?.models) ? endpoint.models : []),
    ...Object.keys(endpoint?.model_mapping || {}),
  ].filter(Boolean))];
}

function clientNames(): string[] {
  return Object.keys(gatewayConfig()?.clients || {});
}

function endpointsFor(client: string, purpose?: string): any[] {
  const endpoints = gatewayConfig()?.clients?.[client]?.endpoints || [];
  return endpoints.filter((endpoint) => {
    if (endpoint.enabled === false) return false;
    if (!purpose) return !endpoint.purpose;
    return endpoint.purpose === purpose;
  });
}

function modelOptionsFor(source: ModelSource, purpose?: string): string[] {
  if (source.endpointId) {
    const endpoint = endpointsFor(source.client, purpose).find((item) => item.id === source.endpointId);
    return publicModelsFor(endpoint);
  }
  const models = endpointsFor(source.client, purpose).flatMap((endpoint) => publicModelsFor(endpoint));
  return [...new Set(models)];
}

function isHindsightApp(status: CommandAppStatus): boolean {
  return Boolean(status.app?.id && String(status.app.id).startsWith("hindsight"));
}

function hindsightApps(): CommandAppStatus[] {
  return state.apps.filter(isHindsightApp);
}

function otherApps(): CommandAppStatus[] {
  return state.apps.filter((item) => !isHindsightApp(item));
}

function activeHindsight(): CommandAppStatus | null {
  const apps = hindsightApps();
  return apps.find((item) => item.plugin?.usedByCodex) || apps.find((item) => item.profileName === "coding-agent") || apps[0] || null;
}

function currentHashView(): "list" | "hindsight" {
  const hash = String(window.location.hash || "").replace(/^#/, "");
  const parts = hash.split("/");
  return parts[0] === "command-apps" && parts[1] === "hindsight" ? "hindsight" : "list";
}

function setView(view: "list" | "hindsight", { replace = false }: { replace?: boolean } = {}): void {
  state.view = view;
  const next = view === "hindsight" ? "#command-apps/hindsight" : "#command-apps";
  if (replace) history.replaceState(null, "", next);
  else if (window.location.hash !== next) history.pushState(null, "", next);
  render();
}

function profileLabel(status: CommandAppStatus): string {
  return status.profileName || status.app?.profileName || "default";
}

function daemonDescription(status: CommandAppStatus): string {
  const profileName = status.profileName || status.app?.profileName || "default";
  if (profileName === "coding-agent") {
    return "编码 Agent 插件默认使用的记忆库。给它配置 LLM 后，Codex / Antigravity 才会走这套模型和端口。";
  }
  if (status.plugin?.usedByCodex) {
    return "当前被编码 Agent 插件使用的记忆服务。页面上的 LLM / Base URL 会写入这个 profile。";
  }
  return "本地记忆服务。可配置自定义 LLM 中转，并由网关托管 daemon。";
}

function renderCard(status: CommandAppStatus): string {
  const appId = status.app?.id || "unknown";
  const isProject = status.app?.type === "project";
  const isDaemon = status.app?.type === "cli-daemon" || status.app?.configurableLlm === true;
  const isSupported = status.app?.supported !== false;
  const hasError = Boolean(status.error || status.process?.status === "error");
  const meta = statusMeta(status);
  const running = status.process?.status === "running";
  const busyAction = state.actionBusy[appId] || "";
  const isBusy = Boolean(busyAction);
  const isEditing = state.editingAppId === appId;
  const isEditingLlm = state.editingLlmAppId === appId;
  const path = status.executablePath || (isProject ? "未检测到源码根目录" : (isSupported ? (isDaemon ? "未检测到 hindsight-embed" : "未检测到可执行文件") : "当前平台暂不支持"));
  const pathLabel = isProject ? "源码根目录" : (isDaemon ? "CLI 路径" : "可执行文件");
  const pathState = !status.executablePath
    ? (isSupported ? "未检测" : "平台不适用")
    : status.manuallyConfigured ? "手动路径" : "自动检测";
  const draft = state.pathDrafts[appId] ?? (status.executablePath || "");
  const llm = llmDraftFor(status);
  const sources = state.modelSources[appId] || sourcesFromStatus(status);
  const llmModelOptions = modelOptionsFor(sources.llm);
  const embeddingModelOptions = modelOptionsFor(sources.embedding, "embedding");

  const commandBadges = isProject
    ? `<span class="command-apps-arg">${escapeHtml(status.app?.command || "npm run gateway:restart")}</span>`
    : (status.app?.args || []).map((arg) => `<span class="command-apps-arg">${escapeHtml(arg)}</span>`).join("");
  const llmSummary = isDaemon ? `
        <div>
          <dt>LLM 中转</dt>
          <dd class="command-apps-path">${escapeHtml(status.llm?.baseUrl || "未配置自定义 Base URL")}</dd>
          <span class="command-apps-badge">${escapeHtml(status.llm?.provider || "openai")}</span>
          <span class="command-apps-badge">${escapeHtml(status.llm?.model || "默认模型")}</span>
          <span class="command-apps-badge">${status.llm?.hasApiKey ? escapeHtml(status.llm?.apiKeyMasked || "已保存 Key") : "未配置 Key"}</span>
        </div>
        <div>
          <dt>MCP</dt>
          <dd class="command-apps-path">${escapeHtml(status.endpoints?.mcpUrl || "http://127.0.0.1:8888/mcp/default/")}</dd>
          <span class="command-apps-badge">:${Number(status.endpoints?.port || 8888)}</span>
        </div>
        <div>
          <dt>Profile</dt>
          <dd class="command-apps-path">${escapeHtml(status.profileName || status.app?.profileName || "default")}</dd>
          <span class="command-apps-badge">${escapeHtml(status.configPath || (status.profileName && status.profileName !== "default" ? `~/.hindsight/profiles/${status.profileName}.env` : "~/.hindsight/embed"))}</span>
          ${status.plugin?.usedByCodex ? `<span class="command-apps-badge is-codex">插件正在使用</span>` : ""}
        </div>` : "";

  return `
    <div class="command-apps-card${running ? " is-running" : ""}${!isSupported ? " is-unsupported" : ""}${hasError ? " is-card-error" : ""}" data-app-id="${escapeHtml(appId)}">
      <div class="command-apps-header">
        <div>
          <h3>${escapeHtml(isDaemon && state.view === "hindsight" ? profileLabel(status) : (status.app?.displayName || appId))}</h3>
          <p>${escapeHtml(isDaemon ? daemonDescription(status) : (status.app?.description || (isProject ? "本地网关服务，支持热重启与服务状态监控。" : "Windows 兼容模式启动，避免每次打开终端。")))}</p>
        </div>
        <span class="command-apps-status ${meta.className}" role="status">
          <span class="command-apps-dot" aria-hidden="true"></span>${escapeHtml(meta.text)}
        </span>
      </div>

      <dl class="command-apps-meta${isDaemon ? " is-daemon" : ""}">
        <div>
          <dt>${escapeHtml(pathLabel)}</dt>
          <dd class="command-apps-path" title="${escapeHtml(status.executablePath || path)}">${escapeHtml(path)}</dd>
          <span class="command-apps-badge">${escapeHtml(pathState)}</span>
        </div>
        <div>
          <dt>最近启动 / 重启</dt>
          <dd>${escapeHtml(formatTime(status.lastLaunchedAt))}</dd>
          <span class="command-apps-badge">${status.process?.status === "launching" ? "正在加载模型，首次可能需要 1-3 分钟" : (running ? `${Number(status.process?.count || 1)} 个进程` : (hasError ? "状态异常" : "无活动进程"))}</span>
        </div>
        ${llmSummary}
      </dl>

      <div class="command-apps-args" aria-label="执行命令">
        ${commandBadges}
      </div>

      ${hasError ? `<div class="command-apps-hint is-error" style="color: #ef4444; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2);">${escapeHtml(status.error || "程序加载出现异常，可重新检测或配置手动路径。")}</div>` : ""}
      ${!hasError && !status.configured && !isEditing && isSupported ? `<div class="command-apps-hint">未找到 ${escapeHtml(status.app?.displayName || appId)}，可重新检测或填写手动路径。</div>` : ""}
      ${!hasError && !isSupported ? `<div class="command-apps-hint">该命令行程序仅支持 ${escapeHtml(status.app?.displayName === "Antigravity" ? "Windows" : "指定平台")}，当前操作系统无法直接运行。</div>` : ""}

      ${isEditingLlm ? `
        <form class="command-apps-manual" onsubmit="window.__commandAppsSaveLlm(event, '${escapeHtml(appId)}')">
          <div class="command-apps-form-title">模型服务（LLM）</div>
          <label>配置方式</label>
          <div class="command-apps-mode-row">${modeButtons(appId, "llm", sources.llm)}</div>
          <div class="command-apps-field-help">网关模式由网关托管模型和密钥；自定义模式才需要填写 Provider、Base URL 和 API Key。</div>
${sources.llm.type === "gateway" ? `
          <label for="command-apps-llm-source-client-${escapeHtml(appId)}">使用网关模型 · Client</label>
          <select id="command-apps-llm-source-client-${escapeHtml(appId)}" onchange="window.__commandAppsSourceChange('${escapeHtml(appId)}', 'llm', 'client', this.value)">
            ${clientNames().map((client) => `<option value="${escapeHtml(client)}" ${sources.llm.client === client ? "selected" : ""}>${escapeHtml(client)}</option>`).join("")}
          </select>
          <label for="command-apps-llm-source-endpoint-${escapeHtml(appId)}">代理节点</label>
          <select id="command-apps-llm-source-endpoint-${escapeHtml(appId)}" onchange="window.__commandAppsSourceChange('${escapeHtml(appId)}', 'llm', 'endpoint', this.value)">
            <option value="">自动路由</option>
            ${endpointsFor(sources.llm.client).map((endpoint) => `<option value="${escapeHtml(endpoint.id)}" ${sources.llm.endpointId === endpoint.id ? "selected" : ""}>${escapeHtml(endpoint.name || endpoint.id)} · ${publicModelsFor(endpoint)[0] || "未设置模型"}</option>`).join("")}
          </select>
          <label for="command-apps-llm-source-model-${escapeHtml(appId)}">模型</label>
          <select id="command-apps-llm-source-model-${escapeHtml(appId)}" onchange="window.__commandAppsSourceChange('${escapeHtml(appId)}', 'llm', 'model', this.value)" ${llmModelOptions.length ? "" : "disabled"}>
            ${llmModelOptions.map((model) => `<option value="${escapeHtml(model)}" ${sources.llm.model === model ? "selected" : ""}>${escapeHtml(model)}</option>`).join("") || `<option value="">无可用模型</option>`}
          </select>
          <div class="command-apps-field-help">选择具体节点后，模型来自该节点映射模型和模型列表；自动路由会列出该 Client 全部可用模型。点保存后会写入当前筛选项。</div>
` : `
          <div class="command-apps-hint">自定义模式会直接使用下方 Provider、Base URL、模型和 API Key，不再走本网关。</div>
`}
${sources.llm.type === "custom" ? `
          <label for="command-apps-llm-provider-${escapeHtml(appId)}">Provider</label>
          <input id="command-apps-llm-provider-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.provider)}" placeholder="openai" />
          <div class="command-apps-field-help">记忆抽取、反思和整理使用的模型协议，例如 openai、anthropic、deepseek、zai、ollama。</div>
          <label for="command-apps-llm-baseurl-${escapeHtml(appId)}">Base URL</label>
          <input id="command-apps-llm-baseurl-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.baseUrl)}" placeholder="https://your-endpoint.com/v1" />
          <div class="command-apps-field-help">兼容 OpenAI 的中转地址；直连官方服务时可留空。</div>
          <label for="command-apps-llm-model-${escapeHtml(appId)}">模型名称</label>
          <input id="command-apps-llm-model-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.model)}" placeholder="your-model-name" />
          <div class="command-apps-field-help">用于事实抽取、记忆反思和回答综合的模型。</div>
          <label for="command-apps-llm-apikey-${escapeHtml(appId)}">API Key${status.llm?.hasApiKey ? `（已保存 ${escapeHtml(status.llm?.apiKeyMasked || "****")}，留空则保持不变）` : ""}</label>
          <input id="command-apps-llm-apikey-${escapeHtml(appId)}" type="password" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.apiKey)}" placeholder="sk-..." />
          <div class="command-apps-field-help">密钥只写入该 profile 自己的配置文件，不会回传给浏览器。</div>
` : ""}

          <div class="command-apps-form-title">网络与端口</div>
          <label for="command-apps-llm-host-${escapeHtml(appId)}">服务监听地址</label>
          <input id="command-apps-llm-host-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.host)}" placeholder="127.0.0.1" />
          <div class="command-apps-field-help">默认 0.0.0.0 会监听所有网卡；仅本机使用建议填 127.0.0.1。</div>
          <label for="command-apps-llm-port-${escapeHtml(appId)}">API 端口</label>
          <input id="command-apps-llm-port-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.port)}" placeholder="8888" />
          <div class="command-apps-field-help">Hindsight daemon 的 HTTP/MCP 端口；修改后需重启 daemon 生效。</div>
          <label for="command-apps-llm-loglevel-${escapeHtml(appId)}">日志级别</label>
          <input id="command-apps-llm-loglevel-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.logLevel)}" placeholder="info" />
          <div class="command-apps-field-help">常用 debug、info、warning、error；排查启动失败时用 debug。</div>

          <div class="command-apps-form-title">LLM 高级选项</div>
          <label for="command-apps-llm-reasoning-${escapeHtml(appId)}">推理强度</label>
          <input id="command-apps-llm-reasoning-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.reasoningEffort)}" placeholder="low" />
          <div class="command-apps-field-help">支持 none、low、medium、high、xhigh；留空表示使用模型默认。</div>
          <label for="command-apps-llm-temperature-${escapeHtml(appId)}">全局温度</label>
          <input id="command-apps-llm-temperature-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.temperature)}" placeholder="none" />
          <div class="command-apps-field-help">可填 0.0-2.0 或 none；部分模型拒绝显式温度时必须填 none。</div>
          <label for="command-apps-llm-strict-${escapeHtml(appId)}">强制结构化输出</label>
          <input id="command-apps-llm-strict-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.strictSchema)}" placeholder="false" />
          <div class="command-apps-field-help">本地模型输出废话或 JSON 不稳定时设为 true。</div>

          <div class="command-apps-form-title">向量模型（Embedding）</div>
          <label>配置方式</label>
          <div class="command-apps-mode-row">${modeButtons(appId, "embedding", sources.embedding)}</div>
${sources.embedding.type === "gateway" ? `
          <label for="command-apps-embed-source-client-${escapeHtml(appId)}">使用网关模型 · Client</label>
          <select id="command-apps-embed-source-client-${escapeHtml(appId)}" onchange="window.__commandAppsSourceChange('${escapeHtml(appId)}', 'embedding', 'client', this.value)">
            ${clientNames().map((client) => `<option value="${escapeHtml(client)}" ${sources.embedding.client === client ? "selected" : ""}>${escapeHtml(client)}</option>`).join("")}
          </select>
          <label for="command-apps-embed-source-endpoint-${escapeHtml(appId)}">向量节点</label>
          <select id="command-apps-embed-source-endpoint-${escapeHtml(appId)}" onchange="window.__commandAppsSourceChange('${escapeHtml(appId)}', 'embedding', 'endpoint', this.value)">
            <option value="">自动路由</option>
            ${endpointsFor(sources.embedding.client, "embedding").map((endpoint) => `<option value="${escapeHtml(endpoint.id)}" ${sources.embedding.endpointId === endpoint.id ? "selected" : ""}>${escapeHtml(endpoint.name || endpoint.id)} · ${escapeHtml(endpoint.embedding_model || publicModelsFor(endpoint)[0] || "未设置模型")}</option>`).join("")}
          </select>
          <label for="command-apps-embed-source-model-${escapeHtml(appId)}">模型</label>
          <select id="command-apps-embed-source-model-${escapeHtml(appId)}" onchange="window.__commandAppsSourceChange('${escapeHtml(appId)}', 'embedding', 'model', this.value)" ${embeddingModelOptions.length ? "" : "disabled"}>
            ${embeddingModelOptions.map((model) => `<option value="${escapeHtml(model)}" ${sources.embedding.model === model ? "selected" : ""}>${escapeHtml(model)}</option>`).join("") || `<option value="">无可用模型</option>`}
          </select>
          <div class="command-apps-field-help">选择具体向量节点后，模型来自该节点的默认向量和模型列表；网关会使用节点配置的 Key。</div>
` : sources.embedding.type === "local" ? `
          <div class="command-apps-hint">使用 Hindsight 自带的本地向量模型，不请求外部服务；首次启动可能需要下载模型。</div>
` : `
          <div class="command-apps-hint">自定义模式会直接使用下方 Provider、模型和 API Key，不再走本网关。</div>
`}
${sources.embedding.type === "custom" ? `
          <label for="command-apps-llm-embed-provider-${escapeHtml(appId)}">Embedding Provider</label>
          <input id="command-apps-llm-embed-provider-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.embeddingsProvider)}" placeholder="local" />
          <div class="command-apps-field-help">local 使用本机模型；openai 使用 OpenAI-compatible embedding 服务；留空使用默认 local。</div>
          <label for="command-apps-llm-embed-model-${escapeHtml(appId)}">OpenAI-compatible 模型名</label>
          <input id="command-apps-llm-embed-model-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.embeddingsModel)}" placeholder="text-embedding-3-small" />
          <div class="command-apps-field-help">Provider 为 openai 时生效；local 模型请在 env 文件中高级配置。</div>
          <label for="command-apps-llm-embed-apikey-${escapeHtml(appId)}">Embedding API Key${status.llm?.hasEmbeddingsApiKey ? `（已保存，留空则保持不变）` : ""}</label>
          <input id="command-apps-llm-embed-apikey-${escapeHtml(appId)}" type="password" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.embeddingsApiKey)}" placeholder="sk-..." />
          <div class="command-apps-field-help">独立于主 LLM Key；仅在使用云端 embedding 服务时需要。</div>
` : ""}

          <div class="command-apps-form-title">重排模型（Reranker）</div>
          <label for="command-apps-llm-rerank-provider-${escapeHtml(appId)}">Reranker Provider</label>
          <input id="command-apps-llm-rerank-provider-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.rerankerProvider)}" placeholder="local" />
          <div class="command-apps-field-help">Reranker 用于对召回的记忆做二次精排，让真正相关的记忆排到前面。常用 local、flashrank、tei、cohere、siliconflow、alibaba、rrf。</div>
          <label for="command-apps-llm-rerank-model-${escapeHtml(appId)}">Reranker 模型名</label>
          <input id="command-apps-llm-rerank-model-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.rerankerModel)}" placeholder="BAAI/bge-reranker-v2-m3" />
          <div class="command-apps-field-help">local 填本地模型名；siliconflow 填托管模型名。云端 Provider 的 API Key 仍需在 env 文件中配置。</div>
          <div class="command-apps-hint">保存后写入 ${escapeHtml(status.configPath || "~/.hindsight/embed")}。已运行的 daemon 需要重启后才会使用新的中转配置。启动时会剥离 SOCKS 代理，避免 httpx 缺少 socksio。</div>
          <div class="command-apps-actions">
            <button class="btn btn-primary" type="submit" ${isBusy ? "disabled" : ""}>${busyAction === "save-llm" ? "保存中..." : "保存 LLM 配置"}</button>
            <button class="btn" type="button" onclick="window.__commandAppsCancelLlm('${escapeHtml(appId)}')" ${isBusy ? "disabled" : ""}>取消</button>
          </div>
        </form>
      ` : isEditing ? `
        <form class="command-apps-manual" onsubmit="window.__commandAppsSave(event, '${escapeHtml(appId)}')">
          <label for="command-apps-path-${escapeHtml(appId)}">${isProject ? "手动源码根目录路径" : (isDaemon ? "hindsight-embed 路径" : "手动可执行文件路径")}</label>
          <input id="command-apps-path-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(draft)}" placeholder="${isProject ? "D:\\agent-transfer" : (isDaemon ? "/Users/you/.local/bin/hindsight-embed" : "C:\\Users\\...\\Antigravity.exe")}" />
          <div class="command-apps-actions">
            <button class="btn btn-primary" type="submit" ${isBusy ? "disabled" : ""}>${busyAction === "save" ? "保存中..." : "保存路径"}</button>
            <button class="btn" type="button" onclick="window.__commandAppsCancelEdit('${escapeHtml(appId)}')" ${isBusy ? "disabled" : ""}>取消</button>
          </div>
        </form>
      ` : `
        <div class="command-apps-actions">
          ${isProject ? `
            <button class="btn btn-primary" onclick="window.__commandAppsRestart('${escapeHtml(appId)}')" ${isBusy || !status.configured || !isSupported ? "disabled" : ""}>${busyAction === "restart" || busyAction === "launch" ? (running ? "重启中..." : "启动中...") : (running ? "重启" : "启动")}</button>
          ` : `
            <button class="btn btn-primary" onclick="window.__commandAppsLaunch('${escapeHtml(appId)}')" ${isBusy || running || status.process?.status === "launching" || !status.configured || !isSupported ? "disabled" : ""}>${busyAction === "launch" || status.process?.status === "launching" ? "启动中..." : "启动"}</button>
          `}
          <button class="btn" onclick="window.__commandAppsStop('${escapeHtml(appId)}')" ${isBusy || (!running && status.process?.status !== "launching") ? "disabled" : ""}>${busyAction === "stop" ? "停止中..." : "停止"}</button>
          <button class="btn" onclick="window.__commandAppsRescan('${escapeHtml(appId)}')" ${isBusy || !isSupported ? "disabled" : ""}>${busyAction === "rescan" ? "检测中..." : (isProject ? "重新检测" : "重新扫描")}</button>
          ${isDaemon ? `<button class="btn" onclick="window.__commandAppsEditLlm('${escapeHtml(appId)}')" ${isBusy || !isSupported ? "disabled" : ""}>配置 LLM</button>` : ""}
          <button class="btn" onclick="window.__commandAppsEditPath('${escapeHtml(appId)}')" ${isBusy || !isSupported ? "disabled" : ""}>配置路径</button>
        </div>
      `}
    </div>
  `;
}

function renderHindsightSummary(): string {
  const profiles = hindsightApps();
  if (!profiles.length) return "";
  const active = activeHindsight();
  const runningCount = profiles.filter((item) => item.process?.status === "running").length;
  const launching = profiles.some((item) => item.process?.status === "launching");
  const hasError = profiles.some((item) => item.error || item.process?.status === "error");
  const tool = state.hindsightTool;
  const installed = tool ? tool.installed : hindsightApps().some((item) => item.configured);
  const meta = tool && !tool.installed
    ? { className: "is-stopped", text: "未安装" }
    : hasError
    ? { className: "is-error", text: "加载异常" }
    : launching
      ? { className: "is-neutral", text: "启动中" }
      : runningCount
        ? { className: "is-running", text: runningCount > 1 ? `${runningCount} 个记忆库运行中` : "运行中" }
        : { className: "is-stopped", text: "已停止" };
  const activeName = active ? profileLabel(active) : "coding-agent";
  const port = active?.endpoints?.port || 9077;
  const model = active?.llm?.model || "未配置模型";
  const toolBusy = Boolean(state.hindsightToolBusy);
  const versionText = state.hindsightToolError
    ? "工具状态检测失败"
    : tool?.installed && !tool.managedByUv
      ? "检测到非 uv 安装"
    : tool?.installed
      ? `hindsight-embed v${tool.version || "未知"}`
    : tool
      ? (tool.uvAvailable === false ? "未检测到 uv" : "hindsight-embed 未安装")
      : "正在检测工具版本";
  const installCommand = tool?.installCommand || "uv tool install hindsight-embed";
  const updateCommand = tool?.updateCommand || "uv tool upgrade hindsight-embed";
  const toolManagerText = !tool
    ? "状态未知"
    : tool.managedByUv
      ? "uv 管理"
      : tool.installed
        ? "外部安装"
        : "尚未安装";
  const toolCommand = tool?.managedByUv ? updateCommand : installCommand;
  return `
    <div class="command-apps-card${runningCount ? " is-running" : ""}${hasError ? " is-card-error" : ""}" data-app-id="hindsight">
      <div class="command-apps-header">
        <div>
          <h3>Hindsight</h3>
          <p>本地记忆服务。编码 Agent 共用插件记忆库；LLM 按记忆库分开配置。</p>
        </div>
        <span class="command-apps-status ${meta.className}" role="status">
          <span class="command-apps-dot" aria-hidden="true"></span>${escapeHtml(meta.text)}
        </span>
      </div>
      <dl class="command-apps-meta">
        <div>
          <dt>插件记忆库</dt>
          <dd class="command-apps-path">${escapeHtml(activeName)}</dd>
          <span class="command-apps-badge is-codex">:${Number(port)}</span>
          <span class="command-apps-badge">${escapeHtml(model)}</span>
        </div>
        <div>
          <dt>记忆库</dt>
          <dd>${profiles.length} 个 profile</dd>
          <span class="command-apps-badge">${profiles.map((item) => escapeHtml(profileLabel(item))).join(" · ")}</span>
        </div>
        <div>
          <dt>本地工具</dt>
          <dd class="command-apps-path">${escapeHtml(versionText)}</dd>
          <span class="command-apps-badge" title="${escapeHtml(toolCommand)}">${toolManagerText}</span>
        </div>
      </dl>
      <div class="command-apps-actions">
        ${tool?.installed === false
          ? `<button class="btn btn-primary" type="button" onclick="window.__commandAppsInstallHindsight()" ${toolBusy || tool.uvAvailable === false ? "disabled" : ""}>${state.hindsightToolBusy === "install" ? "正在安装..." : "安装 Hindsight"}</button>`
          : tool?.installed === true && tool.managedByUv
            ? `<button class="btn" type="button" onclick="window.__commandAppsUpdateHindsight()" ${toolBusy || tool.uvAvailable === false ? "disabled" : ""}>${state.hindsightToolBusy === "update" ? "正在更新..." : "更新 Hindsight"}</button>`
            : tool?.installed === true
              ? `<button class="btn" type="button" disabled>非 uv 安装</button>`
            : `<button class="btn" type="button" disabled>工具状态检测失败</button>`}
        <button class="btn btn-primary" onclick="window.__commandAppsOpenHindsight()" ${installed ? "" : "disabled"}>打开记忆库</button>
        <button class="btn" type="button" onclick="window.__commandAppsOpenMemoryPage()" ${state.memoryPageBusy || !installed ? "disabled" : ""}>${state.memoryPageBusy ? "正在打开..." : "打开记忆页面"}</button>
      </div>
      ${tool?.uvAvailable === false ? `<div class="command-apps-hint">安装和更新 Hindsight 需要先安装 uv。准备好后执行 <code>${escapeHtml(installCommand)}</code>。</div>` : ""}
      ${tool?.installed && !tool.managedByUv ? `<div class="command-apps-hint">当前 hindsight-embed 不由 uv 管理，原有启停功能仍可使用。请先手动迁移到 uv，再使用页面更新。</div>` : ""}
    </div>
  `;
}

function renderHindsightDetail(): string {
  const profiles = hindsightApps();
  const active = activeHindsight();
  const activeName = active ? profileLabel(active) : "coding-agent";
  return `
    <button class="btn" type="button" onclick="window.__commandAppsBackToList()" style="margin-bottom:16px">← 返回命令行程序</button>
    <div class="command-apps-detail-head">
      <div>
        <h3>Hindsight 记忆服务</h3>
        <p>每个 profile 有自己的端口和 LLM 配置。Codex / Antigravity 共用当前这间插件记忆库，不需要再点切换。</p>
      </div>
      <span class="command-apps-badge is-codex">插件当前使用 ${escapeHtml(activeName)}</span>
    </div>
    <div class="command-apps-profile-list">
      ${profiles.map((item) => renderCard(item)).join("")}
    </div>
  `;
}

function render(): void {
  const root = rootEl();
  if (!root) return;
  if (state.loading) {
    root.innerHTML = renderLoading();
    return;
  }
  if (state.error && !state.apps.length) {
    root.innerHTML = `<div class="command-apps-error" role="alert">${escapeHtml(state.error)}</div>`;
    return;
  }
  if (!state.apps.length) {
    root.innerHTML = `<div class="command-apps-hint">暂无已注册的命令行程序。</div>`;
    return;
  }

  const detail = state.view === "hindsight";
  root.innerHTML = `
    ${state.error ? `<div class="command-apps-error" role="alert" style="margin-bottom: 16px;">${escapeHtml(state.error)}</div>` : ""}
    ${detail ? renderHindsightDetail() : `<div style="display: flex; flex-direction: column; gap: 16px;">
      ${otherApps().map((app) => renderCard(app)).join("")}
      ${renderHindsightSummary()}
    </div>`}
  `;
}

async function load(): Promise<void> {
  state.loading = true;
  state.error = "";
  state.editingAppId = null;
  state.editingLlmAppId = null;
  render();
  try {
    const [data, toolResult] = await Promise.all([
      api<{ apps: CommandAppStatus[] }>("/v1/command-apps/apps"),
      api<HindsightToolStatus>("/v1/command-apps/hindsight/tool").catch((error: any) => ({
        error: error?.message || "工具状态检测失败",
      })),
    ]);
    state.apps = data.apps || [];
    if ("error" in toolResult) {
      state.hindsightTool = null;
      state.hindsightToolError = toolResult.error;
    } else {
      state.hindsightTool = toolResult;
      state.hindsightToolError = "";
    }
    state.view = currentHashView();
    for (const app of state.apps) {
      if (app.app?.id) {
        state.pathDrafts[app.app.id] = app.executablePath || "";
        state.llmDrafts[app.app.id] = llmDraftFromStatus(app.llm);
        state.modelSources[app.app.id] = sourcesFromStatus(app);
      }
    }
  } catch (error: any) {
    state.error = error?.message || String(error);
  } finally {
    state.loading = false;
    render();
    if (shouldPoll()) startPolling();
  }
}

function replaceAppStatuses(apps: CommandAppStatus[]): void {
  state.apps = apps || [];
  for (const app of state.apps) {
    if (!app.app?.id) continue;
    state.pathDrafts[app.app.id] = app.executablePath || "";
    state.llmDrafts[app.app.id] = llmDraftFromStatus(app.llm);
    state.modelSources[app.app.id] = sourcesFromStatus(app);
  }
}

async function runHindsightToolAction(action: "install" | "update"): Promise<void> {
  if (state.hindsightToolBusy) return;
  state.hindsightToolBusy = action;
  state.error = "";
  render();
  try {
    const result = await api<{ tool: HindsightToolStatus; apps: CommandAppStatus[] }>(
      HINDSIGHT_TOOL_ACTION_ENDPOINTS[action],
      { method: "POST", body: "{}" },
    );
    state.hindsightTool = result.tool;
    replaceAppStatuses(result.apps);
    showToast(action === "install" ? "Hindsight 安装完成" : "Hindsight 更新完成", "success");
    if (shouldPoll()) startPolling();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(action === "install" ? "Hindsight 安装失败" : "Hindsight 更新失败", "danger");
  } finally {
    state.hindsightToolBusy = "";
    render();
  }
}

async function installHindsight(): Promise<void> {
  await runHindsightToolAction("install");
}

async function updateHindsight(): Promise<void> {
  await runHindsightToolAction("update");
}

async function runAction(
  appId: string,
  action: "launch" | "restart" | "stop" | "rescan" | "save" | "save-llm",
  fn: () => Promise<void>,
): Promise<void> {
  if (state.actionBusy[appId]) return;
  state.actionBusy[appId] = action;
  state.error = "";
  render();
  try {
    await fn();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast("命令行程序操作失败", "danger");
  } finally {
    state.actionBusy[appId] = "";
    render();
  }
}

function updateAppStatus(status: CommandAppStatus): void {
  const appId = status.app?.id;
  if (!appId) return;
  const index = state.apps.findIndex((a) => a.app?.id === appId);
  if (index >= 0) {
    state.apps[index] = status;
  } else {
    state.apps.push(status);
  }
  state.pathDrafts[appId] = status.executablePath || "";
  if (state.editingLlmAppId !== appId) {
    state.modelSources[appId] = sourcesFromStatus(status);
  }
}

async function launch(appId: string = "antigravity"): Promise<void> {
  await runAction(appId, "launch", async () => {
    const status = await api<CommandAppStatus>(`/v1/command-apps/apps/${encodeURIComponent(appId)}/launch`, { method: "POST" });
    updateAppStatus(status);
    if (status.process?.status === "launching") {
      showToast(`${status.app?.displayName || appId} 正在启动，首次加载模型可能需要几分钟`, "info");
      startPolling();
    } else {
      showToast(`${status.app?.displayName || appId} 已启动`, "success");
    }
  });
}

async function restart(appId: string = "shrimp"): Promise<void> {
  await runAction(appId, "restart", async () => {
    const status = await api<CommandAppStatus>(`/v1/command-apps/apps/${encodeURIComponent(appId)}/restart`, { method: "POST" });
    updateAppStatus(status);
    showToast(`${status.app?.displayName || appId} 已触发重启`, "success");
  });
}

async function stop(appId: string = "antigravity"): Promise<void> {
  await runAction(appId, "stop", async () => {
    const status = await api<CommandAppStatus>(`/v1/command-apps/apps/${encodeURIComponent(appId)}/stop`, { method: "POST" });
    updateAppStatus(status);
    showToast(`${status.app?.displayName || appId} 已停止`, "info");
  });
}

async function rescan(appId: string = "antigravity"): Promise<void> {
  await runAction(appId, "rescan", async () => {
    const status = await api<CommandAppStatus>(`/v1/command-apps/apps/${encodeURIComponent(appId)}/discover`);
    updateAppStatus(status);
    if (!status.configured) {
      state.error = `重新检测未找到 ${status.app?.displayName || appId}，请尝试手动路径。`;
      state.editingAppId = appId;
      return;
    }
    showToast(`已检测到 ${status.app?.displayName || appId} 路径`, "success");
  });
}

function editPath(appId: string = "antigravity"): void {
  const current = state.apps.find((a) => a.app?.id === appId);
  state.pathDrafts[appId] = current?.executablePath || "";
  state.editingAppId = appId;
  state.editingLlmAppId = null;
  state.error = "";
  render();
}

function cancelEdit(appId: string = "antigravity"): void {
  if (state.editingAppId === appId) {
    state.editingAppId = null;
  }
  const current = state.apps.find((a) => a.app?.id === appId);
  state.pathDrafts[appId] = current?.executablePath || "";
  render();
}

async function savePath(event: Event, appId: string = "antigravity"): Promise<void> {
  event.preventDefault();
  const value = (state.pathDrafts[appId] || "").trim();
  await runAction(appId, "save", async () => {
    const status = await api<CommandAppStatus>(`/v1/command-apps/apps/${encodeURIComponent(appId)}/config`, {
      method: "PUT",
      body: JSON.stringify({ executablePath: value }),
    });
    updateAppStatus(status);
    if (state.editingAppId === appId) {
      state.editingAppId = null;
    }
    showToast("路径已保存", "success");
  });
}

function editLlm(appId: string = "hindsight"): void {
  const current = state.apps.find((a) => a.app?.id === appId);
  state.llmDrafts[appId] = llmDraftFromStatus(current?.llm);
  state.modelSources[appId] = sourcesFromStatus(current);
  state.editingLlmAppId = appId;
  state.editingAppId = null;
  state.error = "";
  render();
}

function sourceChange(appId: string, kind: "llm" | "embedding", field: "client" | "endpoint" | "model", value: string): void {
  const sources = state.modelSources[appId] || {
    llm: defaultModelSource(),
    embedding: defaultModelSource("local"),
  };
  const next = { ...sources[kind] };
  if (field === "client") {
    next.client = value;
    next.endpointId = null;
    next.model = resolvedGatewayModel({ ...next, client: value, endpointId: null, model: "" }, kind === "embedding" ? "embedding" : undefined);
  } else if (field === "endpoint") {
    next.endpointId = value || null;
    const endpoint = endpointsFor(next.client, kind === "embedding" ? "embedding" : undefined)
      .find((item) => item.id === next.endpointId);
    next.model = kind === "embedding"
      ? (endpoint?.embedding_model || publicModelsFor(endpoint)[0] || "")
      : publicModelsFor(endpoint)[0] || "";
  } else {
    next.model = value;
  }
  state.modelSources[appId] = { ...sources, [kind]: next };
  render();
}

function sourceModeChange(appId: string, kind: "llm" | "embedding", type: ModelSource["type"]): void {
  const sources = state.modelSources[appId] || {
    llm: defaultModelSource(),
    embedding: defaultModelSource("local"),
  };
  const next = { ...sources[kind], type };
  if (type === "gateway") {
    next.client = next.client || clientNames()[0] || "codex";
    next.endpointId = null;
    next.model = resolvedGatewayModel({ ...next, type: "gateway" }, kind === "embedding" ? "embedding" : undefined);
  } else if (type === "local") {
    next.client = "";
    next.endpointId = null;
    next.model = "";
  }
  state.modelSources[appId] = { ...sources, [kind]: next };
  render();
}

function cancelLlm(appId: string = "hindsight"): void {
  if (state.editingLlmAppId === appId) state.editingLlmAppId = null;
  const current = state.apps.find((a) => a.app?.id === appId);
  state.llmDrafts[appId] = llmDraftFromStatus(current?.llm);
  state.modelSources[appId] = sourcesFromStatus(current);
  render();
}

async function saveLlm(event: Event, appId: string = "hindsight"): Promise<void> {
  event.preventDefault();
  const draft = llmDraftFor({ app: { id: appId }, llm: state.llmDrafts[appId] });
  const sources = state.modelSources[appId];
  await runAction(appId, "save-llm", async () => {
    const embeddingMode = sources?.embedding?.type || "local";
    const llmMode = sources?.llm?.type || "custom";
    const llmSource = sources?.llm ? {
      ...sources.llm,
      type: llmMode,
      model: llmMode === "gateway" ? resolvedGatewayModel(sources.llm) : sources.llm.model,
    } : null;
    const embeddingSource = sources?.embedding ? {
      ...sources.embedding,
      type: embeddingMode,
      model: embeddingMode === "gateway" ? resolvedGatewayModel(sources.embedding, "embedding") : sources.embedding.model,
    } : null;
    const llm: Record<string, unknown> = {
      provider: draft.provider.trim(),
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      host: draft.host.trim(),
      port: draft.port.trim(),
      logLevel: draft.logLevel.trim(),
      reasoningEffort: draft.reasoningEffort.trim(),
      temperature: draft.temperature.trim(),
      strictSchema: draft.strictSchema.trim(),
      embeddingsProvider: embeddingMode === "local" ? "local" : draft.embeddingsProvider.trim(),
      embeddingsModel: embeddingMode === "local" ? "" : draft.embeddingsModel.trim(),
      rerankerProvider: draft.rerankerProvider.trim(),
      rerankerModel: draft.rerankerModel.trim(),
    };
    if (draft.apiKey.trim()) llm.apiKey = draft.apiKey.trim();
    if (embeddingMode !== "local" && draft.embeddingsApiKey.trim()) llm.embeddingsApiKey = draft.embeddingsApiKey.trim();
    if (embeddingMode === "local") llm.embeddingsApiKey = "";
    const status = await api<CommandAppStatus>(`/v1/command-apps/apps/${encodeURIComponent(appId)}/config`, {
      method: "PUT",
      body: JSON.stringify({
        llm,
        ...(llmSource && embeddingSource ? {
          llmSource,
          embeddingSource,
        } : {}),
      }),
    });
    updateAppStatus(status);
    state.modelSources[appId] = sourcesFromStatus(status);
    if (state.editingLlmAppId === appId) state.editingLlmAppId = null;
    state.llmDrafts[appId] = {
      ...llmDraftFromStatus(status.llm),
      provider: status.llm?.provider || draft.provider,
      baseUrl: status.llm?.baseUrl || draft.baseUrl,
      model: status.llm?.model || draft.model,
      apiKey: "",
    };
    showToast("LLM 配置已保存", "success");
  });
}

async function openMemoryPage(): Promise<void> {
  if (state.memoryPageBusy) return;
  state.memoryPageBusy = true;
  state.error = "";
  render();
  try {
    const data = await api<{ url: string }>("/v1/command-apps/hindsight/control-plane", {
      method: "POST",
      body: JSON.stringify({ bankId: "coding-agent::local-ai-gateway" }),
    });
    window.open(data.url, "_blank", "noopener,noreferrer");
    showToast("记忆页面已打开", "success");
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast("记忆页面打开失败", "danger");
  } finally {
    state.memoryPageBusy = false;
    render();
  }
}

(window as any).__commandAppsLaunch = launch;
(window as any).__commandAppsRestart = restart;
(window as any).__commandAppsStop = stop;
(window as any).__commandAppsRescan = rescan;
(window as any).__commandAppsEditPath = editPath;
(window as any).__commandAppsCancelEdit = cancelEdit;
(window as any).__commandAppsSave = savePath;
(window as any).__commandAppsEditLlm = editLlm;
(window as any).__commandAppsSourceChange = sourceChange;
(window as any).__commandAppsSourceModeChange = sourceModeChange;
(window as any).__commandAppsCancelLlm = cancelLlm;
(window as any).__commandAppsSaveLlm = saveLlm;
(window as any).__commandAppsOpenMemoryPage = openMemoryPage;
(window as any).__commandAppsInstallHindsight = installHindsight;
(window as any).__commandAppsUpdateHindsight = updateHindsight;

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | null;
  if (target && target.id && target.id.startsWith("command-apps-path-")) {
    const appId = target.id.replace("command-apps-path-", "");
    state.pathDrafts[appId] = target.value;
  } else if (target?.id === "command-apps-path") {
    state.pathDrafts["antigravity"] = target.value;
  } else if (target && target.id && target.id.startsWith("command-apps-llm-")) {
    const match = target.id.match(/^command-apps-llm-(provider|baseurl|model|apikey|host|port|loglevel|reasoning|temperature|strict|embed-provider|embed-model|embed-apikey|rerank-provider|rerank-model)-(.*)$/);
    if (!match) return;
    const field = match[1];
    const appId = match[2];
    const current = state.llmDrafts[appId] || llmDraftFromStatus(null);
    state.llmDrafts[appId] = {
      ...current,
      provider: field === "provider" ? target.value : current.provider,
      baseUrl: field === "baseurl" ? target.value : current.baseUrl,
      model: field === "model" ? target.value : current.model,
      apiKey: field === "apikey" ? target.value : current.apiKey,
      host: field === "host" ? target.value : current.host,
      port: field === "port" ? target.value : current.port,
      logLevel: field === "loglevel" ? target.value : current.logLevel,
      reasoningEffort: field === "reasoning" ? target.value : current.reasoningEffort,
      temperature: field === "temperature" ? target.value : current.temperature,
      strictSchema: field === "strict" ? target.value : current.strictSchema,
      embeddingsProvider: field === "embed-provider" ? target.value : current.embeddingsProvider,
      embeddingsModel: field === "embed-model" ? target.value : current.embeddingsModel,
      embeddingsApiKey: field === "embed-apikey" ? target.value : current.embeddingsApiKey,
      rerankerProvider: field === "rerank-provider" ? target.value : current.rerankerProvider,
      rerankerModel: field === "rerank-model" ? target.value : current.rerankerModel,
    };
  }
});

let pollTimer: number | null = null;

function stopPolling(): void {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function shouldPoll(): boolean {
  return state.apps.some((app) => app.process?.status === "launching" || state.actionBusy[app.app?.id || ""] === "launch");
}

function startPolling(): void {
  if (pollTimer != null) return;
  pollTimer = window.setInterval(() => {
    if (!shouldPoll()) {
      stopPolling();
      return;
    }
    void refreshQuietly();
  }, 2500);
}

async function refreshQuietly(): Promise<void> {
  try {
    const data = await api<{ apps: CommandAppStatus[] }>("/v1/command-apps/apps");
    state.apps = data.apps || [];
    for (const app of state.apps) {
      const appId = app.app?.id;
      if (!appId || state.editingLlmAppId === appId) continue;
      state.modelSources[appId] = sourcesFromStatus(app);
    }
    render();
    if (!shouldPoll()) stopPolling();
  } catch {
    // Keep the last known card state; the next poll retries.
  }
}

(window as any).__commandAppsOpenHindsight = function openHindsight(): void {
  setView("hindsight");
};
(window as any).__commandAppsBackToList = function backToList(): void {
  state.editingAppId = null;
  state.editingLlmAppId = null;
  setView("list");
};
(window as any).__commandAppsOpenSubView = function openSubView(subView?: string): void {
  setView(subView === "hindsight" ? "hindsight" : "list", { replace: true });
};

window.addEventListener("popstate", () => {
  if (!String(window.location.hash || "").startsWith("#command-apps")) return;
  const next = currentHashView();
  if (next !== state.view) {
    state.view = next;
    if (next === "list") {
      state.editingAppId = null;
      state.editingLlmAppId = null;
    }
    render();
  }
});

registerTab("command-apps", {
  onEnter: () => {
    state.view = currentHashView();
    void load();
  },
  onLeave: () => { stopPolling(); },
});
