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
    await navigator.clipboard.writeText(value);
    showToast(`已复制${label}`, "success");
  } catch {
    showToast("复制失败，请手动选择文本", "error");
  }
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
        <strong>${escapeHtml(item.status)}</strong>
        <div class="imsd-sub">${escapeHtml(item.message || "")}</div>
        <div class="imsd-sub">回传: ${escapeHtml(item.notifyStatus || "none")}${item.notifyError ? ` · ${escapeHtml(item.notifyError)}` : ""}</div>
        <code>${escapeHtml(item.sessionId || "")}</code>
      </div>
      <span class="imsd-muted">${escapeHtml(item.updatedAt || item.id)}</span>
    </div>
  `).join("");
}

function render() {
  const el = root();
  if (!el) return;
  const status = state.status;
  if (state.loading && !status) {
    el.innerHTML = `<div class="imsd-empty">正在加载 IM 会话投递配置…</div>`;
    return;
  }

  const endpoints = status?.endpoints || {
    healthUrl: "",
    messageUrl: "",
    difyBaseUrl: "",
    difyChatMessagesUrl: "",
  };

  el.innerHTML = `
    ${state.error ? `<div class="imsd-error">${escapeHtml(state.error)}</div>` : ""}
    <div class="imsd-card">
      <div class="imsd-header">
        <div>
          <h3>IM 会话投递</h3>
          <p>把 Telegram / QQ 等聊天消息，投递到本机 Codex / Claude / Antigravity 会话。</p>
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

      <div class="imsd-help">
        ${escapeHtml(status?.setupHint || "在 LangBot 中选择 Dify Service API，Base URL 填上面的地址，API Key 填 Token。")}
      </div>

      <div class="imsd-actions">
        <button class="btn" type="button" onclick="window.__imsdReload()">刷新</button>
        <button class="btn" type="button" onclick="window.__imsdCopy('${escapeHtml(endpoints.difyChatMessagesUrl || "")}', 'Chat Messages URL')">复制 chat-messages</button>
      </div>
    </div>

    <div class="imsd-card">
      <h3>确认策略</h3>
      <p class="imsd-help">危险操作默认需要确认。可选：open（直接投递）/ confirm_dangerous（仅危险确认）/ confirm_all（全部确认）。</p>
      <div class="imsd-grid">
        <div>
          <label>Policy Mode</label>
          <select id="imsd-policy-select" class="imsd-input">
            ${(status?.policyModes || ["open", "confirm_dangerous", "confirm_all"]).map((mode) => `
              <option value="${escapeHtml(mode)}" ${(state.policyDraft || status?.policyMode) === mode ? "selected" : ""}>${escapeHtml(mode)}</option>
            `).join("")}
          </select>
        </div>
      </div>
      <div class="imsd-actions">
        <button class="btn" type="button" ${state.busy === "policy" ? "disabled" : ""} onclick="window.__imsdSavePolicy()">${state.busy === "policy" ? "保存中..." : "保存策略"}</button>
      </div>
    </div>

    <div class="imsd-card">
      <h3>完成回传 Webhook</h3>
      <p class="imsd-help">任务派发完成或失败后，Shrimp 会把纯文本 reply POST 到这个地址，由 LangBot/适配器发回原聊天。</p>
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
    </div>

    <div class="imsd-card">
      <h3>绑定列表</h3>
      <div class="imsd-list">${renderBindings(status?.bindings || [])}</div>
    </div>

    <div class="imsd-card">
      <h3>最近任务</h3>
      <div class="imsd-list">${renderTasks(status?.recentTasks || [])}</div>
    </div>
  `;
}

(window as any).__imsdReload = () => { void reload(); };
(window as any).__imsdRotate = () => { void rotateToken(); };
(window as any).__imsdUnbind = (bindingKey: string) => { void clearBinding(bindingKey); };
(window as any).__imsdCopy = (value: string, label: string) => { void copyText(value, label); };

registerTab("im-session-delivery", {
  onEnter: () => {
    void reload();
  },
});
