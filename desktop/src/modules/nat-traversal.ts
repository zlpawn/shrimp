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

type ProviderCard = {
  id: string;
  name: string;
  subtitle: string;
  blurb: string;
  status: "available" | "planned";
  tags: string[];
};

const PROVIDER_CARDS: ProviderCard[] = [
  {
    id: "frpc",
    name: "frp",
    subtitle: "frpc / frps",
    blurb: "通过 frpc 连接远端 frps，管理本地映射、进程启停，并在网关内查看 frps Dashboard。",
    status: "available",
    tags: ["TCP 映射", "Dashboard", "启停管理"],
  },
];

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
    const message = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(message);
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

function statusLabel(status?: string): { text: string; tone: string } {
  const s = status || "stopped";
  if (s === "running") return { text: "运行中", tone: "ok" };
  if (s === "starting") return { text: "启动中", tone: "warn" };
  if (s === "error") return { text: "异常", tone: "err" };
  return { text: "已停止", tone: "muted" };
}

function renderDashboardEmbed(cfg: NatConfig, st: NatStatus): string {
  if (!cfg.frpsDashboard?.enabled) {
    return `<div class="nt-note">Dashboard 展示已关闭。开启后可在此预览 frps 控制台。</div>`;
  }
  if (!cfg.secrets?.dashboardAuthConfigured) {
    return `<div class="nt-note">请先填写并保存 Dashboard 用户名/密码，再嵌入预览。也可先用右侧按钮在新标签打开。</div>`;
  }
  if (st.dashboard && st.dashboard.reachable === false) {
    return `<div class="nt-note nt-note-warn">Dashboard 当前不可达：${escapeHtml(st.dashboard.message || "unknown error")}</div>`;
  }
  if (st.dashboard?.statusCode === 401) {
    return `<div class="nt-note nt-note-warn">Dashboard 鉴权失败（401）。请检查用户名/密码后重新保存。</div>`;
  }
  return `<div class="nt-frame-wrap"><iframe class="nt-frame" src="/v1/nat-traversal/frps-dashboard/" title="frps dashboard"></iframe></div>`;
}

function renderCatalog(): string {
  const st = statusLabel(state.status?.provider?.status);
  const enabled = Boolean(state.config?.enabled);
  const server = state.config?.frpc?.serverAddr || "未配置 serverAddr";
  const proxyCount = state.config?.frpc?.proxies?.length || 0;
  const dashReady = Boolean(state.config?.secrets?.dashboardAuthConfigured);

  return `
    <div class="nt-shell">
      <header class="nt-hero">
        <div>
          <div class="nt-kicker">系统扩展</div>
          <h3 class="nt-title">穿透软件</h3>
          <p class="nt-desc">当前先接入 frp。进入管理台后可配置映射、启停进程并查看 Dashboard。</p>
        </div>
        <div class="nt-hero-stats">
          <div class="nt-stat">
            <span class="nt-stat-label">总开关</span>
            <strong>${enabled ? "已启用" : "未启用"}</strong>
          </div>
          <div class="nt-stat">
            <span class="nt-stat-label">frp 状态</span>
            <strong class="nt-tone-${st.tone}">${escapeHtml(st.text)}</strong>
          </div>
          <div class="nt-stat">
            <span class="nt-stat-label">映射数</span>
            <strong>${proxyCount}</strong>
          </div>
        </div>
      </header>

      ${state.error ? `<div class="nt-banner nt-banner-err">${escapeHtml(state.error)}</div>` : ""}

      <div class="nt-catalog">
        ${PROVIDER_CARDS.map((card) => {
          const isFrp = card.id === "frpc";
          const available = card.status === "available";
          const meta = isFrp
            ? `${escapeHtml(server)} · Dashboard ${dashReady ? "已鉴权" : "待配置"}`
            : "统一 provider 接口预留位";
          return `
            <article class="nt-provider-card ${available ? "is-available" : "is-planned"}">
              <div class="nt-provider-top">
                <div class="nt-provider-mark" aria-hidden="true">${escapeHtml(card.name.slice(0, 1))}</div>
                <div class="nt-provider-heading">
                  <div class="nt-provider-name-row">
                    <h4>${escapeHtml(card.name)}</h4>
                    <span class="nt-chip ${available ? "nt-chip-ok" : "nt-chip-muted"}">${available ? "可用" : "规划中"}</span>
                  </div>
                  <div class="nt-provider-sub">${escapeHtml(card.subtitle)}</div>
                </div>
              </div>
              <p class="nt-provider-blurb">${escapeHtml(card.blurb)}</p>
              <div class="nt-provider-tags">
                ${card.tags.map((tag) => `<span class="nt-tag">${escapeHtml(tag)}</span>`).join("")}
              </div>
              <div class="nt-provider-foot">
                <span class="nt-provider-meta">${meta}</span>
                ${
                  available
                    ? `<button class="btn btn-primary" onclick="window.__ntOpenProvider('frpc')">进入管理</button>`
                    : `<button class="btn" disabled title="后续版本接入">即将支持</button>`
                }
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderFrpcDetail(): string {
  const cfg = state.config || {};
  const st = state.status || {};
  const status = statusLabel(st.provider?.status);
  const proxies = cfg.frpc?.proxies || [];
  const peers = cfg.peers || [];
  const logs = st.provider?.recentLogs || [];

  return `
    <div class="nt-shell">
      <div class="nt-detail-bar">
        <button class="btn nt-back" onclick="window.__ntBackCatalog()">← 返回列表</button>
        <div class="nt-detail-title">
          <div class="nt-kicker">Provider</div>
          <h3>frp 管理台</h3>
        </div>
        <span class="nt-chip nt-chip-${status.tone}">${escapeHtml(status.text)}</span>
      </div>

      ${state.error ? `<div class="nt-banner nt-banner-err">${escapeHtml(state.error)}</div>` : ""}
      ${st.provider?.lastError ? `<div class="nt-banner nt-banner-err">${escapeHtml(st.provider.lastError)}</div>` : ""}

      <div class="nt-detail-grid">
        <section class="nt-panel">
          <div class="nt-panel-head">
            <h4>运行控制</h4>
            <span class="nt-soft">PID ${escapeHtml(String(st.provider?.pid || 0))}</span>
          </div>
          <label class="nt-switch">
            <span>启用 NAT Traversal</span>
            <input type="checkbox" id="nt-enabled" ${cfg.enabled ? "checked" : ""} />
          </label>
          <div class="nt-kv">
            <div><span>二进制</span><code>${escapeHtml(st.provider?.binPath || cfg.frpc?.binPath || "自动发现")}</code></div>
            <div><span>Token</span><code>${cfg.secrets?.frpcTokenConfigured ? "已配置" : "未配置"}</code></div>
            <div><span>Dashboard Auth</span><code>${cfg.secrets?.dashboardAuthConfigured ? "已配置" : "未配置"}</code></div>
          </div>
          <div class="nt-actions">
            <button class="btn btn-primary" onclick="window.__ntSave()">保存配置</button>
            <button class="btn" onclick="window.__ntStart()">启动</button>
            <button class="btn" onclick="window.__ntStop()">停止</button>
            <button class="btn" onclick="window.__ntRestart()">重启</button>
            <button class="btn" onclick="window.__ntReload()">刷新</button>
          </div>
        </section>

        <section class="nt-panel">
          <div class="nt-panel-head"><h4>frpc 连接</h4></div>
          <div class="nt-form">
            <label><span>serverAddr</span><input id="nt-server-addr" value="${escapeHtml(cfg.frpc?.serverAddr || "")}" /></label>
            <label><span>serverPort</span><input id="nt-server-port" type="number" value="${escapeHtml(String(cfg.frpc?.serverPort ?? 7000))}" /></label>
            <label><span>binPath</span><input id="nt-bin-path" placeholder="空则自动发现" value="${escapeHtml(cfg.frpc?.binPath || "")}" /></label>
            <label><span>logLevel</span><input id="nt-log-level" value="${escapeHtml(cfg.frpc?.logLevel || "info")}" /></label>
            <label class="nt-span-2"><span>frpc token（secrets）</span><input id="nt-token" type="password" placeholder="${cfg.secrets?.frpcTokenConfigured ? "已配置，留空保留" : "未配置"}" value="${escapeHtml(state.tokenDraft)}" /></label>
          </div>
        </section>

        <section class="nt-panel nt-span-2">
          <div class="nt-panel-head">
            <h4>本地映射 Proxies</h4>
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
                    : `<tr><td colspan="6"><div class="nt-note">还没有映射。先加一条把本机网关端口暴露出去。</div></td></tr>`
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="nt-panel nt-span-2">
          <div class="nt-panel-head"><h4>frps Dashboard</h4></div>
          <label class="nt-switch">
            <span>在管理台展示 Dashboard</span>
            <input type="checkbox" id="nt-dash-enabled" ${cfg.frpsDashboard?.enabled ? "checked" : ""} />
          </label>
          <div class="nt-form">
            <label class="nt-span-2"><span>Dashboard URL</span><input id="nt-dash-url" value="${escapeHtml(cfg.frpsDashboard?.url || "")}" /></label>
            <label><span>用户名（secrets）</span><input id="nt-dash-user" value="${escapeHtml(state.dashUserDraft)}" placeholder="${cfg.secrets?.dashboardAuthConfigured ? "已配置，留空保留" : ""}" /></label>
            <label><span>密码（secrets）</span><input id="nt-dash-pass" type="password" value="${escapeHtml(state.dashPassDraft)}" placeholder="${cfg.secrets?.dashboardAuthConfigured ? "已配置，留空保留" : ""}" /></label>
          </div>
          <div class="nt-kv">
            <div><span>可达</span><code>${st.dashboard?.reachable ? "yes" : "no"}</code></div>
            <div><span>HTTP</span><code>${escapeHtml(String(st.dashboard?.statusCode || "-"))}</code></div>
            <div><span>说明</span><code>${escapeHtml(st.dashboard?.message || "-")}</code></div>
          </div>
          <div class="nt-actions">
            <a class="btn" href="/v1/nat-traversal/frps-dashboard/" target="_blank" rel="noreferrer">经网关反代打开</a>
            ${cfg.frpsDashboard?.url ? `<a class="btn" href="${escapeHtml(cfg.frpsDashboard.url)}" target="_blank" rel="noreferrer">打开原始地址</a>` : ""}
          </div>
          ${renderDashboardEmbed(cfg, st)}
        </section>

        <section class="nt-panel nt-span-2">
          <div class="nt-panel-head"><h4>对端 Peers</h4></div>
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
                            <td class="nt-row-actions">
                              <button class="btn" onclick="window.__ntTestPeer('${escapeHtml(p.id || "")}')">测试</button>
                              <button class="btn" onclick="window.__ntDeletePeer('${escapeHtml(p.id || "")}')">删除</button>
                            </td>
                          </tr>`,
                        )
                        .join("")
                    : `<tr><td colspan="5"><div class="nt-note">暂无对端。可手动添加一台机器的 SSH / gatewayApi。</div></td></tr>`
                }
              </tbody>
            </table>
          </div>
          <div class="nt-form">
            <label><span>id</span><input id="nt-peer-id" value="${escapeHtml(state.peerDraft.id)}" /></label>
            <label><span>displayName</span><input id="nt-peer-name" value="${escapeHtml(state.peerDraft.displayName)}" /></label>
            <label><span>ssh host</span><input id="nt-peer-host" value="${escapeHtml(state.peerDraft.host)}" /></label>
            <label><span>ssh port</span><input id="nt-peer-port" value="${escapeHtml(state.peerDraft.port)}" /></label>
            <label><span>ssh user</span><input id="nt-peer-user" value="${escapeHtml(state.peerDraft.user)}" /></label>
            <label><span>gatewayApi</span><input id="nt-peer-gw" placeholder="127.0.0.1:18788 或 http://..." value="${escapeHtml(state.peerDraft.gatewayApi)}" /></label>
          </div>
          <div class="nt-actions">
            <button class="btn btn-primary" onclick="window.__ntUpsertPeer()">保存 Peer</button>
          </div>
        </section>

        <section class="nt-panel nt-span-2">
          <div class="nt-panel-head"><h4>最近日志</h4></div>
          <pre class="nt-log">${escapeHtml(logs.slice(-50).join("\n") || "暂无日志")}</pre>
        </section>
      </div>
    </div>
  `;
}

function render(): void {
  const el = rootEl();
  if (!el) return;
  if (state.loading && !state.config) {
    el.innerHTML = `<div class="nt-shell"><div class="nt-loading">正在加载穿透能力…</div></div>`;
    return;
  }
  if (state.error && !state.config) {
    el.innerHTML = `
      <div class="nt-shell">
        <div class="nt-banner nt-banner-err">${escapeHtml(state.error)}</div>
        <button class="btn" onclick="window.__ntReload()">重试</button>
      </div>
    `;
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
  const proxies = [...proxyMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row);

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
      frpc: {
        binPath,
        serverAddr,
        serverPort,
        logLevel,
        proxies,
      },
      frpsDashboard: {
        enabled: Boolean(dashEnabled),
        url: dashUrl,
      },
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

(window as any).__ntReload = () => {
  void reload();
};
(window as any).__ntSave = () => {
  void save();
};
(window as any).__ntStart = () => {
  void runAction("start");
};
(window as any).__ntStop = () => {
  void runAction("stop");
};
(window as any).__ntRestart = () => {
  void runAction("restart");
};
(window as any).__ntAddProxy = () => addProxy();
(window as any).__ntRemoveProxy = (i: number) => removeProxy(i);
(window as any).__ntUpsertPeer = () => {
  void upsertPeer();
};
(window as any).__ntDeletePeer = (id: string) => {
  void deletePeer(id);
};
(window as any).__ntTestPeer = (id: string) => {
  void testPeer(id);
};
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
