import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type CommandAppStatus = {
  app?: {
    id?: string;
    displayName?: string;
    args?: string[];
    supported?: boolean;
  };
  configured?: boolean;
  executablePath?: string;
  manuallyConfigured?: boolean;
  lastLaunchedAt?: string | null;
  process?: {
    status?: "stopped" | "running" | "error";
    count?: number;
    launchedByPanel?: boolean;
  };
};

const state: {
  loading: boolean;
  error: string;
  status: CommandAppStatus | null;
  pathDraft: string;
  editing: boolean;
  actionBusy: "" | "launch" | "stop" | "rescan" | "save";
} = {
  loading: false,
  error: "",
  status: null,
  pathDraft: "",
  editing: false,
  actionBusy: "",
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
          <h3>Antigravity</h3>
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

function renderUnsupported(): string {
  return `
    <div class="command-apps-card is-unsupported">
      <div class="command-apps-header">
        <div>
          <h3>Antigravity</h3>
          <p>当前系统暂不支持命令行程序管理，第一阶段仅支持 Windows。</p>
        </div>
      </div>
    </div>
  `;
}

function renderBody(): string {
  const status = state.status || {};
  const meta = statusMeta(status);
  const args = status.app?.args || [];
  const running = status.process?.status === "running";
  const busy = Boolean(state.actionBusy);
  const path = status.executablePath || "未检测到可执行文件";
  const pathState = !status.executablePath
    ? "未检测"
    : status.manuallyConfigured ? "手动路径" : "自动检测";

  return `
    <div class="command-apps-card${running ? " is-running" : ""}">
      <div class="command-apps-header">
        <div>
          <h3>${escapeHtml(status.app?.displayName || "Antigravity")}</h3>
          <p>Windows 兼容模式启动，避免每次打开终端。</p>
        </div>
        <span class="command-apps-status ${meta.className}" role="status">
          <span class="command-apps-dot" aria-hidden="true"></span>${escapeHtml(meta.text)}
        </span>
      </div>

      <dl class="command-apps-meta">
        <div>
          <dt>可执行文件</dt>
          <dd class="command-apps-path" title="${escapeHtml(status.executablePath || path)}">${escapeHtml(path)}</dd>
          <span class="command-apps-badge">${escapeHtml(pathState)}</span>
        </div>
        <div>
          <dt>最近启动</dt>
          <dd>${escapeHtml(formatTime(status.lastLaunchedAt))}</dd>
          <span class="command-apps-badge">${running ? `${Number(status.process?.count || 0)} 个进程` : "无活动进程"}</span>
        </div>
      </dl>

      <div class="command-apps-args" aria-label="启动参数">
        ${args.map((arg) => `<span class="command-apps-arg">${escapeHtml(arg)}</span>`).join("")}
      </div>

      ${state.error ? `<div class="command-apps-error" role="alert">${escapeHtml(state.error)}</div>` : ""}
      ${!status.configured && !state.editing ? `<div class="command-apps-hint">未找到 Antigravity，可重新扫描或填写手动路径。</div>` : ""}

      ${state.editing ? `
        <form class="command-apps-manual" onsubmit="window.__commandAppsSave(event)">
          <label for="command-apps-path">手动路径</label>
          <input id="command-apps-path" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(state.pathDraft)}" placeholder="C:\\Users\\...\\Antigravity.exe" />
          <div class="command-apps-actions">
            <button class="btn btn-primary" type="submit" ${busy ? "disabled" : ""}>${state.actionBusy === "save" ? "保存中..." : "保存路径"}</button>
            <button class="btn" type="button" onclick="window.__commandAppsCancelEdit()" ${busy ? "disabled" : ""}>取消</button>
          </div>
        </form>
      ` : `
        <div class="command-apps-actions">
          <button class="btn btn-primary" onclick="window.__commandAppsLaunch()" ${busy || !status.configured ? "disabled" : ""}>${state.actionBusy === "launch" ? "启动中..." : "启动"}</button>
          <button class="btn" onclick="window.__commandAppsStop()" ${busy || !running ? "disabled" : ""}>${state.actionBusy === "stop" ? "停止中..." : "停止"}</button>
          <button class="btn" onclick="window.__commandAppsRescan()" ${busy ? "disabled" : ""}>${state.actionBusy === "rescan" ? "扫描中..." : "重新扫描"}</button>
          <button class="btn" onclick="window.__commandAppsEditPath()" ${busy ? "disabled" : ""}>配置路径</button>
        </div>
      `}
    </div>
  `;
}

function render(): void {
  const root = rootEl();
  if (!root) return;
  if (state.loading) root.innerHTML = renderLoading();
  else if (state.status?.app?.supported === false) root.innerHTML = renderUnsupported();
  else root.innerHTML = renderBody();
}

async function load(): Promise<void> {
  state.loading = true;
  state.error = "";
  state.editing = false;
  render();
  try {
    state.status = await api<CommandAppStatus>("/v1/command-apps/status");
    state.pathDraft = state.status.executablePath || "";
  } catch (error: any) {
    state.error = error?.message || String(error);
    state.status = state.status || {};
  } finally {
    state.loading = false;
    render();
  }
}

async function runAction(action: typeof state.actionBusy, fn: () => Promise<void>): Promise<void> {
  if (state.actionBusy) return;
  state.actionBusy = action;
  state.error = "";
  render();
  try {
    await fn();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast("命令行程序操作失败", "danger");
  } finally {
    state.actionBusy = "";
    render();
  }
}

async function launch(): Promise<void> {
  await runAction("launch", async () => {
    state.status = await api<CommandAppStatus>("/v1/command-apps/apps/antigravity/launch", { method: "POST" });
    showToast("Antigravity 已启动", "success");
  });
}

async function stop(): Promise<void> {
  await runAction("stop", async () => {
    state.status = await api<CommandAppStatus>("/v1/command-apps/apps/antigravity/stop", { method: "POST" });
    showToast("Antigravity 已停止", "info");
  });
}

async function rescan(): Promise<void> {
  await runAction("rescan", async () => {
    const result = await api<{ selected?: { path?: string } | null }>("/v1/command-apps/discover");
    if (!result.selected?.path) {
      state.error = "重新扫描未找到 Antigravity，请尝试手动路径。";
      state.editing = true;
      return;
    }
    state.status = await api<CommandAppStatus>("/v1/command-apps/status");
    state.pathDraft = state.status.executablePath || result.selected.path;
    showToast("已找到 Antigravity", "success");
  });
}

function editPath(): void {
  state.pathDraft = state.status?.executablePath || "";
  state.editing = true;
  state.error = "";
  render();
}

function cancelEdit(): void {
  state.editing = false;
  state.pathDraft = state.status?.executablePath || "";
  render();
}

async function savePath(event: Event): Promise<void> {
  event.preventDefault();
  const value = state.pathDraft.trim();
  await runAction("save", async () => {
    state.status = await api<CommandAppStatus>("/v1/command-apps/apps/antigravity/config", {
      method: "PUT",
      body: JSON.stringify({ executablePath: value }),
    });
    state.editing = false;
    state.pathDraft = state.status?.executablePath || "";
    showToast("路径已保存", "success");
  });
}

(window as any).__commandAppsLaunch = launch;
(window as any).__commandAppsStop = stop;
(window as any).__commandAppsRescan = rescan;
(window as any).__commandAppsEditPath = editPath;
(window as any).__commandAppsCancelEdit = cancelEdit;
(window as any).__commandAppsSave = savePath;

document.addEventListener("input", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.id === "command-apps-path") state.pathDraft = (target as HTMLInputElement).value;
});

registerTab("command-apps", {
  onEnter: () => { void load(); },
});
