import { registerTab } from "../core/navigation";

// --- Types ---
interface KbCollection {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  doc_count: number;
  created_at: number;
}

interface KbAsset {
  name: string;
  localPath: string;
  url: string;
  remoteUrl?: string;
  sizeBytes: number;
}

interface KbDocument {
  id: string;
  collection_id: string;
  title: string;
  source_type: "file" | "url" | "text";
  source_url?: string;
  file_name?: string;
  file_size?: number;
  file_hash?: string;
  markitdown_status: "idle" | "running" | "done" | "failed" | "skipped";
  markitdown_md: string;
  markitdown_html?: string;
  markitdown_duration_ms: number;
  markitdown_error?: string;
  docling_status: "idle" | "running" | "done" | "failed" | "skipped";
  docling_md: string;
  docling_html?: string;
  docling_json?: string;
  docling_duration_ms: number;
  docling_error?: string;
  assets: KbAsset[];
  word_count: number;
  created_at: number;
}

interface EngineStatus {
  id: string;
  name: string;
  installed: boolean;
  version: string | null;
  binPath: string | null;
  installCommand: string;
  upgradeCommand: string;
}

interface InstallTask {
  taskId: string;
  tool: string;
  status: "running" | "succeeded" | "failed";
  progress: number;
  logs: string[];
  error?: string;
}

// --- State ---
const state = {
  collections: [] as KbCollection[],
  activeCollectionId: "col_default",
  documents: [] as KbDocument[],
  activeDocId: "",
  activeDoc: null as KbDocument | null,
  searchQuery: "",
  engineStatuses: {} as Record<string, EngineStatus>,
  activeFormat: "markdown" as "markdown" | "html" | "json",
  splitMode: "both" as "both" | "markitdown" | "docling",
  showRaw: { markitdown: false, docling: false },
  loadingDocs: false,
  ingesting: false,
  ingestStatusText: "",
  installTask: null as InstallTask | null,
  showInstallModal: false,
  showCreateColModal: false,
  showUrlModal: false,
  showTextModal: false,
  modalUrl: "",
  modalUseLeo: false,
  modalText: "",
  modalTextTitle: "",
  modalColName: "",
  modalColDesc: "",
  previewAsset: null as KbAsset | null,
};

function getRoot(): HTMLElement | null {
  return document.getElementById("knowledge-base-root");
}

function esc(str: any): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const h = d.getHours().toString().padStart(2, "0");
  const min = d.getMinutes().toString().padStart(2, "0");
  return `${m}-${day} ${h}:${min}`;
}

// Markdown Renderer
function renderMarkdownToHtml(md: string): string {
  if (!md) {
    return `<div class="kb-empty-box"><div class="kb-empty-box-icon">📄</div><div class="kb-empty-box-text">暂无解析内容</div></div>`;
  }
  let html = esc(md);

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3 class="kb-md-h3">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="kb-md-h2">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="kb-md-h1">$1</h1>');

  // Blockquotes
  html = html.replace(/^> (.*$)/gim, '<blockquote class="kb-md-quote">$1</blockquote>');

  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/gim, "<em>$1</em>");

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/gim, '<pre class="kb-md-pre"><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/gim, '<code class="kb-md-code">$1</code>');

  // Images
  html = html.replace(/!\[(.*?)\]\((.*?)\)/gim, (_match, alt, src) => {
    return `<div class="kb-md-img-wrap"><img src="${src}" alt="${alt}" class="kb-md-img" onclick="window.__kbPreviewImage('${src}')" /><span class="kb-md-caption">${alt || "文档配图"}</span></div>`;
  });

  // Links
  html = html.replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank" rel="noopener" class="kb-source-link">$1</a>');

  // Tables & Lists
  const lines = html.split("\n");
  const outLines: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (inUl) { outLines.push("</ul>"); inUl = false; }
      if (inOl) { outLines.push("</ol>"); inOl = false; }
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      tableRows.push(trimmed);
      continue;
    } else if (inTable) {
      outLines.push(convertMarkdownTable(tableRows));
      inTable = false;
      tableRows = [];
    }

    if (/^[-*]\s+(.*)$/.test(trimmed)) {
      if (inOl) { outLines.push("</ol>"); inOl = false; }
      if (!inUl) { outLines.push('<ul class="kb-md-ul">'); inUl = true; }
      outLines.push(`<li>${trimmed.replace(/^[-*]\s+/, "")}</li>`);
      continue;
    } else if (/^\d+\.\s+(.*)$/.test(trimmed)) {
      if (inUl) { outLines.push("</ul>"); inUl = false; }
      if (!inOl) { outLines.push('<ol class="kb-md-ol">'); inOl = true; }
      outLines.push(`<li>${trimmed.replace(/^\d+\.\s+/, "")}</li>`);
      continue;
    } else {
      if (inUl) { outLines.push("</ul>"); inUl = false; }
      if (inOl) { outLines.push("</ol>"); inOl = false; }
    }

    if (trimmed === "") {
      outLines.push("<div style='height:8px;'></div>");
    } else if (!trimmed.startsWith("<h") && !trimmed.startsWith("<pre") && !trimmed.startsWith("<blockquote") && !trimmed.startsWith("<div")) {
      outLines.push(`<p style="margin: 6px 0;">${line}</p>`);
    } else {
      outLines.push(line);
    }
  }

  if (inTable) {
    outLines.push(convertMarkdownTable(tableRows));
  }
  if (inUl) outLines.push("</ul>");
  if (inOl) outLines.push("</ol>");

  return outLines.join("\n");
}

function convertMarkdownTable(rows: string[]): string {
  if (rows.length === 0) return "";
  let tableHtml = '<div class="kb-table-wrap"><table class="kb-table">';

  rows.forEach((row, idx) => {
    if (row.replace(/[-|: ]/g, "") === "") {
      return; // divider line
    }
    const cells = row.split("|").slice(1, -1).map((c) => c.trim());
    if (idx === 0) {
      tableHtml += "<thead><tr>";
      cells.forEach((cell) => (tableHtml += `<th>${cell}</th>`));
      tableHtml += "</tr></thead><tbody>";
    } else {
      tableHtml += "<tr>";
      cells.forEach((cell) => (tableHtml += `<td>${cell}</td>`));
      tableHtml += "</tr>";
    }
  });

  tableHtml += "</tbody></table></div>";
  return tableHtml;
}

// --- API Interactions ---

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, options);
  if (!res.ok) {
    let errText = "";
    try {
      const json = await res.json();
      errText = json.error || json.message || JSON.stringify(json);
    } catch {
      errText = `HTTP ${res.status} ${res.statusText}`;
    }
    throw new Error(errText);
  }
  return res.json();
}

export async function initKnowledgeBase(): Promise<void> {
  await Promise.all([loadEngineStatuses(), loadCollections()]);
  await loadDocuments();
  render();
}

async function loadEngineStatuses(): Promise<void> {
  try {
    const data = await apiFetch<{ tools: Record<string, EngineStatus> }>("/v1/kb/tools/status");
    state.engineStatuses = data.tools || {};
  } catch (err) {
    console.error("[KB] Load tools status error", err);
  }
}

async function loadCollections(): Promise<void> {
  try {
    const data = await apiFetch<{ collections: KbCollection[] }>("/v1/kb/collections");
    state.collections = data.collections || [];
    if (!state.collections.some((c) => c.id === state.activeCollectionId) && state.collections.length > 0) {
      state.activeCollectionId = state.collections[0].id;
    }
  } catch (err) {
    console.error("[KB] Load collections error", err);
  }
}

async function loadDocuments(): Promise<void> {
  state.loadingDocs = true;
  render();
  try {
    const query = new URLSearchParams();
    if (state.activeCollectionId) {
      query.set("collection_id", state.activeCollectionId);
    }
    if (state.searchQuery.trim()) {
      query.set("q", state.searchQuery.trim());
    }
    const data = await apiFetch<{ documents: KbDocument[] }>(`/v1/kb/documents?${query.toString()}`);
    state.documents = data.documents || [];
    if (state.documents.length > 0) {
      if (!state.activeDocId || !state.documents.some((d) => d.id === state.activeDocId)) {
        state.activeDocId = state.documents[0].id;
      }
      await loadActiveDocDetail(state.activeDocId);
    } else {
      state.activeDocId = "";
      state.activeDoc = null;
    }
  } catch (err) {
    console.error("[KB] Load documents error", err);
  } finally {
    state.loadingDocs = false;
    render();
  }
}

async function loadActiveDocDetail(docId: string): Promise<void> {
  if (!docId) return;
  try {
    const data = await apiFetch<{ document: KbDocument }>(`/v1/kb/documents/${docId}`);
    state.activeDoc = data.document;
  } catch (err) {
    console.error("[KB] Load doc detail error", err);
  }
}

// Ingestion Handlers
async function handleFileUpload(file: File): Promise<void> {
  state.ingesting = true;
  state.ingestStatusText = `正在上传并解析 ${file.name}，启动双引擎对比...`;
  render();

  try {
    const buffer = await file.arrayBuffer();
    const res = await fetch("/v1/kb/ingest/file", {
      method: "POST",
      headers: {
        "x-filename": encodeURIComponent(file.name),
        "x-collection-id": state.activeCollectionId || "col_default",
      },
      body: buffer,
    });
    if (!res.ok) {
      throw new Error(`Upload error: HTTP ${res.status}`);
    }
    const data = await res.json();
    state.activeDocId = data.document.id;
    await loadCollections();
    await loadDocuments();
  } catch (err: any) {
    alert(`文件解析失败: ${err.message}`);
  } finally {
    state.ingesting = false;
    state.ingestStatusText = "";
    render();
  }
}

async function handleUrlIngest(): Promise<void> {
  if (!state.modalUrl.trim()) return;
  state.ingesting = true;
  state.showUrlModal = false;
  state.ingestStatusText = `正在抓取网页与配图本地化，并启动双引擎解析...`;
  render();

  try {
    const data = await apiFetch<{ document: KbDocument }>("/v1/kb/ingest/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: state.modalUrl.trim(),
        collection_id: state.activeCollectionId || "col_default",
        use_leo: state.modalUseLeo,
      }),
    });
    state.activeDocId = data.document.id;
    state.modalUrl = "";
    await loadCollections();
    await loadDocuments();
  } catch (err: any) {
    alert(`URL 解析失败: ${err.message}`);
  } finally {
    state.ingesting = false;
    state.ingestStatusText = "";
    render();
  }
}

async function handleTextIngest(): Promise<void> {
  if (!state.modalText.trim()) return;
  state.ingesting = true;
  state.showTextModal = false;
  state.ingestStatusText = `正在解析文本内容并生成双版本...`;
  render();

  try {
    const data = await apiFetch<{ document: KbDocument }>("/v1/kb/ingest/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: state.modalText.trim(),
        title: state.modalTextTitle.trim() || "纯文本草稿",
        collection_id: state.activeCollectionId || "col_default",
      }),
    });
    state.activeDocId = data.document.id;
    state.modalText = "";
    state.modalTextTitle = "";
    await loadCollections();
    await loadDocuments();
  } catch (err: any) {
    alert(`文本解析失败: ${err.message}`);
  } finally {
    state.ingesting = false;
    state.ingestStatusText = "";
    render();
  }
}

// Tool Install / Upgrade
async function triggerToolAction(tool: string, action: "install" | "upgrade"): Promise<void> {
  state.showInstallModal = true;
  state.installTask = {
    taskId: "",
    tool,
    status: "running",
    progress: 10,
    logs: [`正在发起 ${tool} 的 ${action === "install" ? "安装" : "更新"} 命令...`],
  };
  render();

  try {
    const endpoint = action === "install" ? "/v1/kb/tools/install" : "/v1/kb/tools/upgrade";
    const data = await apiFetch<{ taskId: string; status: string }>(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool }),
    });

    if (state.installTask) {
      state.installTask.taskId = data.taskId;
    }

    // Poll task progress
    const poll = async () => {
      if (!state.installTask || !state.installTask.taskId) return;
      try {
        const task = await apiFetch<InstallTask>(`/v1/kb/tasks/${state.installTask.taskId}`);
        state.installTask = task;
        render();

        if (task.status === "running") {
          setTimeout(poll, 1000);
        } else {
          await loadEngineStatuses();
          render();
        }
      } catch {
        setTimeout(poll, 2000);
      }
    };
    setTimeout(poll, 1000);
  } catch (err: any) {
    if (state.installTask) {
      state.installTask.status = "failed";
      state.installTask.logs.push(`请求失败: ${err.message}`);
      render();
    }
  }
}

function getOutputContent(doc: KbDocument, engine: "markitdown" | "docling", format: "markdown" | "html" | "json"): string {
  if (engine === "markitdown") {
    if (format === "markdown") return doc.markitdown_md || "";
    if (format === "html") return doc.markitdown_html || renderMarkdownToHtml(doc.markitdown_md);
    return JSON.stringify({ title: doc.title, engine: "markitdown", markdown: doc.markitdown_md }, null, 2);
  } else {
    if (format === "markdown") return doc.docling_md || "";
    if (format === "html") return doc.docling_html || renderMarkdownToHtml(doc.docling_md);
    return doc.docling_json || JSON.stringify({ title: doc.title, engine: "docling", markdown: doc.docling_md }, null, 2);
  }
}

function renderEngineOutput(doc: KbDocument, engine: "markitdown" | "docling"): string {
  const status = engine === "markitdown" ? doc.markitdown_status : doc.docling_status;
  const error = engine === "markitdown" ? doc.markitdown_error : doc.docling_error;
  const toolName = engine === "markitdown" ? "MarkItDown" : "Docling";

  if (status === "failed") {
    return `
      <div class="command-apps-error" role="alert" style="margin-top:0;">
        <div style="font-weight:600; margin-bottom:4px;">⚠️ ${toolName} 解析失败</div>
        <div style="font-size:12px; word-break:break-all;">${esc(error || "未知解析错误")}</div>
      </div>
    `;
  }

  if (status === "skipped") {
    return `
      <div class="command-apps-hint" style="margin-top:0;">
        <div style="font-weight:600; margin-bottom:4px;">📦 ${toolName} 尚未就绪</div>
        <div style="font-size:12px; margin-bottom:10px;">本地尚未安装 ${toolName}，安装后即可自动启用该引擎进行双轨对比解析。</div>
        <button class="btn btn-xs btn-primary" onclick="window.__kbToolAction('${engine}', 'install')">一键安装 ${toolName}</button>
      </div>
    `;
  }

  if (status === "running" || status === "idle") {
    return `
      <div class="kb-empty-box" style="margin-top:20px;">
        <span class="kb-spinner"></span>
        <div class="kb-empty-box-text">${toolName} 正在解析中...</div>
      </div>
    `;
  }

  // Done status:
  if (state.showRaw[engine]) {
    const rawContent = getOutputContent(doc, engine, state.activeFormat);
    return `<textarea class="kb-raw-textarea" readonly spellcheck="false">${esc(rawContent)}</textarea>`;
  }

  if (state.activeFormat === "markdown") {
    const md = engine === "markitdown" ? doc.markitdown_md : doc.docling_md;
    return renderMarkdownToHtml(md);
  }

  if (state.activeFormat === "html") {
    const htmlContent = engine === "markitdown"
      ? (doc.markitdown_html || renderMarkdownToHtml(doc.markitdown_md))
      : (doc.docling_html || renderMarkdownToHtml(doc.docling_md));
    return `<iframe class="kb-html-iframe" sandbox="allow-same-origin" srcdoc="${esc(htmlContent)}"></iframe>`;
  }

  if (state.activeFormat === "json") {
    const jsonContent = getOutputContent(doc, engine, "json");
    return `<pre class="kb-md-pre"><code>${esc(jsonContent)}</code></pre>`;
  }

  return "";
}

// --- Main Render ---

export function render(): void {
  const root = getRoot();
  if (!root) return;

  const doc = state.activeDoc;
  const mdStatus = state.engineStatuses.markitdown || { installed: false, version: null, installCommand: "uv tool install markitdown", upgradeCommand: "uv tool upgrade markitdown" };
  const doclingStatus = state.engineStatuses.docling || { installed: false, version: null, installCommand: "uv tool install docling", upgradeCommand: "uv tool upgrade docling" };

  root.innerHTML = `
    <div class="kb-root-container" id="kb-dropzone">
      <!-- Section Header -->
      <div class="section-header kb-section-header">
        <div>
          <h2>知识库 (Knowledge Base)</h2>
          <p>多格式文档高质量解析 · 微软 MarkItDown 与 IBM Docling 双引擎对比与知识归档管理</p>
        </div>
        <div class="section-header-actions">
          <input type="file" id="kb-file-input" style="display:none;" onchange="window.__kbOnFileSelected(event)" />
          <button class="btn btn-primary" onclick="document.getElementById('kb-file-input').click()" title="支持 PDF、Word、PPT、Excel 等">
            <span>📂</span> 上传文件
          </button>
          <button class="btn" onclick="window.__kbOpenUrlModal()" title="抓取公众号/知乎等网页，支持图片防盗链本地化">
            <span>🌐</span> 抓取网页
          </button>
          <button class="btn" onclick="window.__kbOpenTextModal()" title="输入或粘贴纯文本/Markdown/HTML">
            <span>📝</span> 纯文本录入
          </button>
        </div>
      </div>

      <!-- Ingest Loading Banner -->
      ${state.ingesting ? `
        <div class="kb-ingest-banner" role="status">
          <span class="kb-spinner"></span>
          <span>${esc(state.ingestStatusText)}</span>
        </div>
      ` : ""}

      <!-- Engine Status & Health Row -->
      <div class="kb-engines-row">
        <!-- MarkItDown Card -->
        <div class="kb-engine-card ${mdStatus.installed ? "is-ready" : "is-missing"}">
          <div class="kb-engine-card-head">
            <div class="kb-engine-title-group">
              <span class="kb-engine-icon">⚡</span>
              <span class="kb-engine-name">MarkItDown</span>
              <span class="kb-engine-vendor">微软官方开源</span>
            </div>
            <div class="kb-engine-status-tag">
              <span class="${mdStatus.installed ? "dot-on" : "dot-warn"}"></span>
              <span>${mdStatus.installed ? `已就绪 ${mdStatus.version ? `· v${mdStatus.version}` : ""}` : "未安装"}</span>
            </div>
          </div>
          <div class="kb-engine-desc">轻量快速转换 Office (Word/Excel/PPT)、PDF、音频网页为标准 Markdown</div>
          <div class="kb-engine-foot">
            <code class="kb-engine-cmd" title="${esc(mdStatus.installed ? mdStatus.upgradeCommand : mdStatus.installCommand)}">${esc(mdStatus.installed ? mdStatus.upgradeCommand : mdStatus.installCommand)}</code>
            <div class="kb-engine-actions">
              ${mdStatus.installed
                ? `<button class="btn btn-xs" onclick="window.__kbToolAction('markitdown', 'upgrade')">🔄 更新</button>`
                : `<button class="btn btn-xs btn-primary" onclick="window.__kbToolAction('markitdown', 'install')">⬇️ 一键安装</button>`
              }
            </div>
          </div>
        </div>

        <!-- Docling Card -->
        <div class="kb-engine-card ${doclingStatus.installed ? "is-ready" : "is-missing"}">
          <div class="kb-engine-card-head">
            <div class="kb-engine-title-group">
              <span class="kb-engine-icon">🧠</span>
              <span class="kb-engine-name">Docling</span>
              <span class="kb-engine-vendor">IBM 深度文档理解</span>
            </div>
            <div class="kb-engine-status-tag">
              <span class="${doclingStatus.installed ? "dot-on" : "dot-warn"}"></span>
              <span>${doclingStatus.installed ? `已就绪 ${doclingStatus.version ? `· v${doclingStatus.version}` : ""}` : "未安装"}</span>
            </div>
          </div>
          <div class="kb-engine-desc">前沿版面分析与 OCR，精确提取复杂表格、层级结构，支持 Markdown/HTML/JSON</div>
          <div class="kb-engine-foot">
            <code class="kb-engine-cmd" title="${esc(doclingStatus.installed ? doclingStatus.upgradeCommand : doclingStatus.installCommand)}">${esc(doclingStatus.installed ? doclingStatus.upgradeCommand : doclingStatus.installCommand)}</code>
            <div class="kb-engine-actions">
              ${doclingStatus.installed
                ? `<button class="btn btn-xs" onclick="window.__kbToolAction('docling', 'upgrade')">🔄 更新</button>`
                : `<button class="btn btn-xs btn-primary" onclick="window.__kbToolAction('docling', 'install')">⬇️ 一键安装</button>`
              }
            </div>
          </div>
        </div>
      </div>

      <!-- Main Workspace Layout -->
      <div class="kb-layout">
        <!-- Left Sidebar: Collections & Documents -->
        <aside class="kb-sidebar">
          <!-- Collections Section -->
          <div class="kb-sidebar-section">
            <div class="kb-section-header-mini">
              <span class="kb-section-title">📁 知识库目录</span>
              <button class="btn btn-xs" onclick="window.__kbOpenCreateColModal()">+ 新建</button>
            </div>
            <div class="kb-collections-list">
              ${state.collections.map((c) => `
                <div class="kb-collection-item ${c.id === state.activeCollectionId ? "active" : ""}" onclick="window.__kbSelectCollection('${c.id}')">
                  <div class="kb-collection-name-row">
                    <span>${c.icon || "📁"}</span>
                    <span class="kb-collection-name" title="${esc(c.name)}">${esc(c.name)}</span>
                  </div>
                  <span class="mcp-badge-counter">${c.doc_count || 0}</span>
                </div>
              `).join("")}
            </div>
          </div>

          <!-- Documents Section -->
          <div class="kb-sidebar-section">
            <div class="kb-section-header-mini">
              <span class="kb-section-title">📄 文档列表 (${state.documents.length})</span>
            </div>
            <div class="kb-search-box">
              <span class="kb-search-icon">🔍</span>
              <input class="kb-search-input" type="text" placeholder="搜索文档标题或全文内容..." value="${esc(state.searchQuery)}" oninput="window.__kbOnSearchInput(event)" />
              ${state.searchQuery ? `<button class="kb-search-clear" onclick="window.__kbClearSearch()">✕</button>` : ""}
            </div>

            <div class="kb-docs-list">
              ${state.loadingDocs ? `
                <div class="kb-empty-box">
                  <span class="kb-spinner"></span>
                  <div class="kb-empty-box-sub" style="margin-top:6px;">正在加载文档...</div>
                </div>
              ` : ""}
              ${!state.loadingDocs && state.documents.length === 0 ? `
                <div class="kb-empty-box">
                  <div class="kb-empty-box-icon">📂</div>
                  <div class="kb-empty-box-text">${state.searchQuery ? "未找到匹配文档" : "当前知识库暂无文档"}</div>
                  <div class="kb-empty-box-sub">点击上方按钮或拖拽文件到窗口直接上传</div>
                </div>
              ` : ""}
              ${state.documents.map((d) => `
                <div class="kb-doc-card ${d.id === state.activeDocId ? "active" : ""}" onclick="window.__kbSelectDocument('${d.id}')">
                  <div class="kb-doc-card-top">
                    <span class="kb-doc-type-icon">${d.source_type === "url" ? "🌐" : d.source_type === "text" ? "📝" : "📄"}</span>
                    <span class="kb-doc-card-title" title="${esc(d.title)}">${esc(d.title)}</span>
                  </div>
                  <div class="kb-doc-card-engines">
                    <span class="kb-engine-tag ${d.markitdown_status === "done" ? "tag-ok" : d.markitdown_status === "failed" ? "tag-err" : "tag-skip"}">
                      ⚡ MD: ${d.markitdown_status === "done" ? `${d.markitdown_duration_ms}ms` : d.markitdown_status === "failed" ? "失败" : "未就绪"}
                    </span>
                    <span class="kb-engine-tag ${d.docling_status === "done" ? "tag-ok" : d.docling_status === "failed" ? "tag-err" : "tag-skip"}">
                      🧠 DL: ${d.docling_status === "done" ? `${(d.docling_duration_ms / 1000).toFixed(1)}s` : d.docling_status === "failed" ? "失败" : "未就绪"}
                    </span>
                  </div>
                  <div class="kb-doc-card-meta">
                    <span class="kb-doc-time">${formatDate(d.created_at)}</span>
                    <span class="kb-doc-size">${d.word_count ? `${d.word_count.toLocaleString()} 字` : formatBytes(d.file_size || 0)}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </aside>

        <!-- Right: Workbench Area -->
        <main class="kb-workbench">
          ${!doc ? `
            <!-- Empty Hero State -->
            <div class="mcp-empty-hero kb-workbench-hero">
              <div class="mcp-empty-hero-icon">📚</div>
              <div class="mcp-empty-hero-title">知识库双引擎对比工作台</div>
              <p>支持多格式办公文档、防盗链网页图文抓取本地化、OCR 表格抽取与跨格式导出。<br/>在同一界面对比微软 MarkItDown 与 IBM Docling 的解析细节，获取最优知识表达。</p>
              <div class="kb-hero-actions">
                <button class="btn btn-primary btn-lg" onclick="document.getElementById('kb-file-input').click()">
                  <span>📂</span> 上传文档解析
                </button>
                <button class="btn btn-lg" onclick="window.__kbOpenUrlModal()">
                  <span>🌐</span> 抓取网页并提取配图
                </button>
              </div>
            </div>
          ` : `
            <!-- Active Document Workbench -->
            <div class="kb-doc-workbench">
              <!-- Workbench Toolbar -->
              <div class="kb-wb-toolbar">
                <div class="kb-wb-meta-group">
                  <div class="kb-wb-doc-title" title="${esc(doc.title)}">
                    <span class="kb-wb-type-badge">${doc.source_type === "url" ? "网页" : doc.source_type === "text" ? "纯文本" : "文件"}</span>
                    <span>${esc(doc.title)}</span>
                  </div>
                  <div class="kb-wb-doc-subinfo">
                    ${doc.source_url ? `<a href="${esc(doc.source_url)}" target="_blank" class="kb-source-link" title="${esc(doc.source_url)}">🔗 ${esc(doc.source_url)}</a><span>·</span>` : ""}
                    <span>创建于 ${formatDate(doc.created_at)}</span>
                    <span>·</span>
                    <span>${doc.word_count ? `${doc.word_count.toLocaleString()} 字` : formatBytes(doc.file_size || 0)}</span>
                    ${doc.assets && doc.assets.length > 0 ? `<span>·</span><span>🖼️ ${doc.assets.length} 张提取配图</span>` : ""}
                  </div>
                </div>

                <div class="kb-wb-controls">
                  <!-- Format Segmented Toggle -->
                  <div class="mcp-segmented" title="切换输出视图格式">
                    <button class="mcp-seg-btn ${state.activeFormat === "markdown" ? "active" : ""}" onclick="window.__kbSetFormat('markdown')">Markdown</button>
                    <button class="mcp-seg-btn ${state.activeFormat === "html" ? "active" : ""}" onclick="window.__kbSetFormat('html')">HTML</button>
                    <button class="mcp-seg-btn ${state.activeFormat === "json" ? "active" : ""}" onclick="window.__kbSetFormat('json')">JSON</button>
                  </div>

                  <!-- Split View Segmented Toggle -->
                  <div class="mcp-segmented" title="切换视图分屏模式">
                    <button class="mcp-seg-btn ${state.splitMode === "both" ? "active" : ""}" onclick="window.__kbSetSplit('both')">⫴ 分屏对比</button>
                    <button class="mcp-seg-btn ${state.splitMode === "markitdown" ? "active" : ""}" onclick="window.__kbSetSplit('markitdown')">⚡ MarkItDown</button>
                    <button class="mcp-seg-btn ${state.splitMode === "docling" ? "active" : ""}" onclick="window.__kbSetSplit('docling')">🧠 Docling</button>
                  </div>

                  <button class="btn btn-sm btn-danger" onclick="window.__kbDeleteDoc('${doc.id}')" title="删除此文档">
                    🗑️ 删除
                  </button>
                </div>
              </div>

              <!-- Dual Engine Split Grid -->
              <div class="kb-engines-split-grid ${state.splitMode === "both" ? "is-dual" : "is-single"}">
                <!-- MarkItDown Panel -->
                ${state.splitMode !== "docling" ? `
                  <div class="kb-panel-box">
                    <div class="kb-panel-header">
                      <div class="kb-panel-title-group">
                        <span class="kb-panel-icon">⚡</span>
                        <span class="kb-panel-name">MarkItDown (微软)</span>
                        <span class="kb-duration-pill">${doc.markitdown_duration_ms ? `${doc.markitdown_duration_ms}ms` : "未执行"}</span>
                      </div>
                      <div class="kb-panel-actions">
                        <button class="btn btn-xs ${state.showRaw.markitdown ? "is-active" : ""}" onclick="window.__kbToggleRaw('markitdown')">
                          ${state.showRaw.markitdown ? "👁️ 富文本" : "⌨️ 源码"}
                        </button>
                        <button class="btn btn-xs" onclick="window.__kbCopyContent('markitdown')">📋 复制</button>
                        <button class="btn btn-xs" onclick="window.__kbExportContent('markitdown')">💾 导出</button>
                      </div>
                    </div>
                    <div class="kb-panel-body">
                      ${renderEngineOutput(doc, "markitdown")}
                    </div>
                  </div>
                ` : ""}

                <!-- Docling Panel -->
                ${state.splitMode !== "markitdown" ? `
                  <div class="kb-panel-box">
                    <div class="kb-panel-header">
                      <div class="kb-panel-title-group">
                        <span class="kb-panel-icon">🧠</span>
                        <span class="kb-panel-name">Docling (IBM)</span>
                        <span class="kb-duration-pill">${doc.docling_duration_ms ? `${(doc.docling_duration_ms / 1000).toFixed(1)}s` : "未执行"}</span>
                      </div>
                      <div class="kb-panel-actions">
                        <button class="btn btn-xs ${state.showRaw.docling ? "is-active" : ""}" onclick="window.__kbToggleRaw('docling')">
                          ${state.showRaw.docling ? "👁️ 富文本" : "⌨️ 源码"}
                        </button>
                        <button class="btn btn-xs" onclick="window.__kbCopyContent('docling')">📋 复制</button>
                        <button class="btn btn-xs" onclick="window.__kbExportContent('docling')">💾 导出</button>
                      </div>
                    </div>
                    <div class="kb-panel-body">
                      ${renderEngineOutput(doc, "docling")}
                    </div>
                  </div>
                ` : ""}
              </div>

              <!-- Extracted Localized Assets Tray -->
              ${doc.assets && doc.assets.length > 0 ? `
                <div class="kb-assets-drawer">
                  <div class="kb-assets-drawer-header">
                    <span class="kb-assets-title">🖼️ 本地提取资源与配图 (${doc.assets.length})</span>
                    <span class="kb-assets-hint">所有配图均已完成本地化存储，突破第三方图床防盗链限制</span>
                  </div>
                  <div class="kb-assets-gallery">
                    ${doc.assets.map((a) => `
                      <div class="kb-asset-card" onclick="window.__kbPreviewImage('${a.url}')" title="${esc(a.name)} (${formatBytes(a.sizeBytes)})">
                        <img src="${a.url}" class="kb-asset-thumb" alt="${esc(a.name)}" loading="lazy" />
                        <div class="kb-asset-meta">
                          <span class="kb-asset-name">${esc(a.name)}</span>
                          <span class="kb-asset-size">${formatBytes(a.sizeBytes)}</span>
                        </div>
                      </div>
                    `).join("")}
                  </div>
                </div>
              ` : ""}
            </div>
          `}
        </main>
      </div>

      <!-- Install / Upgrade Modal -->
      ${state.showInstallModal && state.installTask ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this && state.installTask?.status !== 'running') window.__kbCloseInstallModal()">
          <div class="kb-modal" style="width: 580px;">
            <div class="kb-modal-header">
              <span>环境安装与更新 · ${esc(state.installTask.tool)}</span>
              ${state.installTask.status !== "running" ? `<button class="vk-modal-close" onclick="window.__kbCloseInstallModal()">✕</button>` : ""}
            </div>
            <div class="kb-modal-body">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-size:13px;">执行状态: 
                  <strong>${state.installTask.status === "running" ? "⏳ 执行中..." : state.installTask.status === "succeeded" ? "✅ 成功完成" : "❌ 执行失败"}</strong>
                </span>
                <span style="font-size:12px; color:var(--text-secondary);">${state.installTask.progress}%</span>
              </div>
              <div class="kb-progress-bar-bg">
                <div class="kb-progress-bar-fill" style="width: ${state.installTask.progress}%;"></div>
              </div>
              <div class="kb-term-box" id="kb-term-logs">${esc(state.installTask.logs.join("\n"))}</div>
            </div>
            <div class="kb-modal-footer">
              ${state.installTask.status === "running" 
                ? `<button class="btn" disabled>后台运行中...</button>`
                : `<button class="btn btn-primary" onclick="window.__kbCloseInstallModal()">完成并关闭</button>`
              }
            </div>
          </div>
        </div>
      ` : ""}

      <!-- URL Ingest Modal -->
      ${state.showUrlModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this) window.__kbCloseUrlModal()">
          <div class="kb-modal" style="width: 500px;">
            <div class="kb-modal-header">
              <span>抓取网页内容与配图</span>
              <button class="vk-modal-close" onclick="window.__kbCloseUrlModal()">✕</button>
            </div>
            <div class="kb-modal-body">
              <div class="kb-form-group">
                <label class="kb-form-label">目标网页 URL 地址</label>
                <input type="text" class="kb-form-input" placeholder="输入网页链接 (例如: https://mp.weixin.qq.com/s/...)" value="${esc(state.modalUrl)}" oninput="state.modalUrl = this.value" autofocus />
              </div>
              <div class="kb-checkbox-row" style="margin-top: 10px;">
                <input type="checkbox" id="kb-check-leo" ${state.modalUseLeo ? "checked" : ""} onchange="state.modalUseLeo = this.checked" />
                <label for="kb-check-leo">突破防盗链：使用 Leo 插件 Cookie 与真实客户端凭据</label>
              </div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:8px; line-height:1.45;">
                自动抓取微信公众号、知乎、头条等网页文章，并将文中图片下载保存到网关本地，彻底杜绝防盗链失效问题。
              </div>
            </div>
            <div class="kb-modal-footer">
              <button class="btn" onclick="window.__kbCloseUrlModal()">取消</button>
              <button class="btn btn-primary" onclick="window.__kbSubmitUrlIngest()" ${!state.modalUrl.trim() ? "disabled" : ""}>开始抓取与双引擎解析</button>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Text Ingest Modal -->
      ${state.showTextModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this) window.__kbCloseTextModal()">
          <div class="kb-modal" style="width: 560px;">
            <div class="kb-modal-header">
              <span>纯文本 / Markdown 快速录入</span>
              <button class="vk-modal-close" onclick="window.__kbCloseTextModal()">✕</button>
            </div>
            <div class="kb-modal-body">
              <div class="kb-form-group">
                <label class="kb-form-label">文档标题 (可选)</label>
                <input type="text" class="kb-form-input" placeholder="输入文档标题 (默认为纯文本草稿)" value="${esc(state.modalTextTitle)}" oninput="state.modalTextTitle = this.value" />
              </div>
              <div class="kb-form-group">
                <label class="kb-form-label">正文内容</label>
                <textarea class="kb-form-textarea" placeholder="在此粘贴任意文本、HTML 或 Markdown 结构..." oninput="state.modalText = this.value">${esc(state.modalText)}</textarea>
              </div>
            </div>
            <div class="kb-modal-footer">
              <button class="btn" onclick="window.__kbCloseTextModal()">取消</button>
              <button class="btn btn-primary" onclick="window.__kbSubmitTextIngest()" ${!state.modalText.trim() ? "disabled" : ""}>提交并开始解析</button>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Create Collection Modal -->
      ${state.showCreateColModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this) window.__kbCloseCreateColModal()">
          <div class="kb-modal" style="width: 440px;">
            <div class="kb-modal-header">
              <span>新建知识库分类目录</span>
              <button class="vk-modal-close" onclick="window.__kbCloseCreateColModal()">✕</button>
            </div>
            <div class="kb-modal-body">
              <div class="kb-form-group">
                <label class="kb-form-label">分类名称</label>
                <input type="text" class="kb-form-input" placeholder="例如: 深度研报、工程架构、竞品跟踪" value="${esc(state.modalColName)}" oninput="state.modalColName = this.value" autofocus />
              </div>
              <div class="kb-form-group">
                <label class="kb-form-label">分类描述 (可选)</label>
                <input type="text" class="kb-form-input" placeholder="简要描述该分类下的文档类型" value="${esc(state.modalColDesc)}" oninput="state.modalColDesc = this.value" />
              </div>
            </div>
            <div class="kb-modal-footer">
              <button class="btn" onclick="window.__kbCloseCreateColModal()">取消</button>
              <button class="btn btn-primary" onclick="window.__kbSubmitCreateCol()" ${!state.modalColName.trim() ? "disabled" : ""}>创建分类</button>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Image Lightbox Modal -->
      ${state.previewAsset ? `
        <div class="kb-modal-backdrop" onclick="window.__kbCloseImagePreview()">
          <div style="max-width:90vw; max-height:90vh; display:flex; flex-direction:column; align-items:center;">
            <img src="${state.previewAsset.url}" style="max-width:100%; max-height:80vh; border-radius:var(--radius-lg, 8px); box-shadow:0 20px 60px rgba(0,0,0,0.6); border:1px solid var(--border-color); background:#000;" />
            <div style="color:var(--text-primary); margin-top:12px; font-size:13px; font-weight:500; background:rgba(0,0,0,0.7); padding:4px 14px; border-radius:999px; border:1px solid rgba(255,255,255,0.15);">
              ${esc(state.previewAsset.name)} · ${formatBytes(state.previewAsset.sizeBytes)}
            </div>
          </div>
        </div>
      ` : ""}
    </div>
  `;

  // Auto scroll terminal logs
  const termEl = document.getElementById("kb-term-logs");
  if (termEl) termEl.scrollTop = termEl.scrollHeight;

  // Bind Drag & Drop
  bindDragAndDrop();
}

function bindDragAndDrop(): void {
  const dropzone = document.getElementById("kb-dropzone");
  if (!dropzone) return;

  dropzone.ondragover = (e) => {
    e.preventDefault();
  };

  dropzone.ondrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFileUpload(e.dataTransfer.files[0]);
    }
  };
}

// --- Window Action Bindings ---

(window as any).__kbSelectCollection = (id: string) => {
  state.activeCollectionId = id;
  state.searchQuery = "";
  void loadDocuments();
};

(window as any).__kbSelectDocument = (id: string) => {
  state.activeDocId = id;
  void loadActiveDocDetail(id).then(() => render());
};

(window as any).__kbOnSearchInput = (e: any) => {
  state.searchQuery = e.target.value;
  void loadDocuments();
};

(window as any).__kbClearSearch = () => {
  state.searchQuery = "";
  void loadDocuments();
};

(window as any).__kbSetFormat = (fmt: "markdown" | "html" | "json") => {
  state.activeFormat = fmt;
  render();
};

(window as any).__kbSetSplit = (mode: "both" | "markitdown" | "docling") => {
  state.splitMode = mode;
  render();
};

(window as any).__kbToggleRaw = (engine: "markitdown" | "docling") => {
  state.showRaw[engine] = !state.showRaw[engine];
  render();
};

(window as any).__kbOnFileSelected = (e: any) => {
  if (e.target.files && e.target.files[0]) {
    void handleFileUpload(e.target.files[0]);
  }
};

(window as any).__kbToolAction = (tool: string, action: "install" | "upgrade") => {
  void triggerToolAction(tool, action);
};

(window as any).__kbCloseInstallModal = () => {
  state.showInstallModal = false;
  render();
};

(window as any).__kbOpenUrlModal = () => {
  state.showUrlModal = true;
  render();
};

(window as any).__kbCloseUrlModal = () => {
  state.showUrlModal = false;
  render();
};

(window as any).__kbSubmitUrlIngest = () => {
  void handleUrlIngest();
};

(window as any).__kbOpenTextModal = () => {
  state.showTextModal = true;
  render();
};

(window as any).__kbCloseTextModal = () => {
  state.showTextModal = false;
  render();
};

(window as any).__kbSubmitTextIngest = () => {
  void handleTextIngest();
};

(window as any).__kbOpenCreateColModal = () => {
  state.showCreateColModal = true;
  render();
};

(window as any).__kbCloseCreateColModal = () => {
  state.showCreateColModal = false;
  render();
};

(window as any).__kbSubmitCreateCol = async () => {
  if (!state.modalColName.trim()) return;
  try {
    const data = await apiFetch<{ collection: KbCollection }>("/v1/kb/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: state.modalColName.trim(),
        description: state.modalColDesc.trim(),
      }),
    });
    state.showCreateColModal = false;
    state.modalColName = "";
    state.modalColDesc = "";
    await loadCollections();
    state.activeCollectionId = data.collection.id;
    await loadDocuments();
  } catch (err: any) {
    alert(`创建分类失败: ${err.message}`);
  }
};

(window as any).__kbDeleteDoc = async (id: string) => {
  if (!confirm("确定要删除此文档吗？相关的解析缓存和配图也将一并清理。")) return;
  try {
    await apiFetch(`/v1/kb/documents/${id}`, { method: "DELETE" });
    await loadCollections();
    await loadDocuments();
  } catch (err: any) {
    alert(`删除失败: ${err.message}`);
  }
};

(window as any).__kbCopyContent = (engine: "markitdown" | "docling") => {
  if (!state.activeDoc) return;
  const content = getOutputContent(state.activeDoc, engine, state.activeFormat);
  navigator.clipboard.writeText(content).then(() => {
    alert("已复制解析内容到剪贴板！");
  });
};

(window as any).__kbExportContent = (engine: "markitdown" | "docling") => {
  if (!state.activeDoc) return;
  const content = getOutputContent(state.activeDoc, engine, state.activeFormat);
  const ext = state.activeFormat === "markdown" ? ".md" : state.activeFormat === "html" ? ".html" : ".json";
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.activeDoc.title}_${engine}${ext}`;
  a.click();
  URL.revokeObjectURL(url);
};

(window as any).__kbPreviewImage = (url: string) => {
  state.previewAsset = { name: "文档配图预览", url, localPath: "", sizeBytes: 0 };
  render();
};

(window as any).__kbCloseImagePreview = () => {
  state.previewAsset = null;
  render();
};

// Register Tab Lifecycle
registerTab("knowledge-base", {
  onEnter: () => {
    void initKnowledgeBase();
  },
});
