import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type RemoteConfig = {
  enabled?: boolean;
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

type Project = { id: string; name?: string; path?: string };
type Peer = { id: string; displayName?: string };
type SessionEvent = {
  seq?: number;
  type?: string;
  summary?: string;
  approvalId?: string;
  turnId?: string;
  hostEvent?: any;
};

const state: {
  loading: boolean;
  error: string;
  config: RemoteConfig | null;
  status: RemoteStatus | null;
  peers: Peer[];
  projects: Project[];
  selectedPeerId: string;
  selectedProjectId: string;
  activeSessionId: string;
  events: SessionEvent[];
  promptDraft: string;
  controllerPeerId: string;
} = {
  loading: false,
  error: "",
  config: null,
  status: null,
  peers: [],
  projects: [],
  selectedPeerId: "local-host",
  selectedProjectId: "",
  activeSessionId: "",
  events: [],
  promptDraft: "",
  controllerPeerId: "controller-a",
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

function activeSession() {
  const sessions = state.status?.sessions || [];
  return sessions.find((item) => item.id === state.activeSessionId) || sessions[0] || null;
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

function renderEvents(): string {
  if (!state.events.length) {
    return `<div class="rs-empty">暂无事件。打开会话并发送 Prompt 后会显示在这里。</div>`;
  }
  return `
    <div class="rs-event-list">
      ${state.events
        .slice()
        .reverse()
        .map((event) => {
          const text =
            event.summary ||
            event.hostEvent?.text ||
            event.hostEvent?.summary ||
            event.type ||
            "event";
          return `
            <div class="rs-event-item">
              <div class="rs-event-meta">
                <span class="badge">#${escapeHtml(String(event.seq || "-"))}</span>
                <span class="badge">${escapeHtml(event.type || "event")}</span>
                ${event.approvalId ? `<span class="badge">approval ${escapeHtml(event.approvalId)}</span>` : ""}
              </div>
              <div class="rs-event-body">${escapeHtml(String(text))}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function render(): void {
  const el = rootEl();
  if (!el) return;
  const session = activeSession();
  const cfg = state.config || {};
  const st = state.status || {};
  const enabled = Boolean(cfg.enabled);
  const natEnabled = Boolean(st.natTraversalEnabled);

  el.innerHTML = `
    <div class="rs-page">
      <div class="card rs-block">
        <div class="rs-block-head">
          <div>
            <h3>远程会话控制</h3>
            <p class="rs-help">第一期控制面在网关面板。当前后端先用 fake host 跑通编码闭环；真实 Antigravity attach 确认后可切换。</p>
          </div>
          <div class="rs-inline-actions">
            <button class="btn" onclick="window.__rsReload()" ${state.loading ? "disabled" : ""}>刷新</button>
            <button class="btn btn-primary" onclick="window.__rsSave()" ${state.loading ? "disabled" : ""}>保存配置</button>
          </div>
        </div>
        ${state.error ? `<div class="rs-alert">${escapeHtml(state.error)}</div>` : ""}
        <div class="rs-form-grid">
          <label class="form-group">
            <span>启用 Remote Session</span>
            <select id="rs-enabled">
              <option value="true" ${enabled ? "selected" : ""}>开启</option>
              <option value="false" ${!enabled ? "selected" : ""}>关闭</option>
            </select>
          </label>
          <label class="form-group">
            <span>Controller Peer ID</span>
            <input id="rs-controller" value="${escapeHtml(state.controllerPeerId)}" />
          </label>
        </div>
        <div class="rs-inline-actions" style="margin-top:10px;">
          <span class="badge ${enabled ? "badge-default" : ""}">remoteSession: ${enabled ? "on" : "off"}</span>
          <span class="badge ${natEnabled ? "badge-default" : "badge-key-missing"}">natTraversal: ${natEnabled ? "on" : "off"}</span>
          ${!natEnabled ? `<span class="rs-help rs-help-warn">启用远程会话前，请先打开「内网穿透 (NAT Traversal)」。</span>` : ""}
        </div>
      </div>

      <div class="card rs-block">
        <div class="rs-block-head">
          <h3>选择 Host / 项目</h3>
          <div class="rs-inline-actions">
            <button class="btn" onclick="window.__rsLoadProjects()" ${state.loading ? "disabled" : ""}>加载项目</button>
            <button class="btn btn-primary" onclick="window.__rsOpenSession()" ${state.loading ? "disabled" : ""}>打开会话</button>
          </div>
        </div>
        <div class="rs-form-grid">
          <label class="form-group">
            <span>Peer</span>
            <select id="rs-peer" onchange="window.__rsSelectPeer(this.value)">
              ${(state.peers.length ? state.peers : [{ id: "local-host", displayName: "Local Host" }])
                .map(
                  (peer) =>
                    `<option value="${escapeHtml(peer.id)}" ${
                      state.selectedPeerId === peer.id ? "selected" : ""
                    }>${escapeHtml(peer.displayName || peer.id)}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label class="form-group">
            <span>Project</span>
            <select id="rs-project" onchange="window.__rsSelectProject(this.value)">
              <option value="">请选择项目</option>
              ${state.projects
                .map(
                  (project) =>
                    `<option value="${escapeHtml(project.id)}" ${
                      state.selectedProjectId === project.id ? "selected" : ""
                    }>${escapeHtml(project.name || project.id)}${
                      project.path ? " (" + escapeHtml(project.path) + ")" : ""
                    }</option>`,
                )
                .join("")}
            </select>
          </label>
        </div>
      </div>

      <div class="card rs-block">
        <div class="rs-block-head">
          <h3>会话与审批</h3>
          <div class="rs-inline-actions">
            <button class="btn" onclick="window.__rsRefreshEvents()" ${state.loading || !state.activeSessionId ? "disabled" : ""}>刷新事件</button>
            <button class="btn" onclick="window.__rsResume()" ${state.loading || !state.activeSessionId ? "disabled" : ""}>恢复会话</button>
            <button class="btn" onclick="window.__rsEnd()" ${state.loading || !state.activeSessionId ? "disabled" : ""}>结束会话</button>
          </div>
        </div>
        ${
          session
            ? `<div class="rs-inline-actions" style="margin-bottom:10px;">
                <span class="badge">session ${escapeHtml(session.id || "")}</span>
                <span class="${statusBadge(session.state)}">${escapeHtml(session.state || "unknown")}</span>
                <span class="badge">host ${escapeHtml(session.hostPeerId || "")}</span>
                <span class="badge">project ${escapeHtml(session.hostProjectId || "")}</span>
                <span class="badge">conversation ${escapeHtml(session.hostConversationId || "")}</span>
              </div>`
            : `<div class="rs-empty">还没有活动会话。</div>`
        }
        <div class="rs-form-grid">
          <label class="form-group rs-col-2">
            <span>Prompt</span>
            <textarea id="rs-prompt" rows="4" placeholder="让 Host 上的 agent 改文件 / 跑命令...">${escapeHtml(
              state.promptDraft,
            )}</textarea>
          </label>
        </div>
        <div class="rs-inline-actions" style="margin-top:10px;">
          <button class="btn btn-primary" onclick="window.__rsSendPrompt()" ${
            state.loading || !state.activeSessionId ? "disabled" : ""
          }>发送 Prompt</button>
          <button class="btn" onclick="window.__rsApprove()" ${
            state.loading || !state.activeSessionId ? "disabled" : ""
          }>批准最近审批</button>
          <button class="btn" onclick="window.__rsDeny()" ${
            state.loading || !state.activeSessionId ? "disabled" : ""
          }>拒绝最近审批</button>
        </div>
      </div>

      <div class="card rs-block">
        <div class="rs-block-head">
          <h3>事件流</h3>
        </div>
        ${renderEvents()}
      </div>
    </div>
  `;
}

async function reload(): Promise<void> {
  state.loading = true;
  state.error = "";
  render();
  try {
    const [config, status, peers] = await Promise.all([
      api<RemoteConfig>("/v1/remote-session/config"),
      api<RemoteStatus>("/v1/remote-session/status"),
      api<{ peers: Peer[] }>("/v1/remote-session/peers").catch(() => ({ peers: [] })),
    ]);
    state.config = config;
    state.status = status;
    state.peers = peers.peers || [{ id: "local-host", displayName: "Local Host" }];
    if (!state.peers.some((peer) => peer.id === state.selectedPeerId)) {
      state.selectedPeerId = state.peers[0]?.id || "local-host";
    }
    if (!state.activeSessionId && status.sessions?.length) {
      state.activeSessionId = status.sessions[0].id || "";
    }
    if (state.activeSessionId) {
      await refreshEvents(false);
    }
  } catch (error: any) {
    state.error = error?.message || String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function save(): Promise<void> {
  const enabled = (document.getElementById("rs-enabled") as HTMLSelectElement | null)?.value === "true";
  state.controllerPeerId =
    (document.getElementById("rs-controller") as HTMLInputElement | null)?.value?.trim() ||
    state.controllerPeerId;
  state.loading = true;
  state.error = "";
  render();
  try {
    state.config = await api<RemoteConfig>("/v1/remote-session/config", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
    showToast("Remote Session 配置已保存", "success");
    await reload();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    state.loading = false;
    render();
  }
}

async function loadProjects(): Promise<void> {
  state.selectedPeerId =
    (document.getElementById("rs-peer") as HTMLSelectElement | null)?.value || state.selectedPeerId;
  state.loading = true;
  state.error = "";
  render();
  try {
    const data = await api<{ projects: Project[] }>(
      "/v1/remote-session/projects?peerId=" + encodeURIComponent(state.selectedPeerId),
    );
    state.projects = data.projects || [];
    if (!state.selectedProjectId && state.projects[0]?.id) {
      state.selectedProjectId = state.projects[0].id;
    }
    showToast(`已加载 ${state.projects.length} 个项目`, "success");
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
  state.controllerPeerId =
    (document.getElementById("rs-controller") as HTMLInputElement | null)?.value?.trim() ||
    state.controllerPeerId;
  if (!state.selectedProjectId) {
    showToast("请先选择项目", "error");
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
        projectId: state.selectedProjectId,
        controllerPeerId: state.controllerPeerId,
      }),
    });
    state.activeSessionId = data.session?.id || "";
    showToast("会话已打开: " + state.activeSessionId, "success");
    await reload();
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
  if (showMsg) showToast(`已刷新 ${state.events.length} 条事件`, "info");
}

async function sendPrompt(): Promise<void> {
  if (!state.activeSessionId) {
    showToast("请先打开会话", "error");
    return;
  }
  state.promptDraft =
    (document.getElementById("rs-prompt") as HTMLTextAreaElement | null)?.value || "";
  state.controllerPeerId =
    (document.getElementById("rs-controller") as HTMLInputElement | null)?.value?.trim() ||
    state.controllerPeerId;
  if (!state.promptDraft.trim()) {
    showToast("请输入 Prompt", "error");
    return;
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
        }),
      },
    );
    showToast("Prompt 已发送", "success");
    await reload();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    state.loading = false;
    render();
  }
}

function latestApprovalId(): string {
  const hit = [...state.events].reverse().find((event) => event.type === "approval_required");
  return (
    hit?.approvalId ||
    hit?.hostEvent?.approvalId ||
    ""
  );
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
  state.controllerPeerId =
    (document.getElementById("rs-controller") as HTMLInputElement | null)?.value?.trim() ||
    state.controllerPeerId;
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
    showToast(decision === "allow" ? "已批准" : "已拒绝", "success");
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
  state.controllerPeerId =
    (document.getElementById("rs-controller") as HTMLInputElement | null)?.value?.trim() ||
    state.controllerPeerId;
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
  state.controllerPeerId =
    (document.getElementById("rs-controller") as HTMLInputElement | null)?.value?.trim() ||
    state.controllerPeerId;
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
    state.events = [];
    await reload();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    state.loading = false;
    render();
  }
}

(window as any).__rsReload = () => {
  void reload();
};
(window as any).__rsSave = () => {
  void save();
};
(window as any).__rsLoadProjects = () => {
  void loadProjects();
};
(window as any).__rsOpenSession = () => {
  void openSession();
};
(window as any).__rsSendPrompt = () => {
  void sendPrompt();
};
(window as any).__rsApprove = () => {
  void decide("allow");
};
(window as any).__rsDeny = () => {
  void decide("deny");
};
(window as any).__rsRefreshEvents = () => {
  void refreshEvents(true).then(render).catch((error) => {
    showToast(error?.message || String(error), "error");
  });
};
(window as any).__rsResume = () => {
  void resumeSession();
};
(window as any).__rsEnd = () => {
  void endSession();
};
(window as any).__rsSelectPeer = (value: string) => {
  state.selectedPeerId = value;
};
(window as any).__rsSelectProject = (value: string) => {
  state.selectedProjectId = value;
};

registerTab("remote-session", {
  onEnter: () => {
    void reload();
  },
});
