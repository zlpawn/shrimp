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
  cloudflared?: {
    mode?: "quick" | "token";
    binPath?: string;
    localUrl?: string;
    logLevel?: string;
    publicUrl?: string;
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
    cloudflaredTokenConfigured?: boolean;
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
    mode?: string;
    publicUrl?: string;
  };
  providers?: {
    frpc?: {
      status?: string;
      pid?: number;
      lastError?: string;
      recentLogs?: string[];
    };
    cloudflared?: {
      status?: string;
      pid?: number;
      lastError?: string;
      recentLogs?: string[];
      publicUrl?: string;
      mode?: string;
      binPath?: string;
    };
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
  view: "catalog" | "frpc" | "cloudflared";
  loading: boolean;
  error: string;
  config: NatConfig | null;
  status: NatStatus | null;
  discoveries: DiscoverItem[];
  selectedDiscoverPath: string;
  tokenDraft: string;
  cfTokenDraft: string;
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
  installingCloudflared: boolean;
  installOutput: string;
} = {
  view: "catalog",
  loading: false,
  error: "",
  config: null,
  status: null,
  discoveries: [],
  selectedDiscoverPath: "",
  tokenDraft: "",
  cfTokenDraft: "",
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
  installingCloudflared: false,
  installOutput: "",
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


function renderDashboardHints(cfg: NatConfig, st: NatStatus): string {
  const bits: string[] = [];
  if (!cfg.frpsDashboard?.url) {
    bits.push(`请先填写 Dashboard URL，或点“从 serverAddr 填充”。`);
  }
  if (st.dashboard && st.dashboard.reachable === false) {
    bits.push(`Dashboard 当前不可达：${escapeHtml(st.dashboard.message || "unknown error")}`);
  } else if (st.dashboard?.statusCode === 401) {
    bits.push(`Dashboard 需要鉴权（401）。若 frps 开启了用户名/密码，请填写后保存再打开；未开启鉴权可留空。`);
  } else if (cfg.frpsDashboard?.url) {
    bits.push(`Dashboard 通过网关代理在新标签打开，不再嵌入本页，避免把管理台布局撑乱。`);
  }
  return bits.map((b) => `<p class="nt-help${b.includes("不可达") || b.includes("401") ? " nt-help-warn" : ""}">${b}</p>`).join("");
}

function renderCatalog(): string {
  const cfg = state.config || {};
  const frpStatusRaw = state.status?.providers?.frpc?.status || (state.status?.activeProvider === "frpc" ? state.status?.provider?.status : undefined);
  const cfStatusRaw = state.status?.providers?.cloudflared?.status || (state.status?.activeProvider === "cloudflared" ? state.status?.provider?.status : undefined);
  const stFrp = statusMeta(frpStatusRaw);
  const stCf = statusMeta(cfStatusRaw);

  const server = cfg.frpc?.serverAddr || "未配置 serverAddr";
  const proxyCount = cfg.frpc?.proxies?.length || 0;
  const dashReady = Boolean(cfg.secrets?.dashboardAuthConfigured);

  const cfMode = cfg.cloudflared?.mode || "quick";
  const cfPublicUrl = state.status?.providers?.cloudflared?.publicUrl || (state.status?.activeProvider === "cloudflared" ? state.status?.provider?.publicUrl : undefined) || cfg.cloudflared?.publicUrl || "";
  const cfTokenReady = Boolean(cfg.secrets?.cloudflaredTokenConfigured);

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
              <span class="${stFrp.badge}">${escapeHtml(stFrp.text)}</span>
            </div>
          </div>
          <div class="node-card-meta">
            <div class="node-card-row">
              <span class="badge">frpc / frps</span>
              <span class="badge ${stFrp.text === "运行中" ? "badge-default" : ""}">${escapeHtml(stFrp.text)}</span>
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
            <span>后台托管 frpc（macOS / Windows 可手动启停）</span>
            <span class="node-card-cta">进入管理 →</span>
          </div>
        </div>

        <div class="node-card" role="button" tabindex="0"
             onclick="window.__ntOpenProvider('cloudflared')"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.__ntOpenProvider('cloudflared');}">
          <div class="node-card-top">
            <div class="node-card-title-row">
              <div class="node-card-title">Cloudflare Tunnel</div>
            </div>
            <div class="node-card-actions" onclick="event.stopPropagation()">
              <span class="${stCf.badge}">${escapeHtml(stCf.text)}</span>
            </div>
          </div>
          <div class="node-card-meta">
            <div class="node-card-row">
              <span class="badge">cloudflared</span>
              <span class="badge ${stCf.text === "运行中" ? "badge-default" : ""}">${escapeHtml(stCf.text)}</span>
              <span class="badge">${cfMode === "token" ? "Token 隧道" : "Quick 临时公网"}</span>
              ${cfMode === "token" ? `<span class="badge">${cfTokenReady ? "Token 已配置" : "Token 待配置"}</span>` : ""}
            </div>
            <div class="node-card-row">
              <span class="mono" title="${escapeHtml(cfPublicUrl || "启动后自动捕获公网 URL")}">${escapeHtml(cfPublicUrl || (stCf.text === "运行中" ? "捕获公网地址中..." : "未运行 (Quick / Token)"))}</span>
            </div>
            <div class="node-card-models">
              <span class="tag">无需公网IP</span>
              <span class="tag">trycloudflare</span>
              <span class="tag">多端互联</span>
            </div>
          </div>
          <div class="node-card-footer">
            <span>官方 Cloudflare Tunnel 穿透隧道（支持 Windows / macOS）</span>
            <div style="display:flex;gap:8px;align-items:center;">
              <a class="btn btn-xs" href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="访问 Cloudflare 官方控制台">官网 ↗</a>
              <span class="node-card-cta">进入管理 →</span>
            </div>
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
      <details class="nt-details">
        <summary>🔍 本机 frpc 配置检测 (未发现候选文件)</summary>
        <div style="margin-top:6px;">
          <p class="nt-help">未在常见目录找到 frpc.toml / frpc.ini。可把配置放到 ~/frp/frpc.toml 后重检，或手动填写下方表单。</p>
          <button class="btn btn-xs" onclick="window.__ntDiscover()">重新检测</button>
        </div>
      </details>
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
    <div class="usage-guide nt-block">
      <div class="nt-block-head">
        <h3>本机 frpc 配置检测</h3>
        <div class="nt-inline-actions">
          <button class="btn btn-xs" onclick="window.__ntDiscover()">重新检测</button>
          <button class="btn btn-xs btn-primary" onclick="window.__ntImportSelected()">导入到表单</button>
        </div>
      </div>
      <p class="nt-help">检测到 ${items.length} 个候选配置。导入会填充 server/proxies 并推断 Dashboard URL。</p>
      <label class="form-group" style="display:grid;gap:4px;">
        <select id="nt-discover-path" onchange="window.__ntSelectDiscover(this.value)">${options}</select>
      </label>
      <div class="node-card-row" style="margin-top:6px;gap:6px;flex-wrap:wrap;">
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
      <div class="nt-compact-header">
        <div class="nt-compact-header-left">
          <button class="btn btn-sm" onclick="window.__ntBackCatalog()">← 返回</button>
          <h2>frp 管理</h2>
          <span class="${status.badge}">${escapeHtml(status.text)}</span>
          <span class="badge">PID ${escapeHtml(String(st.provider?.pid || 0))}</span>
          <span class="badge">${escapeHtml(st.provider?.mode === "external-detected" ? "已检测外部进程" : (st.provider?.mode || "background"))}</span>
          ${st.provider?.binPath || cfg.frpc?.binPath ? `<span class="badge mono" title="${escapeHtml(st.provider?.binPath || cfg.frpc?.binPath || "")}">frpc</span>` : ""}
          ${(() => {
            const source = st.provider?.configPath || configPath || "";
            return source
              ? `<span class="badge mono" title="${escapeHtml(source)}">源: ${escapeHtml(source.split(/[\\/]/).pop() || source)}</span>`
              : "";
          })()}
        </div>
        <div class="nt-compact-header-right">
          <button class="btn btn-sm" onclick="window.__ntStart()">启动</button>
          <button class="btn btn-sm" onclick="window.__ntStop()">停止</button>
          <button class="btn btn-sm" onclick="window.__ntRestart()">重启</button>
          <button class="btn btn-sm" onclick="window.__ntReload()">刷新</button>
          <button class="btn btn-sm btn-primary" onclick="window.__ntSave()">保存配置</button>
        </div>
      </div>

      ${state.error ? `<div class="nt-alert">${escapeHtml(state.error)}</div>` : ""}
      ${st.provider?.lastError ? `<div class="nt-alert">${escapeHtml(st.provider.lastError)}</div>` : ""}

      ${renderDiscoverBox()}

      <div class="usage-guide nt-block">
        <div class="nt-block-head">
          <h3>frpc 连接</h3>
        </div>
        <div class="nt-form-grid">
          <label class="form-group"><span>serverAddr</span><input id="nt-server-addr" value="${escapeHtml(cfg.frpc?.serverAddr || "")}" oninput="window.__ntMaybeInferDashboard()" /></label>
          <label class="form-group"><span>serverPort</span><input id="nt-server-port" type="number" value="${escapeHtml(String(cfg.frpc?.serverPort ?? 7000))}" /></label>
          <label class="form-group"><span>binPath</span><input id="nt-bin-path" placeholder="空则自动发现" value="${escapeHtml(cfg.frpc?.binPath || "")}" /></label>
          <label class="form-group"><span>logLevel</span><input id="nt-log-level" value="${escapeHtml(cfg.frpc?.logLevel || "info")}" /></label>
        </div>
      </div>

      <div class="usage-guide nt-block">
        <div class="nt-block-head">
          <h3>本地映射 Proxies</h3>
          <button class="btn btn-xs" onclick="window.__ntAddProxy()">新增映射</button>
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
                          <td><button class="btn btn-xs" onclick="window.__ntRemoveProxy(${i})">删除</button></td>
                        </tr>`,
                      )
                      .join("")
                  : `<tr><td colspan="6"><p class="nt-help" style="padding:6px;">还没有映射。可导入本机配置，或手动新增。</p></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="usage-guide nt-block">
        <div class="nt-block-head">
          <h3>frps Dashboard</h3>
          <div class="nt-inline-actions">
            <button type="button" class="btn btn-xs nt-btn-open-dashboard" onclick="window.__ntOpenDashboardProxy()">保存并打开 Dashboard</button>
            ${cfg.frpsDashboard?.url ? `<a class="btn btn-xs" href="${escapeHtml(cfg.frpsDashboard.url)}" target="_blank" rel="noopener noreferrer">原始地址 ↗</a>` : ""}
          </div>
        </div>
        <div class="nt-form-grid">
          <div class="form-group nt-col-2">
            <span>Dashboard URL</span>
            <div class="nt-url-row" style="display:flex;gap:6px;">
              <input id="nt-dash-url" style="flex:1;" value="${escapeHtml(cfg.frpsDashboard?.url || "")}" placeholder="http://x.x.x.x:7500/static/#/" />
              <button type="button" class="btn btn-xs" onclick="window.__ntInferDashboard()" title="根据 frpc 的 serverAddr 生成">从 serverAddr 填充</button>
            </div>
          </div>
          <label class="form-group"><span>用户名（可选）</span><input id="nt-dash-user" value="${escapeHtml(state.dashUserDraft)}" placeholder="${cfg.secrets?.dashboardAuthConfigured ? "已配置，留空保留" : ""}" /></label>
          <label class="form-group"><span>密码（可选）</span><input id="nt-dash-pass" type="password" value="${escapeHtml(state.dashPassDraft)}" placeholder="${cfg.secrets?.dashboardAuthConfigured ? "已配置，留空保留" : ""}" /></label>
        </div>
        <div class="node-card-row" style="margin-top:6px;gap:6px;flex-wrap:wrap;">
          <span class="badge">可达: ${st.dashboard?.reachable ? "yes" : "no"}</span>
          <span class="badge">HTTP: ${escapeHtml(String(st.dashboard?.statusCode || "-"))}</span>
          ${st.dashboard?.message ? `<span class="badge">${escapeHtml(st.dashboard.message)}</span>` : ""}
        </div>
        ${renderDashboardHints(cfg, st)}
      </div>

      <details class="nt-details" open>
        <summary>📋 最近日志 (${logs.length} 条)</summary>
        <pre class="nt-log">${escapeHtml(logs.slice(-100).join("\n") || "暂无日志")}</pre>
      </details>
    </div>
  `;
}

function renderCloudflaredDetail(): string {
  const cfg = state.config || {};
  const st = state.status || {};
  const cfStatus = st.providers?.cloudflared || (st.activeProvider === "cloudflared" ? st.provider : {}) || {};
  const status = statusMeta(cfStatus.status);
  const cfConfig = cfg.cloudflared || {};
  const mode = cfConfig.mode || "quick";
  const localUrl = cfConfig.localUrl || "http://127.0.0.1:8788";
  const binPath = cfConfig.binPath || "";
  const logLevel = cfConfig.logLevel || "info";
  const publicUrl = cfStatus.publicUrl || cfConfig.publicUrl || "";
  const tokenConfigured = Boolean(cfg.secrets?.cloudflaredTokenConfigured);
  const logs = cfStatus.recentLogs || [];

  return `
    <div class="nt-page">
      <div class="nt-compact-header">
        <div class="nt-compact-header-left">
          <button class="btn btn-sm" onclick="window.__ntBackCatalog()">← 返回</button>
          <h2>Cloudflare Tunnel</h2>
          <span class="${status.badge}">${escapeHtml(status.text)}</span>
          <span class="badge">PID ${escapeHtml(String(cfStatus.pid || 0))}</span>
          <span class="badge">${escapeHtml(cfStatus.mode === "external-detected" ? "外部常驻服务" : (cfStatus.mode || mode))}</span>
          ${cfStatus.binPath || binPath ? `<span class="badge mono" title="${escapeHtml(cfStatus.binPath || binPath)}">cloudflared</span>` : ""}
        </div>
        <div class="nt-compact-header-right">
          <a class="btn btn-sm" href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" title="访问 Cloudflare 官方控制台 (dash.cloudflare.com)">Cloudflare 官网 ↗</a>
          <button class="btn btn-sm" onclick="window.__ntStart()">启动</button>
          <button class="btn btn-sm" onclick="window.__ntStop()">停止</button>
          <button class="btn btn-sm" onclick="window.__ntRestart()">重启</button>
          <button class="btn btn-sm" onclick="window.__ntReload()">刷新</button>
          <button class="btn btn-sm btn-primary" onclick="window.__ntSave()">保存配置</button>
        </div>
      </div>

      ${state.error ? `<div class="nt-alert">${escapeHtml(state.error)}</div>` : ""}
      ${cfStatus.lastError ? `<div class="nt-alert">${escapeHtml(cfStatus.lastError)}</div>` : ""}

      ${publicUrl ? `
        <div class="nt-url-banner">
          <div class="nt-url-banner-main">
            <span class="nt-url-label">🌐 公网访问:</span>
            <a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer" class="nt-url-link mono">${escapeHtml(publicUrl)}</a>
          </div>
          <div class="nt-inline-actions">
            <button class="btn btn-xs" onclick="window.__ntCopyText('${escapeHtml(publicUrl)}')">📋 复制</button>
            <a class="btn btn-xs" href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer">在新标签打开 ↗</a>
          </div>
        </div>
      ` : (cfStatus.status === "running" ? `
        <div class="nt-url-banner" style="background:var(--bg-secondary);">
          <span class="mono" style="font-size:12px;">⏳ 正在从 cloudflared 输出流捕获 *.trycloudflare.com 地址，请稍候...</span>
        </div>
      ` : "")}

      <div class="usage-guide nt-block">
        <div class="nt-block-head">
          <h3>Tunnel 连接配置</h3>
          <div class="nt-inline-actions">
            <a class="btn btn-xs" href="https://one.dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" title="直接前往 Cloudflare Zero Trust 控制台创建/获取 Tunnel Token">Zero Trust 控制台 ↗</a>
          </div>
        </div>
        <div class="nt-form-grid">
          <label class="form-group">
            <span>穿透模式 (Mode)</span>
            <select id="nt-cf-mode" onchange="window.__ntCfModeChange(this.value)">
              <option value="quick" ${mode === "quick" ? "selected" : ""}>Quick 模式 (*.trycloudflare.com 临时分配)</option>
              <option value="token" ${mode === "token" ? "selected" : ""}>Token 模式 (Cloudflare Zero Trust 永久命名隧道)</option>
            </select>
          </label>
          <label class="form-group">
            <span>本地目标服务 (localUrl)</span>
            <input id="nt-cf-local-url" value="${escapeHtml(localUrl)}" placeholder="http://127.0.0.1:8788" />
          </label>
          <label class="form-group nt-col-2" id="nt-cf-token-group" style="${mode === "token" ? "" : "display:none;"}">
            <span style="display:flex; justify-content:space-between; align-items:center;">
              <span>Tunnel Token (仅 Token 模式需要，可在 <a href="https://one.dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" style="color:var(--accent-color);text-decoration:underline;">Zero Trust 控制台</a> 创建并获取)</span>
              <span class="badge ${tokenConfigured ? "badge-default" : ""}" style="font-size:10px;">
                ${tokenConfigured ? "已配置" : "未配置"}
              </span>
            </span>
            <input id="nt-cf-token" type="password" value="${escapeHtml(state.cfTokenDraft)}" placeholder="${tokenConfigured ? "已配置 Token，留空保持不变" : "粘贴 Cloudflare Zero Trust 提供的 Tunnel Token"}" />
          </label>
          <label class="form-group">
            <span>可执行文件路径 (binPath)</span>
            <input id="nt-cf-bin-path" placeholder="留空自动在 PATH、npm、brew 中发现" value="${escapeHtml(binPath)}" />
          </label>
          <label class="form-group">
            <span>日志级别 (logLevel)</span>
            <select id="nt-cf-log-level">
              <option value="info" ${logLevel === "info" ? "selected" : ""}>info</option>
              <option value="debug" ${logLevel === "debug" ? "selected" : ""}>debug</option>
              <option value="warn" ${logLevel === "warn" ? "selected" : ""}>warn</option>
              <option value="error" ${logLevel === "error" ? "selected" : ""}>error</option>
            </select>
          </label>
        </div>
      </div>

      <details class="nt-details" ${binPath || cfStatus.binPath ? "" : "open"}>
        <summary>📦 cloudflared 安装与服务化后台运行指引 (点击展开/折叠)</summary>
        <div style="display:grid; gap:8px; margin-top:8px;">
          <div style="font-size:12px; color:var(--text-secondary); line-height:1.5;">
            <strong>后台独立常驻（不随网关关闭）：</strong>
            推荐使用系统服务 <code>cloudflared service install [TOKEN]</code>（Windows 服务 / macOS launchd，由操作系统 services 管理，完全脱离网关生命周期）。网关启动后会自动检测并接管外部运行状态。
          </div>
          <div class="nt-form-grid">
            <div class="form-group nt-col-2">
              <span style="font-size:11px;">全局安装方式 (全自动下载官方二进制):</span>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                <input readonly value="npm install -g cloudflared" class="mono" style="flex:1;min-width:180px;" />
                <button class="btn btn-xs" onclick="window.__ntCopyText('npm install -g cloudflared')">复制</button>
                <button class="btn btn-xs btn-primary" id="nt-btn-install-cf" ${state.installingCloudflared ? "disabled" : ""} onclick="window.__ntInstallCloudflared()">
                  ${state.installingCloudflared ? "⏳ 安装中..." : "⚡ 网关一键安装"}
                </button>
              </div>
              ${state.installingCloudflared ? `
                <div style="margin-top:4px;padding:4px 8px;background:var(--bg-secondary);border-radius:4px;font-size:11px;">
                  正在后台静默执行 <code>npm install -g cloudflared</code>，请稍候（通常需 10~20 秒）...
                </div>
              ` : ""}
              ${state.installOutput ? `
                <pre class="nt-log" style="margin-top:6px;max-height:80px;">${escapeHtml(state.installOutput)}</pre>
              ` : ""}
            </div>
            <div class="form-group">
              <span style="font-size:11px;">Windows 原生后台启动 (PowerShell 隐藏窗口):</span>
              <input readonly value='Start-Process cloudflared -ArgumentList "tunnel --url http://127.0.0.1:8788" -WindowStyle Hidden' class="mono" />
            </div>
            <div class="form-group">
              <span style="font-size:11px;">macOS / Linux 独立后台启动:</span>
              <input readonly value="nohup cloudflared tunnel --url http://127.0.0.1:8788 > /dev/null 2>&1 &" class="mono" />
            </div>
          </div>
        </div>
      </details>

      <details class="nt-details" open>
        <summary>📋 最近日志 (${logs.length} 条)</summary>
        <pre class="nt-log">${escapeHtml(logs.slice(-100).join("\n") || "暂无日志")}</pre>
      </details>
    </div>
  `;
}

function render(): void {
  const el = rootEl();
  if (!el) return;
  setOuterHeaderVisible(state.view === "catalog");
  if (state.error && !state.config) {
    el.innerHTML = `<div class="nt-page"><div class="nt-alert">${escapeHtml(state.error)} <button class="btn" onclick="window.__ntReload()">重试</button></div></div>`;
    return;
  }
  el.innerHTML = state.view === "catalog"
    ? renderCatalog()
    : state.view === "frpc"
      ? renderFrpcDetail()
      : renderCloudflaredDetail();
}

function collectConfigFromDom(): { config: NatConfig; secrets: any } {
  if (state.view === "cloudflared") {
    const mode = ((document.getElementById("nt-cf-mode") as HTMLSelectElement | null)?.value || "quick") as "quick" | "token";
    const localUrl = (document.getElementById("nt-cf-local-url") as HTMLInputElement | null)?.value?.trim() || "http://127.0.0.1:8788";
    const binPath = (document.getElementById("nt-cf-bin-path") as HTMLInputElement | null)?.value?.trim() || "";
    const logLevel = (document.getElementById("nt-cf-log-level") as HTMLSelectElement | null)?.value || "info";
    const token = (document.getElementById("nt-cf-token") as HTMLInputElement | null)?.value?.trim() || "";

    state.cfTokenDraft = token;

    const secrets: any = {};
    if (token) {
      secrets.cloudflared = { token };
    }

    return {
      config: {
        ...(state.config || {}),
        enabled: true,
        activeProvider: "cloudflared",
        cloudflared: {
          ...(state.config?.cloudflared || {}),
          mode,
          localUrl,
          binPath,
          logLevel,
        },
      },
      secrets,
    };
  }

  const serverAddr = (document.getElementById("nt-server-addr") as HTMLInputElement | null)?.value || "";
  const serverPort = Number((document.getElementById("nt-server-port") as HTMLInputElement | null)?.value || 7000);
  const binPath = (document.getElementById("nt-bin-path") as HTMLInputElement | null)?.value || "";
  const logLevel = (document.getElementById("nt-log-level") as HTMLInputElement | null)?.value || "info";
  const dashUrl = (document.getElementById("nt-dash-url") as HTMLInputElement | null)?.value || "";
  const dashEnabled = true; // dashboard open/proxy is always available; no in-page embed
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

  state.dashUserDraft = dashUser;
  state.dashPassDraft = dashPass;

  const secrets: any = {};
  if (dashUser || dashPass) {
    secrets.frpsDashboard = {};
    if (dashUser) secrets.frpsDashboard.username = dashUser;
    if (dashPass) secrets.frpsDashboard.password = dashPass;
  }

  return {
    config: {
      enabled: true,
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

async function save(opts: { quietRender?: boolean } = {}): Promise<void> {
  try {
    const { config, secrets } = collectConfigFromDom();
    state.config = await api<NatConfig>("/v1/nat-traversal/config", {
      method: "PUT",
      body: JSON.stringify({ ...config, secrets }),
    });
    state.status = await api<NatStatus>("/v1/nat-traversal/status");
    // Keep typed password draft only if user is actively editing; clear after successful save
    // when we will re-render form fields from server state.
    if (!opts.quietRender) {
      state.tokenDraft = "";
      state.cfTokenDraft = "";
      state.dashPassDraft = "";
    }
    showToast(`${state.view === "cloudflared" ? "Cloudflare Tunnel" : "frp"} 配置已保存`, "success");
    if (!opts.quietRender) render();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    if (!opts.quietRender) render();
    throw error;
  }
}

async function runAction(action: "start" | "stop" | "restart"): Promise<void> {
  try {
    if (state.view === "cloudflared" && state.config?.activeProvider !== "cloudflared") {
      await save({ quietRender: true });
    } else if (state.view === "frpc" && state.config?.activeProvider !== "frpc") {
      await save({ quietRender: true });
    }
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

async function installCloudflared(): Promise<void> {
  if (state.installingCloudflared) return;
  state.installingCloudflared = true;
  state.installOutput = "";
  render();
  try {
    showToast("开始安装 cloudflared，正在自动下载官方对应平台二进制...", "info");
    const result = await api<{
      ok: boolean;
      binPath?: string;
      message?: string;
      output?: string;
      error?: string;
    }>("/v1/nat-traversal/install-cloudflared", {
      method: "POST",
      body: JSON.stringify({ packageManager: "npm" }),
    });
    state.installingCloudflared = false;
    state.installOutput = result.output || result.message || "";
    if (result.ok) {
      showToast(`🎉 cloudflared 安装成功！路径: ${result.binPath || "已就绪"}`, "success");
      state.status = await api<NatStatus>("/v1/nat-traversal/status");
    } else {
      showToast(`安装未完成: ${result.error || "未知错误"}`, "error");
    }
  } catch (error: any) {
    state.installingCloudflared = false;
    state.installOutput = error?.message || String(error);
    showToast(`安装失败: ${error?.message || String(error)}`, "error");
  } finally {
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


/** Proxy entry that keeps frps relative `../api/*` working. */

/** Open URL as a normal new browser tab (not a feature-constrained popup). */
function openInNewTab(url: string): void {
  const href = String(url || "").trim();
  if (!href) return;
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  // Required for Firefox to accept programmatic click in some cases.
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function buildDashboardProxyEntryPath(targetUrl = ""): string {
  const raw = String(targetUrl || "").trim();
  let pathname = "/static/";
  let hash = "#/";
  if (raw) {
    try {
      const url = new URL(raw);
      pathname = url.pathname && url.pathname !== "/" ? url.pathname : "/static/";
      hash = url.hash || "";
    } catch {
      // keep defaults
    }
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname === "/static") pathname = "/static/";
  if (!pathname.endsWith("/") && !/\.[a-zA-Z0-9]+$/.test(pathname)) {
    pathname = `${pathname}/`;
  }
  return `/v1/nat-traversal/frps-dashboard${pathname}${hash}`;
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
    showToast(`已导入 ${path}（token 仍留在该配置文件）`, "success");
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
(window as any).__ntOpenDashboardProxy = async () => {
  try {
    const draftUrl =
      (document.getElementById("nt-dash-url") as HTMLInputElement | null)?.value?.trim() ||
      state.config?.frpsDashboard?.url ||
      "";
    if (!draftUrl) {
      showToast("请先填写 Dashboard URL", "error");
      return;
    }
    const entry = buildDashboardProxyEntryPath(draftUrl);

    // 1. Open blank tab synchronously within user gesture stack to avoid popup blocker
    const targetWin = window.open("about:blank", "_blank");

    // 2. Save credentials to secrets on server first so reverse proxy has Basic Auth ready
    await save({ quietRender: true });

    // 3. Navigate the opened tab to proxy entry with credentials already persisted
    if (targetWin && !targetWin.closed) {
      targetWin.location.href = entry;
    } else {
      openInNewTab(entry);
    }
  } catch (error: any) {
    showToast(error?.message || String(error), "error");
  }
};
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
  if (id === "cloudflared") {
    state.view = "cloudflared";
    render();
    return;
  }
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
(window as any).__ntCfModeChange = (mode: string) => {
  const tokenGroup = document.getElementById("nt-cf-token-group");
  if (tokenGroup) {
    tokenGroup.style.display = mode === "token" ? "" : "none";
  }
};
(window as any).__ntCopyText = (text: string) => {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(() => {
      showToast("已复制到剪贴板", "success");
    });
  } else {
    showToast("复制失败：浏览器权限受限", "error");
  }
};
(window as any).__ntInstallCloudflared = () => {
  void installCloudflared();
};

registerTab("nat-traversal", {
  onEnter: () => {
    state.view = "catalog";
    setOuterHeaderVisible(true);
    render();
    void reload();
  },
  onLeave: () => {
    setOuterHeaderVisible(true);
  },
});
