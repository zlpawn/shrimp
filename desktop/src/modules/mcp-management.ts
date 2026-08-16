import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

type McpServer = {
  name: string;
  title?: string;
  description?: string;
  enabled?: boolean;
  transport?: "stdio" | "remote";
  command?: string;
  args?: string[];
  url?: string;
  distribution?: { codex?: boolean; claude?: boolean; antigravity?: boolean };
};

type ClientScan = {
  client: string;
  path: string;
  status: "ok" | "missing" | "invalid";
  error?: string;
  servers: Array<{ name: string; config: Record<string, unknown> }>;
};

type ClientMeta = {
  id: string;
  label: string;
  path: string;
  defaultPath: string;
};

type McpState = {
  config: {
    servers?: Record<string, McpServer>;
    clientPaths?: Record<string, string>;
  };
  paths?: Record<string, string>;
  clients?: ClientScan[];
  presentIn?: Record<string, Record<string, boolean>>;
  clientsMeta?: ClientMeta[];
};

const state = {
  loading: false,
  error: "",
  data: null as McpState | null,
  selected: "",
  editing: false,
  preview: "",
  confirming: false,
  busy: "" as "" | "scan" | "save" | "preview" | "apply" | "path",
  pathClient: "",
  pathDraft: "",
  draft: {
    name: "",
    title: "",
    description: "",
    transport: "stdio" as "stdio" | "remote",
    command: "",
    args: "",
    url: "",
    env: "",
    headers: "",
    enabled: true,
    codex: false,
    claude: false,
    antigravity: false,
  },
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`);
  return data as T;
}

function rootEl(): HTMLElement | null {
  return document.getElementById("mcp-management-root");
}

function servers(): McpServer[] {
  return Object.values(state.data?.config?.servers || {});
}

function selected(): McpServer | null {
  return state.data?.config?.servers?.[state.selected] || null;
}

function clientLabel(id: string): string {
  if (id === "codex") return "Codex";
  if (id === "claude") return "Claude";
  return "Antigravity";
}

function renderHeader(): string {
  const busy = Boolean(state.busy);
  return `
    <div class="mcp-header">
      <div>
        <h2>MCP 管理 (MCP Management)</h2>
        <p>扫描 Codex / Claude / Antigravity 已安装的 MCP，配置网关托管 MCP 并分发到各客户端。</p>
      </div>
      <div class="mcp-actions">
        <button class="btn" onclick="window.__mcpRescan()" ${busy ? "disabled" : ""}>重新扫描</button>
        <button class="btn" onclick="window.__mcpNew()" ${busy ? "disabled" : ""}>新增 MCP</button>
        <button class="btn" onclick="window.__mcpPreview()" ${busy ? "disabled" : ""}>生成配置片段</button>
        <button class="btn btn-primary" onclick="window.__mcpApply()" ${busy ? "disabled" : ""}>一键写入客户端配置</button>
      </div>
    </div>
  `;
}

function renderClientList(): string {
  const clients = state.data?.clients || [];
  const meta = state.data?.clientsMeta || [];
  const overrides = state.data?.config?.clientPaths || {};
  return clients.map((client) => {
    const info = meta.find((m) => m.id === client.client);
    const label = info?.label || clientLabel(client.client);
    const statusText = client.status === "ok"
      ? `${client.servers.length} 个`
      : client.status === "missing" ? "文件不存在" : "解析失败";
    const cls = client.status === "ok" ? "mcp-status-ok" : "mcp-status-warn";
    const names = client.servers.map((s) => s.name).join(", ");
    const isPathEdit = state.pathClient === client.client;
    return `
      <div class="mcp-client-card">
        <div class="mcp-client-head">
          <div class="mcp-client-name">${escapeHtml(label)}</div>
          <span class="${cls}">${statusText}</span>
        </div>
        <div class="mcp-client-path">
          <div class="mcp-muted">配置文件路径</div>
          <code class="path-pill">${escapeHtml(client.path)}</code>
          ${isPathEdit
            ? `<div class="mcp-path-edit">
                <input id="mcp-path-value" value="${escapeHtml(state.pathDraft)}" placeholder="留空使用默认路径" />
                <button class="btn" onclick="window.__mcpSavePath('${escapeHtml(client.client)}')" ${state.busy ? "disabled" : ""}>保存</button>
                <button class="btn" onclick="window.__mcpCancelPath()">取消</button>
              </div>`
            : `<button class="btn mcp-path-btn" onclick="window.__mcpEditPath('${escapeHtml(client.client)}')">自定义路径</button>`}
        </div>
        ${client.error ? `<div class="mcp-error">${escapeHtml(client.error)}</div>` : ""}
        ${names ? `<div class="mcp-client-servers">${escapeHtml(names)}</div>` : `<div class="mcp-muted">未发现 MCP 配置</div>`}
        ${overrides?.[client.client] ? `<div class="mcp-muted">已使用自定义路径</div>` : ""}
      </div>
    `;
  }).join("");
}

function renderServerCards(): string {
  const list = servers();
  if (!list.length) {
    return `<div class="mcp-empty">暂无网关托管 MCP。点击「新增 MCP」配置一个。</div>`;
  }
  return list.map((server) => {
    const active = server.name === state.selected ? " active" : "";
    const transport = server.transport === "stdio" ? "stdio" : "remote";
    const disabled = server.enabled === false ? " disabled" : "";
    return `
      <article class="mcp-card${active}${disabled}" onclick="window.__mcpSelect('${escapeHtml(server.name)}')">
        <div class="mcp-card-head">
          <div class="mcp-card-title">${escapeHtml(server.title || server.name)}</div>
          <span class="mcp-badge">${transport}</span>
        </div>
        <div class="mcp-card-desc">${escapeHtml(server.description || "")}</div>
        <div class="mcp-card-meta"><span>${server.enabled === false ? "已停用" : "启用"}</span></div>
      </article>
    `;
  }).join("");
}

function renderEditor(): string {
  const d = state.draft;
  const busy = state.busy === "save";
  return `
    <div class="mcp-editor">
      <h3>${state.selected ? "编辑" : "新增"} MCP</h3>
      <div class="mcp-form">
        <label>名称（英文标识）<input id="mcp-edit-name" value="${escapeHtml(d.name)}" ${state.selected ? "readonly" : ""} /></label>
        <label>标题<input id="mcp-edit-title" value="${escapeHtml(d.title)}" /></label>
        <label>说明<input id="mcp-edit-desc" value="${escapeHtml(d.description)}" /></label>
        <label>传输方式
          <select id="mcp-edit-transport" onchange="window.__mcpTransport(this.value)">
            <option value="stdio" ${d.transport === "stdio" ? "selected" : ""}>stdio（本机进程）</option>
            <option value="remote" ${d.transport === "remote" ? "selected" : ""}>remote（远程 URL）</option>
          </select>
        </label>
        ${d.transport === "stdio"
          ? `<label>命令<input id="mcp-edit-command" value="${escapeHtml(d.command)}" placeholder="npx 或绝对路径" /></label>
             <label>参数（JSON 数组）<input id="mcp-edit-args" value="${escapeHtml(d.args)}" placeholder='["-y","@scope/mcp"]' /></label>
             <label>环境变量（JSON 对象，可选）<input id="mcp-edit-env" value="${escapeHtml(d.env)}" placeholder='{"API_KEY":"..."}' /></label>`
          : `<label>URL<input id="mcp-edit-url" value="${escapeHtml(d.url)}" placeholder="https://…/mcp" /></label>
             <label>Headers（JSON 对象，可选）<input id="mcp-edit-headers" value="${escapeHtml(d.headers)}" placeholder='{"Authorization":"Bearer …"}' /></label>`}
        <div class="mcp-distribution">
          <div class="mcp-distribution-title">分发到客户端</div>
          <label><input type="checkbox" id="mcp-edit-codex" ${d.codex ? "checked" : ""} /> Codex</label>
          <label><input type="checkbox" id="mcp-edit-claude" ${d.claude ? "checked" : ""} /> Claude Desktop</label>
          <label><input type="checkbox" id="mcp-edit-antigravity" ${d.antigravity ? "checked" : ""} /> Antigravity</label>
          <label><input type="checkbox" id="mcp-edit-enabled" ${d.enabled ? "checked" : ""} /> 启用</label>
        </div>
        <div class="mcp-actions">
          <button class="btn btn-primary" onclick="window.__mcpSave()" ${busy ? "disabled" : ""}>${busy ? "保存中…" : "保存"}</button>
          <button class="btn" onclick="window.__mcpCancel()">取消</button>
        </div>
      </div>
    </div>
  `;
}

function renderDetail(): string {
  if (state.editing) return renderEditor();
  const server = selected();
  if (!server) return `<div class="mcp-empty">从左侧选择一个 MCP 查看详情。</div>`;
  const dist = server.distribution || {};
  const present = state.data?.presentIn?.[server.name] || {};
  const rows = ["codex", "claude", "antigravity"].map((id) => {
    const meta = state.data?.clientsMeta?.find((m) => m.id === id);
    const installed = Boolean(present[id]);
    const target = Boolean(dist[id]);
    const status = installed ? "已安装" : target ? "待分发" : "未分发";
    const cls = installed ? "mcp-status-ok" : target ? "mcp-status-warn" : "mcp-status-off";
    return `
      <div class="mcp-client-row">
        <div class="mcp-client-name">${escapeHtml(meta?.label || clientLabel(id))}</div>
        <span class="${cls}">${status}</span>
      </div>
    `;
  }).join("");
  return `
    <div class="mcp-detail">
      <div class="mcp-detail-head">
        <div>
          <h3>${escapeHtml(server.title || server.name)}</h3>
          <div class="mcp-muted">${escapeHtml(server.name)}</div>
        </div>
        <div class="mcp-actions">
          <button class="btn" onclick="window.__mcpEdit()">编辑</button>
          <button class="btn" onclick="window.__mcpDelete('${escapeHtml(server.name)}')">删除</button>
        </div>
      </div>
      <div class="mcp-detail-desc">${escapeHtml(server.description || "")}</div>
      <div class="mcp-detail-meta">
        <span class="mcp-badge">${server.transport === "stdio" ? "stdio" : "remote"}</span>
        <span>${server.enabled === false ? "已停用" : "启用"}</span>
      </div>
      <div class="mcp-detail-section">
        <div class="mcp-section-title">客户端状态</div>
        ${rows}
      </div>
      <div class="mcp-detail-hint">默认先「生成配置片段」查看；「一键写入」会先备份文件再修改。</div>
    </div>
  `;
}

function renderPreview(): string {
  if (!state.preview) return "";
  return `
    <div class="mcp-preview">
      <div class="mcp-preview-head">
        <div class="mcp-section-title">配置片段预览</div>
        <button class="btn" onclick="window.__mcpClosePreview()">关闭</button>
      </div>
      <pre>${escapeHtml(state.preview)}</pre>
    </div>
  `;
}

function renderConfirm(): string {
  const paths = state.data?.clientsMeta?.map((m) => m.path).filter(Boolean) || [];
  return `
    <div class="mcp-confirm">
      <div class="mcp-section-title">确认写入客户端配置</div>
      <p>将修改以下文件（写入前会自动创建 <code>.mcp-backup-&lt;timestamp&gt;</code> 备份）：</p>
      <ul>${paths.map((p) => `<li><code class="path-pill">${escapeHtml(p)}</code></li>`).join("")}</ul>
      <div class="mcp-actions">
        <button class="btn btn-primary" onclick="window.__mcpConfirmApply()">确认写入</button>
        <button class="btn" onclick="window.__mcpCancelApply()">取消</button>
      </div>
    </div>
  `;
}

function render(): void {
  const root = rootEl();
  if (!root) return;
  if (state.loading && !state.data) {
    root.innerHTML = `<div class="mcp-empty">正在加载 MCP 管理…</div>`;
    return;
  }
  if (state.confirming) {
    root.innerHTML = renderHeader() + renderConfirm();
    return;
  }
  root.innerHTML = `
    ${renderHeader()}
    ${state.error ? `<div class="mcp-error">${escapeHtml(state.error)}</div>` : ""}
    ${renderPreview()}
    <div class="mcp-layout">
      <div class="mcp-left">
        <div class="mcp-section-title">网关托管 MCP</div>
        ${renderServerCards()}
      </div>
      <div class="mcp-right">${renderDetail()}</div>
    </div>
    <div class="mcp-section">
      <div class="mcp-section-title">客户端扫描结果</div>
      <div class="mcp-clients">${renderClientList()}</div>
    </div>
  `;
}

async function load(): Promise<void> {
  state.loading = true;
  state.error = "";
  render();
  try {
    state.data = await api<McpState>("/v1/mcp-management/state");
    const list = servers();
    if (!state.data.config.servers?.[state.selected]) {
      state.selected = list[0]?.name || "";
    }
  } catch (error) {
    state.error = (error as Error)?.message || String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function rescan(): Promise<void> {
  if (state.busy) return;
  state.busy = "scan";
  state.error = "";
  render();
  try {
    const data = await api<McpState>("/v1/mcp-management/scan");
    state.data = { ...(state.data || {}), ...data } as McpState;
    showToast("已重新扫描客户端 MCP", "success");
  } catch (error) {
    state.error = (error as Error)?.message || String(error);
  } finally {
    state.busy = "";
    render();
  }
}

function select(name: string): void {
  state.selected = name;
  state.editing = false;
  state.preview = "";
  render();
}

function newServer(): void {
  state.selected = "";
  state.editing = true;
  state.draft = {
    name: "",
    title: "",
    description: "",
    transport: "stdio",
    command: "",
    args: "",
    url: "",
    env: "",
    headers: "",
    enabled: true,
    codex: false,
    claude: false,
    antigravity: false,
  };
  state.pathClient = "";
  render();
}

function edit(): void {
  const server = selected();
  if (!server) return;
  state.editing = true;
  state.draft = {
    name: server.name,
    title: server.title || "",
    description: server.description || "",
    transport: server.transport === "stdio" ? "stdio" : "remote",
    command: server.command || "",
    args: JSON.stringify(server.args || []),
    url: server.url || "",
    env: "",
    headers: "",
    enabled: server.enabled !== false,
    codex: Boolean(server.distribution?.codex),
    claude: Boolean(server.distribution?.claude),
    antigravity: Boolean(server.distribution?.antigravity),
  };
  state.pathClient = "";
  render();
}

function cancel(): void {
  state.editing = false;
  render();
}

function transport(value: string): void {
  state.draft.transport = value === "remote" ? "remote" : "stdio";
  render();
}

function parseJsonObject(text: string, label: string): Record<string, string> | null {
  const s = (text || "").trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  } catch {
    showToast(label + " 必须是 JSON 对象", "error");
    return null;
  }
}

function collect(): (McpServer & { env?: Record<string, string>; headers?: Record<string, string> }) | null {
  const name = (document.getElementById("mcp-edit-name") as HTMLInputElement | null)?.value?.trim() || "";
  const title = (document.getElementById("mcp-edit-title") as HTMLInputElement | null)?.value?.trim() || "";
  const description = (document.getElementById("mcp-edit-desc") as HTMLInputElement | null)?.value?.trim() || "";
  const transportVal = (document.getElementById("mcp-edit-transport") as HTMLSelectElement | null)?.value === "remote" ? "remote" : "stdio";
  const command = (document.getElementById("mcp-edit-command") as HTMLInputElement | null)?.value?.trim() || "";
  const argsText = (document.getElementById("mcp-edit-args") as HTMLInputElement | null)?.value?.trim() || "[]";
  const url = (document.getElementById("mcp-edit-url") as HTMLInputElement | null)?.value?.trim() || "";
  const envText = (document.getElementById("mcp-edit-env") as HTMLInputElement | null)?.value?.trim() || "";
  const headersText = (document.getElementById("mcp-edit-headers") as HTMLInputElement | null)?.value?.trim() || "";
  const codex = (document.getElementById("mcp-edit-codex") as HTMLInputElement | null)?.checked || false;
  const claude = (document.getElementById("mcp-edit-claude") as HTMLInputElement | null)?.checked || false;
  const antigravity = (document.getElementById("mcp-edit-antigravity") as HTMLInputElement | null)?.checked || false;
  const enabled = (document.getElementById("mcp-edit-enabled") as HTMLInputElement | null)?.checked || false;

  if (!name) {
    showToast("请填写 MCP 名称", "error");
    return null;
  }
  let args: string[] = [];
  try {
    const parsed = JSON.parse(argsText || "[]");
    if (!Array.isArray(parsed)) throw new Error("not array");
    args = parsed.map(String);
  } catch {
    showToast("参数必须是 JSON 数组", "error");
    return null;
  }
  if (transportVal === "stdio" && !command) {
    showToast("stdio 传输必须填写命令", "error");
    return null;
  }
  if (transportVal === "remote" && !url) {
    showToast("remote 传输必须填写 URL", "error");
    return null;
  }
  const env = parseJsonObject(envText, "环境变量");
  if (envText && env === null) return null;
  const headers = parseJsonObject(headersText, "Headers");
  if (headersText && headers === null) return null;
  const payload: McpServer & { env?: Record<string, string>; headers?: Record<string, string> } = {
    name,
    title: title || name,
    description,
    transport: transportVal,
    command,
    args,
    url,
    enabled,
    distribution: { codex, claude, antigravity },
  };
  if (env) payload.env = env;
  if (headers) payload.headers = headers;
  return payload;
}

async function save(): Promise<void> {
  const server = collect();
  if (!server) return;
  if (state.busy) return;
  state.busy = "save";
  state.error = "";
  try {
    state.data = await api<McpState>("/v1/mcp-management/servers", {
      method: "POST",
      body: JSON.stringify(server),
    });
    state.selected = server.name;
    state.editing = false;
    showToast("MCP 已保存", "success");
  } catch (error) {
    state.error = (error as Error)?.message || String(error);
  } finally {
    state.busy = "";
    render();
  }
}

async function remove(name: string): Promise<void> {
  if (!window.confirm(`确定删除 MCP ${name}？`)) return;
  if (state.busy) return;
  state.busy = "save";
  try {
    state.data = await api<McpState>(`/v1/mcp-management/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (state.selected === name) state.selected = "";
    showToast("MCP 已删除", "success");
  } catch (error) {
    state.error = (error as Error)?.message || String(error);
  } finally {
    state.busy = "";
    render();
  }
}

async function preview(): Promise<void> {
  if (state.busy) return;
  state.busy = "preview";
  state.error = "";
  try {
    const data = await api<{ previews: Array<{ client: string; path: string; text: string | null; hint: string | null; servers: string[] }> }>(
      "/v1/mcp-management/preview",
      { method: "POST", body: JSON.stringify({ targets: { codex: true, claude: true, antigravity: true } }) },
    );
    const parts = data.previews
      .filter((p) => p.text)
      .map((p) => `# ${p.client}\n文件：${p.path}\n提示：${p.hint || ""}\n\n${p.text}`);
    state.preview = parts.join("\n\n") || "没有可预览的分发内容。";
    showToast("已生成配置片段", "success");
  } catch (error) {
    state.error = (error as Error)?.message || String(error);
  } finally {
    state.busy = "";
    render();
  }
}

function requestApply(): void {
  state.confirming = true;
  state.preview = "";
  render();
}

function cancelApply(): void {
  state.confirming = false;
  render();
}

async function confirmApply(): Promise<void> {
  if (state.busy) return;
  state.busy = "apply";
  state.error = "";
  try {
    const data = await api<{ changed: string[]; backups: string[] }>(
      "/v1/mcp-management/apply",
      { method: "POST", body: JSON.stringify({ targets: { codex: true, claude: true, antigravity: true } }) },
    );
    state.confirming = false;
    showToast(`已写入 ${data.changed?.length || 0} 个文件`, "success");
    await load();
  } catch (error) {
    state.error = (error as Error)?.message || String(error);
    state.confirming = false;
  } finally {
    state.busy = "";
    render();
  }
}

function closePreview(): void {
  state.preview = "";
  render();
}

function editPath(client: string): void {
  state.pathClient = client;
  state.pathDraft = state.data?.config?.clientPaths?.[client] || "";
  render();
}

function cancelPath(): void {
  state.pathClient = "";
  state.pathDraft = "";
  render();
}

async function savePath(client: string): Promise<void> {
  if (state.busy) return;
  state.busy = "path";
  state.error = "";
  try {
    state.data = await api<McpState>("/v1/mcp-management/client-path", {
      method: "PUT",
      body: JSON.stringify({ client, path: (document.getElementById("mcp-path-value") as HTMLInputElement | null)?.value?.trim() || "" }),
    });
    state.pathClient = "";
    state.pathDraft = "";
    showToast("客户端配置路径已保存", "success");
  } catch (error) {
    state.error = (error as Error)?.message || String(error);
  } finally {
    state.busy = "";
    render();
  }
}

(window as unknown as Record<string, unknown>).__mcpRescan = () => { void rescan(); };
(window as unknown as Record<string, unknown>).__mcpNew = newServer;
(window as unknown as Record<string, unknown>).__mcpSelect = select;
(window as unknown as Record<string, unknown>).__mcpEdit = edit;
(window as unknown as Record<string, unknown>).__mcpCancel = cancel;
(window as unknown as Record<string, unknown>).__mcpTransport = transport;
(window as unknown as Record<string, unknown>).__mcpSave = () => { void save(); };
(window as unknown as Record<string, unknown>).__mcpDelete = (name: string) => { void remove(name); };
(window as unknown as Record<string, unknown>).__mcpPreview = () => { void preview(); };
(window as unknown as Record<string, unknown>).__mcpApply = requestApply;
(window as unknown as Record<string, unknown>).__mcpConfirmApply = () => { void confirmApply(); };
(window as unknown as Record<string, unknown>).__mcpCancelApply = cancelApply;
(window as unknown as Record<string, unknown>).__mcpClosePreview = closePreview;
(window as unknown as Record<string, unknown>).__mcpEditPath = editPath;
(window as unknown as Record<string, unknown>).__mcpCancelPath = cancelPath;
(window as unknown as Record<string, unknown>).__mcpSavePath = (client: string) => { void savePath(client); };

registerTab("mcp-management", {
  onEnter: () => { void load(); },
});
