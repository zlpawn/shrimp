import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type CommandAppLlm = {
  provider?: string;
  baseUrl?: string;
  model?: string;
  hasApiKey?: boolean;
  apiKeyMasked?: string | null;
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
  };
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
  endpoints?: {
    healthUrl?: string;
    mcpUrl?: string;
    port?: number;
  } | null;
};

const state: {
  loading: boolean;
  error: string;
  apps: CommandAppStatus[];
  editingAppId: string | null;
  editingLlmAppId: string | null;
  pathDrafts: Record<string, string>;
  llmDrafts: Record<string, { provider: string; baseUrl: string; model: string; apiKey: string }>;
  actionBusy: Record<string, "" | "launch" | "restart" | "stop" | "rescan" | "save" | "save-llm">;
} = {
  loading: false,
  error: "",
  apps: [],
  editingAppId: null,
  editingLlmAppId: null,
  pathDrafts: {},
  llmDrafts: {},
  actionBusy: {},
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

function llmDraftFor(status: CommandAppStatus) {
  const appId = status.app?.id || "unknown";
  return state.llmDrafts[appId] || {
    provider: status.llm?.provider || "openai",
    baseUrl: status.llm?.baseUrl || "",
    model: status.llm?.model || "",
    apiKey: "",
  };
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
        </div>` : "";

  return `
    <div class="command-apps-card${running ? " is-running" : ""}${!isSupported ? " is-unsupported" : ""}${hasError ? " is-card-error" : ""}" data-app-id="${escapeHtml(appId)}">
      <div class="command-apps-header">
        <div>
          <h3>${escapeHtml(status.app?.displayName || appId)}</h3>
          <p>${escapeHtml(status.app?.description || (isProject ? "本地网关服务，支持热重启与服务状态监控。" : (isDaemon ? "本地记忆服务。可配置自定义 LLM 中转，并由网关托管 daemon。" : "Windows 兼容模式启动，避免每次打开终端。")))}</p>
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
          <label for="command-apps-llm-provider-${escapeHtml(appId)}">Provider</label>
          <input id="command-apps-llm-provider-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.provider)}" placeholder="openai" />
          <label for="command-apps-llm-baseurl-${escapeHtml(appId)}">Base URL</label>
          <input id="command-apps-llm-baseurl-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.baseUrl)}" placeholder="https://your-endpoint.com/v1" />
          <label for="command-apps-llm-model-${escapeHtml(appId)}">模型名称</label>
          <input id="command-apps-llm-model-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.model)}" placeholder="your-model-name" />
          <label for="command-apps-llm-apikey-${escapeHtml(appId)}">API Key${status.llm?.hasApiKey ? `（已保存 ${escapeHtml(status.llm?.apiKeyMasked || "****")}，留空则保持不变）` : ""}</label>
          <input id="command-apps-llm-apikey-${escapeHtml(appId)}" type="password" spellcheck="false" autocomplete="off" value="${escapeHtml(llm.apiKey)}" placeholder="sk-..." />
          <div class="command-apps-hint">保存后写入 ~/.hindsight/embed。已运行的 daemon 需要重启后才会使用新的中转配置。启动时会剥离 SOCKS 代理，避免 httpx 缺少 socksio。</div>
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

  root.innerHTML = `
    ${state.error ? `<div class="command-apps-error" role="alert" style="margin-bottom: 16px;">${escapeHtml(state.error)}</div>` : ""}
    <div style="display: flex; flex-direction: column; gap: 16px;">
      ${state.apps.map((app) => renderCard(app)).join("")}
    </div>
  `;
}

async function load(): Promise<void> {
  state.loading = true;
  state.error = "";
  state.editingAppId = null;
  state.editingLlmAppId = null;
  render();
  try {
    const data = await api<{ apps: CommandAppStatus[] }>("/v1/command-apps/apps");
    state.apps = data.apps || [];
    for (const app of state.apps) {
      if (app.app?.id) {
        state.pathDrafts[app.app.id] = app.executablePath || "";
        state.llmDrafts[app.app.id] = {
          provider: app.llm?.provider || "openai",
          baseUrl: app.llm?.baseUrl || "",
          model: app.llm?.model || "",
          apiKey: "",
        };
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
  state.llmDrafts[appId] = {
    provider: current?.llm?.provider || "openai",
    baseUrl: current?.llm?.baseUrl || "",
    model: current?.llm?.model || "",
    apiKey: "",
  };
  state.editingLlmAppId = appId;
  state.editingAppId = null;
  state.error = "";
  render();
}

function cancelLlm(appId: string = "hindsight"): void {
  if (state.editingLlmAppId === appId) state.editingLlmAppId = null;
  const current = state.apps.find((a) => a.app?.id === appId);
  state.llmDrafts[appId] = {
    provider: current?.llm?.provider || "openai",
    baseUrl: current?.llm?.baseUrl || "",
    model: current?.llm?.model || "",
    apiKey: "",
  };
  render();
}

async function saveLlm(event: Event, appId: string = "hindsight"): Promise<void> {
  event.preventDefault();
  const draft = state.llmDrafts[appId] || { provider: "openai", baseUrl: "", model: "", apiKey: "" };
  await runAction(appId, "save-llm", async () => {
    const llm: Record<string, unknown> = {
      provider: draft.provider.trim(),
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
    };
    if (draft.apiKey.trim()) llm.apiKey = draft.apiKey.trim();
    const status = await api<CommandAppStatus>(`/v1/command-apps/apps/${encodeURIComponent(appId)}/config`, {
      method: "PUT",
      body: JSON.stringify({ llm }),
    });
    updateAppStatus(status);
    if (state.editingLlmAppId === appId) state.editingLlmAppId = null;
    state.llmDrafts[appId] = {
      provider: status.llm?.provider || draft.provider,
      baseUrl: status.llm?.baseUrl || draft.baseUrl,
      model: status.llm?.model || draft.model,
      apiKey: "",
    };
    showToast("LLM 配置已保存", "success");
  });
}

(window as any).__commandAppsLaunch = launch;
(window as any).__commandAppsRestart = restart;
(window as any).__commandAppsStop = stop;
(window as any).__commandAppsRescan = rescan;
(window as any).__commandAppsEditPath = editPath;
(window as any).__commandAppsCancelEdit = cancelEdit;
(window as any).__commandAppsSave = savePath;
(window as any).__commandAppsEditLlm = editLlm;
(window as any).__commandAppsCancelLlm = cancelLlm;
(window as any).__commandAppsSaveLlm = saveLlm;

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | null;
  if (target && target.id && target.id.startsWith("command-apps-path-")) {
    const appId = target.id.replace("command-apps-path-", "");
    state.pathDrafts[appId] = target.value;
  } else if (target?.id === "command-apps-path") {
    state.pathDrafts["antigravity"] = target.value;
  } else if (target && target.id && target.id.startsWith("command-apps-llm-")) {
    const match = target.id.match(/^command-apps-llm-(provider|baseurl|model|apikey)-(.*)$/);
    if (!match) return;
    const field = match[1];
    const appId = match[2];
    const current = state.llmDrafts[appId] || { provider: "openai", baseUrl: "", model: "", apiKey: "" };
    state.llmDrafts[appId] = {
      ...current,
      provider: field === "provider" ? target.value : current.provider,
      baseUrl: field === "baseurl" ? target.value : current.baseUrl,
      model: field === "model" ? target.value : current.model,
      apiKey: field === "apikey" ? target.value : current.apiKey,
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
    render();
    if (!shouldPoll()) stopPolling();
  } catch {
    // Keep the last known card state; the next poll retries.
  }
}

registerTab("command-apps", {
  onEnter: () => { void load(); },
  onLeave: () => { stopPolling(); },
});
