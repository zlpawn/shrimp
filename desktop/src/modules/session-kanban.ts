import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type QueueItem = {
  id: string;
  sessionId: string;
  message: string;
  status: string;
  error?: string;
  scheduledAtMs?: number;
  scheduledAt?: string | null;
  vendorTag?: string;
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

type ToolCall = {
  name: string;
  summary?: string;
  detail?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  tools?: ToolCall[];
};

type SessionTranscript = {
  sessionId: string;
  client: string;
  title: string;
  workspacePath?: string;
  lastActivityAt?: string;
  messages: ChatMessage[];
};

type ScheduleMode = "immediate" | "delay_30m" | "delay_1h" | "delay_3h" | "delay_5h" | "custom";

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
  scheduleMode: "immediate" as ScheduleMode,
  scheduleCustomTime: "",
  pathsOpen: false,
  pathsLoading: false,
  pathsSaving: false,
  pathsConfig: null as PathsConfig | null,
  chatOpen: false,
  chatLoading: false,
  chatSessionId: "",
  chatData: null as SessionTranscript | null,
  chatDraft: "",
  chatScheduleMode: "immediate" as ScheduleMode,
  chatScheduleCustomTime: "",
  rescheduleOpen: false,
  rescheduleId: "",
  rescheduleMode: "immediate" as ScheduleMode,
  rescheduleCustomTime: "",
  rescheduleSaving: false,
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

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function formatCountdown(targetMs?: number, now = Date.now()) {
  if (!targetMs || targetMs <= now) return "";
  const diffSec = Math.floor((targetMs - now) / 1000);
  if (diffSec < 60) return `约 ${diffSec} 秒后`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `约 ${diffMin} 分钟后`;
  const diffHour = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (diffHour < 24) return `约 ${diffHour} 小时${remMin > 0 ? ` ${remMin} 分` : ""}后`;
  const diffDays = Math.floor(diffHour / 24);
  return `约 ${diffDays} 天后`;
}

function shortSessionId(id: string) {
  return id.length > 10 ? id.slice(0, 8) + "…" : id;
}

function displayVendor(vendor?: string) {
  if (!vendor) return "";
  const map: Record<string, string> = {
    volcengine: "火山引擎",
    claude: "Claude",
    zhipu: "智谱 AI",
    deepseek: "DeepSeek",
    grok: "Grok",
    antigravity: "Antigravity",
    codex: "Codex",
    generic: "AI 供应商",
  };
  return map[vendor.toLowerCase()] || vendor;
}

function renderCard(session: BoardSession) {
  const selected = session.id === state.selectedSessionId ? " selected" : "";
  const waitingQuotaItem = state.queue.find(
    i => i.sessionId === session.id && i.status === "waiting_quota"
  );
  const quotaBadge = waitingQuotaItem
    ? `<span class="session-kanban-status-badge waiting_quota" style="font-size: 9px; margin-top: 4px;">🛑 等待额度恢复</span>`
    : "";

  return `
    <div class="session-kanban-card${selected}" onclick="window.__sessionKanbanSelect('${escapeHtml(session.id)}')">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
        <span class="session-kanban-client">${escapeHtml(displayClient(session.client))}</span>
        ${quotaBadge}
      </div>
      <strong class="session-kanban-title" title="双击复制标题" ondblclick="event.stopPropagation(); window.__sessionKanbanCopyTitle('${escapeHtml(session.id)}')">${escapeHtml(session.title)}</strong>
      <code class="session-kanban-id" title="双击复制 ID" ondblclick="event.stopPropagation(); window.__sessionKanbanCopyId('${escapeHtml(session.id)}')">${escapeHtml(shortSessionId(session.id))}</code>
      <small>${escapeHtml(session.workspacePath || "global")}</small>
      <div class="session-kanban-card-footer">
        <time>${escapeHtml(formatTime(session.lastActivityAt))}</time>
        <button class="btn btn-xs session-kanban-view-btn" type="button" onclick="event.stopPropagation(); window.__sessionKanbanOpenChat('${escapeHtml(session.id)}')">💬 查看对话</button>
      </div>
    </div>
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

function getSchedulePayload(mode: ScheduleMode, customTime: string) {
  if (mode === "delay_30m") return { delayMinutes: 30 };
  if (mode === "delay_1h") return { delayMinutes: 60 };
  if (mode === "delay_3h") return { delayMinutes: 180 };
  if (mode === "delay_5h") return { delayMinutes: 300 };
  if (mode === "custom" && customTime) return { scheduledAt: customTime };
  return { scheduledAtMs: 0 };
}

function renderTimingSelector(scope: "compose" | "chat" | "reschedule", currentMode: ScheduleMode, customTime: string) {
  const modes: { id: ScheduleMode; label: string }[] = [
    { id: "immediate", label: "⚡ 空闲即投" },
    { id: "delay_30m", label: "⏱️ +30分" },
    { id: "delay_1h", label: "⏱️ +1小时" },
    { id: "delay_3h", label: "⏱️ +3小时" },
    { id: "delay_5h", label: "⏱️ +5小时" },
    { id: "custom", label: "📅 自定义时间" },
  ];

  return `
    <div class="session-kanban-timing-row">
      <div class="session-kanban-timing-segmented">
        ${modes.map(m => `
          <button
            type="button"
            class="${currentMode === m.id ? "active" : ""}"
            onclick="window.__sessionKanbanSetScheduleMode('${scope}', '${m.id}')"
          >${m.label}</button>
        `).join("")}
      </div>
      ${currentMode === "custom" ? `
        <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
          <input
            type="datetime-local"
            class="session-kanban-schedule-input"
            value="${escapeHtml(customTime)}"
            onchange="window.__sessionKanbanUpdateScheduleCustom('${scope}', this.value)"
          />
          <small style="color: var(--text-secondary); font-size: 11px;">指定精准投递时刻</small>
        </div>
      ` : ""}
    </div>
  `;
}

function renderQueueStatusBadge(item: QueueItem) {
  const countdown = formatCountdown(item.scheduledAtMs);
  const timeText = item.scheduledAt ? formatTime(item.scheduledAt) : "";

  if (item.status === "waiting_quota") {
    const vendor = displayVendor(item.vendorTag);
    const vendorLabel = vendor ? `[${vendor}] ` : "";
    return `
      <span class="session-kanban-status-badge waiting_quota" title="${escapeHtml(item.error || "")}">
        🛑 ${escapeHtml(vendorLabel)}等待额度恢复 ${timeText ? `(预计 ${escapeHtml(timeText)}${countdown ? ` / ${escapeHtml(countdown)}` : ""})` : ""}
      </span>
    `;
  }
  if (item.status === "scheduled") {
    return `
      <span class="session-kanban-status-badge scheduled">
        ⏳ 定时投递 (预计 ${escapeHtml(timeText)}${countdown ? ` / ${escapeHtml(countdown)}` : ""})
      </span>
    `;
  }
  if (item.status === "pending") {
    return `<span class="session-kanban-status-badge">⏳ 排队中 (空闲即投)</span>`;
  }
  if (item.status === "dispatching") {
    return `<span class="session-kanban-status-badge dispatching">⚡ 正在投递...</span>`;
  }
  if (item.status === "dispatched") {
    return `<span class="session-kanban-status-badge dispatched">✓ 已投递</span>`;
  }
  if (item.status === "failed") {
    return `<span class="session-kanban-status-badge failed" title="${escapeHtml(item.error || "")}">⚠ 投递失败</span>`;
  }
  if (item.status === "canceled") {
    return `<span class="session-kanban-status-badge">✕ 已取消</span>`;
  }
  return `<span class="session-kanban-status-badge">${escapeHtml(item.status)}</span>`;
}

function renderQueue(item: QueueItem) {
  const session = state.sessions.find(s => s.id === item.sessionId);
  const sessionTitle = session?.title || "";
  const displayTitle = sessionTitle || item.sessionId;

  const isWaitable = item.status === "pending" || item.status === "scheduled" || item.status === "waiting_quota";
  const isFailed = item.status === "failed" || item.status === "canceled";

  let actionsHtml = "";
  if (isWaitable) {
    actionsHtml = `
      <button class="btn btn-xs" type="button" onclick="window.__sessionKanbanOpenReschedule('${item.id}')">✏️ 改期</button>
      <button class="btn btn-xs" type="button" onclick="window.__sessionKanbanForceDispatch('${item.id}')">⚡ 立即投递</button>
      <button class="btn btn-xs" type="button" onclick="window.__sessionKanbanCancel('${item.id}')">取消</button>
    `;
  } else if (isFailed) {
    actionsHtml = `
      <button class="btn btn-xs" type="button" onclick="window.__sessionKanbanRetry('${item.id}')">重试</button>
      <button class="btn btn-xs" type="button" onclick="window.__sessionKanbanOpenReschedule('${item.id}')">✏️ 改期</button>
    `;
  }

  return `
    <div class="session-kanban-queue-row">
      <div>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
          <strong>${escapeHtml(displayTitle)}</strong>
          ${sessionTitle ? `<code class="session-kanban-id" title="双击复制 ID" ondblclick="event.stopPropagation(); window.__sessionKanbanCopyId('${escapeHtml(item.sessionId)}')">${escapeHtml(shortSessionId(item.sessionId))}</code>` : ""}
          <button class="btn btn-xs" type="button" onclick="window.__sessionKanbanOpenChat('${escapeHtml(item.sessionId)}')">💬 对话</button>
        </div>
        <p>${escapeHtml(item.message)}</p>
        ${item.error ? `<small style="display: block; margin-top: 4px;">${escapeHtml(item.error)}</small>` : ""}
      </div>
      <div>${renderQueueStatusBadge(item)}</div>
      <div class="session-kanban-queue-actions">${actionsHtml}</div>
    </div>
  `;
}

function renderRescheduleModal() {
  if (!state.rescheduleOpen) return "";
  const item = state.queue.find(q => q.id === state.rescheduleId);
  if (!item) return "";

  const session = state.sessions.find(s => s.id === item.sessionId);
  const sessionTitle = session?.title || item.sessionId;

  return `
    <div class="session-kanban-modal-backdrop" onclick="window.__sessionKanbanCloseReschedule(event)">
      <div class="session-kanban-modal" onclick="event.stopPropagation()" style="max-width: 540px;">
        <div class="session-kanban-modal-header">
          <h3>修改待发消息计划投递时间</h3>
          <button class="session-kanban-modal-close" type="button" onclick="window.__sessionKanbanCloseReschedule()">×</button>
        </div>
        <div class="session-kanban-modal-body">
          <div>
            <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 2px;">目标会话</label>
            <strong>${escapeHtml(sessionTitle)}</strong>
          </div>
          <div>
            <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 2px;">待发内容</label>
            <p style="margin: 0; font-size: 13px; background: var(--input-bg); padding: 8px 10px; border-radius: 6px;">${escapeHtml(item.message)}</p>
          </div>
          <div>
            <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 6px;">选择新的投递时机</label>
            ${renderTimingSelector("reschedule", state.rescheduleMode, state.rescheduleCustomTime)}
          </div>
        </div>
        <div class="session-kanban-modal-footer">
          <button class="btn" type="button" onclick="window.__sessionKanbanCloseReschedule()">取消</button>
          <div class="session-kanban-modal-footer-right">
            <button class="btn btn-primary" type="button" onclick="window.__sessionKanbanSaveReschedule()">${state.rescheduleSaving ? "保存中…" : "确认修改"}</button>
          </div>
        </div>
      </div>
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

function renderChatDrawer() {
  if (!state.chatOpen) return "";
  const data = state.chatData;
  const sessionId = state.chatSessionId;
  const session = state.sessions.find(s => s.id === sessionId);
  const title = data?.title || session?.title || sessionId;
  const clientName = displayClient(data?.client || session?.client || "unknown");

  let contentHtml = "";
  if (state.chatLoading) {
    contentHtml = "<div class=\"session-kanban-empty\">正在加载对话流与工具记录…</div>";
  } else if (!data || data.messages.length === 0) {
    contentHtml = "<div class=\"session-kanban-empty\">暂无对话内容</div>";
  } else {
    contentHtml = data.messages.map(msg => {
      const isUser = msg.role === "user";
      const toolsHtml = msg.tools && msg.tools.length > 0 ? `
        <details class="session-kanban-tools-details">
          <summary class="session-kanban-tools-summary">
            <span>🛠️ 调用了 <strong>${msg.tools.length}</strong> 个工具 (${escapeHtml([...new Set(msg.tools.map(t => t.name))].slice(0, 3).join(", "))}${msg.tools.length > 3 ? "..." : ""})</span>
          </summary>
          <div class="session-kanban-tools-content">
            ${msg.tools.map(tool => `
              <div class="session-kanban-tool-badge">
                <div class="session-kanban-tool-row">
                  <code class="session-kanban-tool-name">${escapeHtml(tool.name)}</code>
                  ${tool.summary ? `<span class="session-kanban-tool-desc">${escapeHtml(tool.summary)}</span>` : ""}
                </div>
                ${tool.detail ? `<pre class="session-kanban-tool-code">${escapeHtml(tool.detail)}</pre>` : ""}
              </div>
            `).join("")}
          </div>
        </details>
      ` : "";

      return `
        <div class="session-kanban-msg-item ${isUser ? "is-user" : "is-assistant"}">
          <div class="session-kanban-msg-meta">
            <strong>${isUser ? "👤 用户提问" : "🤖 Agent 回复"}</strong>
            <time>${escapeHtml(formatTime(msg.timestamp))}</time>
          </div>
          ${toolsHtml}
          ${msg.content ? `<div class="session-kanban-msg-content">${escapeHtml(msg.content)}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  return `
    <div class="session-kanban-drawer-backdrop" onclick="window.__sessionKanbanCloseChat(event)">
      <div class="session-kanban-drawer" onclick="event.stopPropagation()">
        <div class="session-kanban-drawer-header">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="session-kanban-client">${escapeHtml(clientName)}</span>
              <h3>${escapeHtml(title)}</h3>
            </div>
            <code class="session-kanban-id" title="双击复制完整 ID" ondblclick="window.__sessionKanbanCopyId('${escapeHtml(sessionId)}')">${escapeHtml(sessionId)}</code>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="btn btn-xs" type="button" onclick="window.__sessionKanbanReloadChat()">刷新</button>
            <button class="session-kanban-modal-close" type="button" onclick="window.__sessionKanbanCloseChat()">×</button>
          </div>
        </div>
        <div class="session-kanban-drawer-body" id="session-kanban-chat-body">
          ${contentHtml}
        </div>
        <div class="session-kanban-drawer-footer">
          <textarea
            id="session-kanban-chat-input"
            rows="2"
            placeholder="向当前会话输入新消息并投递..."
          >${escapeHtml(state.chatDraft)}</textarea>
          <div style="margin-top: 4px; margin-bottom: 6px;">
            ${renderTimingSelector("chat", state.chatScheduleMode, state.chatScheduleCustomTime)}
          </div>
          <div class="session-kanban-drawer-actions">
            <button class="btn" type="button" onclick="window.__sessionKanbanChatEnqueue()">加入队列</button>
            <button class="btn btn-primary" type="button" onclick="window.__sessionKanbanChatDispatch()">立即投递</button>
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
      <div style="margin-top: 2px;">
        <label style="display: block; margin-bottom: 4px;">投递时机与延时</label>
        ${renderTimingSelector("compose", state.scheduleMode, state.scheduleCustomTime)}
      </div>
      <div class="session-kanban-actions">
        <button class="btn btn-primary" type="submit">加入队列</button>
        <button class="btn" type="button" onclick="window.__sessionKanbanDispatch()">立即调度</button>
      </div>
      <div class="session-kanban-dispatch-hint">
        <span><strong>加入队列</strong>：存入待发池，后台每 30 秒自动轮询，待会话空闲且到达计划时刻后全自动投递。</span>
        <span><strong>立即调度</strong>：跳过 30 秒等待周期，立即向当前空闲且到期的目标会话发起投递。</span>
      </div>
    </form>
    <div class="session-kanban-queue">${state.queue.map(renderQueue).join("")}</div>
    ${renderPathsModal()}
    ${renderChatDrawer()}
    ${renderRescheduleModal()}
  `;

  if (state.chatOpen) {
    setTimeout(() => {
      const body = document.getElementById("session-kanban-chat-body");
      if (body) body.scrollTop = body.scrollHeight;
    }, 50);
  }
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

async function openChat(id: string) {
  state.chatOpen = true;
  state.chatSessionId = id;
  state.selectedSessionId = id;
  state.chatLoading = true;
  state.chatData = null;
  render();
  try {
    const transcript = await api<SessionTranscript>(`/v1/session-kanban/sessions/${encodeURIComponent(id)}/transcript`);
    state.chatData = transcript;
  } catch (error: any) {
    showToast(error?.message || "获取对话失败", "danger");
  } finally {
    state.chatLoading = false;
    render();
  }
}

function closeChat(event?: Event) {
  if (event && event.target !== event.currentTarget) return;
  state.chatOpen = false;
  render();
}

function reloadChat() {
  if (state.chatSessionId) openChat(state.chatSessionId);
}

function setScheduleMode(scope: "compose" | "chat" | "reschedule", mode: ScheduleMode) {
  if (scope === "compose") state.scheduleMode = mode;
  if (scope === "chat") state.chatScheduleMode = mode;
  if (scope === "reschedule") state.rescheduleMode = mode;
  render();
}

function updateScheduleCustom(scope: "compose" | "chat" | "reschedule", value: string) {
  if (scope === "compose") state.scheduleCustomTime = value;
  if (scope === "chat") state.chatScheduleCustomTime = value;
  if (scope === "reschedule") state.rescheduleCustomTime = value;
}

async function chatEnqueue() {
  const input = document.getElementById("session-kanban-chat-input") as HTMLTextAreaElement | null;
  const message = input?.value?.trim() || "";
  const sessionId = state.chatSessionId;
  if (!sessionId || !message) {
    showToast("请输入消息", "danger");
    return;
  }
  const schedulePayload = getSchedulePayload(state.chatScheduleMode, state.chatScheduleCustomTime);
  try {
    await api("/v1/session-kanban/queue", {
      method: "POST",
      body: JSON.stringify({ sessionId, message, ...schedulePayload }),
    });
    if (input) input.value = "";
    state.chatDraft = "";
    showToast("已加入队列", "success");
    await load();
  } catch (error: any) {
    showToast(error?.message || "入队失败", "danger");
  }
}

async function chatDispatch() {
  await chatEnqueue();
  await dispatchReady();
  setTimeout(() => reloadChat(), 1000);
}

function openReschedule(id: string) {
  const item = state.queue.find(q => q.id === id);
  if (!item) return;
  state.rescheduleOpen = true;
  state.rescheduleId = id;
  state.rescheduleMode = item.scheduledAtMs ? "custom" : "immediate";
  if (item.scheduledAt) {
    try {
      const dt = new Date(item.scheduledAt);
      const iso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      state.rescheduleCustomTime = iso;
    } catch {
      state.rescheduleCustomTime = "";
    }
  } else {
    state.rescheduleCustomTime = "";
  }
  render();
}

function closeReschedule(event?: Event) {
  if (event && event.target !== event.currentTarget) return;
  state.rescheduleOpen = false;
  state.rescheduleId = "";
  render();
}

async function saveReschedule() {
  if (!state.rescheduleId) return;
  state.rescheduleSaving = true;
  render();
  const schedulePayload = getSchedulePayload(state.rescheduleMode, state.rescheduleCustomTime);
  try {
    await api(`/v1/session-kanban/queue/${encodeURIComponent(state.rescheduleId)}/schedule`, {
      method: "PATCH",
      body: JSON.stringify(schedulePayload),
    });
    state.rescheduleOpen = false;
    showToast("投递计划已更新", "success");
    await load();
  } catch (error: any) {
    showToast(error?.message || "更新计划失败", "danger");
  } finally {
    state.rescheduleSaving = false;
    render();
  }
}

async function forceDispatch(id: string) {
  try {
    await api(`/v1/session-kanban/queue/${encodeURIComponent(id)}/schedule`, {
      method: "PATCH",
      body: JSON.stringify({ scheduledAtMs: 0 }),
    });
    await dispatchReady();
  } catch (error: any) {
    showToast(error?.message || "立即投递失败", "danger");
  }
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
  const schedulePayload = getSchedulePayload(state.scheduleMode, state.scheduleCustomTime);
  try {
    await api("/v1/session-kanban/queue", {
      method: "POST",
      body: JSON.stringify({ sessionId: target.value, message, ...schedulePayload }),
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
    await api(`/v1/session-kanban/queue/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      body: JSON.stringify({ immediate: true }),
    });
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
(window as any).__sessionKanbanOpenChat = openChat;
(window as any).__sessionKanbanCloseChat = closeChat;
(window as any).__sessionKanbanReloadChat = reloadChat;
(window as any).__sessionKanbanChatEnqueue = chatEnqueue;
(window as any).__sessionKanbanChatDispatch = chatDispatch;
(window as any).__sessionKanbanSetScheduleMode = setScheduleMode;
(window as any).__sessionKanbanUpdateScheduleCustom = updateScheduleCustom;
(window as any).__sessionKanbanOpenReschedule = openReschedule;
(window as any).__sessionKanbanCloseReschedule = closeReschedule;
(window as any).__sessionKanbanSaveReschedule = saveReschedule;
(window as any).__sessionKanbanForceDispatch = forceDispatch;

document.addEventListener("input", event => {
  const target = event.target as HTMLElement | null;
  if (target?.id === "session-kanban-message") state.draft = (target as HTMLTextAreaElement).value;
  if (target?.id === "session-kanban-chat-input") state.chatDraft = (target as HTMLTextAreaElement).value;
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
