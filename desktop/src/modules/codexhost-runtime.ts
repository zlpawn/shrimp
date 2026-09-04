import { escapeHtml } from "../core/dom";

type CodexhostStatus = {
  runtime?: { installed?: boolean; version?: string | null; packageName?: string };
  process?: {
    status?: "stopped" | "launching" | "running" | "conflict" | "error";
    managed?: boolean;
    launcherPid?: number | null;
  };
  gateway?: { healthy?: boolean; port?: number | null; models?: number };
  codexConfig?: {
    healthy?: boolean;
    dataPlane?: { external?: boolean; gatewayPort?: number | null; healthy?: boolean };
    issues?: Array<{ message?: string }>;
  } | null;
  desktop?: { version?: string | null };
  actions?: { canStart?: boolean; canStop?: boolean; canOpenOfficial?: boolean };
  error?: string | null;
};

const state = {
  loading: false,
  status: null as CodexhostStatus | null,
  error: "",
  action: "" as "" | "start" | "stop" | "official",
};
let pollTimer: number | null = null;

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "HTTP " + response.status);
  return data;
}

function statusMeta() {
  const value = state.status?.process?.status;
  if (state.error || value === "error") return { className: "is-error", text: "状态异常" };
  if (value === "running") return { className: "is-running", text: "增强模式运行中" };
  if (value === "launching") return { className: "is-neutral", text: "正在启动" };
  if (value === "conflict") return { className: "is-error", text: "Codex 已在运行" };
  return { className: "is-stopped", text: "增强模式已停止" };
}

export function renderCodexhostRuntime(): string {
  const status = state.status;
  const meta = statusMeta();
  const installed = Boolean(status?.runtime?.installed);
  const issues = (status?.codexConfig?.issues || []).map((item) => escapeHtml(item?.message || ""));
  const dataPlane = status?.codexConfig?.dataPlane;
  const dataPlaneLabel = dataPlane?.external
    ? "外部 Shrimp · :" + Number(dataPlane.gatewayPort || 0)
    : "当前页面实例 · :" + Number(dataPlane?.gatewayPort || status?.gateway?.port || 0);
  return [
    '<div class="command-apps-card" data-app-id="codexhost">',
    '<div class="command-apps-header"><div><h3>CodexHost</h3>',
    "<p>复用开源 @codexhost/cli，让 Pi、Claude Code、OpenCode 等 Harness 在 Codex Desktop 中协作。</p></div>",
    '<span class="command-apps-status ' + meta.className + '" role="status">',
    '<span class="command-apps-dot" aria-hidden="true"></span>' + escapeHtml(meta.text) + "</span></div>",
    '<dl class="command-apps-meta"><div><dt>运行时</dt>',
    '<dd class="command-apps-path">' + escapeHtml(status?.runtime?.packageName || "@codexhost/cli") + "</dd>",
    '<span class="command-apps-badge">' + escapeHtml(status?.runtime?.version || "未安装") + "</span>",
    '<span class="command-apps-badge">' + (status?.process?.managed ? "Launcher PID " + Number(status.process.launcherPid || 0) : "未托管") + "</span></div>",
    "<div><dt>启动前检查</dt>",
    "<dd>Shrimp 网关：" + (status?.gateway?.healthy ? "正常 · :" + Number(status?.gateway?.port || 0) : "离线 · :" + Number(status?.gateway?.port || 0)) + "</dd>",
    "<dd>Codex 模型配置：" + (status?.codexConfig?.healthy ? "数据面：" + escapeHtml(dataPlaneLabel) : "需要检查") + "</dd>",
    '<span class="command-apps-badge">Codex Desktop ' + escapeHtml(status?.desktop?.version || "未检测") + "</span></div></dl>",
    issues.length ? '<div class="command-apps-hint is-error">' + issues.join("<br>") + "</div>" : "",
    state.error ? '<div class="command-apps-hint is-error">' + escapeHtml(state.error) + "</div>" : "",
    '<div class="command-apps-hint">增强模式与普通模式不能热切换；切换会完整重启 Codex Desktop，现有 Shrimp 模型配置保持不变。</div>',
    '<div class="command-apps-actions">',
    '<button class="btn btn-primary" data-codexhost-action="start" ' + (!installed || !status?.actions?.canStart || state.action ? "disabled" : "") + ">启动增强模式</button>",
    '<button class="btn" data-codexhost-action="stop" ' + (!status?.actions?.canStop || state.action ? "disabled" : "") + ">停止增强模式</button>",
    '<button class="btn" data-codexhost-action="official" ' + (!status?.actions?.canOpenOfficial || state.action ? "disabled" : "") + ">启动普通模式</button>",
    '<button class="btn" data-codexhost-action="install" ' + (state.action || installed ? "disabled" : "") + ">安装</button>",
    '<button class="btn" data-codexhost-action="update" ' + (state.action || !installed ? "disabled" : "") + ">更新</button>",
    '<button class="btn" data-codexhost-action="uninstall" ' + (state.action || !installed ? "disabled" : "") + ">卸载</button>",
    "</div></div>",
  ].join("");
}

function rerender() {
  const root = document.getElementById("codexhost-runtime-root");
  if (root) root.innerHTML = renderCodexhostRuntime();
}

export async function loadCodexhostRuntime() {
  if (state.loading) return;
    state.loading = true;
    state.error = "";
  try {
    state.status = await api("/v1/cli-tools/codexhost/status");
    state.error = "";
  } catch (error: any) {
    state.error = error?.message || String(error);
  } finally {
    state.loading = false;
    rerender();
    schedulePolling();
  }
}

function schedulePolling() {
  if (state.status?.process?.status !== "launching" && !state.action) {
    stopCodexhostPolling();
    return;
  }
  if (pollTimer != null) return;
  pollTimer = window.setInterval(() => {
    void loadCodexhostRuntime();
  }, 2500);
}

function confirmInterruption(action: "stop" | "official") {
  const target = action === "stop" ? "停止增强模式" : "切换到普通模式";
  return window.confirm([
    target + "前请确认：",
    "",
    "当前 Codex Desktop 将被关闭，未完成任务可能被中断。",
    "增强模式不能热切换，需要完整重启 Codex Desktop。",
    "",
    "确定继续吗？",
  ].join("\\n"));
}

async function runAction(action: "start" | "stop" | "official" | "install" | "update" | "uninstall") {
  if (state.action) return;
  if (action === "install" || action === "update" || action === "uninstall") {
    const command = action === "install" || action === "update"
      ? "npm install -g @codexhost/cli"
      : "npm uninstall -g @codexhost/cli";
    (window as any).prefillCliInstallCommand?.(command, "codexhost");
    return;
  }
  if (action !== "start" && !confirmInterruption(action)) return;
  state.action = action;
  rerender();
  const path = action === "start"
    ? "/v1/cli-tools/codexhost/start"
    : action === "stop"
      ? "/v1/cli-tools/codexhost/stop"
      : "/v1/cli-tools/codexhost/open-official";
  try {
    state.status = await api(path, {
      method: "POST",
      body: JSON.stringify(action === "start" ? {} : { confirmInterrupt: true }),
    });
    state.error = "";
  } catch (error: any) {
    state.error = error?.message || String(error);
  } finally {
    if (state.status?.process?.status !== "launching") state.action = "";
    rerender();
    schedulePolling();
  }
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const action = target?.getAttribute("data-codexhost-action") as "start" | "stop" | "official" | "install" | "update" | "uninstall" | null;
  if (action) void runAction(action);
});

export function stopCodexhostPolling() {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}
