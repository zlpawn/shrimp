import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type CommandAppStatus = {
  app?: {
    id?: string;
    displayName?: string;
    description?: string;
    type?: "executable" | "project";
    command?: string;
    args?: string[];
    supported?: boolean;
  };
  configured?: boolean;
  executablePath?: string;
  manuallyConfigured?: boolean;
  lastLaunchedAt?: string | null;
  error?: string | null;
  process?: {
    status?: "stopped" | "running" | "error";
    count?: number;
    launchedByPanel?: boolean;
  };
};

const state: {
  loading: boolean;
  error: string;
  apps: CommandAppStatus[];
  editingAppId: string | null;
  pathDrafts: Record<string, string>;
  actionBusy: Record<string, "" | "launch" | "restart" | "stop" | "rescan" | "save">;
} = {
  loading: false,
  error: "",
  apps: [],
  editingAppId: null,
  pathDrafts: {},
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

function renderCard(status: CommandAppStatus): string {
  const appId = status.app?.id || "unknown";
  const isProject = status.app?.type === "project";
  const isSupported = status.app?.supported !== false;
  const hasError = Boolean(status.error || status.process?.status === "error");
  const meta = statusMeta(status);
  const running = status.process?.status === "running";
  const busyAction = state.actionBusy[appId] || "";
  const isBusy = Boolean(busyAction);
  const isEditing = state.editingAppId === appId;
  const path = status.executablePath || (isProject ? "未检测到源码根目录" : (isSupported ? "未检测到可执行文件" : "当前平台暂不支持"));
  const pathLabel = isProject ? "源码根目录" : "可执行文件";
  const pathState = !status.executablePath
    ? (isSupported ? "未检测" : "平台不适用")
    : status.manuallyConfigured ? "手动路径" : "自动检测";
  const draft = state.pathDrafts[appId] ?? (status.executablePath || "");

  const commandBadges = isProject
    ? `<span class="command-apps-arg">${escapeHtml(status.app?.command || "npm run gateway:restart")}</span>`
    : (status.app?.args || []).map((arg) => `<span class="command-apps-arg">${escapeHtml(arg)}</span>`).join("");

  return `
    <div class="command-apps-card${running ? " is-running" : ""}${!isSupported ? " is-unsupported" : ""}${hasError ? " is-card-error" : ""}" data-app-id="${escapeHtml(appId)}">
      <div class="command-apps-header">
        <div>
          <h3>${escapeHtml(status.app?.displayName || appId)}</h3>
          <p>${escapeHtml(status.app?.description || (isProject ? "本地网关服务，支持热重启与服务状态监控。" : "Windows 兼容模式启动，避免每次打开终端。"))}</p>
        </div>
        <span class="command-apps-status ${meta.className}" role="status">
          <span class="command-apps-dot" aria-hidden="true"></span>${escapeHtml(meta.text)}
        </span>
      </div>

      <dl class="command-apps-meta">
        <div>
          <dt>${escapeHtml(pathLabel)}</dt>
          <dd class="command-apps-path" title="${escapeHtml(status.executablePath || path)}">${escapeHtml(path)}</dd>
          <span class="command-apps-badge">${escapeHtml(pathState)}</span>
        </div>
        <div>
          <dt>最近启动 / 重启</dt>
          <dd>${escapeHtml(formatTime(status.lastLaunchedAt))}</dd>
          <span class="command-apps-badge">${running ? `${Number(status.process?.count || 1)} 个进程` : (hasError ? "状态异常" : "无活动进程")}</span>
        </div>
      </dl>

      <div class="command-apps-args" aria-label="执行命令">
        ${commandBadges}
      </div>

      ${hasError ? `<div class="command-apps-hint is-error" style="color: #ef4444; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2);">${escapeHtml(status.error || "程序加载出现异常，可重新检测或配置手动路径。")}</div>` : ""}
      ${!hasError && !status.configured && !isEditing && isSupported ? `<div class="command-apps-hint">未找到 ${escapeHtml(status.app?.displayName || appId)}，可重新检测或填写手动路径。</div>` : ""}
      ${!hasError && !isSupported ? `<div class="command-apps-hint">该命令行程序仅支持 ${escapeHtml(status.app?.displayName === "Antigravity" ? "Windows" : "指定平台")}，当前操作系统无法直接运行。</div>` : ""}

      ${isEditing ? `
        <form class="command-apps-manual" onsubmit="window.__commandAppsSave(event, '${escapeHtml(appId)}')">
          <label for="command-apps-path-${escapeHtml(appId)}">${isProject ? "手动源码根目录路径" : "手动可执行文件路径"}</label>
          <input id="command-apps-path-${escapeHtml(appId)}" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(draft)}" placeholder="${isProject ? "D:\\agent-transfer" : "C:\\Users\\...\\Antigravity.exe"}" />
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
            <button class="btn btn-primary" onclick="window.__commandAppsLaunch('${escapeHtml(appId)}')" ${isBusy || !status.configured || !isSupported ? "disabled" : ""}>${busyAction === "launch" ? "启动中..." : "启动"}</button>
          `}
          <button class="btn" onclick="window.__commandAppsStop('${escapeHtml(appId)}')" ${isBusy || !running ? "disabled" : ""}>${busyAction === "stop" ? "停止中..." : "停止"}</button>
          <button class="btn" onclick="window.__commandAppsRescan('${escapeHtml(appId)}')" ${isBusy || !isSupported ? "disabled" : ""}>${busyAction === "rescan" ? "检测中..." : (isProject ? "重新检测" : "重新扫描")}</button>
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
  render();
  try {
    const data = await api<{ apps: CommandAppStatus[] }>("/v1/command-apps/apps");
    state.apps = data.apps || [];
    for (const app of state.apps) {
      if (app.app?.id) {
        state.pathDrafts[app.app.id] = app.executablePath || "";
      }
    }
  } catch (error: any) {
    state.error = error?.message || String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function runAction(
  appId: string,
  action: "launch" | "restart" | "stop" | "rescan" | "save",
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
    showToast(`${status.app?.displayName || appId} 已启动`, "success");
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

(window as any).__commandAppsLaunch = launch;
(window as any).__commandAppsRestart = restart;
(window as any).__commandAppsStop = stop;
(window as any).__commandAppsRescan = rescan;
(window as any).__commandAppsEditPath = editPath;
(window as any).__commandAppsCancelEdit = cancelEdit;
(window as any).__commandAppsSave = savePath;

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | null;
  if (target && target.id && target.id.startsWith("command-apps-path-")) {
    const appId = target.id.replace("command-apps-path-", "");
    state.pathDrafts[appId] = target.value;
  } else if (target?.id === "command-apps-path") {
    state.pathDrafts["antigravity"] = target.value;
  }
});

registerTab("command-apps", {
  onEnter: () => { void load(); },
});


