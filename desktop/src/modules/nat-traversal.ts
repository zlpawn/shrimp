import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type NatConfig = {
  enabled?: boolean;
  activeProvider?: string;
  frpc?: {
    binPath?: string;
    serverAddr?: string;
    serverPort?: number;
    logLevel?: string;
    proxies?: Array<{
      name?: string;
      type?: string;
      localIp?: string;
      localPort?: number;
      remotePort?: number;
    }>;
  };
  frpsDashboard?: { enabled?: boolean; url?: string };
  peers?: Array<{
    id?: string;
    displayName?: string;
    ssh?: { host?: string; port?: number; user?: string; identityFile?: string };
    services?: { gatewayApi?: string };
  }>;
  secrets?: {
    frpcTokenConfigured?: boolean;
    dashboardAuthConfigured?: boolean;
  };
};

type NatStatus = {
  enabled?: boolean;
  activeProvider?: string;
  provider?: {
    status?: string;
    pid?: number;
    lastError?: string;
    recentLogs?: string[];
    binPath?: string;
  };
  dashboard?: {
    enabled?: boolean;
    configured?: boolean;
    reachable?: boolean;
    statusCode?: number;
    message?: string;
    url?: string;
  };
};

const state: {
  view: "catalog" | "frpc";
  loading: boolean;
  error: string;
  config: NatConfig | null;
  status: NatStatus | null;
  tokenDraft: string;
  dashUserDraft: string;
  dashPassDraft: string;
  peerDraft: {
    id: string;
    displayName: string;
    host: string;
    port: string;
    user: string;
    gatewayApi: string;
  };
} = {
  view: "catalog",
  loading: false,
  error: "",
  config: null,
  status: null,
  tokenDraft: "",
  dashUserDraft: "",
  dashPassDraft: "",
  peerDraft: {
    id: "",
    displayName: "",
    host: "",
    port: "22",
    user: "",
    gatewayApi: "",
  },
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}`);
  }
  return data as T;
}

function rootEl(): HTMLElement | null {
  return document.getElementById("nat-traversal-root");
}

function formatPeerSsh(peer: { ssh?: { user?: string; host?: string; port?: number } }): string {
  const host = peer.ssh?.host || "";
  const user = peer.ssh?.user || "";
  const port = peer.ssh?.port;
  if (!host && !user) return "";
  const auth = user ? `${user}@${host}` : host;
  return port ? `${auth}:${port}` : auth;
}

function statusMeta(status?: string): { text: string; badge: string } {
  const s = status || "stopped";
  if (s === "running") return { text: "运行中", badge: "badge badge-default" };
  if (s === "starting") return { text: "启动中", badge: "badge" };
  if (s === "error") return { text: "异常", badge: "badge badge-key-missing" };
  return { text: "已停止", badge: "badge" };
}

function renderDashboardEmbed(cfg: NatConfig, st: NatStatus): string {
  if (!cfg.frpsDashboard?.enabled) {
    return `<p class="nt-help">Dashboard 展示已关闭。</p>`;
  }
  if (!cfg.secrets?.dashboardAuthConfigured) {
    return `<p class="nt-help">请先填写并保存 Dashboard 用户名/密码，再嵌入预览。也可先用按钮在新标签打开。</p>`;
  }
  if (st.dashboard && st.dashboard.reachable === false) {
    return `<p class="nt-help nt-help-warn">Dashboard 当前不可达：${escapeHtml(st.dashboard.message || "unknown error")}</p>`;
  }
  if (st.dashboard?.statusCode === 401) {
    return `<p class="nt-help nt-help-warn">Dashboard 鉴权失败（401）。请检查用户名/密码后重新保存。</p>`;
  }
  return `<div class="nt-frame-wrap"><iframe class="nt-frame" src="/v1/nat-traversal/frps-dashboard/" title="frps dashboard"></iframe></div>`;
}

function renderCatalog(): string {
  const cfg = state.config || {};
  const st = statusMeta(state.status?.provider?.status);
  const server = cfg.frpc?.serverAddr || "未配置 serverAddr";
  const proxyCount = cfg.frpc?.proxies?.length || 0;
  const enabled = Boolean(cfg.enabled);
  const dashReady = Boolean(cfg.secrets?.dashboardAuthConfigured);

  return `
    <div class="nt-page">
      ${state.error ? `<div class="nt-alert">${escapeHtml(state.error)} <button class="btn" onclick="window.__ntReload()">重试</button></div>` : ""}

      <div class="endpoints-grid">
        <div class="node-card" role="button" tabindex="0"
             onclick="window.__ntOpenProvider('frpc')"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.__ntOpenProvider('frpc');}">
          <div class="node-card-top">
            <div class="node-card-title-row">
              <div class="node-card-title">frp</div>
            </div>
            <div class="node-card-actions" onclick="event.stopPropagation()">
              <span class="${st.badge}">${escapeHtml(st.text)}</span>
            </div>
          </div>
          <div class="node-card-meta">
            <div class="node-card-row">
              <span class="badge">frpc / frps</span>
              <span class="badge ${enabled ? "badge-default" : ""}">${enabled ? "已启用" : "未启用"}</span>
              <span class="badge">${proxyCount} 条映射</span>
              <span class="badge">${dashReady ? "Dashboard 已鉴权" : "Dashboard 待配置"}</span>
            </div>
            <div class="node-card-row">
              <span class="mono" title="${escapeHtml(server)}">${escapeHtml(server)}</span>
            </div>
            <div class="node-card-models">
              <span class="tag">TCP 映射</span>
              <span class="tag">进程启停</span>
              <span class="tag">Dashboard</span>
            </div>
          </div>
          <div class="node-card-footer">
            <span>通过 frpc 连接远端 frps，管理本地端口映射</span>
            <span class="node-card-cta">进入管理 →</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFrpcDetail(): string {
  const cfg = state.config || {};
  const st = state.status || {};
  const status = statusMeta(st.provider?.status);
  const proxies = cfg.frpc?.proxies || [];
  const peers = cfg.peers || [];
  const logs = st.provider?.recentLogs || [];

  return `
    <div class="nt-page">
      <div class="section-header nt-subhead">
        <div>
          <h2>frp 管理</h2>
          <p>配置 frpc 连接、本地映射、对端 Peer，并查看 frps Dashboard。</p>
        </div>
        <div class="section-header-actions">
          <span class="${status.badge}">${escapeHtml(status.text)}</span>
          <button class="btn" onclick="window.__ntBackCatalog()">返回列表</button>
          <button class="btn" onclick="window.__ntReload()">刷新</button>
          <button class="btn btn-primary" onclick="window.__ntSave()">保存配置</button>
        </div>
      </div>

      ${state.error ? `<div class="nt-alert">${escapeHtml(state.error)}</div>` : ""}
      ${st.provider?.lastError ? `<div class="nt-alert">${escapeHtml(st.provider.lastError)}</div>` : ""}

      <div class="usage-guide nt-block">
        <div class="nt-block-head">
          <h3>运行控制</h3>
          <div class="nt-inline-actions">
            <button class="btn" onclick="window.__ntStart()">启动</button>
            <button class="btn" onclick="window.__ntStop()">停止</button>
            <button class="btn" onclick="window.__ntRestart()">重启</button>
          </div>
        </div>
        <label class="nt-check-row">
          <input type="checkbox" id="nt-enabled" ${cfg.enabled ? "checked" : ""} />
          <span>启用 NAT Traversal</span>
        </label>
        <div class="node-card-row" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
          <span class="badge">PID ${escapeHtml(String(st.provider?.pid || 0))}</span>
          <span class="badge">Token ${cfg.secrets?.frpcTokenConfigured ? "已配置" : "未配置"}</span>
          <span class="badge">Dashboard Auth ${cfg.secrets?.dashboardAuthConfigured ? "已配置" : "未配置"}</span>
          <span class="badge mono">${escapeHtml(st.provider?.binPath || cfg.frpc?.binPath || "自动发现 frpc")}</span>
        </div>
      </div>

      <div class="usage-guide nt-block">
        <h3>frpc 连接</h3>
        <div class="nt-form-grid">
          <label class="form-group"><span>serverAddr</span><input id="nt-server-addr" value="${escapeHtml(cfg.frpc?.serverAddr || "")}" /></label>
          <label class="form-group"><span>serverPort</span><input id="nt-server-port" type="number" value="${escapeHtml(String(cfg.frpc?.serverPort ?? 7000))}" /></label>
          <label class="form-group"><span>binPath</span><input id="nt-bin-path" placeholder="空则自动发现" value="${escapeHtml(cfg.frpc?.binPath || "")}" /></label>
          <label class="form-group"><span>logLevel</span><input id="nt-log-level" value="${escapeHtml(cfg.frpc?.logLevel || "info")}" /></label>
          <label class="form-group nt-col-2"><span>frpc token（secrets）</span><input id="nt-token" type="password" placeholder="${cfg.secrets?.frpcTokenConfigured ? "已配置，留空保留" : "未配置"}" value="${escapeHtml(state.tokenDraft)}" /></label>
        </div>
      </div>

      <div class="usage-guide nt-block">
        <div class="nt-block-head">
          <h3>本地映射 Proxies</h3>
          <button class="btn" onclick="window.__ntAddProxy()">新增映射</button>
        </div>
        <div class="nt-table-wrap">
          <table class="nt-table">
            <thead>
              <tr><th>name</th><th>type</th><th>localIp</th><th>localPort</th><th>remotePort</th><th></th></tr>
            </thead>
            <tbody>
              ${
                proxies.length
                  ? proxies
                      .map(
                        (p, i) => `<tr>
                          <td><input data-proxy="${i}" data-k="name" value="${escapeHtml(p.name || "")}" /></td>
                          <td><input data-proxy="${i}" data-k="type" value="${escapeHtml(p.type || "tcp")}" /></td>
                          <td><input data-proxy="${i}" data-k="localIp" value="${escapeHtml(p.localIp || "127.0.0.1")}" /></td>
                          <td><input data-proxy="${i}" data-k="localPort" type="number" value="${escapeHtml(String(p.localPort || 0))}" /></td>
                          <td><input data-proxy="${i}" data-k="remotePort" type="number" value="${escapeHtml(String(p.remotePort || 0))}" /></td>
                          <td><button class="btn" onclick="window.__ntRemoveProxy(${i})">删除</button></td>
                        </tr>`,
                      )
                      .join("")
                  : `<tr><td colspan="6"><p class="nt-help">还没有映射。先加一条把本机网关端口暴露出去。</p></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="usage-guide nt-block">
        <h3>frps Dashboard</h3>
        <label class="nt-check-row">
          <input type="checkbox" id="nt-dash-enabled" ${cfg.frpsDashboard?.enabled ? "checked" : ""} />
          <span>在管理台展示 Dashboard</span>
        </label>
        <div class="nt-form-grid" style="margin-top:12px;">
          <label class="form-group nt-col-2"><span>Dashboard URL</span><input id="nt-dash-url" value="${escapeHtml(cfg.frpsDashboard?.url || "")}" /></label>
          <label class="form-group"><span>用户名（secrets）</span><input id="nt-dash-user" value="${escapeHtml(state.dashUserDraft)}" placeholder="${cfg.secrets?.dashboardAuthConfigured ? "已配置，留空保留" : ""}" /></label>
          <label class="form-group"><span>密码（secrets）</span><input id="nt-dash-pass" type="password" value="${escapeHtml(state.dashPassDraft)}" placeholder="${cfg.secrets?.dashboardAuthConfigured ? "已配置，留空保留" : ""}" /></label>
        </div>
        <div class="node-card-row" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
          <span class="badge">可达 ${st.dashboard?.reachable ? "yes" : "no"}</span>
          <span class="badge">HTTP ${escapeHtml(String(st.dashboard?.statusCode || "-"))}</span>
          <span class="badge">${escapeHtml(st.dashboard?.message || "无附加信息")}</span>
        </div>
        <div class="nt-inline-actions" style="margin-top:12px;">
          <a class="btn" href="/v1/nat-traversal/frps-dashboard/" target="_blank" rel="noreferrer">经网关反代打开</a>
          ${cfg.frpsDashboard?.url ? `<a class="btn" href="${escapeHtml(cfg.frpsDashboard.url)}" target="_blank" rel="noreferrer">打开原始地址</a>` : ""}
        </div>
        ${renderDashboardEmbed(cfg, st)}
      </div>

      <div class="usage-guide nt-block">
        <h3>对端 Peers</h3>
        <div class="nt-table-wrap">
          <table class="nt-table">
            <thead><tr><th>id</th><th>名称</th><th>ssh</th><th>gatewayApi</th><th></th></tr></thead>
            <tbody>
              ${
                peers.length
                  ? peers
                      .map(
                        (p) => `<tr>
                          <td><code>${escapeHtml(p.id || "")}</code></td>
                          <td>${escapeHtml(p.displayName || "")}</td>
                          <td>${escapeHtml(formatPeerSsh(p))}</td>
                          <td><code>${escapeHtml(p.services?.gatewayApi || "")}</code></td>
                          <td>
                            <button class="btn" onclick="window.__ntTestPeer('${escapeHtml(p.id || "")}')">测试</button>
                            <button class="btn" onclick="window.__ntDeletePeer('${escapeHtml(p.id || "")}')">删除</button>
                          </td>
                        </tr>`,
                      )
                      .join("")
                  : `<tr><td colspan="5"><p class="nt-help">暂无对端。可手动添加一台机器的 SSH / gatewayApi。</p></td></tr>`
              }
            </tbody>
          </table>
        </div>
        <div class="nt-form-grid" style="margin-top:12px;">
          <label class="form-group"><span>id</span><input id="nt-peer-id" value="${escapeHtml(state.peerDraft.id)}" /></label>
          <label class="form-group"><span>displayName</span><input id="nt-peer-name" value="${escapeHtml(state.peerDraft.displayName)}" /></label>
          <label class="form-group"><span>ssh host</span><input id="nt-peer-host" value="${escapeHtml(state.peerDraft.host)}" /></label>
          <label class="form-group"><span>ssh port</span><input id="nt-peer-port" value="${escapeHtml(state.peerDraft.port)}" /></label>
          <label class="form-group"><span>ssh user</span><input id="nt-peer-user" value="${escapeHtml(state.peerDraft.user)}" /></label>
          <label class="form-group"><span>gatewayApi</span><input id="nt-peer-gw" placeholder="127.0.0.1:18788 或 http://..." value="${escapeHtml(state.peerDraft.gatewayApi)}" /></label>
        </div>
        <div class="nt-inline-actions" style="margin-top:12px;">
          <button class="btn btn-primary" onclick="window.__ntUpsertPeer()">保存 Peer</button>
        </div>
      </div>

      <div class="usage-guide nt-block">
        <h3>最近日志</h3>
        <pre class="nt-log">${escapeHtml(logs.slice(-50).join("\n") || "暂无日志")}</pre>
      </div>
    </div>
  `;
}

function render(): void {
  const el = rootEl();
  if (!el) return;
  if (state.loading && !state.config) {
    el.innerHTML = `<div class="nt-page"><p class="nt-help">正在加载…</p></div>`;
    return;
  }
  if (state.error && !state.config) {
    el.innerHTML = `<div class="nt-page"><div class="nt-alert">${escapeHtml(state.error)} <button class="btn" onclick="window.__ntReload()">重试</button></div></div>`;
    return;
  }
  el.innerHTML = state.view === "catalog" ? renderCatalog() : renderFrpcDetail();
}

function collectConfigFromDom(): { config: NatConfig; secrets: any } {
  const enabled = (document.getElementById("nt-enabled") as HTMLInputElement | null)?.checked;
  const serverAddr = (document.getElementById("nt-server-addr") as HTMLInputElement | null)?.value || "";
  const serverPort = Number((document.getElementById("nt-server-port") as HTMLInputElement | null)?.value || 7000);
  const binPath = (document.getElementById("nt-bin-path") as HTMLInputElement | null)?.value || "";
  const logLevel = (document.getElementById("nt-log-level") as HTMLInputElement | null)?.value || "info";
  const token = (document.getElementById("nt-token") as HTMLInputElement | null)?.value || "";
  const dashEnabled = (document.getElementById("nt-dash-enabled") as HTMLInputElement | null)?.checked;
  const dashUrl = (document.getElementById("nt-dash-url") as HTMLInputElement | null)?.value || "";
  const dashUser = (document.getElementById("nt-dash-user") as HTMLInputElement | null)?.value || "";
  const dashPass = (document.getElementById("nt-dash-pass") as HTMLInputElement | null)?.value || "";

  const proxyInputs = [...document.querySelectorAll("[data-proxy]")] as HTMLInputElement[];
  const proxyMap = new Map<number, any>();
  for (const input of proxyInputs) {
    const idx = Number(input.dataset.proxy);
    const key = input.dataset.k || "";
    const row = proxyMap.get(idx) || {};
    row[key] = key.endsWith("Port") ? Number(input.value || 0) : input.value;
    proxyMap.set(idx, row);
  }
  const proxies = [...proxyMap.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);

  state.tokenDraft = token;
  state.dashUserDraft = dashUser;
  state.dashPassDraft = dashPass;

  const secrets: any = {};
  if (token) secrets.frpc = { token };
  if (dashUser || dashPass) {
    secrets.frpsDashboard = {};
    if (dashUser) secrets.frpsDashboard.username = dashUser;
    if (dashPass) secrets.frpsDashboard.password = dashPass;
  }

  return {
    config: {
      enabled: Boolean(enabled),
      activeProvider: "frpc",
      frpc: { binPath, serverAddr, serverPort, logLevel, proxies },
      frpsDashboard: { enabled: Boolean(dashEnabled), url: dashUrl },
      peers: state.config?.peers || [],
    },
    secrets,
  };
}

async function reload(): Promise<void> {
  state.loading = true;
  state.error = "";
  render();
  try {
    const [config, status] = await Promise.all([
      api<NatConfig>("/v1/nat-traversal/config"),
      api<NatStatus>("/v1/nat-traversal/status"),
    ]);
    state.config = config;
    state.status = status;
  } catch (error: any) {
    state.error = error?.message || String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function save(): Promise<void> {
  try {
    const { config, secrets } = collectConfigFromDom();
    state.config = await api<NatConfig>("/v1/nat-traversal/config", {
      method: "PUT",
      body: JSON.stringify({ ...config, secrets }),
    });
    state.status = await api<NatStatus>("/v1/nat-traversal/status");
    state.tokenDraft = "";
    state.dashPassDraft = "";
    showToast("frp 配置已保存", "success");
    render();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    render();
  }
}

async function runAction(action: "start" | "stop" | "restart"): Promise<void> {
  try {
    await api(`/v1/nat-traversal/${action}`, { method: "POST", body: "{}" });
    state.status = await api<NatStatus>("/v1/nat-traversal/status");
    showToast(`已${action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}`, "success");
    render();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    render();
  }
}

function addProxy(): void {
  const collected = collectConfigFromDom();
  const proxies = [
    ...(collected.config.frpc?.proxies || []),
    {
      name: `proxy-${(collected.config.frpc?.proxies || []).length + 1}`,
      type: "tcp",
      localIp: "127.0.0.1",
      localPort: 8788,
      remotePort: 18788,
    },
  ];
  state.config = {
    ...(state.config || {}),
    ...collected.config,
    frpc: { ...(collected.config.frpc || {}), proxies },
    peers: state.config?.peers || [],
  };
  render();
}

function removeProxy(index: number): void {
  const collected = collectConfigFromDom();
  const proxies = [...(collected.config.frpc?.proxies || [])];
  proxies.splice(index, 1);
  state.config = {
    ...(state.config || {}),
    ...collected.config,
    frpc: { ...(collected.config.frpc || {}), proxies },
    peers: state.config?.peers || [],
  };
  render();
}

async function upsertPeer(): Promise<void> {
  const id = (document.getElementById("nt-peer-id") as HTMLInputElement | null)?.value?.trim();
  const displayName = (document.getElementById("nt-peer-name") as HTMLInputElement | null)?.value?.trim();
  const host = (document.getElementById("nt-peer-host") as HTMLInputElement | null)?.value?.trim();
  const port = Number((document.getElementById("nt-peer-port") as HTMLInputElement | null)?.value || 22);
  const user = (document.getElementById("nt-peer-user") as HTMLInputElement | null)?.value?.trim();
  const gatewayApi = (document.getElementById("nt-peer-gw") as HTMLInputElement | null)?.value?.trim();
  if (!id) {
    showToast("peer id 必填", "error");
    return;
  }
  try {
    await api("/v1/nat-traversal/peers", {
      method: "PUT",
      body: JSON.stringify({
        peer: {
          id,
          displayName: displayName || id,
          ssh: { host, port, user, identityFile: "" },
          services: { gatewayApi },
        },
      }),
    });
    state.peerDraft = { id: "", displayName: "", host: "", port: "22", user: "", gatewayApi: "" };
    await reload();
    showToast("Peer 已保存", "success");
  } catch (error: any) {
    showToast(error?.message || String(error), "error");
  }
}

async function deletePeer(id: string): Promise<void> {
  try {
    await api(`/v1/nat-traversal/peers/${encodeURIComponent(id)}`, { method: "DELETE" });
    await reload();
    showToast("Peer 已删除", "success");
  } catch (error: any) {
    showToast(error?.message || String(error), "error");
  }
}

async function testPeer(id: string): Promise<void> {
  try {
    const result = await api<any>("/v1/nat-traversal/test-link", {
      method: "POST",
      body: JSON.stringify({ peerId: id }),
    });
    showToast(
      `测试 ${id}: ${result.status}${result.message ? " - " + result.message : ""}`,
      result.status === "online" ? "success" : "error",
    );
  } catch (error: any) {
    showToast(error?.message || String(error), "error");
  }
}

(window as any).__ntReload = () => { void reload(); };
(window as any).__ntSave = () => { void save(); };
(window as any).__ntStart = () => { void runAction("start"); };
(window as any).__ntStop = () => { void runAction("stop"); };
(window as any).__ntRestart = () => { void runAction("restart"); };
(window as any).__ntAddProxy = () => addProxy();
(window as any).__ntRemoveProxy = (i: number) => removeProxy(i);
(window as any).__ntUpsertPeer = () => { void upsertPeer(); };
(window as any).__ntDeletePeer = (id: string) => { void deletePeer(id); };
(window as any).__ntTestPeer = (id: string) => { void testPeer(id); };
(window as any).__ntOpenProvider = (id: string) => {
  if (id !== "frpc") {
    showToast("该穿透方式尚未接入", "info");
    return;
  }
  state.view = "frpc";
  render();
};
(window as any).__ntBackCatalog = () => {
  state.view = "catalog";
  render();
};

registerTab("nat-traversal", {
  onEnter: () => {
    state.view = "catalog";
    void reload();
  },
});
