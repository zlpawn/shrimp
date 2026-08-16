import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type QueueItem = {
  id: string;
  sessionId: string;
  message: string;
  status: string;
  error?: string;
  updatedAt: string;
};

type BoardSession = {
  id: string;
  client: string;
  title: string;
  workspacePath?: string;
  lastActivityAt?: string;
  status: string;
  queuedCount?: number;
};

type PathField = {
  key: string;
  label: string;
  value: string;
  exists?: boolean;
};

type ClientPathConfig = {
  id: string;
  name: string;
  description: string;
  fields: PathField[];
};

type PathsConfig = Record<string, ClientPathConfig>;

const columns = [
  { id: "queued", title: "排队中", hint: "等待空闲后投递" },
  { id: "running", title: "运行中", hint: "90 秒内有活动" },
  { id: "waiting_input", title: "等待输入", hint: "24 小时内空闲" },
  { id: "completed", title: "已完成", hint: "超过 24 小时未活动" },
  { id: "idle", title: "待处理", hint: "无队列任务的历史会话" },
  { id: "error", title: "异常", hint: "读取或投递失败" },
] as const;
const clients = ["all", "codex", "claude", "antigravity"] as const;

const state = {
  loading: false,
  error: "",
  sessions: [] as BoardSession[],
  queue: [] as QueueItem[],
  selectedSessionId: "",
  draft: "",
  clientFilter: "all",
  search: "",
  pathsOpen: false,
  pathsLoading: false,
  pathsSaving: false,
  pathsConfig: null as PathsConfig | null,
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data as T;
}

function root() {
  return document.getElementById("session-kanban-root");
}

function formatTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function shortSessionId(id: string) {
  return id.length > 10 ? id.slice(0, 8) + "…" : id;
}

function renderCard(session: BoardSession) {
  const selected = session.id === state.selectedSessionId ? " selected" : "";
  return `
    <button class="session-kanban-card${selected}" onclick="window.__sessionKanbanSelect('${escapeHtml(session.id)}')">
      <span class="session-kanban-client">${escapeHtml(displayClient(session.client))}</span>
      <strong class="session-kanban-title" title="双击复制标题" ondblclick="event.stopPropagation(); window.__sessionKanbanCopyTitle('${escapeHtml(session.id)}')">${escapeHtml(session.title)}</strong>
      <code class="session-kanban-id" title="双击复制 ID" ondblclick="event.stopPropagation(); window.__sessionKanbanCopyId('${escapeHtml(session.id)}')">${escapeHtml(shortSessionId(session.id))}</code>
      <small>${escapeHtml(session.workspacePath || "global")}</small>
      <time>${escapeHtml(formatTime(session.lastActivityAt))}</time>
    </button>
  `;
}

function displayClient(client: string) {
  if (client === "codex") return "Codex";
  if (client === "claude") return "Claude desktop";
  if (client === "antigravity") return "Antigravity";
  return client;
}

function filterBoardSessions() {
  const keyword = state.search.trim().toLowerCase();
  const filtered = state.sessions.filter(session => {
    if (state.clientFilter !== "all" && session.client !== state.clientFilter) return false;
    if (!keyword) return true;
    return session.title.toLowerCase().includes(keyword)
      || session.workspacePath?.toLowerCase().includes(keyword)
      || session.id.toLowerCase().includes(keyword);
  });
  return filtered;
}

function targetSessionsByClient() {
  const result = new Map<string, BoardSession[]>();
  for (const session of state.sessions
    .filter(session => session.status !== "completed" && session.status !== "error")
    .slice(0, 30)) {
    const list = result.get(session.client) || [];
    list.push(session);
    result.set(session.client, list);
  }
  return result;
}

function renderTargetOptions() {
  const groups = targetSessionsByClient();
  if (!groups.size) return `<option value="">没有可投递会话</option>`;
  return [...groups.entries()].map(([client, sessions]) => `
    <optgroup label="${escapeHtml(displayClient(client))}">
      ${sessions.map(session => `<option value="${escapeHtml(session.id)}" ${session.id === state.selectedSessionId ? "selected" : ""}>${escapeHtml(session.title.slice(0, 48))}${session.title.length > 48 ? "…" : ""}</option>`).join("")}
    </optgroup>
  `).join("");
}

function renderQueue(item: QueueItem) {
  const session = state.sessions.find(s => s.id === item.sessionId);
  const sessionTitle = session?.title || "";
  const displayTitle = sessionTitle || item.sessionId;
  const action = item.status === "failed" || item.status === "canceled"
    ? `<button class="btn" onclick="window.__sessionKanbanRetry('${item.id}')">重试</button>`
    : item.status === "pending"
      ? `<button class="btn" onclick="window.__sessionKanbanCancel('${item.id}')">取消</button>`
      : "";
  return `
    <div class="session-kanban-queue-row">
      <div>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <strong>${escapeHtml(displayTitle)}</strong>
          ${sessionTitle ? `<code class="session-kanban-id" title="双击复制 ID" ondblclick="event.stopPropagation(); window.__sessionKanbanCopyId('${escapeHtml(item.sessionId)}')">${escapeHtml(shortSessionId(item.sessionId))}</code>` : ""}
        </div>
        <p>${escapeHtml(item.message)}</p>
        ${item.error ? `<small>${escapeHtml(item.error)}</small>` : ""}
      </div>
      <span>${escapeHtml(item.status)}</span>
      ${action}
    </div>
  `;
}

function renderPathsModal() {
  if (!state.pathsOpen) return "";
  const config = state.pathsConfig;
  if (!config) {
    return `
      <div class="session-kanban-modal-backdrop" onclick="window.__sessionKanbanClosePaths(event)">
        <div class="session-kanban-modal" onclick="event.stopPropagation()">
          <div class="session-kanban-modal-header">
            <h3>客户端会话路径设置</h3>
            <button class="session-kanban-modal-close" type="button" onclick="window.__sessionKanbanClosePaths()">×</button>
          </div>
          <div class="session-kanban-modal-body">
            <div class="session-kanban-empty">正在加载路径配置…</div>
          </div>
        </div>
      </div>
    `;
  }

  const clientCards = Object.entries(config).map(([clientId, client]) => `
    <div class="session-kanban-client-card" data-client="${escapeHtml(clientId)}">
      <div class="session-kanban-client-head">
        <strong>${escapeHtml(client.name)}</strong>
        <small>${escapeHtml(client.description)}</small>
      </div>
      ${client.fields.map(field => `
        <div class="session-kanban-field-row">
          <div class="session-kanban-field-label-row">
            <label>${escapeHtml(field.label)}</label>
            <span class="path-badge ${field.exists ? "exists" : "missing"}">${field.exists ? "✓ 路径有效" : "⚠ 未检测到"}</span>
          </div>
          <input
            class="session-kanban-path-input"
            data-client="${escapeHtml(clientId)}"
            data-key="${escapeHtml(field.key)}"
            value="${escapeHtml(field.value)}"
            onchange="window.__sessionKanbanUpdatePathField('${escapeHtml(clientId)}', '${escapeHtml(field.key)}', this.value)"
          />
        </div>
      `).join("")}
    </div>
  `).join("");

  return `
    <div class="session-kanban-modal-backdrop" onclick="window.__sessionKanbanClosePaths(event)">
      <div class="session-kanban-modal" onclick="event.stopPropagation()">
        <div class="session-kanban-modal-header">
          <h3>客户端会话路径设置</h3>
          <button class="session-kanban-modal-close" type="button" onclick="window.__sessionKanbanClosePaths()">×</button>
        </div>
        <div class="session-kanban-modal-body">
          <p class="session-kanban-modal-intro">
            查看与自定义各个客户端会话的扫描路径。修改后保存，看板将使用新路径即时扫描并同步会话。
          </p>
          ${clientCards}
        </div>
        <div class="session-kanban-modal-footer">
          <button class="btn" type="button" onclick="window.__sessionKanbanResetPaths()">恢复默认</button>
          <div class="session-kanban-modal-footer-right">
            <button class="btn" type="button" onclick="window.__sessionKanbanClosePaths()">取消</button>
            <button class="btn btn-primary" type="button" onclick="window.__sessionKanbanSavePaths()">${state.pathsSaving ? "保存中…" : "保存并刷新"}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function render() {
  const el = root();
  if (!el) return;
  if (state.loading) {
    el.innerHTML = "<div class=\"session-kanban-empty\">正在读取会话…</div>";
    return;
  }

  const boardHtml = columns.map(column => {
    const items = filterBoardSessions().filter(session => session.status === column.id);
    return `
      <section class="session-kanban-column" data-status="${column.id}">
        <header><div><h3>${column.title}</h3><small>${column.hint}</small></div><span>${items.length}</span></header>
        ${items.map(renderCard).join("")}
      </section>
    `;
  }).join("");
  el.innerHTML = `
    ${state.error ? `<div class="session-kanban-error">${escapeHtml(state.error)}</div>` : ""}
    <div class="session-kanban-toolbar">
      <div class="session-kanban-filter-group">
        <input id="session-kanban-search" value="${escapeHtml(state.search)}" placeholder="搜索标题、路径或 ID" />
        <div class="session-kanban-segmented">
        ${clients.map(client => `<button type="button" class="${state.clientFilter === client ? "active" : ""}" onclick="window.__sessionKanbanFilter('${client}')">${client === "all" ? "全部" : displayClient(client)}</button>`).join("")}
      </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="btn" type="button" onclick="window.__sessionKanbanOpenPaths()">⚙ 路径配置</button>
        <button class="btn" type="button" onclick="window.__sessionKanbanRefresh()">刷新</button>
      </div>
    </div>
    <div class="session-kanban-rules">
      <span>运行中：90 秒内有活动</span>
      <span>等待输入：90 秒到 24 小时无活动</span>
      <span>已完成：超过 24 小时无活动</span>
      <span>超过 48 小时不展示</span>
      <span>有待发消息时优先显示为「排队中」</span>
    </div>
    <div class="session-kanban-meta">
      <span>共 ${state.sessions.length} 个会话</span>
      <span>排队中 ${state.sessions.filter(item => item.status === "queued").length}</span>
      <span>运行中 ${state.sessions.filter(item => item.status === "running").length}</span>
      <span>等待输入 ${state.sessions.filter(item => item.status === "waiting_input").length}</span>
      <span>已完成 ${state.sessions.filter(item => item.status === "completed").length}</span>
    </div>
    <div class="session-kanban-board">${boardHtml}</div>
    <form class="session-kanban-compose" onsubmit="window.__sessionKanbanSubmit(event)">
      <label for="session-kanban-target">目标会话</label>
      <select id="session-kanban-target">
        ${renderTargetOptions()}
      </select>
      <label for="session-kanban-message">待发消息</label>
      <textarea id="session-kanban-message" rows="3" placeholder="会话空闲后自动投递">${escapeHtml(state.draft)}</textarea>
      <div class="session-kanban-actions">
        <button class="btn btn-primary" type="submit">加入队列</button>
        <button class="btn" type="button" onclick="window.__sessionKanbanDispatch()">立即调度</button>
      </div>
      <div class="session-kanban-dispatch-hint">
        <span><strong>加入队列</strong>：存入待发池，后台每 30 秒自动轮询，待会话空闲后全自动投递。</span>
        <span><strong>立即调度</strong>：跳过 30 秒等待周期，立即向当前空闲的目标会话发起投递。</span>
      </div>
    </form>
    <div class="session-kanban-queue">${state.queue.map(renderQueue).join("")}</div>
    ${renderPathsModal()}
  `;
}

async function load() {
  state.loading = true;
  state.error = "";
  render();
  try {
    const board = await api<{ sessions: BoardSession[]; queue: QueueItem[] }>("/v1/session-kanban/board");
    state.sessions = board.sessions || [];
    state.queue = board.queue || [];
    if (!state.selectedSessionId && state.sessions.length) state.selectedSessionId = state.sessions[0].id;
  } catch (error: any) {
    state.error = error?.message || String(error);
  } finally {
    state.loading = false;
    render();
  }
}

function select(id: string) {
  state.selectedSessionId = id;
  render();
}

function setClientFilter(client: string) {
  state.clientFilter = clients.includes(client as any) ? client : "all";
  render();
}

function refresh() {
  return load();
}

async function openPaths() {
  state.pathsOpen = true;
  state.pathsLoading = true;
  render();
  try {
    const config = await api<PathsConfig>("/v1/session-kanban/paths");
    state.pathsConfig = config;
  } catch (error: any) {
    showToast(error?.message || "获取路径配置失败", "danger");
  } finally {
    state.pathsLoading = false;
    render();
  }
}

function closePaths(event?: Event) {
  if (event && event.target !== event.currentTarget) return;
  state.pathsOpen = false;
  render();
}

function updatePathField(clientId: string, key: string, value: string) {
  if (!state.pathsConfig || !state.pathsConfig[clientId]) return;
  const field = state.pathsConfig[clientId].fields.find(f => f.key === key);
  if (field) field.value = value;
}

async function savePaths() {
  if (!state.pathsConfig) return;
  state.pathsSaving = true;
  render();
  try {
    const updated = await api<PathsConfig>("/v1/session-kanban/paths", {
      method: "PUT",
      body: JSON.stringify(state.pathsConfig),
    });
    state.pathsConfig = updated;
    state.pathsOpen = false;
    showToast("路径配置已保存并刷新", "success");
    await load();
  } catch (error: any) {
    showToast(error?.message || "保存路径配置失败", "danger");
  } finally {
    state.pathsSaving = false;
    render();
  }
}

async function resetPaths() {
  try {
    const defaults = await api<PathsConfig>("/v1/session-kanban/paths/reset", { method: "POST" });
    state.pathsConfig = defaults;
    showToast("已恢复默认路径", "success");
    render();
    await load();
  } catch (error: any) {
    showToast(error?.message || "恢复默认失败", "danger");
  }
}

function copyTitle(id: string) {
  const session = state.sessions.find(item => item.id === id);
  if (!session) return;
  navigator.clipboard.writeText(session.title).then(
    () => showToast("标题已复制", "success"),
    () => showToast("复制标题失败", "danger"),
  );
}

function copyId(id: string) {
  navigator.clipboard.writeText(id).then(
    () => showToast("ID 已复制", "success"),
    () => showToast("复制 ID 失败", "danger"),
  );
}

async function submit(event: Event) {
  event.preventDefault();
  const target = document.getElementById("session-kanban-target") as HTMLSelectElement | null;
  const input = document.getElementById("session-kanban-message") as HTMLTextAreaElement | null;
  const message = input?.value?.trim() || "";
  if (!target?.value || !message) {
    showToast("请选择会话并输入消息", "danger");
    return;
  }
  try {
    await api("/v1/session-kanban/queue", {
      method: "POST",
      body: JSON.stringify({ sessionId: target.value, message }),
    });
    state.draft = "";
    showToast("已加入队列", "success");
    await load();
  } catch (error: any) {
    showToast(error?.message || "入队失败", "danger");
  }
}

async function cancel(id: string) {
  try {
    await api(`/v1/session-kanban/queue/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    await load();
  } catch (error: any) {
    showToast(error?.message || "取消失败", "danger");
  }
}

async function retry(id: string) {
  try {
    await api(`/v1/session-kanban/queue/${encodeURIComponent(id)}/retry`, { method: "POST" });
    await load();
  } catch (error: any) {
    showToast(error?.message || "重试失败", "danger");
  }
}

async function dispatchReady() {
  try {
    const result = await api<{ dispatched: number; waiting: number }>("/v1/session-kanban/dispatch", { method: "POST" });
    showToast(`已投递 ${result.dispatched}，等待 ${result.waiting}`, "success");
    await load();
  } catch (error: any) {
    showToast(error?.message || "调度失败", "danger");
  }
}

(window as any).__sessionKanbanSelect = select;
(window as any).__sessionKanbanCopyTitle = copyTitle;
(window as any).__sessionKanbanCopyId = copyId;
(window as any).__sessionKanbanFilter = setClientFilter;
(window as any).__sessionKanbanRefresh = refresh;
(window as any).__sessionKanbanSubmit = submit;
(window as any).__sessionKanbanCancel = cancel;
(window as any).__sessionKanbanRetry = retry;
(window as any).__sessionKanbanDispatch = dispatchReady;
(window as any).__sessionKanbanOpenPaths = openPaths;
(window as any).__sessionKanbanClosePaths = closePaths;
(window as any).__sessionKanbanUpdatePathField = updatePathField;
(window as any).__sessionKanbanSavePaths = savePaths;
(window as any).__sessionKanbanResetPaths = resetPaths;

document.addEventListener("input", event => {
  const target = event.target as HTMLElement | null;
  if (target?.id === "session-kanban-message") state.draft = (target as HTMLTextAreaElement).value;
  if (target?.id === "session-kanban-search") {
    state.search = (target as HTMLInputElement).value;
    const active = document.activeElement?.id;
    render();
    document.getElementById(active || "")?.focus();
  }
});

registerTab("session-kanban", {
  onEnter: () => { void load(); },
});
