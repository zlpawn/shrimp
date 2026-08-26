import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

export function sortAntigravityModels<T extends { id?: string; name?: string; label?: string }>(models: T[] = []): T[] {
  const filtered = models.filter((m) => {
    const name = (m.name || m.label || m.id || "").toLowerCase();
    if (name.includes("medium") || name.includes("low")) {
      const hasHigh = models.some((other) => {
        const otherName = (other.name || other.label || other.id || "").toLowerCase();
        if (!otherName.includes("high")) return false;
        if (name.includes("3.7") && otherName.includes("3.7")) return true;
        if (name.includes("3.6") && otherName.includes("3.6")) return true;
        if (name.includes("3.5") && otherName.includes("3.5")) return true;
        if (name.includes("3.1") && otherName.includes("3.1")) return true;
        return false;
      });
      if (hasHigh) return false;
    }
    return true;
  });

  function getScore(m: T) {
    const name = (m.name || m.label || m.id || "").toLowerCase();
    if (name.includes("gemini")) {
      let v = 1000;
      if (name.includes("3.7")) v += 400;
      else if (name.includes("3.6")) v += 300;
      else if (name.includes("3.5")) v += 200;
      else if (name.includes("3.1")) v += 100;
      
      if (name.includes("high")) v += 30;
      else if (name.includes("medium")) v += 20;
      else if (name.includes("low")) v += 10;
      return v;
    }
    if (name.includes("claude")) {
      let v = 500;
      if (name.includes("sonnet")) v += 50;
      else if (name.includes("opus")) v += 40;
      else if (name.includes("haiku")) v += 30;
      return v;
    }
    if (name.includes("gpt")) {
      return 200;
    }
    return 100;
  }
  return [...filtered].sort((a, b) => getScore(b) - getScore(a));
}


type FrpProxyItem = {
  name: string;
  type: string;
  remotePort: number;
  localIp: string;
  localPort: number;
  status: string;
  clientId?: string;
  hostname?: string;
};

type PeerTransport = {
  type: "direct" | "frp" | "custom";
  frpProxyName?: string;
  host?: string;
  port?: number | string;
};

type PeerAuth = {
  type: "ssh" | "gateway_token" | "none";
  ssh?: {
    username?: string;
    authType?: "password" | "key" | "agent";
    password?: string;
    privateKeyPath?: string;
  };
  gatewayToken?: string;
};

type Peer = {
  id: string;
  name: string;
  displayName?: string;
  transport?: PeerTransport;
  auth?: PeerAuth;
  services?: { gatewayApi?: string };
  status?: string;
  lastCheck?: string | null;
};

type RemoteConfig = {
  enabled?: boolean;
  peers?: Peer[];
};

type RemoteStatus = {
  enabled?: boolean;
  natTraversalEnabled?: boolean;
  sessions?: Array<{
    id?: string;
    state?: string;
    hostPeerId?: string;
    hostProjectId?: string;
    hostConversationId?: string;
    controllerPeerId?: string;
    latestSeq?: number;
  }>;
};

type ProjectConversation = {
  id: string;
  title: string;
  updatedAt?: number;
};

type Project = {
  id: string;
  name?: string;
  path?: string;
  conversations?: ProjectConversation[];
};

type AvailableModel = { id: string; name: string; source?: string; isRecommended?: boolean };
type OfficialRemoteLink = { id: string; name: string; url: string; kind?: string; createdAt?: number; updatedAt?: number };
type OfficialLinkFramePolicy = { id?: string; embeddable?: boolean; reason?: string; xFrameOptions?: string };

type SessionEvent = {
  seq?: number;
  type?: string;
  summary?: string;
  approvalId?: string;
  turnId?: string;
  hostEvent?: any;
};

type StreamState = {
  sessionId: string;
  source: EventSource | null;
};

const OFFICIAL_MODELS_FALLBACK: AvailableModel[] = sortAntigravityModels([
  { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash High (Fast)", isRecommended: true },
  { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash High (Fast)" },
  { id: "gemini-3.5-flash-high", name: "Gemini 3.5 Flash High (Fast)" },
  { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro High" },
  { id: "claude-sonnet-4-6-thinking", name: "Claude Sonnet 4.6 (Thinking)" },
  { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
  { id: "gpt-oss-120b-high", name: "GPT-OSS 120B (High)" },
]);

const state: {
  view: "catalog" | "antigravity" | "official-links";
  loading: boolean;
  error: string;
  config: RemoteConfig | null;
  status: RemoteStatus | null;
  peers: Peer[];
  frpProxies: FrpProxyItem[];
  localFrpcProxyNames: Set<string>;
  frpServerHost: string;
  projects: Project[];
  availableModels: AvailableModel[];
  selectedPeerId: string;
  selectedProjectId: string;
  selectedConversationId: string;
  customProjectPath: string;
  selectedModel: string;
  activeSessionId: string;
  events: SessionEvent[];
  promptDraft: string;
  controllerPeerId: string;
  editingPeer: Peer | null;
  showPeerModal: boolean;
  showPeersDrawer: boolean;
  showPasswordPlain: boolean;
  stream: StreamState;
  officialLinks: OfficialRemoteLink[];
  selectedOfficialLinkId: string;
  editingOfficialLink: { id?: string; name: string; url: string } | null;
  showOfficialLinkModal: boolean;
  officialFramePolicy: OfficialLinkFramePolicy | null;
  officialFrameChecking: boolean;
} = {
  view: "catalog",
  loading: false,
  error: "",
  config: null,
  status: null,
  peers: [],
  frpProxies: [],
  localFrpcProxyNames: new Set(),
  frpServerHost: "",
  projects: [],
  availableModels: OFFICIAL_MODELS_FALLBACK,
  selectedPeerId: "",
  selectedProjectId: "",
  selectedConversationId: "",
  customProjectPath: "",
  selectedModel: "",
  activeSessionId: "",
  events: [],
  promptDraft: "",
  controllerPeerId: "controller-a",
  editingPeer: null,
  showPeerModal: false,
  showPeersDrawer: false,
  showPasswordPlain: false,
  stream: { sessionId: "", source: null },
  officialLinks: [],
  selectedOfficialLinkId: "",
  editingOfficialLink: null,
  showOfficialLinkModal: false,
  officialFramePolicy: null,
  officialFrameChecking: false,
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
  return document.getElementById("remote-session-root");
}

function remotePeers(): Peer[] {
  return state.peers.filter((p) => p.id !== "local-host");
}

function activeSession() {
  const sessions = state.status?.sessions || [];
  return sessions.find((item) => item.id === state.activeSessionId) || sessions[0] || null;
}

function selectedPeer(): Peer | null {
  return remotePeers().find((p) => p.id === state.selectedPeerId) || null;
}

function selectedProject(): Project | null {
  return (
    state.projects.find(
      (p) => p.id === state.selectedProjectId || p.path === state.selectedProjectId,
    ) ||
    state.projects[0] ||
    null
  );
}

function statusBadge(status?: string): string {
  const s = status || "unknown";
  if (s === "ready") return "badge badge-default";
  if (s === "running") return "badge";
  if (s === "awaiting_approval") return "badge badge-key-missing";
  if (s === "disconnected") return "badge";
  if (s === "ended") return "badge";
  return "badge";
}

function formatTimeAgo(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m 前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h 前`;
  return `${Math.floor(diff / 86400000)}d 前`;
}

function latestApprovalId(): string {
  const hit = [...state.events].reverse().find((event) => event.type === "approval_required");
  return hit?.approvalId || hit?.hostEvent?.approvalId || "";
}

function getEventRoleMeta(event: any): {
  roleClass: string;
  roleBadgeHtml: string;
  typeBadgeText: string;
} {
  const type = String(event.type || event.hostType || "").toLowerCase();
  const isApproval = type === "approval_required" || Boolean(event.approvalId);
  if (isApproval) {
    return {
      roleClass: "is-approval",
      roleBadgeHtml: `<span class="badge rs-role-badge rs-role-approval">⚠️ 待审批拦截</span>`,
      typeBadgeText: "approval",
    };
  }
  if (
    type.includes("user") ||
    type.includes("prompt") ||
    type === "user_input" ||
    type === "prompt_dispatched"
  ) {
    return {
      roleClass: "is-user",
      roleBadgeHtml: `<span class="badge rs-role-badge rs-role-user">👤 用户 Prompt</span>`,
      typeBadgeText: type,
    };
  }
  if (
    type.includes("assistant") ||
    type.includes("planner") ||
    type.includes("model") ||
    type === "thinking"
  ) {
    return {
      roleClass: "is-assistant",
      roleBadgeHtml: `<span class="badge rs-role-badge rs-role-assistant">🤖 Agent 回复</span>`,
      typeBadgeText: type,
    };
  }
  return {
    roleClass: "is-system",
    roleBadgeHtml: `<span class="badge rs-role-badge rs-role-system">⚙️ 系统状态</span>`,
    typeBadgeText: type || "event",
  };
}

function renderEvents(): string {
  if (!state.events.length) {
    return `<div class="rs-empty">暂无事件。在下方输入 Prompt 发送后，实时编码与思考流将在此展示。</div>`;
  }
  return `
    <div class="rs-event-list">
      ${state.events
        .slice()
        .reverse()
        .map((event) => {
          const text =
            event.text ||
            event.summary ||
            event.hostEvent?.text ||
            event.hostEvent?.summary ||
            event.type ||
            "event";
          const { roleClass, roleBadgeHtml, typeBadgeText } = getEventRoleMeta(event);
          return `
            <div class="rs-event-item ${roleClass}">
              <div class="rs-event-meta">
                <span class="badge">#${escapeHtml(String(event.seq || "-"))}</span>
                ${roleBadgeHtml}
                <span class="badge" style="font-size:11px; opacity:0.75;">${escapeHtml(typeBadgeText)}</span>
                ${event.approvalId ? `<span class="badge badge-key-missing">待审批 ${escapeHtml(event.approvalId)}</span>` : ""}
                ${event.turnId ? `<span class="badge" style="font-size:11px;">${escapeHtml(event.turnId)}</span>` : ""}
              </div>
              <div class="rs-event-body">${escapeHtml(String(text))}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function closeEventStream(): void {
  state.stream.source?.close();
  state.stream = { sessionId: "", source: null };
}

function syncEventStream(): void {
  if (!state.activeSessionId) {
    closeEventStream();
    return;
  }
  if (state.stream.sessionId === state.activeSessionId && state.stream.source) return;

  closeEventStream();
  const source = new EventSource(
    `/v1/remote-session/sessions/${encodeURIComponent(state.activeSessionId)}/events/stream?cursor=0&includeHostEvents=true`,
  );
  source.addEventListener("session_event", (event) => {
    try {
      const record = JSON.parse((event as MessageEvent).data) as SessionEvent;
      const index = state.events.findIndex((item) => item.seq === record.seq);
      if (index >= 0) state.events[index] = record;
      else state.events.push(record);
      state.events.sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
      render();
    } catch {
      // Ignore malformed server events; the next refresh can restore state.
    }
  });
  source.onerror = () => {
    closeEventStream();
    showToast("实时事件流连接中断，稍后刷新可重连", "error");
  };
  state.stream = { sessionId: state.activeSessionId, source };
}

// 1. 卡片首页 (Card Catalog)
function renderCatalog(): string {
  const currentSession = activeSession();
  const sessionActive = Boolean(currentSession && currentSession.state !== "ended");
  const remotes = remotePeers();
  const activePeer = selectedPeer();
  const officialBadgeClass = state.officialLinks.length ? "badge badge-default" : "badge";
  const officialBadgeText = state.officialLinks.length ? state.officialLinks.length + " 个链接" : "未配置";
  const officialRecentText = state.officialLinks[0]
    ? "最近：" + state.officialLinks[0].name
    : "保存官方 /r/ 链接并按需打开";

  return `
    <div class="rs-page">
      <div class="rs-top-action-bar" style="display:flex; justify-content:flex-end; gap:8px; margin-bottom:16px;">
        <button class="btn" onclick="window.__rsOpenPeersDrawer()">📡 对端设备管理 (${remotes.length})</button>
        <button class="btn" onclick="window.__rsReload()" ${state.loading ? "disabled" : ""}>刷新状态</button>
      </div>

      ${state.error ? `<div class="rs-alert">${escapeHtml(state.error)}</div>` : ""}

      <div class="endpoints-grid">
        <div class="node-card" role="button" tabindex="0"
             onclick="window.__rsOpenScene('antigravity')"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.__rsOpenScene('antigravity');}">
          <div class="node-card-top">
            <div class="node-card-title-row">
              <div class="node-card-title">🌟 Antigravity 远程编码</div>
            </div>
            <div class="node-card-actions" onclick="event.stopPropagation()">
              <span class="badge ${sessionActive ? "badge-default" : ""} ${currentSession?.state === "awaiting_approval" ? "badge-key-missing" : ""}">
                ${sessionActive ? (currentSession?.state === "awaiting_approval" ? "待审批" : "会话活跃") : "就绪"}
              </span>
            </div>
          </div>
          <div class="node-card-meta">
            <div class="node-card-row">
              <span class="badge">Language Server</span>
              <span class="badge">Cascade Trajectory</span>
              <span class="badge">双向审批</span>
            </div>
            <div class="node-card-row">
              <span class="mono">${
                activePeer
                  ? `当前选定主机: ${escapeHtml(activePeer.displayName || activePeer.name || activePeer.id)}`
                  : remotes.length
                    ? `可选主机: ${remotes.length} 个远端节点`
                    : "尚未添加对端主机 (点击右上角添加)"
              }</span>
            </div>
            <div class="node-card-models">
              <span class="tag">工作区挂载</span>
              <span class="tag">历史会话复用</span>
              <span class="tag">代码审批</span>
            </div>
          </div>
          <div class="node-card-footer">
            <span>连接远端 Antigravity，交互式执行 Cascade 编码与审批</span>
            <span class="node-card-cta">进入远程编码工作台 →</span>
          </div>
        </div>
      </div>
      <div class="endpoints-grid">
        <div class="node-card" role="button" tabindex="0"
             onclick="window.__rsOpenScene('official-links')"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.__rsOpenScene('official-links');}">
          <div class="node-card-top">
            <div class="node-card-title-row">
              <div class="node-card-title">🔗 Antigravity 官方远程控制</div>
            </div>
            <div class="node-card-actions" onclick="event.stopPropagation()">
              <span class="${officialBadgeClass}">${officialBadgeText}</span>
            </div>
          </div>
          <div class="node-card-meta">
            <div class="node-card-row">
              <span class="badge">Official Remote Control</span>
              <span class="badge">新 Tab 打开</span>
            </div>
            <div class="node-card-row mono">${escapeHtml(officialRecentText)}</div>
          </div>
          <div class="node-card-footer">
            <span>管理官方远程链接；官方站点禁止 iframe 时使用新 Tab</span>
            <span class="node-card-cta">管理官方链接 →</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// 2. Antigravity 远程编码详情工作台
function renderAntigravityScene(): string {
  const session = activeSession();
  const latestAp = latestApprovalId();
  const remotes = remotePeers();
  const currentProj = selectedProject();
  const projectConversations = currentProj?.conversations || [];

  return `
    <div class="rs-page">
      <div class="rs-top-action-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <button class="btn btn-sm" onclick="window.__rsBackToCatalog()">← 返回场景列表</button>
        <div style="display:flex; gap:8px;">
          <button class="btn" onclick="window.__rsOpenPeersDrawer()">📡 对端设备管理 (${remotes.length})</button>
          <button class="btn" onclick="window.__rsReload()" ${state.loading ? "disabled" : ""}>刷新状态</button>
        </div>
      </div>

      ${state.error ? `<div class="rs-alert">${escapeHtml(state.error)}</div>` : ""}

      <!-- 远端连接与工作区选择卡片 -->
      <div class="card rs-block">
        <div class="rs-block-head">
          <h3>远端主机、工作区与会话</h3>
          <div class="rs-inline-actions">
            <button class="btn btn-sm" onclick="window.__rsOpenPeersDrawer()">⚙️ 管理对端节点</button>
            <button class="btn btn-sm" onclick="window.__rsLoadProjects()" ${state.loading || !state.selectedPeerId ? "disabled" : ""}>🔄 刷新远端数据</button>
          </div>
        </div>

        <div class="rs-form-grid">
          <!-- 目标主机 -->
          <label class="form-group">
            <span>目标对端主机 (Host Peer)</span>
            <select id="rs-peer" onchange="window.__rsSelectPeer(this.value)">
              ${
                remotes.length
                  ? remotes
                      .map(
                        (p) =>
                          `<option value="${escapeHtml(p.id)}" ${
                            state.selectedPeerId === p.id ? "selected" : ""
                          }>🌐 ${escapeHtml(p.displayName || p.name || p.id)} [${escapeHtml(p.transport?.type || "direct")}:${p.transport?.port || ""}]</option>`,
                      )
                      .join("")
                  : `<option value="">-- 暂无对端主机 (请先点击「管理对端节点」添加) --</option>`
              }
            </select>
          </label>

          <!-- 工作区项目 -->
          <label class="form-group">
            <span>工作区项目 (Workspace Project)</span>
            <select id="rs-project" onchange="window.__rsSelectProject(this.value)">
              ${
                state.projects.length
                  ? state.projects
                      .map(
                        (project) =>
                          `<option value="${escapeHtml(project.path || project.id)}" ${
                            (state.selectedProjectId === project.path || state.selectedProjectId === project.id) ? "selected" : ""
                          }>📁 ${escapeHtml(project.name || project.id)} (${escapeHtml(project.path || "")})${
                            project.conversations?.length ? " [" + project.conversations.length + "个会话]" : ""
                          }</option>`,
                      )
                      .join("")
                  : `<option value="">-- 远端暂无工程，可在下方手动指定绝对路径 --</option>`
              }
            </select>
          </label>

          <!-- 项目下的会话选择 -->
          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <span>项目会话 (Conversation)</span>
              <button class="btn btn-xs" type="button" onclick="window.__rsOpenConversationModal()" ${!state.selectedConversationId ? "disabled style='opacity:0.5; cursor:not-allowed;'" : "style='cursor:pointer; color:var(--primary);'"}>
                💬 查看对话详情
              </button>
            </div>
            <select id="rs-conversation-select" onchange="window.__rsSelectConversation(this.value)">
              <option value="">✨ + 新建独立会话 (在当前工作区开启新任务)</option>
              ${projectConversations
                .map(
                  (conv) =>
                    `<option value="${escapeHtml(conv.id)}" ${
                      state.selectedConversationId === conv.id ? "selected" : ""
                    }>💬 ${escapeHtml(conv.title || conv.id)}${
                      conv.updatedAt ? " (" + formatTimeAgo(conv.updatedAt) + ")" : ""
                    }</option>`,
                )
                .join("")}
            </select>
          </div>

          <!-- 执行模型 -->
          <label class="form-group">
            <span>执行模型 (Execution Model)</span>
            <select id="rs-model-select" onchange="window.__rsSelectModel(this.value)">
              <option value="">默认 (由 Antigravity 自动推断 / 继承会话)</option>
              ${state.availableModels
                .map(
                  (m) =>
                    `<option value="${escapeHtml(m.id)}" ${state.selectedModel === m.id ? "selected" : ""}>${escapeHtml(m.name || m.id)}</option>`,
                )
                .join("")}
            </select>
          </label>

          <!-- 手动路径兜底 -->
          <label class="form-group rs-col-2">
            <span>远端工作区绝对路径 (手动指定 / 覆盖)</span>
            <input id="rs-custom-project-path" value="${escapeHtml(state.customProjectPath)}" placeholder="例如：/Users/pa/project 或 D:\\projects\\my-app (选择上方项目时将自动填充)" oninput="window.__rsChangeCustomPath(this.value)" />
          </label>
        </div>
      </div>

      <!-- 待处理审批卡片 -->
      ${latestAp ? `
        <div class="card rs-block rs-approval-highlight">
          <div class="rs-block-head">
            <div>
              <h3 style="color:var(--danger,#e63946);">⚠️ 待处理审批 (Approval Required)</h3>
              <p class="rs-help">远端 Cascade 触发了文件修改或命令执行操作，等待您的授权决定。</p>
            </div>
            <div class="rs-inline-actions">
              <button class="btn btn-primary" onclick="window.__rsApprove()" ${state.loading ? "disabled" : ""}>✓ 批准执行</button>
              <button class="btn btn-danger" onclick="window.__rsDeny()" ${state.loading ? "disabled" : ""}>✕ 拒绝</button>
            </div>
          </div>
          <div class="rs-approval-body">
            审批 ID: <code>${escapeHtml(latestAp)}</code>
          </div>
        </div>
      ` : ""}

      <!-- 交互控制与 Prompt 下发 -->
      <div class="card rs-block">
        <div class="rs-block-head">
          <h3>会话交互与 Prompt 下发</h3>
          <div class="rs-inline-actions">
            <button class="btn btn-sm" onclick="window.__rsRefreshEvents()" ${state.loading || !state.activeSessionId ? "disabled" : ""}>刷新事件</button>
            <button class="btn btn-sm" onclick="window.__rsResume()" ${state.loading || !state.activeSessionId ? "disabled" : ""}>恢复会话</button>
            <button class="btn btn-sm btn-danger" onclick="window.__rsEnd()" ${state.loading || !state.activeSessionId ? "disabled" : ""}>结束会话</button>
          </div>
        </div>
        ${
          session
            ? `<div class="rs-inline-actions" style="margin-bottom:10px;">
                <span class="badge">Session: ${escapeHtml(session.id || "")}</span>
                <span class="${statusBadge(session.state)}">${escapeHtml(session.state || "unknown")}</span>
                <span class="badge">Host: ${escapeHtml(session.hostPeerId || "")}</span>
                <span class="badge">Project: ${escapeHtml(session.hostProjectId || "")}</span>
                <span class="badge">Conversation: ${escapeHtml(session.hostConversationId || "")}</span>
              </div>`
            : `<div class="rs-empty">尚未连接到活动会话，请先选择远端主机与工作区后点击「新建 / 接入会话」。</div>`
        }
        <div class="rs-form-grid">
          <label class="form-group rs-col-2">
            <span>Prompt 指令</span>
            <textarea id="rs-prompt" rows="3" placeholder="下发编程指令，例如：检查当前项目单测并修复 failing 模块... (Enter 发送)">${escapeHtml(
              state.promptDraft,
            )}</textarea>
          </label>
        </div>
        <div class="rs-inline-actions" style="margin-top:10px; justify-content:flex-end;">
          <button class="btn btn-primary" onclick="window.__rsSendPrompt()" ${
            state.loading || !state.selectedPeerId ? "disabled" : ""
          }>发送 Prompt ➔</button>
        </div>
      </div>

      <!-- 实时事件流 -->
      <div class="card rs-block">
        <div class="rs-block-head">
          <h3>实时事件流 (Live Event Stream)</h3>
        </div>
        ${renderEvents()}
      </div>
      ${renderConversationModal()}
    </div>
  `;
}

function selectedOfficialLink(): OfficialRemoteLink | null {
  return state.officialLinks.find((item) => item.id === state.selectedOfficialLinkId) || null;
}

function renderOfficialLinksScene(): string {
  const selected = selectedOfficialLink();
  const policy = state.officialFramePolicy;
  const statusText = state.officialFrameChecking
    ? "正在检测官方页面嵌入策略..."
    : policy?.embeddable === false
      ? "官方站点禁止 iframe 嵌入，请使用新 Tab 打开。"
      : policy?.embeddable
        ? "官方页面允许嵌入，可以尝试预览。"
        : "尚未检测嵌入策略。";
  const pills = state.officialLinks
    .map((item) => {
      const active = item.id === state.selectedOfficialLinkId;
      return `<button type="button" class="rs-official-link-pill ${active ? "active" : ""}" role="radio" aria-checked="${active}" aria-current="${active ? "true" : "false"}" onclick="window.__rsSelectOfficialLink('${escapeHtml(item.id)}')">${escapeHtml(item.name)}</button>`;
    })
    .join("");
  return `
    <div class="rs-page">
      <div class="rs-top-action-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <button class="btn btn-sm" onclick="window.__rsBackToCatalog()">← 返回场景列表</button>
        <button class="btn btn-primary" onclick="window.__rsEditOfficialLink()">+ 新增官方链接</button>
      </div>
      ${state.error ? `<div class="rs-alert">${escapeHtml(state.error)}</div>` : ""}
      <div class="card rs-block">
        <div class="rs-block-head">
          <h3>官方远程链接</h3>
          <div class="rs-inline-actions">
            <button class="btn btn-sm" onclick="window.__rsLoadOfficialLinks()" ${state.loading ? "disabled" : ""}>刷新</button>
          </div>
        </div>
        <div class="rs-official-link-track" role="radiogroup" aria-label="官方远程链接">
          ${pills}
          <button type="button" class="rs-official-link-pill rs-official-add" onclick="window.__rsEditOfficialLink()">+ 新增</button>
        </div>
      </div>
      <div class="card rs-block">
        <div class="rs-block-head">
          <h3>${selected ? escapeHtml(selected.name) : "选择一个官方链接"}</h3>
          <div class="rs-inline-actions">
            ${selected ? `
              <button class="btn btn-sm" onclick="window.__rsCheckOfficialFrame()">检测嵌入</button>
              <button class="btn btn-sm" onclick="window.__rsEditOfficialLink('${escapeHtml(selected.id)}')">编辑</button>
              <button class="btn btn-sm" onclick="window.__rsDeleteOfficialLink('${escapeHtml(selected.id)}')">删除</button>
              <button class="btn btn-primary btn-sm" onclick="window.__rsOpenOfficialLink('${escapeHtml(selected.id)}')">打开官方页面</button>
            ` : ""}
          </div>
        </div>
        ${selected ? `
          <div class="rs-official-detail">
            <code class="path-pill">${escapeHtml(selected.url)}</code>
            <div class="rs-official-status ${policy?.embeddable === false ? "is-blocked" : ""}">${escapeHtml(statusText)}</div>
            ${policy?.embeddable ? `
              <div class="rs-official-frame-wrap">
                <iframe src="${escapeHtml(selected.url)}" title="Antigravity 官方远程控制"></iframe>
              </div>
            ` : ""}
          </div>
        ` : `<div class="rs-empty">尚无选中的官方链接。点击“新增官方链接”保存一个 antigravity.google.com /r/ 链接。</div>`}
      </div>
      ${renderOfficialLinkModal()}
    </div>
  `;
}

function renderOfficialLinkModal(): string {
  if (!state.showOfficialLinkModal || !state.editingOfficialLink) return "";
  return `
    <div class="rs-modal-overlay" onclick="window.__rsCloseOfficialLinkModal()">
      <div class="rs-modal-card" onclick="event.stopPropagation()">
        <h3>${state.editingOfficialLink.id ? "编辑官方链接" : "新增官方链接"}</h3>
        <label class="form-group">
          <span>名称</span>
          <input id="rs-official-name" type="text" value="${escapeHtml(state.editingOfficialLink.name)}" placeholder="例如：工作台 Mac" maxlength="80" />
        </label>
        <label class="form-group">
          <span>官方远程链接 (HTTPS)</span>
          <textarea id="rs-official-url" rows="4" placeholder="https://antigravity.google.com/r/...">${escapeHtml(state.editingOfficialLink.url)}</textarea>
        </label>
        <p class="rs-help rs-help-warn">链接仅保存在本机 gateway.db，不会提交到 GitHub。</p>
        <div class="rs-inline-actions" style="justify-content:flex-end; margin-top:16px;">
          <button class="btn" onclick="window.__rsCloseOfficialLinkModal()">取消</button>
          <button class="btn btn-primary" onclick="window.__rsSaveOfficialLink()">保存</button>
        </div>
      </div>
    </div>
  `;
}

// 对端节点管理抽屉 / 列表弹窗 (Peers Management)
function renderPeersDrawer(): string {
  if (!state.showPeersDrawer) return "";
  const remotes = remotePeers();

  return `
    <div class="rs-modal-overlay" onclick="if(event.target===this) window.__rsClosePeersDrawer()">
      <div class="rs-modal-card card" style="max-width:700px;">
        <div class="rs-block-head">
          <div>
            <h3>📡 对端设备管理 (Peers)</h3>
            <p class="rs-help">管理受控端主机及其网络通道与 SSH 认证接入配置。</p>
          </div>
          <div class="rs-inline-actions">
            <button class="btn btn-primary btn-sm" onclick="window.__rsOpenAddPeerModal()">+ 添加对端节点</button>
            <button class="btn btn-sm" onclick="window.__rsClosePeersDrawer()">✕ 关闭</button>
          </div>
        </div>

        <div class="endpoints-grid" style="margin-top:16px;">
          ${
            remotes.length
              ? remotes
                  .map((p) => {
                    const isFrp = (p.transport?.type || "direct") === "frp";
                    const host = p.transport?.host || state.frpServerHost || "";
                    const port = p.transport?.port || "";
                    const authType = p.auth?.type || "ssh";
                    const sshUser = p.auth?.ssh?.username || "未配置用户名";

                    return `
                      <div class="node-card">
                        <div class="node-card-top">
                          <div class="node-card-title">🌐 ${escapeHtml(p.displayName || p.name || p.id)}</div>
                          <div class="rs-inline-actions">
                            <button class="btn btn-sm" onclick="window.__rsEditPeer('${escapeHtml(p.id)}')">编辑</button>
                            <button class="btn btn-sm btn-danger" onclick="window.__rsDeletePeer('${escapeHtml(p.id)}')">删除</button>
                          </div>
                        </div>
                        <div class="node-card-meta">
                          <div class="node-card-row">
                            <span class="badge">${isFrp ? "FRP 穿透" : "直连"}</span>
                            ${p.transport?.frpProxyName ? `<span class="badge">Proxy: ${escapeHtml(p.transport.frpProxyName)}</span>` : ""}
                            ${port ? `<span class="badge">端口 ${port}</span>` : ""}
                          </div>
                          ${host ? `<div class="node-card-row"><span class="mono">${escapeHtml(host)}${port ? ":" + port : ""}</span></div>` : ""}
                          <div class="node-card-row">
                            <span class="badge">${
                              authType === "ssh"
                                ? `SSH: ${escapeHtml(sshUser)}`
                                : authType === "gateway_token"
                                  ? "Token 认证"
                                  : "无需认证"
                            }</span>
                          </div>
                        </div>
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="rs-empty" style="grid-column:1/-1;">暂未添加对端节点。点击右上角「+ 添加对端节点」开始配置。</div>`
          }
        </div>
      </div>
    </div>
  `;
}

// 对端节点编辑模态窗 (Modal)
function renderPeerModal(): string {
  if (!state.showPeerModal) return "";
  const p = state.editingPeer || {
    id: "",
    name: "",
    transport: { type: "direct", frpProxyName: "", host: "", port: "" },
    auth: { type: "ssh", ssh: { username: "", authType: "password", password: "" } },
  };
  const transportType = p.transport?.type || "direct";
  const isFrp = transportType === "frp";
  const authType = p.auth?.type || "ssh";
  const isSsh = authType === "ssh";
  const isToken = authType === "gateway_token";
  const hasPasswordConfigured = Boolean(p.auth?.ssh?.password);

  const availableRemoteFrpProxies = state.frpProxies.filter(
    (px) => !state.localFrpcProxyNames.has(px.name),
  );

  return `
    <div class="rs-modal-overlay" onclick="if(event.target===this) window.__rsClosePeerModal()">
      <div class="rs-modal-card card">
        <div class="rs-block-head">
          <h3>${p.id && !p.id.startsWith("peer_") ? "编辑对端节点 (Peer)" : "添加新对端节点 (Peer)"}</h3>
          <button class="btn btn-sm" onclick="window.__rsClosePeerModal()">✕</button>
        </div>

        <div class="rs-divider"></div>
        <div class="rs-section-subtitle">
          <span>网络通道配置 (Transport)</span>
          ${isFrp ? `<button class="btn btn-sm" onclick="window.__rsFetchFrpProxies()">刷新 FRP 代理列表</button>` : ""}
        </div>

        <div class="rs-form-grid">
          <label class="form-group">
            <span>穿透方式</span>
            <select id="modal-peer-transport-type" onchange="window.__rsModalTransportChange(this.value)">
              <option value="direct" ${transportType === "direct" ? "selected" : ""}>直连 (局域网 / 公网 IP / VPN)</option>
              <option value="frp" ${transportType === "frp" ? "selected" : ""}>FRP 内网穿透</option>
              <option value="custom" ${transportType === "custom" ? "selected" : ""}>自定义通道</option>
            </select>
          </label>

          ${isFrp ? `
            <label class="form-group">
              <span>选择 FRP 对端 Proxy (已过滤本机)</span>
              <select id="modal-peer-frp-proxy" onchange="window.__rsModalSelectFrpProxy(this.value)">
                ${availableRemoteFrpProxies.length === 0
                  ? `<option value="">(未发现可用的远端 FRP 代理)</option>`
                  : availableRemoteFrpProxies
                    .map(
                      (px) =>
                        `<option value="${escapeHtml(px.name)}" data-port="${px.remotePort}" ${
                          (p.transport?.frpProxyName || availableRemoteFrpProxies[0]?.name) === px.name ? "selected" : ""
                        }>${escapeHtml(px.name)} [${escapeHtml(px.type.toUpperCase())}:${px.remotePort}] (${escapeHtml(px.status)})</option>`,
                    )
                    .join("")}
              </select>
            </label>
          ` : ""}

          <label class="form-group">
            <span>目标 Host / IP</span>
            <input id="modal-peer-host" value="${escapeHtml(p.transport?.host || "")}" placeholder="例如：192.168.1.100 或 39.105.19.237" />
          </label>

          <label class="form-group">
            <span>连接端口 (Port)</span>
            <input id="modal-peer-port" type="number" value="${p.transport?.port ?? ""}" placeholder="例如：22 或 6005" />
          </label>

          <label class="form-group rs-col-2">
            <span>节点名称 (Display Name)</span>
            <input id="modal-peer-name" value="${escapeHtml(p.name || p.displayName || "")}" placeholder="例如：办公室开发机 / mac-pa" />
          </label>
        </div>

        <div class="rs-divider"></div>
        <div class="rs-section-subtitle">主机访问与认证 (Auth)</div>

        <div class="rs-form-grid">
          <label class="form-group ${!isSsh && !isToken ? "rs-col-2" : ""}">
            <span>认证模式</span>
            <select id="modal-peer-auth-type" onchange="window.__rsModalAuthChange(this.value)">
              <option value="ssh" ${isSsh ? "selected" : ""}>SSH 认证</option>
              <option value="gateway_token" ${isToken ? "selected" : ""}>Gateway Token</option>
              <option value="none" ${authType === "none" ? "selected" : ""}>无需认证</option>
            </select>
          </label>

          ${isSsh ? `
            <label class="form-group">
              <span>SSH 用户名</span>
              <input id="modal-peer-ssh-user" value="${escapeHtml(p.auth?.ssh?.username || "")}" placeholder="例如：root 或 pa" />
            </label>
            <label class="form-group rs-col-2">
              <span style="display:flex; justify-content:space-between; align-items:center;">
                <span>SSH 密码 / 密钥</span>
                <span class="badge ${hasPasswordConfigured ? "badge-default" : ""}" style="font-size:11px;">
                  ${hasPasswordConfigured ? "已配置" : "未配置"}
                </span>
              </span>
              <div style="display:flex; gap:6px;">
                <input id="modal-peer-ssh-pwd" type="${state.showPasswordPlain ? "text" : "password"}" value="${escapeHtml(p.auth?.ssh?.password || "")}" placeholder="${hasPasswordConfigured ? "留空则保持已配置密码" : "输入 SSH 登录密码"}" style="flex:1;" />
                <button type="button" class="btn btn-sm" onclick="window.__rsTogglePasswordPlain()" title="切换明文/密文">
                  ${state.showPasswordPlain ? "🙈 隐藏" : "👁️ 显示"}
                </button>
              </div>
            </label>
          ` : isToken ? `
            <label class="form-group">
              <span>Gateway Token</span>
              <input id="modal-peer-token" type="password" value="${escapeHtml(p.auth?.gatewayToken || "")}" placeholder="填写远端网关 Token" />
            </label>
          ` : ""}
        </div>

        <div class="rs-inline-actions" style="margin-top:20px; justify-content:flex-end;">
          <button class="btn" onclick="window.__rsClosePeerModal()">取消</button>
          <button class="btn btn-primary" onclick="window.__rsSavePeerModal()">保存节点</button>
        </div>
      </div>
    </div>
  `;
}

function render(): void {
  const el = rootEl();
  if (!el) return;
  const content = state.view === "antigravity"
    ? renderAntigravityScene()
    : state.view === "official-links"
      ? renderOfficialLinksScene()
      : renderCatalog();
  el.innerHTML = content + renderPeersDrawer() + renderPeerModal();
}

async function reload(): Promise<void> {
  state.loading = true;
  state.error = "";
  render();
  try {
    const [config, status, peersRes, proxiesRes, natCfg] = await Promise.all([
      api<RemoteConfig>("/v1/remote-session/config"),
      api<RemoteStatus>("/v1/remote-session/status"),
      api<{ peers: Peer[] }>("/v1/remote-session/peers").catch(() => ({ peers: [] })),
      api<{ ok: boolean; serverHost?: string; proxies?: FrpProxyItem[] }>("/v1/nat-traversal/dashboard/proxies").catch(() => ({ ok: false, proxies: [] })),
      api<{ frpc?: { proxies?: Array<{ name: string }> } }>("/v1/nat-traversal/config").catch(() => ({})),
    ]);
    state.config = config;
    state.status = status;
    state.peers = peersRes.peers || [];
    if (proxiesRes?.proxies) {
      state.frpProxies = proxiesRes.proxies;
      state.frpServerHost = proxiesRes.serverHost || "";
    }

    const localNames = new Set<string>();
    if (Array.isArray(natCfg?.frpc?.proxies)) {
      for (const px of natCfg.frpc.proxies) {
        if (px?.name) localNames.add(px.name);
      }
    }
    state.localFrpcProxyNames = localNames;

    const remotes = remotePeers();
    if (!state.selectedPeerId || !remotes.some((p) => p.id === state.selectedPeerId)) {
      state.selectedPeerId = remotes[0]?.id || "";
    }

    if (!state.activeSessionId && status.sessions?.length) {
      state.activeSessionId = status.sessions[0].id || "";
    }

    if (state.selectedPeerId) {
      try {
        const [modelsRes, projData] = await Promise.all([
          api<{ models: AvailableModel[] }>("/v1/remote-session/models?peerId=" + encodeURIComponent(state.selectedPeerId)).catch(() => ({ models: [] })),
          api<{ projects: Project[] }>("/v1/remote-session/projects?peerId=" + encodeURIComponent(state.selectedPeerId)).catch(() => ({ projects: [] })),
        ]);
        state.availableModels = sortAntigravityModels(modelsRes.models?.length ? modelsRes.models : OFFICIAL_MODELS_FALLBACK);
        state.projects = projData.projects || [];
        if (!state.selectedProjectId && state.projects[0]) {
          state.selectedProjectId = state.projects[0].path || state.projects[0].id;
          state.customProjectPath = state.projects[0].path || "";
        }
      } catch {
        state.availableModels = OFFICIAL_MODELS_FALLBACK;
        state.projects = [];
      }
    } else {
      state.availableModels = OFFICIAL_MODELS_FALLBACK;
      state.projects = [];
    }

    if (state.activeSessionId) {
      await refreshEvents(false);
    }
    syncEventStream();
  } catch (error: any) {
    state.error = error?.message || String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function loadOfficialLinks(): Promise<void> {
  state.loading = true;
  state.error = "";
  render();
  try {
    const data = await api<{ links: OfficialRemoteLink[] }>("/v1/remote-session/official-links");
    state.officialLinks = data.links || [];
    if (!state.officialLinks.some((item) => item.id === state.selectedOfficialLinkId)) {
      state.selectedOfficialLinkId = state.officialLinks[0]?.id || "";
      state.officialFramePolicy = null;
    }
  } catch (error: any) {
    state.error = error?.message || String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function selectOfficialLink(linkId: string): Promise<void> {
  state.selectedOfficialLinkId = linkId;
  state.officialFramePolicy = null;
  render();
}

function editOfficialLink(linkId = ""): void {
  const current = state.officialLinks.find((item) => item.id === linkId);
  state.editingOfficialLink = current
    ? { id: current.id, name: current.name, url: current.url }
    : { name: "", url: "" };
  state.showOfficialLinkModal = true;
  render();
}

function closeOfficialLinkModal(): void {
  state.showOfficialLinkModal = false;
  state.editingOfficialLink = null;
  render();
}

async function saveOfficialLink(): Promise<void> {
  if (!state.editingOfficialLink) return;
  const name = (document.getElementById("rs-official-name") as HTMLInputElement | null)?.value.trim() || "";
  const url = (document.getElementById("rs-official-url") as HTMLTextAreaElement | null)?.value.trim() || "";
  try {
    const path = state.editingOfficialLink.id
      ? "/v1/remote-session/official-links/" + encodeURIComponent(state.editingOfficialLink.id)
      : "/v1/remote-session/official-links";
    const data = await api<{ link: OfficialRemoteLink }>(path, {
      method: state.editingOfficialLink.id ? "PUT" : "POST",
      body: JSON.stringify({ name, url }),
    });
    state.showOfficialLinkModal = false;
    state.editingOfficialLink = null;
    state.selectedOfficialLinkId = data.link.id;
    showToast("官方远程链接已保存", "success");
    await loadOfficialLinks();
  } catch (error: any) {
    showToast(error?.message || String(error), "error");
  }
}

async function deleteOfficialLink(linkId: string): Promise<void> {
  const current = state.officialLinks.find((item) => item.id === linkId);
  if (!current || !confirm(`确定删除官方远程链接 "${current.name}" 吗？`)) return;
  try {
    await api("/v1/remote-session/official-links/" + encodeURIComponent(linkId), { method: "DELETE" });
    if (state.selectedOfficialLinkId === linkId) {
      state.selectedOfficialLinkId = "";
      state.officialFramePolicy = null;
    }
    showToast("官方远程链接已删除", "success");
    await loadOfficialLinks();
  } catch (error: any) {
    showToast(error?.message || String(error), "error");
  }
}

function openOfficialLink(linkId: string): void {
  const current = state.officialLinks.find((item) => item.id === linkId);
  if (!current) return;
  window.open(current.url, "_blank", "noopener,noreferrer");
}

async function checkOfficialFrame(): Promise<void> {
  if (!state.selectedOfficialLinkId) return;
  state.officialFrameChecking = true;
  state.officialFramePolicy = null;
  render();
  try {
    const data = await api<OfficialLinkFramePolicy>(
      "/v1/remote-session/official-links/" +
        encodeURIComponent(state.selectedOfficialLinkId) +
        "/frame-policy",
    );
    state.officialFramePolicy = data;
  } catch (error: any) {
    state.officialFramePolicy = {
      embeddable: false,
      reason: "check_failed",
      xFrameOptions: error?.message || String(error),
    };
  } finally {
    state.officialFrameChecking = false;
    render();
  }
}

async function fetchFrpProxies(): Promise<void> {
  try {
    const res = await api<{ ok: boolean; serverHost?: string; proxies?: FrpProxyItem[] }>("/v1/nat-traversal/dashboard/proxies");
    if (res?.proxies) {
      state.frpProxies = res.proxies;
      state.frpServerHost = res.serverHost || "";
      showToast(`已拉取到 ${res.proxies.length} 个 FRP 在线代理`, "success");
      render();
    }
  } catch (err: any) {
    showToast("拉取 FRP Dashboard 失败: " + err.message, "error");
  }
}

async function loadProjects(): Promise<void> {
  if (!state.selectedPeerId) {
    showToast("请先选择目标对端主机", "error");
    return;
  }
  state.loading = true;
  state.error = "";
  render();
  try {
    const [projData, modelsRes] = await Promise.all([
      api<{ projects: Project[] }>("/v1/remote-session/projects?peerId=" + encodeURIComponent(state.selectedPeerId)),
      api<{ models: AvailableModel[] }>("/v1/remote-session/models?peerId=" + encodeURIComponent(state.selectedPeerId)).catch(() => ({ models: [] })),
    ]);
    state.projects = projData.projects || [];
    state.availableModels = modelsRes.models?.length ? modelsRes.models : OFFICIAL_MODELS_FALLBACK;
    if ((!state.selectedProjectId || !state.projects.some(p => (p.path || p.id) === state.selectedProjectId)) && state.projects[0]) {
      state.selectedProjectId = state.projects[0].path || state.projects[0].id;
      state.customProjectPath = state.projects[0].path || "";
    }
    showToast(`已拉取 ${state.projects.length} 个项目工作区`, "success");
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
  } finally {
    state.loading = false;
    render();
  }
}

async function openSession(): Promise<void> {
  state.selectedPeerId =
    (document.getElementById("rs-peer") as HTMLSelectElement | null)?.value || state.selectedPeerId;
  state.selectedProjectId =
    (document.getElementById("rs-project") as HTMLSelectElement | null)?.value ||
    state.selectedProjectId;
  state.selectedConversationId =
    (document.getElementById("rs-conversation-select") as HTMLSelectElement | null)?.value ||
    state.selectedConversationId;
  state.customProjectPath =
    (document.getElementById("rs-custom-project-path") as HTMLInputElement | null)?.value?.trim() ||
    state.customProjectPath;

  if (!state.selectedPeerId) {
    showToast("请先选择目标对端主机", "error");
    return;
  }

  const targetProjectId = state.customProjectPath || state.selectedProjectId;
  if (!targetProjectId) {
    showToast("请选择项目或在下方输入远端工作区绝对路径", "error");
    return;
  }
  state.loading = true;
  state.error = "";
  render();
  try {
    const data = await api<{ session: any }>("/v1/remote-session/sessions", {
      method: "POST",
      body: JSON.stringify({
        peerId: state.selectedPeerId,
        projectId: targetProjectId,
        conversationId: state.selectedConversationId || undefined,
        controllerPeerId: state.controllerPeerId,
        model: state.selectedModel || undefined,
      }),
    });
    state.activeSessionId = data.session?.id || "";
    showToast("会话已建立: " + state.activeSessionId, "success");
    await reload();
    syncEventStream();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    state.loading = false;
    render();
  }
}

async function refreshEvents(showMsg = true): Promise<void> {
  if (!state.activeSessionId) return;
  const data = await api<{ events: SessionEvent[] }>(
    "/v1/remote-session/sessions/" +
      encodeURIComponent(state.activeSessionId) +
      "/events?cursor=0",
  );
  state.events = data.events || [];
  syncEventStream();
  if (showMsg) showToast(`已刷新 ${state.events.length} 条事件`, "info");
}

async function sendPrompt(): Promise<void> {
  state.promptDraft =
    (document.getElementById("rs-prompt") as HTMLTextAreaElement | null)?.value || "";
  if (!state.promptDraft.trim()) {
    showToast("请输入 Prompt 指令", "error");
    return;
  }

  // Auto-establish or connect session if not already connected
  if (!state.activeSessionId) {
    state.selectedPeerId =
      (document.getElementById("rs-peer") as HTMLSelectElement | null)?.value || state.selectedPeerId;
    state.selectedProjectId =
      (document.getElementById("rs-project") as HTMLSelectElement | null)?.value ||
      state.selectedProjectId;
    state.selectedConversationId =
      (document.getElementById("rs-conversation-select") as HTMLSelectElement | null)?.value ||
      state.selectedConversationId;
    state.customProjectPath =
      (document.getElementById("rs-custom-project-path") as HTMLInputElement | null)?.value?.trim() ||
      state.customProjectPath;

    if (!state.selectedPeerId) {
      showToast("请先选择目标对端主机", "error");
      return;
    }

    const targetProjectId = state.customProjectPath || state.selectedProjectId;
    if (!targetProjectId) {
      showToast("请选择工作区项目或输入远端工作区绝对路径", "error");
      return;
    }

    state.loading = true;
    state.error = "";
    render();
    try {
      const data = await api<{ session: any }>("/v1/remote-session/sessions", {
        method: "POST",
        body: JSON.stringify({
          peerId: state.selectedPeerId,
          projectId: targetProjectId,
          conversationId: state.selectedConversationId || undefined,
          controllerPeerId: state.controllerPeerId,
          model: state.selectedModel || undefined,
        }),
      });
      state.activeSessionId = data.session?.id || "";
    } catch (error: any) {
      state.error = error?.message || String(error);
      showToast("建立会话失败: " + state.error, "error");
      state.loading = false;
      render();
      return;
    }
  }

  state.loading = true;
  state.error = "";
  render();
  try {
    await api(
      "/v1/remote-session/sessions/" + encodeURIComponent(state.activeSessionId) + "/prompt",
      {
        method: "POST",
        body: JSON.stringify({
          prompt: state.promptDraft,
          controllerPeerId: state.controllerPeerId,
          model: state.selectedModel || undefined,
        }),
      },
    );
    state.promptDraft = "";
    showToast("Prompt 已下发至远端", "success");
    await reload();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    state.loading = false;
    render();
  }
}

async function decide(decision: "allow" | "deny"): Promise<void> {
  if (!state.activeSessionId) {
    showToast("请先打开会话", "error");
    return;
  }
  const approvalId = latestApprovalId();
  if (!approvalId) {
    showToast("当前没有待处理审批", "info");
    return;
  }
  state.loading = true;
  state.error = "";
  render();
  try {
    await api(
      "/v1/remote-session/sessions/" +
        encodeURIComponent(state.activeSessionId) +
        "/approvals/" +
        encodeURIComponent(approvalId),
      {
        method: "POST",
        body: JSON.stringify({
          decision,
          controllerPeerId: state.controllerPeerId,
        }),
      },
    );
    showToast(decision === "allow" ? "已批准执行" : "已拒绝执行", "success");
    await reload();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    state.loading = false;
    render();
  }
}

async function resumeSession(): Promise<void> {
  if (!state.activeSessionId) return;
  state.loading = true;
  state.error = "";
  render();
  try {
    const cursor = state.events.length ? Number(state.events[0].seq || 0) : 0;
    await api(
      "/v1/remote-session/sessions/" + encodeURIComponent(state.activeSessionId) + "/resume",
      {
        method: "POST",
        body: JSON.stringify({
          controllerPeerId: state.controllerPeerId,
          cursor,
        }),
      },
    );
    showToast("会话已恢复", "success");
    await reload();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    state.loading = false;
    render();
  }
}

async function endSession(): Promise<void> {
  if (!state.activeSessionId) return;
  state.loading = true;
  state.error = "";
  render();
  try {
    await api(
      "/v1/remote-session/sessions/" + encodeURIComponent(state.activeSessionId) + "/end",
      {
        method: "POST",
        body: JSON.stringify({ controllerPeerId: state.controllerPeerId }),
      },
    );
    showToast("会话已结束", "success");
    state.activeSessionId = "";
    closeEventStream();
    state.events = [];
    await reload();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    state.loading = false;
    render();
  }
}


function renderConversationModal(): string {
  if (!state.chatModalOpen) return "";
  const conv = state.chatData?.conversation || state.chatData;
  const messages = conv?.messages || [];
  const title = conv?.title || state.selectedConversationId || "会话详情";
  const sessionId = state.selectedConversationId || "";

  let contentHtml = "";
  if (state.chatLoading) {
    contentHtml = `<div class="session-kanban-empty">正在拉取远端会话完整记录与对话上下文...</div>`;
  } else if (!messages || messages.length === 0) {
    contentHtml = `<div class="session-kanban-empty">该会话暂无历史消息记录</div>`;
  } else {
    contentHtml = messages.map((m: any, idx: number) => {
      const isUser = m.role === "user";
      
      const toolsHtml = m.tools && m.tools.length > 0 ? `
        <details class="session-kanban-tools-details">
          <summary class="session-kanban-tools-summary">
            <span>🛠️ 调用了 <strong>${m.tools.length}</strong> 个工具 (${escapeHtml([...new Set(m.tools.map((t: any) => t.name))].slice(0, 3).join(", "))}${m.tools.length > 3 ? "..." : ""})</span>
          </summary>
          <div class="session-kanban-tools-content">
            ${m.tools.map((tool: any) => `
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
            <time>${m.timestamp ? escapeHtml(m.timestamp) : ""}</time>
          </div>
          ${toolsHtml}
          ${m.content ? `<div class="session-kanban-msg-content">${escapeHtml(m.content)}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  return `
    <div class="session-kanban-drawer-backdrop" onclick="window.__rsCloseConversationModal()">
      <div class="session-kanban-drawer" onclick="event.stopPropagation()">
        <div class="session-kanban-drawer-header">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="session-kanban-client">远端会话</span>
              <h3>${escapeHtml(title)}</h3>
            </div>
            <code class="session-kanban-id" title="复制对话内容" ondblclick="window.__rsCopyConversationContent()">${escapeHtml(sessionId)}</code>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="btn btn-xs" type="button" onclick="window.__rsCopyConversationContent()">📋 复制内容</button>
            <button class="session-kanban-modal-close" type="button" onclick="window.__rsCloseConversationModal()">×</button>
          </div>
        </div>
        <div class="session-kanban-drawer-body">
          ${contentHtml}
        </div>
      </div>
    </div>
  `;
}

async function openConversationModal(): Promise<void> {
  if (!state.selectedConversationId || !state.selectedPeerId) {
    showToast("请先选择具体的项目会话", "info");
    return;
  }
  state.chatModalOpen = true;
  state.chatLoading = true;
  state.chatData = null;
  render();
  try {
    const data = await api<{ ok: boolean; conversation: any }>("/v1/remote-session/conversations/" + encodeURIComponent(state.selectedConversationId) + "?peerId=" + encodeURIComponent(state.selectedPeerId));
    state.chatData = data.conversation || data;
  } catch (err: any) {
    showToast("获取会话内容失败: " + err.message, "error");
  } finally {
    state.chatLoading = false;
    render();
  }
}

function copyConversationContent(): void {
  const conv = state.chatData?.conversation || state.chatData;
  const messages = conv?.messages || [];
  if (!messages.length) {
    showToast("当前没有可复制的对话内容", "info");
    return;
  }
  const text = messages.map((m: any) => {
    const role = m.role === "user" ? "### User:" : "### Assistant:";
    return `${role}\n${m.content || ""}\n`;
  }).join("\n\n");

  navigator.clipboard.writeText(text).then(
    () => showToast("完整对话内容已复制到剪贴板", "success"),
    () => showToast("复制失败", "error")
  );
}

// Window Globals for UI actions
(window as any).__rsReload = () => { void reload(); };
(window as any).__rsOpenScene = (scene: "antigravity" | "official-links") => {
  state.view = scene;
  render();
};
(window as any).__rsBackToCatalog = () => {
  state.view = "catalog";
  render();
};
(window as any).__rsLoadOfficialLinks = () => { void loadOfficialLinks(); };
(window as any).__rsSelectOfficialLink = (linkId: string) => { void selectOfficialLink(linkId); };
(window as any).__rsEditOfficialLink = (linkId = "") => { editOfficialLink(linkId); };
(window as any).__rsCloseOfficialLinkModal = () => { closeOfficialLinkModal(); };
(window as any).__rsSaveOfficialLink = () => { void saveOfficialLink(); };
(window as any).__rsDeleteOfficialLink = (linkId: string) => { void deleteOfficialLink(linkId); };
(window as any).__rsOpenOfficialLink = (linkId: string) => { openOfficialLink(linkId); };
(window as any).__rsCheckOfficialFrame = () => { void checkOfficialFrame(); };
(window as any).__rsOpenPeersDrawer = () => {
  state.showPeersDrawer = true;
  render();
};
(window as any).__rsClosePeersDrawer = () => {
  state.showPeersDrawer = false;
  render();
};
(window as any).__rsLoadProjects = () => { void loadProjects(); };
(window as any).__rsOpenSession = () => { void openSession(); };
(window as any).__rsSendPrompt = () => { void sendPrompt(); };
(window as any).__rsApprove = () => { void decide("allow"); };
(window as any).__rsDeny = () => { void decide("deny"); };
(window as any).__rsRefreshEvents = () => {
  void refreshEvents(true).then(render).catch((error) => {
    showToast(error?.message || String(error), "error");
  });
};
(window as any).__rsResume = () => { void resumeSession(); };
(window as any).__rsEnd = () => { void endSession(); };
(window as any).__rsSelectPeer = (value: string) => {
  state.selectedPeerId = value;
  state.selectedProjectId = "";
  state.selectedConversationId = "";
  state.selectedModel = "";
  void loadProjects();
};
(window as any).__rsSelectProject = (value: string) => {
  state.selectedProjectId = value;
  state.customProjectPath = value;
  state.selectedConversationId = "";
  render();
};
(window as any).__rsOpenConversationModal = () => { void openConversationModal(); };
(window as any).__rsCloseConversationModal = () => { state.chatModalOpen = false; render(); };
(window as any).__rsCopyConversationContent = () => { copyConversationContent(); };
(window as any).__rsSelectConversation = (value: string) => {
  state.selectedConversationId = value;
  if (value) {
    // Automatically attach to this conversation and load history
    void openSession();
  } else {
    state.activeSessionId = "";
    closeEventStream();
    state.events = [];
    render();
  }
};
(window as any).__rsChangeCustomPath = (value: string) => {
  state.customProjectPath = value;
};
(window as any).__rsSelectModel = (value: string) => {
  state.selectedModel = value;
};
(window as any).__rsFetchFrpProxies = () => { void fetchFrpProxies(); };

(window as any).__rsOpenAddPeerModal = () => {
  const available = state.frpProxies.filter((px) => !state.localFrpcProxyNames.has(px.name));
  const hasFrp = available.length > 0;
  const firstFrp = available[0];
  state.editingPeer = {
    id: `peer_${Date.now()}`,
    name: hasFrp ? firstFrp.name : "",
    displayName: hasFrp ? firstFrp.name : "",
    transport: hasFrp ? {
      type: "frp",
      frpProxyName: firstFrp.name,
      host: state.frpServerHost || "39.105.19.237",
      port: firstFrp.remotePort,
    } : {
      type: "direct",
      frpProxyName: "",
      host: "",
      port: "",
    },
    auth: { type: "ssh", ssh: { username: "", authType: "password", password: "" } },
  };
  state.showPasswordPlain = false;
  state.showPeerModal = true;
  render();
};

(window as any).__rsEditPeer = (peerId: string) => {
  const p = state.peers.find((item) => item.id === peerId);
  if (!p || p.id === "local-host") return;
  state.editingPeer = JSON.parse(JSON.stringify(p));
  state.showPasswordPlain = false;
  state.showPeerModal = true;
  render();
};

(window as any).__rsDeletePeer = async (peerId: string) => {
  const p = state.peers.find((item) => item.id === peerId);
  if (!p || p.id === "local-host") return;
  if (!confirm(`确定要删除节点 "${p.displayName || p.name || p.id}" 吗？`)) return;
  try {
    await api(`/v1/remote-session/peers/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    showToast("节点已删除", "success");
    const remotes = remotePeers().filter((item) => item.id !== peerId);
    state.selectedPeerId = remotes[0]?.id || "";
    await reload();
  } catch (err: any) {
    showToast("删除失败: " + err.message, "error");
  }
};

(window as any).__rsClosePeerModal = () => {
  state.showPeerModal = false;
  state.editingPeer = null;
  render();
};

(window as any).__rsTogglePasswordPlain = () => {
  state.showPasswordPlain = !state.showPasswordPlain;
  render();
};

(window as any).__rsModalTransportChange = (val: "direct" | "frp" | "custom") => {
  if (!state.editingPeer) return;
  state.editingPeer.transport = state.editingPeer.transport || { type: val };
  state.editingPeer.transport.type = val;
  if (val === "frp") {
    const available = state.frpProxies.filter((px) => !state.localFrpcProxyNames.has(px.name));
    if (available.length > 0 && !state.editingPeer.transport.frpProxyName) {
      (window as any).__rsModalSelectFrpProxy(available[0].name);
      return;
    }
  }
  render();
};

(window as any).__rsModalAuthChange = (val: "ssh" | "gateway_token" | "none") => {
  if (!state.editingPeer) return;
  state.editingPeer.auth = state.editingPeer.auth || { type: val };
  state.editingPeer.auth.type = val;
  render();
};

(window as any).__rsModalSelectFrpProxy = (proxyName: string) => {
  if (!state.editingPeer) return;
  const px = state.frpProxies.find((p) => p.name === proxyName);
  state.editingPeer.transport = state.editingPeer.transport || { type: "frp" };
  state.editingPeer.transport.frpProxyName = proxyName;
  if (px) {
    state.editingPeer.transport.port = px.remotePort;
    state.editingPeer.transport.host = state.frpServerHost || "39.105.19.237";
    if (!state.editingPeer.name || state.editingPeer.name.startsWith("peer_")) {
      state.editingPeer.name = px.name;
      state.editingPeer.displayName = px.name;
    }
  }
  render();
};

(window as any).__rsSavePeerModal = async () => {
  const name = (document.getElementById("modal-peer-name") as HTMLInputElement | null)?.value?.trim();
  const transportType = (document.getElementById("modal-peer-transport-type") as HTMLSelectElement | null)?.value as any || "direct";
  const frpProxyName = (document.getElementById("modal-peer-frp-proxy") as HTMLSelectElement | null)?.value || "";
  const host = (document.getElementById("modal-peer-host") as HTMLInputElement | null)?.value?.trim() || "";
  const portRaw = (document.getElementById("modal-peer-port") as HTMLInputElement | null)?.value?.trim() || "";
  const port = portRaw ? Number(portRaw) : "";

  const authType = (document.getElementById("modal-peer-auth-type") as HTMLSelectElement | null)?.value as any || "ssh";
  const sshUser = (document.getElementById("modal-peer-ssh-user") as HTMLInputElement | null)?.value?.trim() || "";
  const sshPwdInput = (document.getElementById("modal-peer-ssh-pwd") as HTMLInputElement | null)?.value;
  const token = (document.getElementById("modal-peer-token") as HTMLInputElement | null)?.value || "";

  if (!name) {
    showToast("请输入节点名称", "error");
    return;
  }

  const existingPwd = state.editingPeer?.auth?.ssh?.password || "";
  const finalPwd = sshPwdInput !== undefined && sshPwdInput !== "" ? sshPwdInput : existingPwd;

  const payload: Peer = {
    id: state.editingPeer?.id || `peer_${Date.now()}`,
    name,
    displayName: name,
    transport: {
      type: transportType,
      frpProxyName: transportType === "frp" ? frpProxyName : "",
      host,
      port: port || undefined,
    },
    auth: {
      type: authType,
      ssh: authType === "ssh" ? { username: sshUser, password: finalPwd } : undefined,
      gatewayToken: authType === "gateway_token" ? token : undefined,
    },
  };

  try {
    await api("/v1/remote-session/config", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    }).catch(() => {});
    await api("/v1/remote-session/peers", {
      method: "PUT",
      body: JSON.stringify({ peer: payload }),
    });
    showToast("对端节点保存成功", "success");
    state.showPeerModal = false;
    state.editingPeer = null;
    state.selectedPeerId = payload.id;
    await reload();
  } catch (err: any) {
    showToast("保存节点失败: " + err.message, "error");
  }
};

registerTab("remote-session", {
  onEnter: () => {
    void Promise.all([reload(), loadOfficialLinks()]);
  },
  onLeave: () => {
    closeEventStream();
  },
});
