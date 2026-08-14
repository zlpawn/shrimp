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

function rootEl(): HTMLElement {
  const el = document.getElementById("nat-traversal-root");
  if (!el) throw new Error("nat-traversal-root not found");
  return el;
}

function statusBadge(status?: string): string {
  const s = status || "stopped";
  const cls =
    s === "running" ? "ok" : s === "error" ? "err" : s === "starting" ? "warn" : "muted";
  return `<span class="nt-badge nt-${cls}">${escapeHtml(s)}</span>`;
}

function render(): void {
  const el = rootEl();
  if (state.loading && !state.config) {
    el.innerHTML = `<div class="nt-loading">加载中…</div>`;
    return;
  }
  if (state.error && !state.config) {
    el.innerHTML = `<div class="nt-error">${escapeHtml(state.error)} <button class="btn" onclick="window.__ntReload()">重试</button></div>`;
    return;
  }

  const cfg = state.config || {};
  const st = state.status || {};
  const proxies = cfg.frpc?.proxies || [];
  const peers = cfg.peers || [];
  const logs = st.provider?.recentLogs || [];

  el.innerHTML = `
    <div class="nt-grid">
      <section class="nt-card">
        <div class="nt-card-head">
          <h3>概览</h3>
          ${statusBadge(st.provider?.status)}
        </div>
        <label class="nt-row"><span>启用 NAT Traversal</span>
          <input type="checkbox" id="nt-enabled" ${cfg.enabled ? "checked" : ""} />
        </label>
        <div class="nt-meta">
          <div>Provider: <code>${escapeHtml(cfg.activeProvider || "frpc")}</code></div>
          <div>PID: <code>${escapeHtml(String(st.provider?.pid || 0))}</code></div>
          <div>Token: <code>${cfg.secrets?.frpcTokenConfigured ? "已配置" : "未配置"}</code></div>
          <div>Dashboard Auth: <code>${cfg.secrets?.dashboardAuthConfigured ? "已配置" : "未配置"}</code></div>
        </div>
        <div class="nt-actions">
          <button class="btn btn-primary" onclick="window.__ntSave()">保存配置</button>
          <button class="btn" onclick="window.__ntStart()">启动</button>
          <button class="btn" onclick="window.__ntStop()">停止</button>
          <button class="btn" onclick="window.__ntRestart()">重启</button>
          <button class="btn" onclick="window.__ntReload()">刷新状态</button>
        </div>
        ${st.provider?.lastError ? `<div class="nt-error">${escapeHtml(st.provider.lastError)}</div>` : ""}
        ${state.error ? `<div class="nt-error">${escapeHtml(state.error)}</div>` : ""}
      </section>

      <section class="nt-card">
        <div class="nt-card-head"><h3>frpc 客户端</h3></div>
        <div class="nt-form">
          <label>serverAddr<input id="nt-server-addr" value="${escapeHtml(cfg.frpc?.serverAddr || "")}" /></label>
          <label>serverPort<input id="nt-server-port" type="number" value="${escapeHtml(String(cfg.frpc?.serverPort ?? 7000))}" /></label>
          <label>binPath<input id="nt-bin-path" placeholder="空则自动发现" value="${escapeHtml(cfg.frpc?.binPath || "")}" /></label>
          <label>logLevel<input id="nt-log-level" value="${escapeHtml(cfg.frpc?.logLevel || "info")}" /></label>
          <label>frpc token（写入 secrets）<input id="nt-token" type="password" placeholder="${cfg.secrets?.frpcTokenConfigured ? "已配置，留空保留" : "未配置"}" value="${escapeHtml(state.tokenDraft)}" /></label>
        </div>
        <h4>Proxies</h4>
        <div class="nt-table-wrap">
          <table class="nt-table">
            <thead><tr><th>name</th><th>type</th><th>localIp</th><th>localPort</th><th>remotePort</th><th></th></tr></thead>
            <tbody>
              ${proxies
                .map(
                  (p, i) => `<tr>
                    <td><input data-proxy="${i}" data-k="name" value="${escapeHtml(p.name || "")}" /></td>
                    <td><input data-proxy="${i}" data-k="type" value="${escapeHtml(p.type || "tcp")}" /></td>
                    <td><input data-proxy="${i}" data-k="localIp" value="${escapeHtml(p.localIp || "127.0.0.1")}" /></td>
                    <td><input data-proxy="${i}" data-k="localPort" type="number" value="${escapeHtml(String(p.localPort || 0))}" /></td>
                    <td><input data-proxy="${i}" data-k="remotePort" type="number" value="${escapeHtml(String(p.remotePort || 0))}" /></td>
                    <td><button class="btn" onclick="window.__ntRemoveProxy(${i})">删</button></td>
                  </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <button class="btn" onclick="window.__ntAddProxy()">新增 proxy</button>
      </section>

      <section class="nt-card">
        <div class="nt-card-head"><h3>frps Dashboard</h3></div>
        <label class="nt-row"><span>在管理台展示</span>
          <input type="checkbox" id="nt-dash-enabled" ${cfg.frpsDashboard?.enabled ? "checked" : ""} />
        </label>
        <div class="nt-form">
          <label>Dashboard URL<input id="nt-dash-url" value="${escapeHtml(cfg.frpsDashboard?.url || "")}" /></label>
          <label>用户名（secrets）<input id="nt-dash-user" value="${escapeHtml(state.dashUserDraft)}" placeholder="${cfg.secrets?.dashboardAuthConfigured ? "已配置，留空保留" : ""}" /></label>
          <label>密码（secrets）<input id="nt-dash-pass" type="password" value="${escapeHtml(state.dashPassDraft)}" placeholder="${cfg.secrets?.dashboardAuthConfigured ? "已配置，留空保留" : ""}" /></label>
        </div>
        <div class="nt-meta">
          <div>可达: <code>${st.dashboard?.reachable ? "yes" : "no"}</code></div>
          <div>HTTP: <code>${escapeHtml(String(st.dashboard?.statusCode || "-"))}</code></div>
          <div>${escapeHtml(st.dashboard?.message || "")}</div>
        </div>
        <div class="nt-actions">
          <a class="btn" href="/v1/nat-traversal/frps-dashboard/" target="_blank" rel="noreferrer">在浏览器打开（经网关反代）</a>
          ${cfg.frpsDashboard?.url ? `<a class="btn" href="${escapeHtml(cfg.frpsDashboard.url)}" target="_blank" rel="noreferrer">打开原始地址</a>` : ""}
        </div>
        ${
          cfg.frpsDashboard?.enabled
            ? `<div class="nt-frame-wrap"><iframe class="nt-frame" src="/v1/nat-traversal/frps-dashboard/" title="frps dashboard"></iframe></div>`
            : `<div class="nt-empty">启用后将在此嵌入 frps Dashboard</div>`
        }
      </section>

      <section class="nt-card">
        <div class="nt-card-head"><h3>对端 Peers</h3></div>
        <div class="nt-table-wrap">
          <table class="nt-table">
            <thead><tr><th>id</th><th>名称</th><th>ssh</th><th>gatewayApi</th><th></th></tr></thead>
            <tbody>
              ${peers
                .map(
                  (p) => `<tr>
                    <td><code>${escapeHtml(p.id || "")}</code></td>
                    <td>${escapeHtml(p.displayName || "")}</td>
                    <td>${escapeHtml([p.ssh?.user, p.ssh?.host, p.ssh?.port].filter(Boolean).join("@").replace("@", "@"))}</td>
                    <td><code>${escapeHtml(p.services?.gatewayApi || "")}</code></td>
                    <td>
                      <button class="btn" onclick="window.__ntTestPeer('${escapeHtml(p.id || "")}')">测试</button>
                      <button class="btn" onclick="window.__ntDeletePeer('${escapeHtml(p.id || "")}')">删</button>
                    </td>
                  </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <h4>手动添加 / 更新</h4>
        <div class="nt-form">
          <label>id<input id="nt-peer-id" value="${escapeHtml(state.peerDraft.id)}" /></label>
          <label>displayName<input id="nt-peer-name" value="${escapeHtml(state.peerDraft.displayName)}" /></label>
          <label>ssh host<input id="nt-peer-host" value="${escapeHtml(state.peerDraft.host)}" /></label>
          <label>ssh port<input id="nt-peer-port" value="${escapeHtml(state.peerDraft.port)}" /></label>
          <label>ssh user<input id="nt-peer-user" value="${escapeHtml(state.peerDraft.user)}" /></label>
          <label>gatewayApi<input id="nt-peer-gw" placeholder="127.0.0.1:18788 或 http://..." value="${escapeHtml(state.peerDraft.gatewayApi)}" /></label>
        </div>
        <button class="btn btn-primary" onclick="window.__ntUpsertPeer()">保存 Peer</button>
      </section>

      <section class="nt-card">
        <div class="nt-card-head"><h3>最近日志</h3></div>
        <pre class="nt-log">${escapeHtml(logs.slice(-40).join("\n") || "暂无日志")}</pre>
      </section>
    </div>
  `;
}

function collectConfigFromDom(): { config: NatConfig; secrets: any } {
  const enabled = (document.getElementById("nt-enabled") as HTMLInputElement)?.checked;
  const serverAddr = (document.getElementById("nt-server-addr") as HTMLInputElement)?.value || "";
  const serverPort = Number((document.getElementById("nt-server-port") as HTMLInputElement)?.value || 7000);
  const binPath = (document.getElementById("nt-bin-path") as HTMLInputElement)?.value || "";
  const logLevel = (document.getElementById("nt-log-level") as HTMLInputElement)?.value || "info";
  const token = (document.getElementById("nt-token") as HTMLInputElement)?.value || "";
  const dashEnabled = (document.getElementById("nt-dash-enabled") as HTMLInputElement)?.checked;
  const dashUrl = (document.getElementById("nt-dash-url") as HTMLInputElement)?.value || "";
  const dashUser = (document.getElementById("nt-dash-user") as HTMLInputElement)?.value || "";
  const dashPass = (document.getElementById("nt-dash-pass") as HTMLInputElement)?.value || "";

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
    showToast("NAT Traversal 配置已保存", "success");
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
    showToast(`已${action}`, "success");
    render();
  } catch (error: any) {
    state.error = error?.message || String(error);
    showToast(state.error, "error");
    render();
  }
}

function addProxy(): void {
  const cfg = state.config || { frpc: { proxies: [] } };
  cfg.frpc = cfg.frpc || { proxies: [] };
  cfg.frpc.proxies = [
    ...(cfg.frpc.proxies || []),
    {
      name: `proxy-${(cfg.frpc.proxies || []).length + 1}`,
      type: "tcp",
      localIp: "127.0.0.1",
      localPort: 8788,
      remotePort: 18788,
    },
  ];
  state.config = cfg as NatConfig;
  // preserve form fields already typed
  const collected = collectConfigFromDom();
  state.config = {
    ...collected.config,
    frpc: {
      ...collected.config.frpc,
      proxies: cfg.frpc.proxies,
    },
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
  const id = (document.getElementById("nt-peer-id") as HTMLInputElement)?.value?.trim();
  const displayName = (document.getElementById("nt-peer-name") as HTMLInputElement)?.value?.trim();
  const host = (document.getElementById("nt-peer-host") as HTMLInputElement)?.value?.trim();
  const port = Number((document.getElementById("nt-peer-port") as HTMLInputElement)?.value || 22);
  const user = (document.getElementById("nt-peer-user") as HTMLInputElement)?.value?.trim();
  const gatewayApi = (document.getElementById("nt-peer-gw") as HTMLInputElement)?.value?.trim();
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
    showToast(`测试 ${id}: ${result.status}${result.message ? " - " + result.message : ""}`, result.status === "online" ? "success" : "error");
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

registerTab("nat-traversal", {
  onEnter: () => {
    void reload();
  },
});
