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
  distribution?: Record<string, boolean>;
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

type InRepoMcp = {
  name: string;
  lang: "node" | "python" | "java" | "go" | "custom";
  title: string;
  description: string;
  command: string;
  args: string[];
  transport: "stdio" | "remote";
  path: string;
  sampleEnv?: KeyValPair[];
};

type RunningInspector = {
  serverName: string;
  port: number;
  url: string;
  startedAt: number;
};

type McpState = {
  config: {
    servers?: Record<string, McpServer>;
    clientPaths?: Record<string, string>;
  };
  paths?: Record<string, string>;
  clients?: ClientScan[];
  presentIn?: Record<string, Record<string, boolean>>;
  inRepoMcps?: InRepoMcp[];
  runningInspectors?: RunningInspector[];
  clientsMeta?: ClientMeta[];
};

type KeyValPair = { key: string; value: string };

const state = {
  loading: false,
  error: "",
  data: null as McpState | null,
  selected: "",
  editing: false,
  preview: "",
  previewServerName: "",
  previewServerFilter: "",
  previewClientTab: "all",
  previewViewMode: "snippet" as "snippet" | "full",
  previewItems: [] as Array<{ client: string; path: string; text: string | null; snippet: string | null; hint: string | null; servers: string[] }>,
  confirming: false,
  confirmServerName: "",
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
    argsList: [] as string[],
    url: "",
    env: "",
    envList: [] as KeyValPair[],
    headers: "",
    headersList: [] as KeyValPair[],
    enabled: true,
    codex: false,
    claude: false,
    claude_code: false,
    antigravity: false,
    distribution: {} as Record<string, boolean>,
  },
};

type McpTemplate = {
  id: string;
  name: string;
  category: "in_repo" | "community" | "remote" | "custom";
  title: string;
  description: string;
  icon: string;
  transport: "stdio" | "remote";
  command: string;
  argsList: string[];
  url?: string;
  envList?: KeyValPair[];
  headersList?: KeyValPair[];
};

const MCP_TEMPLATES: McpTemplate[] = [
  {
    id: "custom",
    name: "my-custom-mcp",
    category: "custom",
    title: "空白自定义 (Custom)",
    description: "从零手动配置启动命令、参数与环境变量",
    icon: "⚙️",
    transport: "stdio",
    command: "",
    argsList: [],
  },
  {
    id: "in_repo_database_hub",
    name: "database-hub",
    category: "in_repo",
    title: "🗄️ 多数据库大模型管理 (MySQL / Redis / SQLite)",
    description: "自研多数据库 MCP，支持环境变量配置多个数据库连接并提供 NL2SQL 与表结构管理能力",
    icon: "🗄️",
    transport: "stdio",
    command: "node",
    argsList: ["./mcps/database-hub/index.mjs"],
    envList: [
      { key: "order_center", value: "mysql://root:123456@127.0.0.1:3306/orders_db" },
      { key: "cache_redis", value: "redis://:auth123@127.0.0.1:6379/0" },
      { key: "local_sqlite", value: "sqlite:///d:/data/app.db" },
    ],
  },
  {
    id: "in_repo_node",
    name: "node_custom_tool",
    category: "in_repo",
    title: "自研 Node.js MCP (项目源码 mcps/)",
    description: "使用 Node 独立运行当前代码库 mcps/ 目录下的 JS/TS 脚本",
    icon: "🟢",
    transport: "stdio",
    command: "node",
    argsList: ["./mcps/node-tool/index.mjs"],
  },
  {
    id: "in_repo_python",
    name: "py_fastmcp_tool",
    category: "in_repo",
    title: "自研 Python FastMCP (项目源码 mcps/)",
    description: "使用 uv 自动隔离虚拟环境并运行 mcps/ 目录下的 server.py",
    icon: "🐍",
    transport: "stdio",
    command: "uv",
    argsList: ["run", "--directory", "./mcps/py-tool", "server.py"],
  },
  {
    id: "in_repo_java",
    name: "java_custom_tool",
    category: "in_repo",
    title: "自研 Java MCP (项目源码 mcps/)",
    description: "使用 JVM 独立运行 mcps/ 目录下的 Fat-JAR 包",
    icon: "☕",
    transport: "stdio",
    command: "java",
    argsList: ["-jar", "./mcps/java-tool/target/app.jar"],
  },
  {
    id: "in_repo_go",
    name: "go_custom_tool",
    category: "in_repo",
    title: "自研 Go MCP (项目源码 mcps/)",
    description: "使用 go run 独立运行当前代码库 mcps/ 目录下的 Go 源码服务",
    icon: "🦫",
    transport: "stdio",
    command: "go",
    argsList: ["run", "./mcps/go-tool/main.go"],
  },
  {
    id: "npx_filesystem",
    name: "filesystem",
    category: "community",
    title: "NPM 官方文件系统 (@modelcontextprotocol/server-filesystem)",
    description: "提供指定目录的本地文件读写与浏览能力",
    icon: "📁",
    transport: "stdio",
    command: "npx",
    argsList: ["-y", "@modelcontextprotocol/server-filesystem", "./"],
  },
  {
    id: "npx_fetch",
    name: "fetch",
    category: "community",
    title: "Python 官方网页抓取 (uvx mcp-server-fetch)",
    description: "提供 HTML 转 Markdown 与网页内容抓取能力",
    icon: "🌐",
    transport: "stdio",
    command: "uvx",
    argsList: ["mcp-server-fetch"],
  },
  {
    id: "remote_stream",
    name: "remote_stream_api",
    category: "remote",
    title: "远程 HTTP / SSE 流式服务 (Remote Stream)",
    description: "连接远程服务器或云端托管的 MCP 接口（支持 URL 变量占位符与 Headers 认证）",
    icon: "☁️",
    transport: "remote",
    command: "",
    argsList: [],
    url: "https://mcp.example.com/sse?api_key=${MY_API_KEY}",
    envList: [{ key: "MY_API_KEY", value: "" }],
  },
];

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

function isInspectorRunning(serverName: string): boolean {
  return Boolean(state.data?.runningInspectors?.some((i) => i.serverName === serverName));
}

function runningInspectorUrl(serverName: string): string {
  const inspector = state.data?.runningInspectors?.find((i) => i.serverName === serverName);
  if (inspector?.url && /^https?:\/\/127\.0\.0\.1:\d+\/$/.test(inspector.url)) return inspector.url;
  if (inspector?.port) return `http://127.0.0.1:${inspector.port}/`;
  return "";
}

function clientDisplayName(id: string): string {
  const w = window as any;
  if (typeof w.__clientDisplayName === "function") {
    const custom = w.__clientDisplayName(id);
    if (custom && custom !== id) return custom;
  }
  if (id === "codex") return "OpenAI Codex";
  if (id === "claude") return "Claude Desktop";
  if (id === "claude_code") return "Claude Code";
  if (id === "antigravity") return "Google Antigravity";
  const meta = state.data?.clientsMeta || [];
  const info = meta.find((m) => m.id === id);
  if (info?.label && info.label !== id) return info.label;
  if (typeof w.__clientDisplayName === "function") {
    const custom = w.__clientDisplayName(id);
    if (custom) return custom;
  }
  return id;
}

function clientLabel(id: string): string {
  return clientDisplayName(id);
}

function clientIcon(id: string): string {
  if (id === "codex") return "🟢";
  if (id === "claude") return "🟠";
  if (id === "claude_code") return "🟣";
  if (id === "antigravity") return "🔵";
  return "⚪";
}

function renderHeader(): string {
  const busy = Boolean(state.busy);
  const hasServers = servers().length > 0;
  return `
    <div class="mcp-header">
      <div>
        <h2>MCP 枢纽 (MCP Hub)</h2>
        <p>集中配置与自研开发本地及远程 MCP 服务，并一键分发同步至 Codex / Claude Desktop / Claude Code / Antigravity 客户端。</p>
      </div>
      <div class="mcp-actions">
        <button class="btn" onclick="window.__mcpRescan()" ${busy ? "disabled" : ""} title="重新扫描本机各客户端实际已配置的 MCP">
          <span class="mcp-btn-icon-text">🔄</span> 重新扫描
        </button>
        <button class="btn btn-primary" onclick="window.__mcpNew()" ${busy ? "disabled" : ""}>
          <span>+ 新增 MCP</span>
        </button>
        <button class="btn" onclick="window.__mcpPreview()" ${busy || !hasServers ? "disabled" : ""} title="预览合并后的完整客户端配置文本（不修改任何文件）">
          生成配置片段
        </button>
        <button class="btn btn-apply" onclick="window.__mcpApply()" ${busy || !hasServers ? "disabled" : ""} title="自动创建备份并将所有已启用的 MCP 批量原子写入各客户端配置文件">
          一键写入客户端
        </button>
      </div>
    </div>
  `;
}

function renderClientList(): string {
  const clients = state.data?.clients || [];
  const meta = state.data?.clientsMeta || [];
  const overrides = state.data?.config?.clientPaths || {};
  const managedServers = state.data?.config?.servers || {};

  return clients.map((client) => {
    const label = clientDisplayName(client.client);
    const statusText = client.status === "ok"
      ? `${client.servers.length} 个已安装`
      : client.status === "missing" ? "配置文件未创建" : "配置文件解析失败";
    const cls = client.status === "ok" ? "mcp-status-ok" : "mcp-status-warn";
    const isPathEdit = state.pathClient === client.client;

    const serverItems = client.servers.map((s) => {
      const isManaged = Boolean(managedServers[s.name]);
      const isDebugging = isInspectorRunning(s.name);
      return `
        <div class="mcp-detected-item">
          <div class="mcp-detected-name-row">
            <code class="mcp-detected-name">${escapeHtml(s.name)}</code>
            <div style="display: flex; gap: 4px; align-items: center;">
              ${isDebugging
                ? `<button type="button" class="btn btn-xs" style="border: 1px solid #22c55e; color: #22c55e;" onclick="window.__mcpOpenInspector('${escapeHtml(s.name)}')" title="打开 Inspector 调试控制台">🌐 调试中</button>`
                : `<button type="button" class="btn btn-xs" onclick="window.__mcpStartInspector('${escapeHtml(s.name)}')" title="在 Inspector 中调试「${escapeHtml(s.name)}」">🔍 调试</button>`
              }
              ${isManaged
                ? `<span class="mcp-tag-managed" title="该 MCP 已在网关集中托管">✅ 已托管</span>`
                : `<button type="button" class="btn btn-xs btn-import" onclick="window.__mcpImportServer('${escapeHtml(client.client)}', '${escapeHtml(s.name)}')" title="将「${escapeHtml(s.name)}」导入为网关托管 MCP，方便统一管理和跨客户端分发">📥 导入托管</button>`
              }
            </div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="mcp-client-card" data-client="${escapeHtml(client.client)}">
        <div class="mcp-client-head">
          <div class="mcp-client-title-row">
            <span class="mcp-client-icon">${clientIcon(client.client)}</span>
            <div class="mcp-client-name">${escapeHtml(label)}</div>
          </div>
          <span class="mcp-badge ${cls}">${statusText}</span>
        </div>
        <div class="mcp-client-path">
          <div class="mcp-field-label">配置文件绝对路径</div>
          <code class="path-pill">${escapeHtml(client.path)}</code>
          ${isPathEdit
            ? `<div class="mcp-path-edit">
                <input id="mcp-path-value" value="${escapeHtml(state.pathDraft)}" placeholder="留空使用默认路径" />
                <button class="btn btn-primary" onclick="window.__mcpSavePath('${escapeHtml(client.client)}')" ${state.busy ? "disabled" : ""}>保存路径</button>
                <button class="btn" onclick="window.__mcpCancelPath()">取消</button>
              </div>`
            : `<div class="mcp-path-actions">
                <button class="btn btn-sm mcp-path-btn" onclick="window.__mcpEditPath('${escapeHtml(client.client)}')">自定义路径</button>
                ${overrides?.[client.client] ? `<span class="mcp-tag-custom">已自定义</span>` : ""}
               </div>`}
        </div>
        ${client.error ? `<div class="mcp-error">${escapeHtml(client.error)}</div>` : ""}
        <div class="mcp-client-servers-box">
          <div class="mcp-field-label">已检测到的本地 MCP (${client.servers.length})</div>
          ${client.servers.length > 0
            ? `<div class="mcp-client-server-pills">${serverItems}</div>`
            : `<div class="mcp-muted">未发现任何本地配置的 MCP</div>`
          }
        </div>
      </div>
    `;
  }).join("");
}

function renderServerCards(): string {
  const configuredServers = state.data?.config?.servers || {};
  const inRepoList = state.data?.inRepoMcps || [];

  const inRepoNames = new Set(inRepoList.map((m) => m.name));
  const thirdPartyServers = Object.values(configuredServers).filter((s) => !inRepoNames.has(s.name));

  if (!inRepoList.length && !thirdPartyServers.length) {
    return `
      <div class="mcp-empty-card">
        <div class="mcp-empty-icon">📦</div>
        <div class="mcp-empty-title">暂无网关托管的 MCP</div>
        <div class="mcp-muted">在 <code>mcps/</code> 目录下编写自研源码，或点击右上角「+ 新增 MCP」创建配置。</div>
      </div>
    `;
  }

  let html = "";

  // 1. 本地自研 MCP 模块 (源码位于 mcps/)
  if (inRepoList.length > 0) {
    html += `
      <div class="mcp-section-label-row">
        <span class="mcp-section-label">🚀 本地自研 MCP (源码目录 mcps/)</span>
        <span class="mcp-badge-counter">${inRepoList.length}</span>
      </div>
    `;
    html += inRepoList.map((item) => {
      const configured = configuredServers[item.name];
      const active = ((item.name === state.selected && !state.editing) || (state.editing && state.draft.name === item.name)) ? " active" : "";
      const langIcon = item.lang === "python" ? "🐍" : item.lang === "node" ? "🟢" : item.lang === "java" ? "☕" : "⚡";
      const langText = item.lang === "python" ? "Python FastMCP" : item.lang === "node" ? "Node.js" : item.lang === "java" ? "Java" : "自研";

      if (configured) {
        const disabled = configured.enabled === false ? " disabled" : "";
        const isDebugging = isInspectorRunning(item.name);
        const debugTag = isDebugging ? `<span class="mcp-badge" style="background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.4); cursor: pointer;" onclick="event.stopPropagation(); window.__mcpOpenInspector('${escapeHtml(item.name)}')" title="点击打开 Inspector 调试控制台">⚡ 调试中</span>` : "";
        const dist = configured.distribution || {};
        const clientEntries = Object.entries(dist)
          .filter(([, v]) => Boolean(v))
          .map(([k]) => clientDisplayName(k));
        const clients = clientEntries.join(" · ");

        return `
          <article class="mcp-card${active}${disabled}" onclick="window.__mcpSelect('${escapeHtml(item.name)}')">
            <div class="mcp-card-head">
              <div class="mcp-card-title">${langIcon} ${escapeHtml(configured.title || item.name)}</div>
              <div style="display: flex; gap: 4px; align-items: center;">
                ${debugTag}
                <span class="mcp-badge mcp-badge-inrepo">${langText}</span>
              </div>
            </div>
            <div class="mcp-card-desc">${escapeHtml(configured.description || item.description)}</div>
            <div class="mcp-card-meta">
              <span class="mcp-card-status">${configured.enabled === false ? "<span class='dot-off'></span> 已停用" : "<span class='dot-on'></span> 已启用"}</span>
              <span class="mcp-card-dist">${clients ? `分发: ${escapeHtml(clients)}` : "未配置分发"}</span>
            </div>
          </article>
        `;
      }

      const isDebugging = isInspectorRunning(item.name);
      const debugTag = isDebugging ? `<span class="mcp-badge" style="background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.4); cursor: pointer;" onclick="event.stopPropagation(); window.__mcpOpenInspector('${escapeHtml(item.name)}')" title="点击打开 Inspector 调试控制台">⚡ 调试中</span>` : "";

      return `
        <article class="mcp-card mcp-card-unconfigured${active}" onclick="window.__mcpApplyInRepo('${escapeHtml(item.name)}')" title="点击一键配置分发客户端">
          <div class="mcp-card-head">
            <div class="mcp-card-title">${langIcon} ${escapeHtml(item.name)}</div>
            <div style="display: flex; gap: 4px; align-items: center;">
              ${debugTag}
              <span class="mcp-badge mcp-badge-inrepo">${langText}</span>
            </div>
          </div>
          <div class="mcp-card-desc">源码路径：<code>${escapeHtml(item.path)}</code></div>
          <div class="mcp-card-meta">
            <span class="mcp-card-status"><span class="dot-warn"></span> 源码已就绪</span>
            <span class="mcp-card-dist mcp-dist-prompt">👉 点击配置分发</span>
          </div>
        </article>
      `;
    }).join("");
  }

  // 2. 第三方与远程 MCP 模块
  if (thirdPartyServers.length > 0) {
    html += `
      <div class="mcp-section-label-row" style="${inRepoList.length > 0 ? "margin-top: 18px;" : ""}">
        <span class="mcp-section-label">📦 第三方与远程 MCP</span>
        <span class="mcp-badge-counter">${thirdPartyServers.length}</span>
      </div>
    `;
    html += thirdPartyServers.map((server) => {
      const active = ((server.name === state.selected && !state.editing) || (state.editing && state.draft.name === server.name)) ? " active" : "";
      const transport = server.transport === "stdio" ? "STDIO" : "HTTP";
      const disabled = server.enabled === false ? " disabled" : "";
      const isDebugging = isInspectorRunning(server.name);
      const debugTag = isDebugging ? `<span class="mcp-badge" style="background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.4); cursor: pointer;" onclick="event.stopPropagation(); window.__mcpOpenInspector('${escapeHtml(server.name)}')" title="点击打开 Inspector 调试控制台">⚡ 调试中</span>` : "";
      const dist = server.distribution || {};
      const clientEntries = Object.entries(dist)
        .filter(([, v]) => Boolean(v))
        .map(([k]) => clientDisplayName(k));
      const clients = clientEntries.join(" · ");

      return `
        <article class="mcp-card${active}${disabled}" onclick="window.__mcpSelect('${escapeHtml(server.name)}')">
          <div class="mcp-card-head">
            <div class="mcp-card-title">${escapeHtml(server.title || server.name)}</div>
            <div style="display: flex; gap: 4px; align-items: center;">
              ${debugTag}
              <span class="mcp-badge mcp-badge-${server.transport || "stdio"}">${transport}</span>
            </div>
          </div>
          ${server.description ? `<div class="mcp-card-desc">${escapeHtml(server.description)}</div>` : ""}
          <div class="mcp-card-meta">
            <span class="mcp-card-status">${server.enabled === false ? "<span class='dot-off'></span> 已停用" : "<span class='dot-on'></span> 已启用"}</span>
            <span class="mcp-card-dist">${clients ? `分发: ${escapeHtml(clients)}` : "未配置分发"}</span>
          </div>
        </article>
      `;
    }).join("");
  }

  return html;
}

function renderEditor(): string {
  const d = state.draft;
  const busy = state.busy === "save";
  const isStdio = d.transport === "stdio";

  return `
    <div class="mcp-editor">
      <div class="mcp-editor-head">
        <div>
          <h3>${state.selected ? "编辑 MCP 配置" : "连接至自定义 MCP"}</h3>
          <p class="mcp-muted">配置 MCP 服务的启动方式与目标客户端，网关将自动完成各客户端配置的适配与注入。</p>
        </div>
        <div class="mcp-segmented">
          <button type="button" class="mcp-seg-btn ${isStdio ? "active" : ""}" onclick="window.__mcpSetTransport('stdio')">
            STDIO
          </button>
          <button type="button" class="mcp-seg-btn ${!isStdio ? "active" : ""}" onclick="window.__mcpSetTransport('remote')">
            流式 HTTP
          </button>
        </div>
      </div>

      <div class="mcp-form">
        <div class="mcp-form-group">
          <label class="mcp-form-label" for="mcp-edit-name">名称 (MCP server name) <span class="req">*</span></label>
          <input id="mcp-edit-name" class="mcp-input" value="${escapeHtml(d.name)}" placeholder="例如：sqlite、filesystem、github" ${state.selected ? "readonly" : ""} />
        </div>

        <div class="mcp-form-row-2">
          <div class="mcp-form-group">
            <label class="mcp-form-label" for="mcp-edit-title">显示标题 (可选)</label>
            <input id="mcp-edit-title" class="mcp-input" value="${escapeHtml(d.title)}" placeholder="例如：本地 SQLite 数据库" />
          </div>
          <div class="mcp-form-group">
            <label class="mcp-form-label" for="mcp-edit-desc">功能说明 (可选)</label>
            <input id="mcp-edit-desc" class="mcp-input" value="${escapeHtml(d.description)}" placeholder="简要描述该 MCP 提供的工具功能" />
          </div>
        </div>

        ${isStdio ? `
          <!-- STDIO Form -->
          <div class="mcp-form-group">
            <label class="mcp-form-label" for="mcp-edit-command">启动命令 (Command) <span class="req">*</span></label>
            <input id="mcp-edit-command" class="mcp-input" value="${escapeHtml(d.command)}" placeholder="例如：openai-dev-mcp serve-sqlite 或 npx、node、python" />
          </div>

          <!-- Dynamic Arguments List -->
          <div class="mcp-dynamic-section">
            <div class="mcp-dynamic-head">
              <label class="mcp-form-label">参数 (Arguments)</label>
              <span class="mcp-subhint">按顺序执行的命令行参数</span>
            </div>
            <div class="mcp-dynamic-list" id="mcp-args-container">
              ${d.argsList.map((arg, idx) => `
                <div class="mcp-dynamic-row">
                  <input class="mcp-input mcp-arg-input" data-idx="${idx}" value="${escapeHtml(arg)}" placeholder="参数项 (如 -y 或 @modelcontextprotocol/server-filesystem)" />
                  <button type="button" class="mcp-btn-del" onclick="window.__mcpRemoveArg(${idx})" title="删除此参数">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
              `).join("")}
            </div>
            <button type="button" class="btn mcp-btn-add" onclick="window.__mcpAddArg()">+ 添加参数</button>
          </div>

          <!-- Dynamic Environment Variables List -->
          <div class="mcp-dynamic-section">
            <div class="mcp-dynamic-head">
              <label class="mcp-form-label">环境变量 (Environment Variables)</label>
              <span class="mcp-subhint">传递给子进程的 Key-Value 变量</span>
            </div>
            <div class="mcp-dynamic-list" id="mcp-env-container">
              ${d.envList.map((item, idx) => `
                <div class="mcp-dynamic-row mcp-kv-row">
                  <input class="mcp-input mcp-env-key" data-idx="${idx}" value="${escapeHtml(item.key)}" placeholder="键 (如 GITHUB_TOKEN)" />
                  <input class="mcp-input mcp-env-val" data-idx="${idx}" value="${escapeHtml(item.value)}" placeholder="值 (如 ghp_...)" />
                  <button type="button" class="mcp-btn-del" onclick="window.__mcpRemoveEnv(${idx})" title="删除环境变量">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
              `).join("")}
            </div>
            <button type="button" class="btn mcp-btn-add" onclick="window.__mcpAddEnv()">+ 添加环境变量</button>
          </div>
        ` : `
          <!-- HTTP Form -->
          <div class="mcp-form-group">
            <div class="mcp-dynamic-head">
              <label class="mcp-form-label" for="mcp-edit-url">URL <span class="req">*</span></label>
              <span class="mcp-subhint">支持使用 <code>\${KEY}</code> 占位符引用私密变量（避免将明文密钥推送到远程）</span>
            </div>
            <input id="mcp-edit-url" class="mcp-input" value="${escapeHtml(d.url)}" placeholder="例如：https://mcp.example.com/sse?api_key=\${MY_API_KEY}" />
          </div>

          <!-- Dynamic Variables List for URL interpolation & secrets -->
          <div class="mcp-dynamic-section">
            <div class="mcp-dynamic-head">
              <label class="mcp-form-label">私密变量与密钥 (URL Variables / Secrets)</label>
              <span class="mcp-subhint">保存在本地 mcp.secrets.json，用于在写入客户端时自动替换 URL 中的 \${KEY} 占位符</span>
            </div>
            <div class="mcp-dynamic-list" id="mcp-env-container">
              ${d.envList.map((item, idx) => `
                <div class="mcp-dynamic-row mcp-kv-row">
                  <input class="mcp-input mcp-env-key" data-idx="${idx}" value="${escapeHtml(item.key)}" placeholder="变量名 (如 MY_API_KEY)" />
                  <input class="mcp-input mcp-env-val" data-idx="${idx}" value="${escapeHtml(item.value)}" placeholder="私密值 (如 sk-...)" />
                  <button type="button" class="mcp-btn-del" onclick="window.__mcpRemoveEnv(${idx})" title="删除私密变量">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
              `).join("")}
            </div>
            <button type="button" class="btn mcp-btn-add" onclick="window.__mcpAddEnv()">+ 添加私密变量</button>
          </div>

          <!-- Dynamic Headers List -->
          <div class="mcp-dynamic-section">
            <div class="mcp-dynamic-head">
              <label class="mcp-form-label">标头 (Headers)</label>
              <span class="mcp-subhint">附加在 HTTP 请求中的自定义 Header 键值对（保存在本地 mcp.secrets.json）</span>
            </div>
            <div class="mcp-dynamic-list" id="mcp-headers-container">
              ${d.headersList.map((item, idx) => `
                <div class="mcp-dynamic-row mcp-kv-row">
                  <input class="mcp-input mcp-header-key" data-idx="${idx}" value="${escapeHtml(item.key)}" placeholder="标头名称 (如 Authorization 或 X-Api-Key)" />
                  <input class="mcp-input mcp-header-val" data-idx="${idx}" value="${escapeHtml(item.value)}" placeholder="标头值 (如 Bearer token...)" />
                  <button type="button" class="mcp-btn-del" onclick="window.__mcpRemoveHeader(${idx})" title="删除标头">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
              `).join("")}
            </div>
            <button type="button" class="btn mcp-btn-add" onclick="window.__mcpAddHeader()">+ 添加标头</button>
          </div>
        `}

        <!-- Modern Sliding Switches for Client Distribution & Activation -->
        <div class="mcp-form-group">
          <label class="mcp-form-label">服务状态与客户端分发</label>
          <div class="mcp-toggles-grid">
            <label class="mcp-toggle-card">
              <div class="mcp-toggle-label">
                <span class="mcp-toggle-title">启用此 MCP</span>
                <span class="mcp-toggle-desc">总开关，停用后不会写入任何客户端</span>
              </div>
              <input type="checkbox" id="mcp-edit-enabled" class="mcp-toggle-input" ${d.enabled ? "checked" : ""} onchange="window.__mcpToggleDraft('enabled', this.checked)" />
              <span class="mcp-toggle-track"><span class="mcp-toggle-thumb"></span></span>
            </label>

            ${(() => {
              const metaList = state.data?.clientsMeta || [];
              const clientScans = state.data?.clients || [];
              const clientIds = Array.from(new Set([
                "codex", "claude", "claude_code", "antigravity",
                ...metaList.map((m) => m.id),
                ...clientScans.map((c) => c.client),
              ]));
              return clientIds.map((cid) => {
                const meta = metaList.find((m) => m.id === cid);
                const label = meta?.label || clientDisplayName(cid);
                const isChecked = Boolean(d.distribution?.[cid] ?? (d as Record<string, any>)[cid]);
                const pathDesc = meta?.path ? `写入 ${escapeHtml(meta.path)}` : cid === "codex" ? "写入 ~/.codex/config.toml" : cid === "claude" ? "写入 Claude-3p managedMcpServers" : cid === "claude_code" ? "写入 ~/.claude.json" : cid === "antigravity" ? "写入 mcp_config.json" : `写入 ~/.${cid}/mcp.json`;
                return `
                  <label class="mcp-toggle-card">
                    <div class="mcp-toggle-label">
                      <span class="mcp-toggle-title">${clientIcon(cid)} ${escapeHtml(label)}</span>
                      <span class="mcp-toggle-desc">${pathDesc}</span>
                    </div>
                    <input type="checkbox" id="mcp-edit-${escapeHtml(cid)}" class="mcp-toggle-input" ${isChecked ? "checked" : ""} onchange="window.__mcpToggleDraft('${escapeHtml(cid)}', this.checked)" />
                    <span class="mcp-toggle-track"><span class="mcp-toggle-thumb"></span></span>
                  </label>
                `;
              }).join("");
            })()}
          </div>
        </div>

        <div class="mcp-form-actions">
          <button class="btn btn-primary" onclick="window.__mcpSave()" ${busy ? "disabled" : ""}>
            ${busy ? "正在保存…" : "保存配置"}
          </button>
          <button class="btn" onclick="window.__mcpCancel()">取消</button>
        </div>
      </div>
    </div>
  `;
}

function renderDetail(): string {
  const server = selected();
  if (!server) {
    const inRepo = state.data?.inRepoMcps?.find((m) => m.name === state.selected);
    if (inRepo) {
      const langIcon = inRepo.lang === "python" ? "🐍" : inRepo.lang === "node" ? "🟢" : inRepo.lang === "java" ? "☕" : inRepo.lang === "go" ? "🦫" : "⚡";
      const langText = inRepo.lang === "python" ? "Python FastMCP" : inRepo.lang === "node" ? "Node.js" : inRepo.lang === "java" ? "Java" : inRepo.lang === "go" ? "Go" : "自研";
      return `
        <div class="mcp-detail">
          <div class="mcp-detail-head">
            <div>
              <h3>${langIcon} ${escapeHtml(inRepo.title)}</h3>
              <code class="mcp-name-badge">${escapeHtml(inRepo.name)}</code>
            </div>
            <div class="mcp-actions">
              ${isInspectorRunning(inRepo.name)
                ? `<button class="btn btn-sm" style="border: 1px solid #22c55e; color: #22c55e;" onclick="window.__mcpOpenInspector('${escapeHtml(inRepo.name)}')">🌐 打开 Inspector</button>
                   <button class="btn btn-sm btn-danger" onclick="window.__mcpStopInspector('${escapeHtml(inRepo.name)}')">🛑 停止调试</button>`
                : `<button class="btn btn-sm" onclick="window.__mcpStartInspector('${escapeHtml(inRepo.name)}')">🔍 启动 Inspector 调试</button>`
              }
              <button class="btn btn-sm btn-primary" onclick="window.__mcpApplyInRepo('${escapeHtml(inRepo.name)}')">
                ✨ 立即配置并分发
              </button>
            </div>
          </div>
          <div class="mcp-detail-desc">${escapeHtml(inRepo.description)}</div>

          <div class="mcp-detail-meta-bar">
            <span class="mcp-badge mcp-badge-inrepo">${langText} 自研源码</span>
            <span class="mcp-badge mcp-status-warn">待配置分发客户端</span>
          </div>

          <div class="mcp-detail-section">
            <div class="mcp-section-title">自研源码信息</div>
            <div class="mcp-client-path" style="margin-top: 8px;">
              <div class="mcp-field-label">入口源码文件</div>
              <code class="path-pill">${escapeHtml(inRepo.path)}</code>
            </div>
            <div class="mcp-client-path" style="margin-top: 8px;">
              <div class="mcp-field-label">启动命令与参数</div>
              <code class="path-pill">${escapeHtml(inRepo.command)} ${escapeHtml(inRepo.args.join(" "))}</code>
            </div>
          </div>

          ${inRepo.sampleEnv && inRepo.sampleEnv.length > 0 ? `
          <div class="mcp-detail-section">
            <div class="mcp-section-title">📋 环境变量配置示例 (支持配置多个数据库)</div>
            <div style="margin-top: 6px; font-size: 12px; opacity: 0.85;">
              以 <code>库名/别名</code> 作为 Key，以 <code>连接 URL</code> 作为 Value：
            </div>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
              ${inRepo.sampleEnv.map((e) => `
                <div style="display: flex; gap: 8px; align-items: baseline; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); padding: 6px 10px; border-radius: 6px; font-size: 12px;">
                  <strong style="color: #60a5fa; font-family: monospace;">${escapeHtml(e.key)}</strong>
                  <span style="opacity: 0.5;">=</span>
                  <code style="word-break: break-all; opacity: 0.9;">${escapeHtml(e.value)}</code>
                </div>
              `).join("")}
            </div>
          </div>
          ` : ""}

          <div class="mcp-detail-hint">
            💡 点击右上角「✨ 立即配置并分发」按钮，即可一键将该自研 MCP 登记到网关（自动带入示例配置）并推送到各个客户端。
          </div>
        </div>
      `;
    }

    const list = servers();
    if (list.length > 0) {
      state.selected = list[0].name;
      return renderDetail();
    }
    return `
      <div class="mcp-empty-hero">
        <div class="mcp-empty-hero-icon">👈</div>
        <div class="mcp-empty-hero-title">请从左侧选择一个 MCP</div>
        <p>在左侧列表中选择自研或第三方 MCP 查看详情与分发状态，或点击「+ 新增 MCP」。</p>
      </div>
    `;
  }
  const dist = server.distribution || {};
  const present = state.data?.presentIn?.[server.name] || {};
  const metaList = state.data?.clientsMeta || [];
  const clientScans = state.data?.clients || [];
  const clientIds = Array.from(new Set([
    "codex", "claude", "claude_code", "antigravity",
    ...metaList.map((m) => m.id),
    ...clientScans.map((c) => c.client),
  ]));
  const rows = clientIds.map((id) => {
    const meta = metaList.find((m) => m.id === id);
    const installed = Boolean(present[id]);
    const target = Boolean(dist[id]);
    const status = installed ? "已同步至配置文件" : target ? "待同步写入" : "未分发至此客户端";
    const cls = installed ? "mcp-status-ok" : target ? "mcp-status-warn" : "mcp-status-off";
    return `
      <div class="mcp-client-row">
        <div class="mcp-client-row-info">
          <span class="mcp-client-icon">${clientIcon(id)}</span>
          <div class="mcp-client-name">${escapeHtml(meta?.label || clientDisplayName(id))}</div>
        </div>
        <span class="mcp-badge ${cls}">${status}</span>
      </div>
    `;
  }).join("");

  return `
    <div class="mcp-detail">
      <div class="mcp-detail-head">
        <div>
          <h3>${escapeHtml(server.title || server.name)}</h3>
          <code class="mcp-name-badge">${escapeHtml(server.name)}</code>
        </div>
        <div class="mcp-actions">
          ${isInspectorRunning(server.name)
            ? `<button class="btn btn-sm" style="border: 1px solid #22c55e; color: #22c55e;" onclick="window.__mcpOpenInspector('${escapeHtml(server.name)}')">🌐 打开 Inspector</button>
               <button class="btn btn-sm btn-danger" onclick="window.__mcpStopInspector('${escapeHtml(server.name)}')">🛑 停止调试</button>`
            : `<button class="btn btn-sm" onclick="window.__mcpStartInspector('${escapeHtml(server.name)}')">🔍 启动 Inspector 调试</button>`
          }
          <button class="btn btn-sm" onclick="window.__mcpPreviewServer('${escapeHtml(server.name)}')" title="预览当前这一个 MCP 生成的各客户端配置片段">
            📄 预览片段
          </button>
          <button class="btn btn-sm btn-apply" onclick="window.__mcpApplyServer('${escapeHtml(server.name)}')" title="仅将当前这一个 MCP 增量写入已配置的目标客户端">
            🚀 写入客户端
          </button>
          <button class="btn btn-sm btn-primary" onclick="window.__mcpEdit()">编辑配置</button>
          <button class="btn btn-sm btn-danger" onclick="window.__mcpDelete('${escapeHtml(server.name)}')">删除</button>
        </div>
      </div>
      ${server.description ? `<div class="mcp-detail-desc">${escapeHtml(server.description)}</div>` : ""}

      <div class="mcp-detail-meta-bar">
        <span class="mcp-badge mcp-badge-${server.transport || "stdio"}">${server.transport === "stdio" ? "STDIO 本地进程" : "HTTP 远程流式"}</span>
        <span class="mcp-badge ${server.enabled === false ? "mcp-status-warn" : "mcp-status-ok"}">${server.enabled === false ? "已停用" : "启用中"}</span>
      </div>

      <div class="mcp-detail-section">
        <div class="mcp-section-title">分发目标与同步状态</div>
        <div class="mcp-client-rows-box">${rows}</div>
      </div>

      <div class="mcp-detail-hint">
        💡 提示：点击「预览片段」可查看当前 MCP 单独的配置文本；点击「写入客户端」可仅将当前 MCP 同步写入客户端。
      </div>
    </div>
  `;
}

function renderHighlightedCode(code: string, serverNames: string[], isFullMode: boolean, clientId: string): string {
  if (!isFullMode) {
    return `<code>${escapeHtml(code)}</code>`;
  }

  const lines = code.split("\n");
  let inTargetBlock = false;
  let braceDepth = 0;
  let targetBraceBase = 0;
  let firstHighlightId = "";

  const formattedLines = lines.map((line, idx) => {
    let isHighlight = false;

    if (clientId === "codex") {
      const secMatch = line.match(/^\s*\[([^\]]+)\]/);
      if (secMatch) {
        const sec = secMatch[1].trim();
        const matchedServer = serverNames.some((s) => sec === `mcp_servers.${s}` || sec.startsWith(`mcp_servers.${s}.`));
        if (matchedServer) {
          inTargetBlock = true;
        } else {
          inTargetBlock = false;
        }
      }
      if (inTargetBlock) isHighlight = true;
    } else {
      if (!inTargetBlock) {
        const keyMatch = line.match(/^\s*"([^"]+)":\s*\{/);
        if (keyMatch && serverNames.includes(keyMatch[1])) {
          inTargetBlock = true;
          targetBraceBase = braceDepth;
        }
      }
      if (inTargetBlock) {
        isHighlight = true;
        const openCount = (line.match(/{/g) || []).length;
        const closeCount = (line.match(/}/g) || []).length;
        braceDepth += openCount - closeCount;
        if (braceDepth <= targetBraceBase && closeCount > 0) {
          inTargetBlock = false;
        }
      } else {
        const openCount = (line.match(/{/g) || []).length;
        const closeCount = (line.match(/}/g) || []).length;
        braceDepth += openCount - closeCount;
      }
    }

    let idAttr = "";
    if (isHighlight && !firstHighlightId) {
      firstHighlightId = `mcp-target-${clientId}`;
      idAttr = ` id="${firstHighlightId}"`;
    }

    const lineNum = `<span class="mcp-line-num">${idx + 1}</span>`;
    if (isHighlight) {
      return `<div class="mcp-code-line mcp-line-highlight"${idAttr}>${lineNum}<span class="mcp-line-content">${escapeHtml(line)}</span><span class="mcp-line-badge">✦ 本次配置</span></div>`;
    }
    return `<div class="mcp-code-line">${lineNum}<span class="mcp-line-content">${escapeHtml(line)}</span></div>`;
  });

  return formattedLines.join("");
}

function renderPreview(): string {
  if (!state.previewItems.length && !state.preview) return "";

  const serverList = servers();
  const currentFilter = state.previewServerFilter || "";
  const currentClient = state.previewClientTab || "all";
  const viewMode = state.previewViewMode || "snippet";

  const itemsToShow = state.previewItems.filter((p) => {
    if (currentClient === "all") return Boolean(p.text || p.snippet);
    return p.client === currentClient && Boolean(p.text || p.snippet);
  });

  return `
    <div class="mcp-preview-modal">
      <div class="mcp-preview-header-bar">
        <div class="mcp-preview-title-group">
          <span class="mcp-preview-icon">📄</span>
          <div>
            <div class="mcp-section-title">MCP 配置片段与合并预览</div>
            <div class="mcp-muted" style="font-size: 11px;">查看生成的精简配置代码片段，或预览合并写入到各客户端的完整配置文件。</div>
          </div>
        </div>

        <div class="mcp-preview-actions-bar">
          <!-- Server Filter Selector -->
          <div class="mcp-preview-filter">
            <span class="mcp-field-label">预览对象：</span>
            <select class="mcp-select" onchange="window.__mcpChangePreviewServer(this.value)">
              <option value="" ${currentFilter === "" ? "selected" : ""}>🌐 全部托管 MCP (${serverList.length})</option>
              ${serverList.map((s) => `
                <option value="${escapeHtml(s.name)}" ${currentFilter === s.name ? "selected" : ""}>
                  📦 ${escapeHtml(s.title || s.name)} (${escapeHtml(s.name)})
                </option>
              `).join("")}
            </select>
          </div>

          <!-- Snippet vs Full File Segmented Toggle -->
          <div class="mcp-segmented">
            <button type="button" class="mcp-seg-btn ${viewMode === "snippet" ? "active" : ""}" onclick="window.__mcpSetPreviewMode('snippet')">
              仅看配置片段 (Snippet)
            </button>
            <button type="button" class="mcp-seg-btn ${viewMode === "full" ? "active" : ""}" onclick="window.__mcpSetPreviewMode('full')">
              完整文件合并效果
            </button>
          </div>

          <button class="btn btn-sm" onclick="window.__mcpClosePreview()">✕ 关闭预览</button>
        </div>
      </div>

      <!-- Client Tabs -->
      <div class="mcp-preview-tabs">
        <button class="mcp-preview-tab ${currentClient === "all" ? "active" : ""}" onclick="window.__mcpSetPreviewClient('all')">
          全部客户端 (${state.previewItems.filter(p => p.snippet || p.text).length})
        </button>
        ${Array.from(new Set([
          "codex", "claude", "claude_code", "antigravity",
          ...state.previewItems.map(p => p.client),
          ...(state.data?.clientsMeta || []).map(m => m.id),
          ...(state.data?.clients || []).map(c => c.client),
        ])).map((cid) => {
          const p = state.previewItems.find(item => item.client === cid);
          const hasContent = Boolean(p?.snippet || p?.text);
          return `
            <button class="mcp-preview-tab ${currentClient === cid ? "active" : ""} ${!hasContent ? "disabled" : ""}" onclick="window.__mcpSetPreviewClient('${cid}')">
              ${clientIcon(cid)} ${clientDisplayName(cid)}
            </button>
          `;
        }).join("")}
      </div>

      <!-- Preview Content Cards -->
      <div class="mcp-preview-body">
        ${itemsToShow.length === 0
          ? `<div class="mcp-empty-card" style="padding: 24px;"><div class="mcp-muted">该客户端暂无可预览的配置内容。</div></div>`
          : itemsToShow.map((p) => {
              const code = viewMode === "snippet" ? (p.snippet || p.text || "") : (p.text || "");
              return `
                <div class="mcp-preview-client-card">
                  <div class="mcp-preview-card-head">
                    <div class="mcp-preview-card-title-row">
                      <span class="mcp-client-icon">${clientIcon(p.client)}</span>
                      <span class="mcp-preview-client-name">${escapeHtml(clientLabel(p.client))}</span>
                      <code class="path-pill" style="font-size: 10px; padding: 2px 6px;">${escapeHtml(p.path)}</code>
                    </div>
                    <div class="mcp-preview-card-actions">
                      ${viewMode === "full" && p.servers.length > 0 ? `
                        <button class="btn btn-xs btn-locate" onclick="window.__mcpScrollToTarget('${escapeHtml(p.client)}')">
                          🎯 定位到本次配置
                        </button>
                      ` : ""}
                      <button class="btn btn-xs btn-primary" onclick="window.__mcpCopySnippet('${escapeHtml(p.client)}')">
                        📋 复制${viewMode === "snippet" ? "片段" : "全文"}
                      </button>
                    </div>
                  </div>
                  ${p.hint ? `<div class="mcp-preview-hint">💡 ${escapeHtml(p.hint)}</div>` : ""}
                  <div class="mcp-code-container ${viewMode === "full" ? "mcp-full-code-box" : ""}">
                    <pre id="mcp-code-${escapeHtml(p.client)}">${renderHighlightedCode(code, p.servers, viewMode === "full", p.client)}</pre>
                  </div>
                </div>
              `;
            }).join("")
        }
      </div>
    </div>
  `;
}

function renderConfirm(): string {
  const sName = state.confirmServerName;
  const paths = state.data?.clientsMeta?.map((m) => m.path).filter(Boolean) || [];
  const title = sName ? `⚠️ 确认仅将 MCP「${escapeHtml(sName)}」写入客户端` : "⚠️ 确认写入客户端配置";
  const desc = sName
    ? `网关将仅对 MCP「<strong>${escapeHtml(sName)}</strong>」进行增量分发合并，写入以下目标客户端配置文件（写入前会自动创建 <code>.mcp-backup-&lt;timestamp&gt;</code> 备份）：`
    : "网关将根据分发设置更新以下客户端配置文件（写入前会自动创建 <code>.mcp-backup-&lt;timestamp&gt;</code> 备份）：";
  return `
    <div class="mcp-confirm">
      <div class="mcp-section-title">${title}</div>
      <p>${desc}</p>
      <ul>${paths.map((p) => `<li><code class="path-pill">${escapeHtml(p)}</code></li>`).join("")}</ul>
      <div class="mcp-actions">
        <button class="btn btn-primary" onclick="window.__mcpConfirmApply()">确认写入并应用</button>
        <button class="btn" onclick="window.__mcpCancelApply()">取消</button>
      </div>
    </div>
  `;
}

function render(): void {
  const root = rootEl();
  if (!root) return;
  if (state.loading && !state.data) {
    root.innerHTML = `<div class="mcp-loading"><span class="mcp-spinner"></span> 正在扫描客户端并加载 MCP 配置…</div>`;
    return;
  }
  if (state.confirming) {
    root.innerHTML = renderHeader() + renderConfirm();
    return;
  }

  if (state.editing) {
    const isSaveBusy = state.busy === "save";
    root.innerHTML = `
      <div class="mcp-page-container">
        <div class="mcp-header">
          <div class="mcp-header-title-group">
            <button class="btn mcp-btn-back" onclick="window.__mcpCancel()" title="返回 MCP 列表">
              <span>←</span> 返回列表
            </button>
            <div>
              <h2>${state.selected ? "编辑 MCP 配置" : "连接至自定义 MCP"}</h2>
              <p class="mcp-muted">配置 MCP 服务的启动方式与目标客户端，网关将自动完成各客户端配置的适配与注入。</p>
            </div>
          </div>
          <div class="mcp-actions">
            <button class="btn" onclick="window.__mcpCancel()">取消</button>
            <button class="btn btn-primary" onclick="window.__mcpSave()" ${isSaveBusy ? "disabled" : ""}>
              ${isSaveBusy ? "正在保存…" : "保存配置"}
            </button>
          </div>
        </div>
        ${state.error ? `<div class="mcp-error-banner">${escapeHtml(state.error)}</div>` : ""}
        <div class="mcp-editor-wrap">
          ${renderEditor()}
        </div>
      </div>
    `;
    return;
  }

  const serverList = servers();
  const hasServers = serverList.length > 0;

  let mainSection = "";
  if (!hasServers) {
    mainSection = `
      <div class="mcp-empty-hero">
        <div class="mcp-empty-hero-icon">⚡</div>
        <div class="mcp-empty-hero-title">暂无网关托管的 MCP</div>
        <p>在这里集中配置托管本地 STDIO 或远程流式 HTTP MCP，一键批量分发写入到各个客户端配置文件中。</p>
        <button class="btn btn-primary btn-lg" onclick="window.__mcpNew()">+ 新增第一个 MCP</button>
      </div>
    `;
  } else {
    mainSection = `
      <div class="mcp-layout">
        <div class="mcp-left">
          <div class="mcp-left-head">
            <div class="mcp-section-title">网关托管 MCP (${serverList.length})</div>
          </div>
          <div class="mcp-cards-list">
            ${renderServerCards()}
          </div>
        </div>
        <div class="mcp-right">
          ${renderDetail()}
        </div>
      </div>
    `;
  }

  root.innerHTML = `
    <div class="mcp-page-container">
      ${renderHeader()}
      ${state.error ? `<div class="mcp-error-banner">${escapeHtml(state.error)}</div>` : ""}
      ${renderPreview()}
      
      <!-- 主配置工作区 -->
      ${mainSection}

      <!-- 客户端扫描与路径设置独立区块 -->
      <div class="mcp-clients-section">
        <div class="mcp-clients-section-head">
          <div>
            <div class="mcp-section-title">客户端本地配置与路径 (Local Clients Configuration)</div>
            <p class="mcp-muted">展示本机实际检测到的各客户端已安装 MCP，以及当前生效的配置文件读取/分发路径。</p>
          </div>
        </div>
        <div class="mcp-clients">${renderClientList()}</div>
      </div>
    </div>
  `;
}

function saveInputsToDraft(): void {
  const nameEl = document.getElementById("mcp-edit-name") as HTMLInputElement | null;
  const titleEl = document.getElementById("mcp-edit-title") as HTMLInputElement | null;
  const descEl = document.getElementById("mcp-edit-desc") as HTMLInputElement | null;
  const cmdEl = document.getElementById("mcp-edit-command") as HTMLInputElement | null;
  const urlEl = document.getElementById("mcp-edit-url") as HTMLInputElement | null;

  if (nameEl) state.draft.name = nameEl.value;
  if (titleEl) state.draft.title = titleEl.value;
  if (descEl) state.draft.description = descEl.value;
  if (cmdEl) state.draft.command = cmdEl.value;
  if (urlEl) state.draft.url = urlEl.value;

  // Sync args
  const argInputs = document.querySelectorAll<HTMLInputElement>(".mcp-arg-input");
  if (argInputs.length > 0) {
    const list: string[] = [];
    argInputs.forEach((input) => {
      list.push(input.value);
    });
    state.draft.argsList = list;
  }

  // Sync env
  const envKeys = document.querySelectorAll<HTMLInputElement>(".mcp-env-key");
  const envVals = document.querySelectorAll<HTMLInputElement>(".mcp-env-val");
  if (envKeys.length > 0) {
    const list: KeyValPair[] = [];
    envKeys.forEach((keyEl, i) => {
      list.push({ key: keyEl.value, value: envVals[i]?.value || "" });
    });
    state.draft.envList = list;
  }

  // Sync headers
  const headerKeys = document.querySelectorAll<HTMLInputElement>(".mcp-header-key");
  const headerVals = document.querySelectorAll<HTMLInputElement>(".mcp-header-val");
  if (headerKeys.length > 0) {
    const list: KeyValPair[] = [];
    headerKeys.forEach((keyEl, i) => {
      list.push({ key: keyEl.value, value: headerVals[i]?.value || "" });
    });
    state.draft.headersList = list;
  }
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
  const dist: Record<string, boolean> = {};
  const metaList = state.data?.clientsMeta || [];
  const clientScans = state.data?.clients || [];
  const clientIds = Array.from(new Set([
    "codex", "claude", "claude_code", "antigravity",
    ...metaList.map((m) => m.id),
    ...clientScans.map((c) => c.client),
  ]));
  for (const cid of clientIds) {
    dist[cid] = true;
  }
  state.draft = {
    name: "",
    title: "",
    description: "",
    transport: "stdio",
    command: "",
    args: "",
    argsList: [""],
    url: "",
    env: "",
    envList: [],
    headers: "",
    headersList: [],
    enabled: true,
    codex: true,
    claude: true,
    claude_code: true,
    antigravity: true,
    distribution: dist,
  };
  state.pathClient = "";
  render();
}

function edit(): void {
  const server = selected();
  if (!server) return;
  state.editing = true;
  const dist = { ...(server.distribution || {}) };
  state.draft = {
    name: server.name,
    title: server.title || "",
    description: server.description || "",
    transport: server.transport === "stdio" ? "stdio" : "remote",
    command: server.command || "",
    args: JSON.stringify(server.args || []),
    argsList: server.args && server.args.length ? [...server.args] : [""],
    url: server.url || "",
    env: "",
    envList: [],
    headers: "",
    headersList: [],
    enabled: server.enabled !== false,
    codex: Boolean(dist.codex),
    claude: Boolean(dist.claude),
    claude_code: Boolean(dist.claude_code),
    antigravity: Boolean(dist.antigravity),
    distribution: dist,
  };
  state.pathClient = "";
  render();
}

function cancel(): void {
  state.editing = false;
  render();
}

function applyTemplate(templateId: string): void {
  if (!templateId) return;
  if (templateId.startsWith("inrepo:")) {
    const sName = templateId.replace("inrepo:", "");
    const item = state.data?.inRepoMcps?.find((m) => m.name === sName);
    if (!item) return;

    saveInputsToDraft();
    state.draft.name = item.name;
    state.draft.title = item.title;
    state.draft.description = item.description;
    state.draft.transport = item.transport;
    state.draft.command = item.command;
    state.draft.argsList = [...item.args];
    state.draft.url = "";
    state.draft.envList = [];
    state.draft.headersList = [];

    showToast(`已自动载入项目自研 MCP「${item.name}」的全部命令与真实路径！`, "success");
    render();
    return;
  }

  const tpl = MCP_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return;

  saveInputsToDraft();
  const currentName = state.draft.name.trim();
  const defaultNames = ["", "my-custom-mcp", "node_custom_tool", "py_fastmcp_tool", "java_custom_tool", "filesystem", "fetch", "remote_stream_api"];
  if (defaultNames.includes(currentName)) {
    state.draft.name = tpl.name;
  }
  state.draft.title = tpl.title;
  state.draft.description = tpl.description;
  state.draft.transport = tpl.transport;
  state.draft.command = tpl.command;
  state.draft.argsList = [...tpl.argsList];
  state.draft.url = tpl.url || "";
  if (tpl.envList && tpl.envList.length) {
    state.draft.envList = structuredClone(tpl.envList);
  }
  if (tpl.headersList && tpl.headersList.length) {
    state.draft.headersList = structuredClone(tpl.headersList);
  }

  showToast(`已套用「${tpl.title}」配置模板，请按需微调`, "success");
  render();
}

function applyInRepo(name: string): void {
  const item = state.data?.inRepoMcps?.find((m) => m.name === name);
  if (!item) return;
  state.selected = "";
  state.editing = true;
  const dist: Record<string, boolean> = {};
  const metaList = state.data?.clientsMeta || [];
  const clientScans = state.data?.clients || [];
  const clientIds = Array.from(new Set([
    "codex", "claude", "claude_code", "antigravity",
    ...metaList.map((m) => m.id),
    ...clientScans.map((c) => c.client),
  ]));
  for (const cid of clientIds) {
    dist[cid] = true;
  }
  state.draft = {
    name: item.name,
    title: item.title,
    description: item.description,
    transport: item.transport,
    command: item.command,
    args: "",
    argsList: [...item.args],
    url: "",
    env: "",
    envList: item.sampleEnv && item.sampleEnv.length > 0 ? structuredClone(item.sampleEnv) : [],
    headers: "",
    headersList: [],
    enabled: true,
    codex: true,
    claude: true,
    claude_code: true,
    antigravity: true,
    distribution: dist,
  };
  showToast(`已自动载入自研 MCP「${item.name}」的配置与示例数据源！`, "success");
  render();
}

function setTransport(val: "stdio" | "remote"): void {
  saveInputsToDraft();
  state.draft.transport = val;
  if (val === "stdio" && state.draft.argsList.length === 0) {
    state.draft.argsList = [""];
  }
  render();
}

function addArg(): void {
  saveInputsToDraft();
  state.draft.argsList.push("");
  render();
}

function removeArg(index: number): void {
  saveInputsToDraft();
  state.draft.argsList.splice(index, 1);
  render();
}

function addEnv(): void {
  saveInputsToDraft();
  state.draft.envList.push({ key: "", value: "" });
  render();
}

function removeEnv(index: number): void {
  saveInputsToDraft();
  state.draft.envList.splice(index, 1);
  render();
}

function addHeader(): void {
  saveInputsToDraft();
  state.draft.headersList.push({ key: "", value: "" });
  render();
}

function removeHeader(index: number): void {
  saveInputsToDraft();
  state.draft.headersList.splice(index, 1);
  render();
}

function toggleDraft(field: string, checked: boolean): void {
  if (field === "enabled") {
    state.draft.enabled = checked;
    return;
  }
  if (!state.draft.distribution) {
    state.draft.distribution = {};
  }
  state.draft.distribution[field] = checked;
  (state.draft as Record<string, any>)[field] = checked;
}

function collect(): (McpServer & { env?: Record<string, string>; headers?: Record<string, string> }) | null {
  saveInputsToDraft();
  const d = state.draft;
  const name = d.name.trim();
  const title = d.title.trim();
  const description = d.description.trim();
  const transportVal = d.transport;
  const command = d.command.trim();
  const url = d.url.trim();
  const { enabled, codex, claude, claude_code, antigravity } = d;

  if (!name) {
    showToast("请填写 MCP 名称", "error");
    return null;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    showToast("MCP 名称只能包含字母、数字、下划线和连字符", "error");
    return null;
  }

  const args: string[] = d.argsList.map((a) => a.trim()).filter((a) => a.length > 0);

  if (transportVal === "stdio" && !command) {
    showToast("stdio 传输必须填写启动命令", "error");
    return null;
  }
  if (transportVal === "remote" && !url) {
    showToast("流式 HTTP 传输必须填写 URL", "error");
    return null;
  }

  const env: Record<string, string> = {};
  for (const item of d.envList) {
    const k = item.key.trim();
    if (k) env[k] = item.value;
  }

  const headers: Record<string, string> = {};
  for (const item of d.headersList) {
    const k = item.key.trim();
    if (k) headers[k] = item.value;
  }

  const distribution: Record<string, boolean> = {
    codex: Boolean(d.distribution?.codex ?? codex),
    claude: Boolean(d.distribution?.claude ?? claude),
    claude_code: Boolean(d.distribution?.claude_code ?? claude_code),
    antigravity: Boolean(d.distribution?.antigravity ?? antigravity),
  };

  if (d.distribution) {
    for (const [k, v] of Object.entries(d.distribution)) {
      distribution[k] = Boolean(v);
    }
  }

  const payload: McpServer & { env?: Record<string, string>; headers?: Record<string, string> } = {
    name,
    title: title || name,
    description,
    transport: transportVal,
    command,
    args,
    url,
    enabled,
    distribution,
  };

  if (Object.keys(env).length > 0) payload.env = env;
  if (Object.keys(headers).length > 0) payload.headers = headers;

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
    showToast("MCP 配置已保存", "success");
  } catch (error) {
    state.error = (error as Error)?.message || String(error);
  } finally {
    state.busy = "";
    render();
  }
}

async function remove(name: string): Promise<void> {
  if (!window.confirm(`确定删除 MCP "${name}" 吗？`)) return;
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

async function preview(serverName?: string): Promise<void> {
  if (state.busy) return;
  state.busy = "preview";
  state.error = "";
  state.previewServerFilter = serverName || "";
  state.previewServerName = serverName || "";
  try {
    const url = serverName
      ? `/v1/mcp-management/servers/${encodeURIComponent(serverName)}/preview`
      : "/v1/mcp-management/preview";
    const targets: Record<string, boolean> = { codex: true, claude: true, claude_code: true, antigravity: true };
    if (state.data?.clientsMeta) {
      for (const m of state.data.clientsMeta) targets[m.id] = true;
    }
    if (state.data?.clients) {
      for (const c of state.data.clients) targets[c.client] = true;
    }
    const data = await api<{ previews: Array<{ client: string; path: string; text: string | null; snippet: string | null; hint: string | null; servers: string[] }> }>(
      url,
      { method: "POST", body: JSON.stringify({ targets }) },
    );
    state.previewItems = data.previews || [];
    state.preview = "active";
    showToast(serverName ? `已生成 MCP「${serverName}」配置片段` : "已生成配置片段", "success");
  } catch (error) {
    state.error = (error as Error)?.message || String(error);
  } finally {
    state.busy = "";
    render();
    if (state.previewViewMode === "full") {
      setTimeout(() => { scrollToTarget(state.previewClientTab); }, 120);
    }
  }
}

function closePreview(): void {
  state.preview = "";
  state.previewItems = [];
  state.previewServerFilter = "";
  state.previewServerName = "";
  render();
}

function setPreviewMode(mode: "snippet" | "full"): void {
  state.previewViewMode = mode;
  render();
  if (mode === "full") {
    setTimeout(() => { scrollToTarget(state.previewClientTab); }, 120);
  }
}

function scrollToTarget(clientId?: string): void {
  const target = clientId && clientId !== "all"
    ? document.getElementById(`mcp-target-${clientId}`)
    : (document.querySelector(".mcp-line-highlight") as HTMLElement | null);

  if (!target) {
    if (clientId && clientId !== "all") {
      showToast(`当前客户端无「${state.previewServerName || "所选 MCP"}」的配置块`, "info");
    }
    return;
  }

  const pre = target.closest("pre");
  if (pre) {
    const relativeTop = target.offsetTop - pre.offsetTop;
    pre.scrollTo({
      top: Math.max(0, relativeTop - pre.clientHeight / 2 + target.clientHeight / 2),
      behavior: "smooth",
    });
  }

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("mcp-pulse-highlight");
  void target.offsetWidth;
  target.classList.add("mcp-pulse-highlight");
  setTimeout(() => { target.classList.remove("mcp-pulse-highlight"); }, 1600);
}

function setPreviewClient(client: string): void {
  state.previewClientTab = client;
  render();
  if (state.previewViewMode === "full") {
    setTimeout(() => { scrollToTarget(client); }, 120);
  }
}

function changePreviewServer(serverName: string): void {
  void preview(serverName || undefined);
}

function copySnippet(clientId: string): void {
  const item = state.previewItems.find((p) => p.client === clientId);
  if (!item) return;
  const viewMode = state.previewViewMode || "snippet";
  const code = viewMode === "snippet" ? (item.snippet || item.text || "") : (item.text || "");
  if (!code) return;
  void navigator.clipboard.writeText(code).then(
    () => { showToast(`已复制 ${clientDisplayName(clientId)} 配置到剪贴板`, "success"); },
    () => { showToast("复制失败，请手动选中复制", "error"); },
  );
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

function importServer(clientId: string, serverName: string): void {
  const client = state.data?.clients?.find((c) => c.client === clientId);
  const server = client?.servers?.find((s) => s.name === serverName);
  if (!server) {
    showToast("未找到该 MCP 的配置数据", "error");
    return;
  }

  const conf = server.config || {};
  const isRemote = Boolean(conf.url);
  const presence = state.data?.presentIn?.[serverName] || {};

  const envList: KeyValPair[] = [];
  if (conf.env && typeof conf.env === "object") {
    for (const [k, v] of Object.entries(conf.env)) {
      envList.push({ key: k, value: String(v) });
    }
  }

  const headersList: KeyValPair[] = [];
  if (conf.headers && typeof conf.headers === "object") {
    for (const [k, v] of Object.entries(conf.headers)) {
      headersList.push({ key: k, value: String(v) });
    }
  }

  const dist: Record<string, boolean> = {
    codex: Boolean(clientId === "codex" || presence.codex),
    claude: Boolean(clientId === "claude" || presence.claude),
    claude_code: Boolean(clientId === "claude_code" || presence.claude_code),
    antigravity: Boolean(clientId === "antigravity" || presence.antigravity),
  };
  const metaList = state.data?.clientsMeta || [];
  const clientScans = state.data?.clients || [];
  const clientIds = Array.from(new Set([
    ...metaList.map((m) => m.id),
    ...clientScans.map((c) => c.client),
  ]));
  for (const cid of clientIds) {
    dist[cid] = Boolean(clientId === cid || presence[cid]);
  }

  state.selected = "";
  state.editing = true;
  state.draft = {
    name: server.name,
    title: server.name,
    description: `从 ${clientDisplayName(clientId)} 导入`,
    transport: isRemote ? "remote" : "stdio",
    command: (conf.command as string) || "",
    args: "",
    argsList: Array.isArray(conf.args) ? [...conf.args] : [],
    url: (conf.url as string) || "",
    env: "",
    envList,
    headers: "",
    headersList,
    enabled: true,
    codex: Boolean(dist.codex),
    claude: Boolean(dist.claude),
    claude_code: Boolean(dist.claude_code),
    antigravity: Boolean(dist.antigravity),
    distribution: dist,
  };

  showToast(`已载入「${serverName}」配置，确认无误后点击保存即可纳入网关托管`, "success");
  render();
}

function requestApply(serverName?: string): void {
  state.confirming = true;
  state.confirmServerName = serverName || "";
  state.preview = "";
  render();
}

function cancelApply(): void {
  state.confirming = false;
  state.confirmServerName = "";
  render();
}

async function confirmApply(): Promise<void> {
  if (state.busy) return;
  state.busy = "apply";
  state.error = "";
  const sName = state.confirmServerName;
  try {
    const url = sName
      ? `/v1/mcp-management/servers/${encodeURIComponent(sName)}/apply`
      : "/v1/mcp-management/apply";
    const targets: Record<string, boolean> = { codex: true, claude: true, claude_code: true, antigravity: true };
    if (state.data?.clientsMeta) {
      for (const m of state.data.clientsMeta) targets[m.id] = true;
    }
    if (state.data?.clients) {
      for (const c of state.data.clients) targets[c.client] = true;
    }
    const data = await api<{ changed: string[]; backups: string[] }>(
      url,
      { method: "POST", body: JSON.stringify({ targets }) },
    );
    state.confirming = false;
    state.confirmServerName = "";
    showToast(sName ? `已成功将 MCP「${sName}」写入 ${data.changed?.length || 0} 个客户端配置文件` : `已成功写入 ${data.changed?.length || 0} 个客户端配置文件`, "success");
    await load();
  } catch (error) {
    state.error = (error as Error)?.message || String(error);
    state.confirming = false;
  } finally {
    state.busy = "";
    render();
  }
}

async function startInspector(serverName: string): Promise<void> {
  const name = String(serverName || "").trim();
  if (!name) return;
  showToast(`正在启动「${name}」MCP Inspector 调试进程...`, "info");
  try {
    const res = await api<{ ok?: boolean; url?: string; port?: number; running?: boolean }>(
      `/v1/mcp-management/inspector/${encodeURIComponent(name)}/start`,
      { method: "POST" },
    );
    const targetUrl = res.url || "";
    if (!/^https?:\/\/127\.0\.0\.1:\d+\/$/.test(targetUrl)) {
      throw new Error("Inspector 返回了无效的本地地址");
    }
    showToast(`MCP Inspector 调试控制台已就绪，正在打开...`, "success");
    window.open(targetUrl, "_blank");
    await load();
  } catch (err) {
    showToast(`启动 Inspector 失败: ${(err as Error)?.message || String(err)}`, "error");
  }
}

async function stopInspector(serverName: string): Promise<void> {
  const name = String(serverName || "").trim();
  if (!name) return;
  try {
    await api<{ ok?: boolean; running?: boolean }>(
      `/v1/mcp-management/inspector/${encodeURIComponent(name)}/stop`,
      { method: "POST" },
    );
    showToast(`已停止「${name}」MCP Inspector 调试进程`, "success");
    await load();
  } catch (err) {
    showToast(`停止 Inspector 失败: ${(err as Error)?.message || String(err)}`, "error");
  }
}

function openInspector(serverName: string): void {
  const name = String(serverName || "").trim();
  if (!name) return;
  const targetUrl = runningInspectorUrl(name);
  if (!targetUrl) {
    showToast(`「${name}」的 Inspector 已停止，请重新启动调试`, "error");
    return;
  }
  window.open(targetUrl, "_blank");
}

(window as unknown as Record<string, unknown>).__mcpRescan = () => { void rescan(); };
(window as unknown as Record<string, unknown>).__mcpNew = newServer;
(window as unknown as Record<string, unknown>).__mcpImportServer = importServer;
(window as unknown as Record<string, unknown>).__mcpSelect = select;
(window as unknown as Record<string, unknown>).__mcpEdit = edit;
(window as unknown as Record<string, unknown>).__mcpCancel = cancel;
(window as unknown as Record<string, unknown>).__mcpApplyTemplate = applyTemplate;
(window as unknown as Record<string, unknown>).__mcpApplyInRepo = applyInRepo;
(window as unknown as Record<string, unknown>).__mcpSetTransport = setTransport;
(window as unknown as Record<string, unknown>).__mcpAddArg = addArg;
(window as unknown as Record<string, unknown>).__mcpRemoveArg = removeArg;
(window as unknown as Record<string, unknown>).__mcpAddEnv = addEnv;
(window as unknown as Record<string, unknown>).__mcpRemoveEnv = removeEnv;
(window as unknown as Record<string, unknown>).__mcpAddHeader = addHeader;
(window as unknown as Record<string, unknown>).__mcpRemoveHeader = removeHeader;
(window as unknown as Record<string, unknown>).__mcpToggleDraft = toggleDraft;
(window as unknown as Record<string, unknown>).__mcpSave = () => { void save(); };
(window as unknown as Record<string, unknown>).__mcpDelete = (name: string) => { void remove(name); };
(window as unknown as Record<string, unknown>).__mcpPreview = () => { void preview(); };
(window as unknown as Record<string, unknown>).__mcpPreviewServer = (name: string) => { void preview(name); };
(window as unknown as Record<string, unknown>).__mcpClosePreview = closePreview;
(window as unknown as Record<string, unknown>).__mcpSetPreviewMode = setPreviewMode;
(window as unknown as Record<string, unknown>).__mcpSetPreviewClient = setPreviewClient;
(window as unknown as Record<string, unknown>).__mcpChangePreviewServer = changePreviewServer;
(window as unknown as Record<string, unknown>).__mcpCopySnippet = copySnippet;
(window as unknown as Record<string, unknown>).__mcpScrollToTarget = scrollToTarget;
(window as unknown as Record<string, unknown>).__mcpApply = () => { requestApply(); };
(window as unknown as Record<string, unknown>).__mcpApplyServer = (name: string) => { requestApply(name); };
(window as unknown as Record<string, unknown>).__mcpConfirmApply = () => { void confirmApply(); };
(window as unknown as Record<string, unknown>).__mcpCancelApply = cancelApply;
(window as unknown as Record<string, unknown>).__mcpEditPath = editPath;
(window as unknown as Record<string, unknown>).__mcpCancelPath = cancelPath;
(window as unknown as Record<string, unknown>).__mcpSavePath = (client: string) => { void savePath(client); };
(window as unknown as Record<string, unknown>).__mcpStartInspector = (name: string) => { void startInspector(name); };
(window as unknown as Record<string, unknown>).__mcpStopInspector = (name: string) => { void stopInspector(name); };
(window as unknown as Record<string, unknown>).__mcpOpenInspector = (name: string) => { openInspector(name); };

registerTab("mcp-management", {
  onEnter: () => { void load(); },
});
