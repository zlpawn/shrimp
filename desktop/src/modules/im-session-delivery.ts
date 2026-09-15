import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type Binding = {
  bindingKey: string;
  platform: string;
  chatType: string;
  chatId: string;
  userId?: string;
  client: string;
  sessionId: string;
  workspacePath?: string;
  title?: string;
  lastUsedAt?: string | null;
};

type RecentTask = {
  id: string;
  sessionId: string;
  message: string;
  status: string;
  error?: string;
  notifyStatus?: string;
  notifyError?: string;
  updatedAt?: string | null;
};

type StatusPayload = {
  ok: boolean;
  enabled: boolean;
  tokenConfigured: boolean;
  tokenMasked: string;
  tokenSource: string;
  webhookUrl?: string;
  webhookConfigured?: boolean;
  webhookSource?: string;
  policyMode?: string;
  policyModes?: string[];
  endpoints: {
    healthUrl: string;
    messageUrl: string;
    difyBaseUrl: string;
    difyChatMessagesUrl: string;
  };
  bindings: Binding[];
  recentTasks: RecentTask[];
  setupHint?: string;
};

const state = {
  loading: false,
  busy: "",
  error: "",
  status: null as StatusPayload | null,
  lastRotatedToken: "",
  webhookDraft: "",
  policyDraft: "confirm_dangerous",
};

let renderHook: (() => void) | null = null;

function root() {
  return document.getElementById("im-session-delivery-root");
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || body?.error || `Request failed: ${res.status}`);
  }
  return body as T;
}

async function reload(silent = false) {
  if (!silent) {
    state.loading = true;
    state.error = "";
    render();
  }
  try {
    state.status = await api<StatusPayload>("/v1/remote-agent/status");
    if (!state.webhookDraft) state.webhookDraft = state.status.webhookUrl || "";
    state.policyDraft = state.status.policyMode || state.policyDraft || "confirm_dangerous";
  } catch (error: any) {
    state.error = error?.message || String(error);
    if (!silent) showToast("加载 IM 会话投递状态失败", "error");
  } finally {
    state.loading = false;
    render();
  }
}

async function rotateToken() {
  if (state.busy) return;
  state.busy = "rotate";
  render();
  try {
    const result = await api<{ token: string }>("/v1/remote-agent/token/rotate", { method: "POST", body: "{}" });
    state.lastRotatedToken = result.token || "";
    showToast("Token 已生成，请复制到 LangBot", "success");
    await reload(true);
  } catch (error: any) {
    showToast(error?.message || "生成 Token 失败", "error");
  } finally {
    state.busy = "";
    render();
  }
}

async function savePolicy() {
  if (state.busy) return;
  state.busy = "policy";
  render();
  try {
    await api("/v1/remote-agent/policy", {
      method: "POST",
      body: JSON.stringify({ policyMode: state.policyDraft || "confirm_dangerous" }),
    });
    showToast("策略已保存", "success");
    await reload(true);
  } catch (error: any) {
    showToast(error?.message || "保存策略失败", "error");
  } finally {
    state.busy = "";
    render();
  }
}

async function saveWebhook() {
  if (state.busy) return;
  state.busy = "webhook";
  render();
  try {
    await api("/v1/remote-agent/webhook", {
      method: "POST",
      body: JSON.stringify({ webhookUrl: state.webhookDraft || "" }),
    });
    showToast("Webhook 已保存", "success");
    await reload(true);
  } catch (error: any) {
    showToast(error?.message || "保存 Webhook 失败", "error");
  } finally {
    state.busy = "";
    render();
  }
}

async function clearWebhook() {
  state.webhookDraft = "";
  await saveWebhook();
}

async function clearBinding(bindingKey: string) {
  if (state.busy) return;
  state.busy = bindingKey;
  render();
  try {
    await api(`/v1/remote-agent/bindings/${encodeURIComponent(bindingKey)}`, { method: "DELETE" });
    showToast("已解除绑定", "success");
    await reload(true);
  } catch (error: any) {
    showToast(error?.message || "解除绑定失败", "error");
  } finally {
    state.busy = "";
    render();
  }
}

async function copyText(value: string, label: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      throw new Error("clipboard API unavailable");
    }
    showToast(`已复制${label}`, "success");
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (copied) {
      showToast(`已复制${label}`, "success");
    } else {
      showToast("复制失败，请手动选择文本", "error");
    }
  }
}

const POLICY_LABELS: Record<string, string> = {
  open: "直接投递",
  confirm_dangerous: "危险操作需确认",
  confirm_all: "全部操作需确认",
};

function policyLabel(mode: string): string {
  return POLICY_LABELS[mode] || mode;
}

function renderBindings(bindings: Binding[]) {
  if (!bindings.length) {
    return `<div class="imsd-empty">暂无绑定。先在聊天里发送 /agent list，再用 /agent use 1 绑定。</div>`;
  }
  return bindings.map((item) => `
    <div class="imsd-row">
      <div>
        <strong>${escapeHtml(item.platform)} · ${escapeHtml(item.chatType)} · ${escapeHtml(item.chatId)}</strong>
        <div class="imsd-sub">${escapeHtml(item.client)} | ${escapeHtml(item.workspacePath || "")} | ${escapeHtml(item.title || item.sessionId)}</div>
        <code>${escapeHtml(item.bindingKey)}</code>
      </div>
      <button class="btn" type="button" ${state.busy === item.bindingKey ? "disabled" : ""} onclick="window.__imsdUnbind('${escapeHtml(item.bindingKey)}')">解绑</button>
    </div>
  `).join("");
}

function renderTasks(tasks: RecentTask[]) {
  if (!tasks.length) return `<div class="imsd-empty">暂无最近任务。</div>`;
  return tasks.map((item) => `
    <div class="imsd-row">
      <div>
        <strong>${escapeHtml(taskStatusLabel(item.status))}</strong>
        <div class="imsd-sub">${escapeHtml(item.message || "")}</div>
        <div class="imsd-sub">回传: ${escapeHtml(item.notifyStatus || "none")}${item.notifyError ? ` · ${escapeHtml(item.notifyError)}` : ""}</div>
        <code>${escapeHtml(item.sessionId || "")}</code>
      </div>
      <span class="imsd-muted">${escapeHtml(item.updatedAt || item.id)}</span>
    </div>
  `).join("");
}

function taskStatusLabel(status: string): string {
  if (status === "dispatched" || status === "completed") return "已完成";
  if (status === "running" || status === "dispatching") return "执行中";
  if (status === "pending" || status === "waiting_input" || status === "queued") return "排队中";
  if (status === "failed" || status === "error") return "失败";
  if (status === "canceled") return "已取消";
  return status || "未知";
}

function renderImSessionDelivery(): string {
  const status = state.status;
  if (state.loading && !status) {
    return `<div class="imsd-empty">正在加载 IM 会话投递配置…</div>`;
  }

  const endpoints = status?.endpoints || {
    healthUrl: "",
    messageUrl: "",
    difyBaseUrl: "",
    difyChatMessagesUrl: "",
  };

  return `
    ${state.error ? `<div class="imsd-error">${escapeHtml(state.error)}</div>` : ""}
    <div class="imsd-shell">
    <header class="imsd-hero">
      <div>
        <p class="imsd-eyebrow">Remote Agent Delivery</p>
        <h3>IM 会话投递</h3>
        <p>把 Telegram / QQ 等聊天消息，投递到本机 Codex / Claude / Antigravity 会话。</p>
      </div>
      <div class="imsd-hero-actions">
        <span class="imsd-badge ${status?.tokenConfigured ? "is-on" : ""}">${status?.tokenConfigured ? "Token 已配置" : "Token 未配置"}</span>
        <button class="btn" type="button" onclick="window.__imsdReload()">刷新</button>
      </div>
    </header>

    <section class="imsd-stat-grid">
      <article class="imsd-stat">
        <span>接入状态</span>
        <strong>${status?.tokenConfigured ? "可用" : "待配置"}</strong>
        <small>${status?.tokenConfigured ? "LangBot 可调用 Dify 入口" : "先生成 Token 后接入 LangBot"}</small>
      </article>
      <article class="imsd-stat">
        <span>确认策略</span>
        <strong>${escapeHtml(policyLabel(state.policyDraft || status?.policyMode || "confirm_dangerous"))}</strong>
        <small>${escapeHtml(state.policyDraft || status?.policyMode || "confirm_dangerous")}</small>
      </article>
      <article class="imsd-stat">
        <span>绑定会话</span>
        <strong>${(status?.bindings || []).length}</strong>
        <small>${(status?.recentTasks || []).length} 条最近任务</small>
      </article>
    </section>

    <div class="imsd-card imsd-card-primary">
      <div class="imsd-header">
        <div>
          <h3>接入配置</h3>
          <p>LangBot 使用 Dify Service API 调用网关，Base URL 和 API Key 都在这里获取。</p>
        </div>
        <span class="imsd-badge ${status?.tokenConfigured ? "is-on" : ""}">${status?.tokenConfigured ? "已配置 Token" : "未配置 Token"}</span>
      </div>

      <div class="imsd-grid">
        <div>
          <label>Dify Base URL</label>
          <div class="imsd-copy-row">
            <code>${escapeHtml(endpoints.difyBaseUrl || "-")}</code>
            <button class="btn" type="button" onclick="window.__imsdCopy('${escapeHtml(endpoints.difyBaseUrl || "")}', 'Base URL')">复制</button>
          </div>
        </div>
        <div>
          <label>Token</label>
          <div class="imsd-copy-row">
            <code>${escapeHtml(state.lastRotatedToken || status?.tokenMasked || "未生成")}</code>
            <button class="btn" type="button" ${state.busy === "rotate" ? "disabled" : ""} onclick="window.__imsdRotate()">${state.busy === "rotate" ? "生成中..." : "生成/轮换"}</button>
            <button class="btn" type="button" ${!state.lastRotatedToken ? "disabled" : ""} onclick="window.__imsdCopy('${escapeHtml(state.lastRotatedToken || "")}', 'Token')">复制明文</button>
          </div>
          <div class="imsd-help">来源：${escapeHtml(status?.tokenSource || "none")}。轮换后请同步更新 LangBot 的 Dify API Key。</div>
        </div>
      </div>

      <div class="imsd-note">Token 是 LangBot 调用网关的访问凭据，填到 LangBot Dify Service API 的 API Key。必须配置，否则 Dify 入口会返回 401；它和管理台 Gateway API Key 相互独立。</div>
    </div>

    <div class="imsd-card">
      <div class="imsd-header">
        <div>
          <h3>确认策略</h3>
          <p>控制从 IM 下发任务时，哪些操作需要二次确认。</p>
        </div>
      </div>
      <div class="imsd-grid">
        <div>
          <label>策略模式</label>
          <div class="imsd-segmented">
            ${(status?.policyModes || ["open", "confirm_dangerous", "confirm_all"]).map((mode) => `
              <button type="button" class="${(state.policyDraft || status?.policyMode) === mode ? "active" : ""}" onclick="window.__imsdSelectPolicy('${escapeHtml(mode)}')">${escapeHtml(policyLabel(mode))}</button>
            `).join("")}
          </div>
          <div class="imsd-help">当前值：<code>${escapeHtml(state.policyDraft || status?.policyMode || "confirm_dangerous")}</code> · 保存后立即生效</div>
        </div>
      </div>
      <div class="imsd-actions">
        <button class="btn" type="button" ${state.busy === "policy" ? "disabled" : ""} onclick="window.__imsdSavePolicy()">${state.busy === "policy" ? "保存中..." : "保存策略"}</button>
      </div>
    </div>

    <details class="imsd-card imsd-advanced">
      <summary>
        <span>
          <strong>高级设置：完成回传 Webhook</strong>
          <small>当前优先使用同步 SSE 回传，Webhook 可留空。</small>
        </span>
        <span class="imsd-badge">${status?.webhookConfigured ? "已配置" : "未启用"}</span>
      </summary>
      <div class="imsd-grid imsd-advanced-body">
      <div class="imsd-grid">
        <div>
          <label>Webhook URL</label>
          <div class="imsd-copy-row">
            <input id="imsd-webhook-input" class="imsd-input" type="text" value="${escapeHtml(state.webhookDraft || status?.webhookUrl || "")}" placeholder="http://127.0.0.1:18080/hooks/shrimp" />
          </div>
          <div class="imsd-help">来源：${escapeHtml(status?.webhookSource || "none")} · ${status?.webhookConfigured ? "已配置" : "未配置"}</div>
        </div>
      </div>
      <div class="imsd-actions">
        <button class="btn" type="button" ${state.busy === "webhook" ? "disabled" : ""} onclick="window.__imsdSaveWebhook()">${state.busy === "webhook" ? "保存中..." : "保存 Webhook"}</button>
        <button class="btn" type="button" ${state.busy === "webhook" ? "disabled" : ""} onclick="window.__imsdClearWebhook()">清空</button>
      </div>
    </details>

    <div class="imsd-card">
      <div class="imsd-header">
        <div>
          <h3>绑定列表</h3>
          <p>聊天窗口和本机会话的对应关系。</p>
        </div>
        <span class="imsd-badge">${(status?.bindings || []).length} 个绑定</span>
      </div>
      <div class="imsd-list">${renderBindings(status?.bindings || [])}</div>
    </div>

    <div class="imsd-card">
      <div class="imsd-header">
        <div>
          <h3>最近任务</h3>
          <p>展示最近的 IM 下发任务、执行状态和回传状态。</p>
        </div>
      </div>
      <div class="imsd-list">${renderTasks(status?.recentTasks || [])}</div>
    </div>
    </div>
  `;
}

(window as any).__imsdReload = () => { void reload(); };
(window as any).__imsdRotate = () => { void rotateToken(); };
(window as any).__imsdSelectPolicy = (mode: string) => {
  state.policyDraft = mode;
  render();
};
(window as any).__imsdUnbind = (bindingKey: string) => { void clearBinding(bindingKey); };
(window as any).__imsdCopy = (value: string, label: string) => { void copyText(value, label); };

function render() {
  if (renderHook) {
    renderHook();
    return;
  }
  const el = root();
  if (!el) return;
  el.innerHTML = renderImSessionDelivery();
}

export function enterImSessionDelivery(): void {
  void reload();
}

export function renderImSessionDeliveryPanel(): string {
  return renderImSessionDelivery();
}

export function setImSessionDeliveryRenderHook(hook: (() => void) | null): void {
  renderHook = hook;
}
