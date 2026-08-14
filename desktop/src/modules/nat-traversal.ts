import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type NatConfig = {
  enabled?: boolean;
  activeProvider?: string;
  frpc?: {
    binPath?: string;
    configPath?: string;
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

type DiscoverItem = {
  path: string;
  mtimeMs: number;
  bytes: number;
  parsed: {
    serverAddr?: string;
    serverPort?: number;
    logLevel?: string;
    proxyCount?: number;
    hasToken?: boolean;
  };
};

const state: {
  view: "catalog" | "frpc";
  loading: boolean;
  error: string;
  config: NatConfig | null;
  status: NatStatus | null;
  discoveries: DiscoverItem[];
  selectedDiscoverPath: string;
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
  discoveries: [],
  selectedDiscoverPath: "",
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
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data as T;
}

function rootEl(): HTMLElement | null {
  return document.getElementById("nat-traversal-root");
}

function sectionHeaderEl(): HTMLElement | null {
  return document.querySelector("#section-nat-traversal > .section-header");
}

function setOuterHeaderVisible(visible: boolean): void {
  const header = sectionHeaderEl();
  if (!header) return;
  header.style.display = visible ? "" : "none";
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

function renderToggle(id: string, checked: boolean, label: string, hint = ""): string {
  return `
    <label class="nt-toggle" for="${id}">
      <span class="nt-toggle-copy">
        <span class="nt-toggle-label">${escapeHtml(label)}</span>
        ${hint ? `<span class="nt-toggle-hint">${escapeHtml(hint)}</span>` : ""}
      </span>
      <input id="${id}" type="checkbox" class="nt-toggle-input" ${checked ? "checked" : ""} />
      <span class="nt-toggle-track" aria-hidden="true"><span class="nt-toggle-thumb"></span></span>
    </label>
  `;
}

function renderDashboardEmbed(cfg: NatConfig, st: NatStatus): string {
  if (!cfg.frpsDashboard?.enabled) {
    return `<p class="nt-help">Dashboard 展示已关闭。打开上方开关后可在此预览。</p>`;
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
            <span>通过 frpc 连接远端 frps，管理本机端口映射</span>
            <span class="node-card-cta">进入管理 →</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDiscoverBox(): string {
  const items = state.discoveries || [];
  if (!items.length) {
    return `
      <div class="nt-discover">
        <div class="nt-block-head">
          <h3>本机 frpc 配置检测</h3>
          <button class="btn" onclick="window.__ntDiscover()">重新检测</button>
        </div>
        <p class="nt-help">未在常见目录找到 frpc.toml / frpc.ini。你也可以手动填写下方表单，或把配置放到 ~/frp/frpc.toml 后再检测。</p>
        <p class="nt-help">检测范围：~/frp、~/.frp、~/.config/frp、Homebrew etc、以及 frpc 二进制同目录。</p>
      </div>
    `;
  }

  const options = items
    .map((item) => {
      const selected = (state.selectedDiscoverPath || items[0].path) === item.path ? "selected" : "";
      const label = `${item.path}  ·  ${item.parsed.serverAddr || "无 serverAddr"}  ·  ${item.parsed.proxyCount || 0} proxies`;
      return `<option value="${escapeHtml(item.path)}" ${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  const active = items.find((x) => x.path === (state.selectedDiscoverPath || items[0].path)) || items[0];

  return `
    <div class="nt-discover">
      <div class="nt-block-head">
        <h3>本机 frpc 配置检测</h3>
        <div class="nt-inline-actions">
          <button class="btn" onclick="window.__ntDiscover()">重新检测</button>
          <button class="btn btn-primary" onclick="window.__ntImportSelected()">导入到表单</button>
        </div>
      </div>
      <p class="nt-help">检测到 ${items.length} 个候选配置。导入会填充 server/proxies，并尽量推断 Dashboard URL（默认端口 7500）。token 会写入 secrets。</p>
      <label class="form-group" style="display:grid;gap:6px;">
        <span style="font-size:12px;color:var(--text-secondary)">候选配置文件</span>
        <select id="nt-discover-path" onchange="window.__ntSelectDiscover(this.value)">${options}</select>
      </label>
      <div class="node-card-row" style="margin-top:10px;gap:8px;flex-wrap:wrap;">
        <span class="badge">server ${escapeHtml(active.parsed.serverAddr || "-")}:${escapeHtml(String(active.parsed.serverPort || "-"))}</span>
        <span class="badge">${escapeHtml(String(active.parsed.proxyCount || 0))} proxies</span>
        <span class="badge">token ${active.parsed.hasToken ? "有" : "无"}</span>
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
  const configPath = cfg.frpc?.configPath || "";

  return `
    <div class="nt-page">
      <div class="section-header nt-subhead">
        <div>
          <h2>frp 管理</h2>
          <p>从本机配置导入或手动编辑，管理 frpc 连接、端口映射与 Dashboard。</p>
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
        ${renderToggle("nt-enabled", Boolean(cfg.enabled), "启用 NAT Traversal / frpc", "关闭后不会自动拉起 frpc 进程")}
        <div class="node-card-row" style="margin-top:12px;gap:8px;flex-wrap:wrap;">
          <span class="badge">PID ${escapeHtml(String(st.provider?.pid || 0))}</span>
          <span class="badge">Token ${cfg.secrets?.frpcTokenConfigured ? "已配置" : "未配置"}</span>
          <span class="badge">Dashboard Auth ${cfg.secrets?.dashboardAuthConfigured ? "已配置" : "未配置"}</span>
          <span class="badge mono">${escapeHtml(st.provider?.binPath || cfg.frpc?.binPath || "自动发现 frpc")}</span>
          ${configPath ? `<span class="badge mono" title="${escapeHtml(configPath)}">配置源 ${escapeHtml(configPath)}</span>` : ""}
        </div>
      </div>

      <div class="usage-guide nt-block">
        ${renderDiscoverBox()}
      </div>

      <div class="usage-guide nt-block">
        <h3>frpc 连接</h3>
        <p class="nt-help">优先从上方检测结果导入。若本机没有配置文件，再手动填写 serverAddr / token。</p>
        <div class="nt-form-grid">
          <label class="form-group"><span>serverAddr</span><input id="nt-server-addr" value="${escapeHtml(cfg.frpc?.serverAddr || "")}" oninput="window.__ntMaybeInferDashboard()" /></label>
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
        <p class="nt-help">
          Proxies 定义“本机端口如何被 frps 暴露到公网/对端”。例如把本机 22 映射到远端 6007，对端就能通过 frps:6007 连到你的 SSH。
          导入本机 frpc 配置后会自动带入已有映射。
        </p>
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
                  : `<tr><td colspan="6"><p class="nt-help">还没有映射。可导入本机配置，或手动新增。</p></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="usage-guide nt-block">
        <h3>frps Dashboard</h3>
        ${renderToggle("nt-dash-enabled", Boolean(cfg.frpsDashboard?.enabled), "在管理台展示 Dashboard", "关闭后仅保留“新标签打开”，不嵌入预览")}
        <div class="nt-form-grid" style="margin-top:12px;">
          <label class="form-group nt-col-2">
            <span>Dashboard URL（默认可由 serverAddr + 7500 推断）</span>
            <input id="nt-dash-url" value="${escapeHtml(cfg.frpsDashboard?.url || "")}" placeholder="http://x.x.x.x:7500/static/#/" />
          </label>
          <label class="form-group"><span>用户名（secrets）</span><input id="nt-dash-user" value="${escapeHtml(state.dashUserDraft)}" placeholder="${cfg.secrets?.dashboardAuthConfigured ? "已配置，留空保留" : ""}" /></label>
          <label class="form-group"><span>密码（secrets）</span><input id="nt-dash-pass" type="password" value="${escapeHtml(state.dashPassDraft)}" placeholder="${cfg.secrets?.dashboardAuthConfigured ? "已配置，留空保留" : ""}" /></label>
        </div>
        <div class="node-card-row" style="margin-top:10px;gap:8px;flex-wrap:wrap;">
          <span class="badge">可达 ${st.dashboard?.reachable ? "yes" : "no"}</span>
          <span class="badge">HTTP ${escapeHtml(String(st.dashboard?.statusCode || "-"))}</span>
          <span class="badge">${escapeHtml(st.dashboard?.message || "无附加信息")}</span>
        </div>
        <div class="nt-inline-actions" style="margin-top:12px;">
          <button class="btn" onclick="window.__ntInferDashboard()">按 serverAddr 推断 URL</button>
          <a class="btn" href="/v1/nat-traversal/frps-dashboard/" target="_blank" rel="noreferrer">经网关反代打开</a>
          ${cfg.frpsDashboard?.url ? `<a class="btn" href="${escapeHtml(cfg.frpsDashboard.url)}" target="_blank" rel="noreferrer">打开原始地址</a>` : ""}
        </div>
        ${renderDashboardEmbed(cfg, st)}
      </div>

      <div class="usage-guide nt-block">
        <h3>对端 Peers</h3>
        <p class="nt-help">
          Peers 记录“你要连的另一台机器”。例如家里电脑作为 Host 时，公司电脑在这里保存它的 SSH 地址或 gatewayApi。
          第一期主要用于连通测试；后续 Remote Session 会从这里选择对端。
        </p>
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
                  : `<tr><td colspan="5"><p class="nt-help">暂无对端。Remote Session 前可以先不填。</p></td></tr>`
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
  setOuterHeaderVisible(state.view === "catalog");
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
      frpc: {
        binPath,
        configPath: state.config?.frpc?.configPath || "",
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

async function discover(autoSelect = true): Promise<void> {
  try {
    const data = await api<{ candidates: DiscoverItem[] }>("/v1/nat-traversal/discover-frpc");
    state.discoveries = data.candidates || [];
    if (autoSelect && state.discoveries.length && !state.selectedDiscoverPath) {
      state.selectedDiscoverPath = state.discoveries[0].path;
    }
  } catch (error: any) {
    state.error = error?.message || String(error);
  }
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
    if (state.view === "frpc") {
      await discover(true);
    }
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

function inferDashboardFromServerAddr(): void {
  const serverAddr = (document.getElementById("nt-server-addr") as HTMLInputElement | null)?.value?.trim()
    || state.config?.frpc?.serverAddr
    || "";
  if (!serverAddr) {
    showToast("请先填写 serverAddr", "error");
    return;
  }
  let host = serverAddr;
  try {
    if (serverAddr.includes("://")) host = new URL(serverAddr).hostname;
  } catch {
    // keep raw
  }
  const url = `http://${host}:7500/static/#/`;
  const input = document.getElementById("nt-dash-url") as HTMLInputElement | null;
  if (input) input.value = url;
  if (state.config) {
    state.config.frpsDashboard = {
      ...(state.config.frpsDashboard || {}),
      url,
    };
  }
  showToast("已按 serverAddr + 7500 推断 Dashboard URL", "success");
}

async function importSelected(): Promise<void> {
  const path = state.selectedDiscoverPath || state.discoveries[0]?.path;
  if (!path) {
    showToast("没有可导入的配置文件", "error");
    return;
  }
  try {
    const result = await api<any>("/v1/nat-traversal/import-frpc", {
      method: "POST",
      body: JSON.stringify({ path, setEnabled: true }),
    });
    state.config = result.config;
    state.status = await api<NatStatus>("/v1/nat-traversal/status");
    state.tokenDraft = "";
    showToast(`已导入 ${path}`, "success");
    render();
  } catch (error: any) {
    showToast(error?.message || String(error), "error");
  }
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
(window as any).__ntDiscover = async () => {
  await discover(true);
  render();
  showToast(state.discoveries.length ? `检测到 ${state.discoveries.length} 个配置` : "未检测到配置", "info");
};
(window as any).__ntSelectDiscover = (path: string) => {
  state.selectedDiscoverPath = path;
};
(window as any).__ntImportSelected = () => { void importSelected(); };
(window as any).__ntInferDashboard = () => inferDashboardFromServerAddr();
(window as any).__ntMaybeInferDashboard = () => {
  const urlInput = document.getElementById("nt-dash-url") as HTMLInputElement | null;
  if (!urlInput) return;
  if (urlInput.value.trim()) return;
  // soft auto-fill only when empty
  const serverAddr = (document.getElementById("nt-server-addr") as HTMLInputElement | null)?.value?.trim();
  if (!serverAddr) return;
  let host = serverAddr;
  try {
    if (serverAddr.includes("://")) host = new URL(serverAddr).hostname;
  } catch {
    // keep
  }
  urlInput.value = `http://${host}:7500/static/#/`;
};
(window as any).__ntOpenProvider = async (id: string) => {
  if (id !== "frpc") {
    showToast("该穿透方式尚未接入", "info");
    return;
  }
  state.view = "frpc";
  render();
  await discover(true);
  // Auto import best candidate once if form still empty.
  const cfg = state.config;
  const empty =
    !cfg?.frpc?.serverAddr &&
    !(cfg?.frpc?.proxies && cfg.frpc.proxies.length) &&
    state.discoveries.length > 0;
  if (empty) {
    state.selectedDiscoverPath = state.discoveries[0].path;
    await importSelected();
  } else {
    render();
  }
};
(window as any).__ntBackCatalog = () => {
  state.view = "catalog";
  render();
};

registerTab("nat-traversal", {
  onEnter: () => {
    state.view = "catalog";
    setOuterHeaderVisible(true);
    void reload();
  },
  onLeave: () => {
    setOuterHeaderVisible(true);
  },
});
