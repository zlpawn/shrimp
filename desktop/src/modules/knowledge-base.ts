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
  source_type: "file" | "url" | "text" | "craft" | "video";
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

export type KbPhaseView = "parser" | "chunking" | "retrieval" | "rag";

// --- State ---
const state = {
  activePhase: "parser" as KbPhaseView,
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
  showEditColModal: false,
  editingColId: "",
  editColName: "",
  editColDesc: "",
  showUrlModal: false,
  showTextModal: false,
  modalUrl: "",
  modalUseLeo: true,
  modalText: "",
  modalTextTitle: "",
  modalColName: "",
  modalColDesc: "",
  previewAsset: null as KbAsset | null,
  showCraftModal: false,
  craftStatus: null as null | { connected: boolean; spaceName?: string; error?: string },
  craftLoading: false,
  craftDocuments: [] as Array<{ id: string; title: string; snippet?: string }>,
  craftSelectedIds: new Set<string>(),
  craftSearchQuery: "",
  craftImporting: false,
  craftImportTargetCol: "col_default",
  // Phase 2-4 interactive preview state
  chunkSize: 1024,
  chunkOverlap: 128,
  selectedEmbeddingModel: "text-embedding-3-small",
  hybridWeight: 0.5,
};

function getRoot(): HTMLElement | null {
  return document.getElementById("knowledge-base-root");
}

function getCollectionIcon(icon?: string): string {
  if (!icon || icon === "folder") return "📁";
  return icon;
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

/**
 * Instant initialization: renders immediately without blocking on network/process detection!
 */
export function initKnowledgeBase(): void {
  // 1. Instant optimistic render (0ms delay)
  render();

  // 2. Load collections & documents asynchronously
  void loadCollections()
    .then(() => loadDocuments())
    .then(() => render());

  // 3. Load engine statuses asynchronously in background
  void loadEngineStatuses().then(() => render());
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

// Craft MCP Channel Handlers
let craftSearchTimer: any = null;

async function openCraftModal(): Promise<void> {
  state.showCraftModal = true;
  state.craftLoading = true;
  state.craftSearchQuery = "";
  state.craftSelectedIds = new Set();
  state.craftImportTargetCol = state.activeCollectionId || "col_default";
  render();

  try {
    const status = await apiFetch<{ connected: boolean; spaceName?: string; error?: string }>("/v1/kb/channels/craft/status");
    state.craftStatus = status;
    if (status.connected) {
      const data = await apiFetch<{ documents: Array<{ id: string; title: string; snippet?: string }> }>("/v1/kb/channels/craft/documents?limit=50");
      state.craftDocuments = data.documents || [];
    } else {
      state.craftDocuments = [];
    }
  } catch (err: any) {
    state.craftStatus = { connected: false, error: err.message };
    state.craftDocuments = [];
  } finally {
    state.craftLoading = false;
    render();
  }
}

async function searchCraftDocuments(query: string): Promise<void> {
  state.craftSearchQuery = query;
  state.craftLoading = true;
  render();

  try {
    const q = encodeURIComponent(query.trim());
    const data = await apiFetch<{ documents: Array<{ id: string; title: string; snippet?: string }> }>(
      `/v1/kb/channels/craft/documents?limit=50${q ? `&q=${q}` : ""}`
    );
    state.craftDocuments = data.documents || [];
  } catch (err: any) {
    console.error("Search craft error:", err);
  } finally {
    state.craftLoading = false;
    render();
  }
}

async function importSingleCraftDoc(rootBlockId: string, title: string): Promise<void> {
  state.craftImporting = true;
  render();

  try {
    const targetCol = state.craftImportTargetCol || state.activeCollectionId || "col_default";
    const res = await apiFetch<{ document: KbDocument }>("/v1/kb/channels/craft/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootBlockId,
        title,
        collection_id: targetCol,
      }),
    });
    state.showCraftModal = false;
    state.activeDocId = res.document.id;
    await loadCollections();
    await loadDocuments();
  } catch (err: any) {
    alert(`导入 Craft 笔记失败: ${err.message}`);
  } finally {
    state.craftImporting = false;
    render();
  }
}

async function batchImportCraftDocs(): Promise<void> {
  if (state.craftSelectedIds.size === 0) return;
  state.craftImporting = true;
  render();

  try {
    const targetCol = state.craftImportTargetCol || state.activeCollectionId || "col_default";
    const items = Array.from(state.craftSelectedIds).map((id) => {
      const doc = state.craftDocuments.find((d) => d.id === id);
      return { rootBlockId: id, title: doc?.title || "" };
    });

    const res = await apiFetch<{ imported: KbDocument[]; failed: any[]; total: number }>("/v1/kb/channels/craft/batch-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        collection_id: targetCol,
      }),
    });

    state.showCraftModal = false;
    state.craftSelectedIds.clear();
    await loadCollections();
    await loadDocuments();
    if (res.imported && res.imported.length > 0) {
      state.activeDocId = res.imported[0].id;
    }
  } catch (err: any) {
    alert(`批量导入失败: ${err.message}`);
  } finally {
    state.craftImporting = false;
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

// --- Phase 2: Chunking & Embedding Preview View ---
function renderPhaseChunking(): string {
  return `
    <div class="kb-phase-blueprint">
      <div class="kb-phase-hero">
        <div class="kb-phase-hero-info">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <span class="kb-tab-badge-phase is-planned">未就绪</span>
            <span class="kb-phase-status-badge">🛠️ 架构与数据协议已就绪</span>
          </div>
          <h3>知识切片流水线与 LanceDB 嵌入式向量索引</h3>
          <p>基于高保真解析出的结构化 Markdown 与富文本，提供智能分块（段落/Markdown 层级/语义）、向量嵌入（Embedding）并持久化到本地 LanceDB 向量数据库，为 RAG 问答提供高召回知识单元。</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-primary" onclick="alert('知识切片引擎正在流水线集成中，解析出的所有 Markdown 与富文本将可无缝直接灌入！')">▶️ 开启切片索引构建</button>
        </div>
      </div>

      <div class="kb-phase-grid">
        <div class="kb-phase-card">
          <div class="kb-phase-card-title"><span>🧩</span> 智能分块策略 (Chunking Strategies)</div>
          <div class="kb-phase-card-desc">针对技术文档、研报、跨页表格与法规提供定制切片算法，保留语义完整性。</div>
          <ul class="kb-phase-feature-list">
            <li class="kb-phase-feature-item"><span>🔹</span> <span><code>Header-Aware Chunker</code>：识别 Markdown <code># / ## / ###</code> 层级分层切片</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><code>Table-Preserving Chunker</code>：完整保留 Docling 提取的跨页表格，不被打断</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><code>Semantic Chunker</code>：基于余弦相似度相邻断句自适应合并</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><code>QA Synthesis</code>：针对切片自动提取 3~5 个高频问答对辅助索引</span></li>
          </ul>
        </div>

        <div class="kb-phase-card">
          <div class="kb-phase-card-title"><span>📐</span> 向量模型路由 (Embedding Pipeline)</div>
          <div class="kb-phase-card-desc">复用本网关现有模型路由中心，支持云端与本地向量模型无缝调度。</div>
          <ul class="kb-phase-feature-list">
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>网关模型中转</b>：支持 <code>text-embedding-3-small</code>, <code>bge-m3</code>, <code>nomic-embed</code></span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>本地离线模型</b>：支持纯本地 FastEmbed / Ollama 向量模型</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>批量批处理</b>：自动多线程 Batching 并发，防止接口限流</span></li>
          </ul>
        </div>

        <div class="kb-phase-card">
          <div class="kb-phase-card-title"><span>🗄️</span> 嵌入式向量库 (LanceDB)</div>
          <div class="kb-phase-card-desc">基于 Lance 列式格式的现代化嵌入式向量数据库，零常驻开销。</div>
          <ul class="kb-phase-feature-list">
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>自包含免运维</b>：单机文件存储在 <code>data/knowledge-base/lancedb/</code></span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>极速向量检索</b>：基于 Rust / Arrow 底层加速，支持百万向量毫秒级余弦搜索</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>元数据过滤</b>：支持按 <code>collection_id</code>、文档 ID、更新时间联合过滤</span></li>
          </ul>
        </div>
      </div>
    </div>
  `;
}

// --- Phase 3: Hybrid Retrieval & Rerank Lab View ---
function renderPhaseRetrieval(): string {
  return `
    <div class="kb-phase-blueprint">
      <div class="kb-phase-hero">
        <div class="kb-phase-hero-info">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <span class="kb-tab-badge-phase is-planned">未就绪</span>
            <span class="kb-phase-status-badge">🎯 FTS5 引擎已就绪 · RRF 融合评测中</span>
          </div>
          <h3>多路混合检索与重排精排评测实验室 (Hybrid Retrieval Lab)</h3>
          <p>融合 BM25 关键词倒排索引与 Dense 向量语义检索，并通过 BGE-Reranker 二次重排打分，提供可视化的检索召回效果调优控制台。</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-primary" onclick="alert('混合检索评测室正在对齐 RRF 参数算法！当前 SQLite FTS5 全文搜索已可用。')">🔍 运行检索召回基准评测</button>
        </div>
      </div>

      <div class="kb-phase-grid">
        <div class="kb-phase-card">
          <div class="kb-phase-card-title"><span>🔍</span> 双路融合检索 (Hybrid Search)</div>
          <div class="kb-phase-card-desc">兼顾专有名词精确匹配与模糊自然语言语义泛化。</div>
          <ul class="kb-phase-feature-list">
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>BM25 全文路</b>：基于已有 SQLite FTS5 引擎，针对代码、专有名词、型号百分百命中</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>向量语义路</b>：基于 LanceDB 语义相似度，处理口语化同义词表达</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>RRF 排名融合</b>：基于倒数排名公式自适应归一化多路得分</span></li>
          </ul>
        </div>

        <div class="kb-phase-card">
          <div class="kb-phase-card-title"><span>⚖️</span> 重排精排模型 (Cross-Encoder Rerank)</div>
          <div class="kb-phase-card-desc">解决向量检索中相关度虚高问题，将最精准事实排在前列。</div>
          <ul class="kb-phase-feature-list">
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>支持模型</b>：<code>bge-reranker-v2-m3</code>, <code>cohere-rerank-v3</code>, <code>flashrank</code></span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>动态上下文压缩</b>：精简注入 LLM 的上下文窗口，节省 Token 消耗</span></li>
          </ul>
        </div>

        <div class="kb-phase-card">
          <div class="kb-phase-card-title"><span>🧪</span> 可视化评测工作台 (Benchmark Workbench)</div>
          <div class="kb-phase-card-desc">输入任意自然语言问题，实时对比纯关键词、纯向量与混合重排的三栏召回得分分布。</div>
          <ul class="kb-phase-feature-list">
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>Top-K 命中高亮</b>：高亮展示匹配的具体文档切片与原文定位</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>参数一键热调</b>：实时调整 Dense/Sparse 权重比值与阈值截断</span></li>
          </ul>
        </div>
      </div>
    </div>
  `;
}

// --- Phase 4: RAG Chat & Agent Tool View ---
function renderPhaseRag(): string {
  return `
    <div class="kb-phase-blueprint">
      <div class="kb-phase-hero">
        <div class="kb-phase-hero-info">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <span class="kb-tab-badge-phase is-planned">未就绪</span>
            <span class="kb-phase-status-badge">💬 溯源问答原型 & MCP 协议</span>
          </div>
          <h3>基于精准溯源的 RAG 问答舱与 Agent 原生工具赋能</h3>
          <p>支持与知识库直接展开多轮流式对话，回答严格基于召回上下文并附带可交互的文档引用溯源；同时将知识库自动发布为标准 MCP 工具，供外部编程 Agent 自主检索。</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-primary" onclick="alert('问答工作舱与 MCP 适配器正在对接，未来 Claude Code、Codex、Antigravity 即可直接对话检索此库！')">💬 开启对话舱</button>
        </div>
      </div>

      <div class="kb-phase-grid">
        <div class="kb-phase-card">
          <div class="kb-phase-card-title"><span>💬</span> 知识库对话舱 (Chat with KB)</div>
          <div class="kb-phase-card-desc">为用户提供沉浸式的问答界面，支持多轮会话记忆。</div>
          <ul class="kb-phase-feature-list">
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>严格防幻觉 Prompt</b>：要求模型完全依据知识库事实作答，未知内容坦诚说明</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>流式打字机输出</b>：打字机即时展现思考过程与最终论述</span></li>
          </ul>
        </div>

        <div class="kb-phase-card">
          <div class="kb-phase-card-title"><span>🔗</span> 精准引用与溯源高亮 (Citations & Grounding)</div>
          <div class="kb-phase-card-desc">回答段落右上角带有一键溯源码，点击直接定位文档原处。</div>
          <ul class="kb-phase-feature-list">
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>原文抽屉弹出</b>：点击 [1]、[2] 徽章，侧栏立即高亮展示原切片与对应图片</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>图表双向联动</b>：如果回答涉及 Excel 提取表格或 Docling 配图，可内嵌直接预览</span></li>
          </ul>
        </div>

        <div class="kb-phase-card">
          <div class="kb-phase-card-title"><span>🤖</span> Agent 级 MCP 工具导出 (Agent Tool Integration)</div>
          <div class="kb-phase-card-desc">无缝联动网关现有的 MCP 枢纽 (MCP Hub)。</div>
          <ul class="kb-phase-feature-list">
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>内置原生 MCP Server</b>：自动暴露 <code>kb_search</code>, <code>kb_get_document</code> 工具</span></li>
            <li class="kb-phase-feature-item"><span>🔹</span> <span><b>全客户端分发</b>：一键写入 Claude Desktop, Claude Code, Codex 与 Antigravity</span></li>
          </ul>
        </div>
      </div>
    </div>
  `;
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
          <button class="btn" onclick="window.__kbOpenCraftModal()" title="从 Craft 笔记软件导入文档与知识库">
            <span>📓</span> 导入 Craft 笔记
          </button>
          <button class="btn" onclick="window.__kbOpenUrlModal()" title="抓取公众号/知乎等网页内容，支持图片防盗链本地化">
            <span>🌐</span> 抓取网页内容
          </button>
          <button class="btn" onclick="window.__kbOpenTextModal()" title="输入或粘贴纯文本/Markdown/HTML">
            <span>📝</span> 纯文本录入
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="kb-nav-tabs">
        <button class="kb-nav-tab-btn ${state.activePhase === "parser" ? "active" : ""}" onclick="window.__kbSwitchView('parser')">
          <span>📑 文档解析与对比工作台</span>
        </button>
        <button class="kb-nav-tab-btn ${state.activePhase === "chunking" ? "active" : ""}" onclick="window.__kbSwitchView('chunking')">
          <span>🧩 知识切片与向量索引</span>
          <span class="kb-tab-badge-phase is-planned">未就绪</span>
        </button>
        <button class="kb-nav-tab-btn ${state.activePhase === "retrieval" ? "active" : ""}" onclick="window.__kbSwitchView('retrieval')">
          <span>🎯 混合检索评测室</span>
          <span class="kb-tab-badge-phase is-planned">未就绪</span>
        </button>
        <button class="kb-nav-tab-btn ${state.activePhase === "rag" ? "active" : ""}" onclick="window.__kbSwitchView('rag')">
          <span>💬 RAG 问答与 Agent 工具</span>
          <span class="kb-tab-badge-phase is-planned">未就绪</span>
        </button>
      </div>

      <!-- Ingest Loading Banner -->
      ${state.ingesting ? `
        <div class="kb-ingest-banner" role="status">
          <span class="kb-spinner"></span>
          <span>${esc(state.ingestStatusText)}</span>
        </div>
      ` : ""}

      <!-- Content Views according to activePhase -->
      ${state.activePhase === "chunking" ? renderPhaseChunking() : ""}
      ${state.activePhase === "retrieval" ? renderPhaseRetrieval() : ""}
      ${state.activePhase === "rag" ? renderPhaseRag() : ""}

      ${state.activePhase === "parser" ? `
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
                ${state.collections.map((c) => {
                  const icon = getCollectionIcon(c.icon);
                  const isDefault = c.id === "col_default";
                  return `
                  <div class="kb-collection-item ${c.id === state.activeCollectionId ? "active" : ""}" onclick="window.__kbSelectCollection('${c.id}')">
                    <div class="kb-collection-name-row">
                      <span class="kb-col-icon">${icon}</span>
                      <span class="kb-collection-name" title="${esc(c.name)}">${esc(c.name)}</span>
                    </div>
                    <div class="kb-collection-meta-row">
                      <span class="mcp-badge-counter">${c.doc_count || 0}</span>
                      <div class="kb-col-actions" onclick="event.stopPropagation()">
                        <button class="kb-col-btn" title="重命名 / 编辑目录" onclick="window.__kbOpenEditColModal('${c.id}')">✏️</button>
                        ${!isDefault ? `
                          <button class="kb-col-btn text-danger" title="删除知识库目录及全部文档" onclick="window.__kbDeleteCollection('${c.id}', '${esc(c.name)}')">🗑️</button>
                        ` : ""}
                      </div>
                    </div>
                  </div>
                `;}).join("")}
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
                      <span class="kb-doc-type-icon">${d.source_type === "url" ? "🌐" : d.source_type === "text" ? "📝" : d.source_type === "craft" ? "📓" : "📄"}</span>
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
                <p>支持多格式办公文档、防盗链网页图文抓取本地化、Craft 笔记无缝同步、OCR 表格抽取与跨格式导出。<br/>在同一界面对比微软 MarkItDown 与 IBM Docling 的解析细节，获取最优知识表达。</p>
                <div class="kb-hero-actions">
                  <button class="btn btn-primary btn-lg" onclick="document.getElementById('kb-file-input').click()">
                    <span>📂</span> 上传文档解析
                  </button>
                  <button class="btn btn-lg" onclick="window.__kbOpenCraftModal()">
                    <span>📓</span> 导入 Craft 笔记
                  </button>
                  <button class="btn btn-lg" onclick="window.__kbOpenUrlModal()">
                    <span>🌐</span> 抓取网页内容
                  </button>
                  <button class="btn btn-lg" onclick="window.__kbOpenTextModal()">
                    <span>📝</span> 纯文本录入
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
                      <span class="kb-wb-type-badge">${doc.source_type === "url" ? "网页" : doc.source_type === "text" ? "纯文本" : doc.source_type === "craft" ? "Craft 笔记" : "文件"}</span>
                      <span>${esc(doc.title)}</span>
                    </div>
                    <div class="kb-wb-doc-subinfo">
                      ${doc.source_url ? `<a href="${esc(doc.source_url)}" ${doc.source_type === "craft" ? "" : 'target="_blank"'} class="kb-source-link" title="${esc(doc.source_url)}">${doc.source_type === "craft" ? "📓 在 Craft 中打开" : `🔗 ${esc(doc.source_url)}`}</a><span>·</span>` : ""}
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
      ` : ""}

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
              <span>抓取网页内容</span>
              <button class="vk-modal-close" onclick="window.__kbCloseUrlModal()">✕</button>
            </div>
            <div class="kb-modal-body">
              <div class="kb-form-group">
                <label class="kb-form-label">目标网页 URL 地址</label>
                <input type="text" class="kb-form-input" placeholder="输入网页链接 (例如: https://mp.weixin.qq.com/s/...)" value="${esc(state.modalUrl)}" oninput="state.modalUrl = this.value" onkeydown="if (event.key === 'Enter') window.__kbSubmitUrlIngest()" autofocus />
              </div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:10px; line-height:1.5;">
                💡 <b>自动配置与鉴权</b>：系统将自动识别目标域名并联动真实客户端凭据，同时自动将文内图片转存至本地，彻底解决内网鉴权与防盗链失效问题。
              </div>
            </div>
            <div class="kb-modal-footer">
              <button class="btn" onclick="window.__kbCloseUrlModal()">取消</button>
              <button class="btn btn-primary" onclick="window.__kbSubmitUrlIngest()" ${!state.modalUrl.trim() ? "disabled" : ""}>开始抓取与解析</button>
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

      <!-- Craft Notes Import Modal -->
      ${state.showCraftModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this && !state.craftImporting) window.__kbCloseCraftModal()">
          <div class="kb-modal" style="width: 720px; max-height: 85vh; display: flex; flex-direction: column;">
            <div class="kb-modal-header" style="flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 18px;">📓</span>
                <span style="font-weight: 600; font-size: 15px;">从 Craft 笔记同步知识</span>
                ${state.craftStatus?.connected
                  ? `<span class="badge badge-success" style="font-size: 11px; padding: 2px 8px; border-radius: 12px;">🟢 ${esc(state.craftStatus.spaceName || "已连接 Space")}</span>`
                  : state.craftLoading
                  ? `<span class="badge" style="font-size: 11px; padding: 2px 8px;">连接中...</span>`
                  : `<span class="badge badge-error" style="font-size: 11px; padding: 2px 8px; border-radius: 12px;">🔴 未连接</span>`
                }
              </div>
              ${!state.craftImporting ? `<button class="vk-modal-close" onclick="window.__kbCloseCraftModal()">✕</button>` : ""}
            </div>

            <div class="kb-modal-body" style="overflow-y: auto; flex: 1; padding: 16px 20px;">
              ${!state.craftStatus?.connected && !state.craftLoading ? `
                <div class="kb-alert kb-alert-error" style="margin-bottom: 14px; padding: 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3);">
                  <div style="font-weight: 600; color: #ef4444;">Craft MCP 服务连接失败</div>
                  <div style="font-size: 12px; margin-top: 4px; color: var(--text-secondary);">
                    ${esc(state.craftStatus?.error || "无法连接到 Craft MCP 链接")}
                  </div>
                  <div style="font-size: 12px; margin-top: 6px; color: var(--text-muted);">
                    提示：系统已尝试读取 <code>~/.gemini/config/mcp_config.json</code> 中的 Craft 配置。请检查 Craft MCP 服务状态。
                  </div>
                </div>
              ` : `
                <!-- Filter bar: Search + Target Collection -->
                <div style="display: flex; gap: 12px; margin-bottom: 14px; align-items: center;">
                  <div style="flex: 1; position: relative;">
                    <input type="text" class="kb-form-input" placeholder="🔍 搜索 Craft 笔记标题或全文..."
                      value="${esc(state.craftSearchQuery)}"
                      oninput="window.__kbOnCraftSearch(this.value)"
                      ${state.craftImporting ? "disabled" : ""} />
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px; font-size: 13px;">
                    <span style="white-space: nowrap; color: var(--text-secondary);">目标知识库:</span>
                    <select class="kb-form-input" style="width: 150px; padding: 6px 10px;"
                      onchange="state.craftImportTargetCol = this.value"
                      ${state.craftImporting ? "disabled" : ""}>
                      ${state.collections.map((c) => `
                        <option value="${c.id}" ${(state.craftImportTargetCol || state.activeCollectionId || 'col_default') === c.id ? 'selected' : ''}>
                          ${getCollectionIcon(c.icon)} ${esc(c.name)}
                        </option>
                      `).join('')}
                    </select>
                  </div>
                </div>

                <!-- Notes List -->
                ${state.craftLoading ? `
                  <div style="text-align: center; padding: 48px; color: var(--text-secondary);">
                    <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
                    <div>正在从 Craft 获取笔记列表...</div>
                  </div>
                ` : state.craftDocuments.length === 0 ? `
                  <div style="text-align: center; padding: 48px; color: var(--text-secondary);">
                    <div style="font-size: 24px; margin-bottom: 8px;">🔍</div>
                    <div>未找到匹配的 Craft 笔记</div>
                  </div>
                ` : `
                  <div style="border: 1px solid var(--border-color); border-radius: 6px; max-height: 380px; overflow-y: auto; background: var(--bg-secondary);">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                      <thead style="background: var(--bg-tertiary); position: sticky; top: 0; z-index: 1;">
                        <tr style="border-bottom: 1px solid var(--border-color); text-align: left;">
                          <th style="padding: 10px 14px; width: 40px;">
                            <input type="checkbox"
                              ${state.craftSelectedIds.size === state.craftDocuments.length && state.craftDocuments.length > 0 ? "checked" : ""}
                              onchange="window.__kbToggleAllCraftDocs(this.checked)"
                              ${state.craftImporting ? "disabled" : ""} />
                          </th>
                          <th style="padding: 10px 14px;">笔记标题与摘要</th>
                          <th style="padding: 10px 14px; width: 80px; text-align: right;">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${state.craftDocuments.map((d) => `
                          <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.15s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
                            <td style="padding: 10px 14px; vertical-align: middle;">
                              <input type="checkbox" value="${d.id}"
                                ${state.craftSelectedIds.has(d.id) ? "checked" : ""}
                                onchange="window.__kbToggleCraftDoc('${d.id}', this.checked)"
                                ${state.craftImporting ? "disabled" : ""} />
                            </td>
                            <td style="padding: 10px 14px; vertical-align: middle;">
                              <div style="font-weight: 500; color: var(--text-primary);">${esc(d.title)}</div>
                              ${d.snippet ? `<div style="font-size: 11px; color: var(--text-muted); max-width: 460px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px;">${esc(d.snippet)}</div>` : ''}
                            </td>
                            <td style="padding: 10px 14px; text-align: right; vertical-align: middle;">
                              <button class="btn btn-xs btn-primary" onclick="window.__kbImportSingleCraftDoc('${d.id}', '${esc(d.title)}')" ${state.craftImporting ? "disabled" : ""}>
                                导入
                              </button>
                            </td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                `}
              `}
            </div>

            <div class="kb-modal-footer" style="flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;">
              <div style="font-size: 12px; color: var(--text-secondary);">
                ${state.craftSelectedIds.size > 0 ? `已选 <b style="color: var(--text-primary);">${state.craftSelectedIds.size}</b> 篇笔记` : `共 ${state.craftDocuments.length} 篇可用笔记`}
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="btn" onclick="window.__kbCloseCraftModal()" ${state.craftImporting ? "disabled" : ""}>取消</button>
                <button class="btn btn-primary" onclick="window.__kbBatchImportCraftDocs()" ${state.craftSelectedIds.size === 0 || state.craftImporting ? "disabled" : ""}>
                  ${state.craftImporting ? `正在解析导入中...` : `批量导入 (${state.craftSelectedIds.size})`}
                </button>
              </div>
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
                <input type="text" class="kb-form-input" placeholder="例如: 深度研报、工程架构、竞品跟踪" value="${esc(state.modalColName)}" oninput="state.modalColName = this.value" onkeydown="if (event.key === 'Enter') window.__kbSubmitCreateCol()" autofocus />
              </div>
              <div class="kb-form-group">
                <label class="kb-form-label">分类描述 (可选)</label>
                <input type="text" class="kb-form-input" placeholder="简要描述该分类下的文档类型" value="${esc(state.modalColDesc)}" oninput="state.modalColDesc = this.value" onkeydown="if (event.key === 'Enter') window.__kbSubmitCreateCol()" />
              </div>
            </div>
            <div class="kb-modal-footer">
              <button class="btn" onclick="window.__kbCloseCreateColModal()">取消</button>
              <button class="btn btn-primary" onclick="window.__kbSubmitCreateCol()" ${!state.modalColName.trim() ? "disabled" : ""}>创建分类</button>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Edit Collection Modal -->
      ${state.showEditColModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this) window.__kbCloseEditColModal()">
          <div class="kb-modal" style="width: 440px;">
            <div class="kb-modal-header">
              <span>编辑知识库目录</span>
              <button class="vk-modal-close" onclick="window.__kbCloseEditColModal()">✕</button>
            </div>
            <div class="kb-modal-body">
              <div class="kb-form-group">
                <label class="kb-form-label">目录名称</label>
                <input type="text" class="kb-form-input" placeholder="请输入知识库名称" value="${esc(state.editColName)}" oninput="state.editColName = this.value" onkeydown="if (event.key === 'Enter') window.__kbSubmitEditCol()" autofocus />
              </div>
              <div class="kb-form-group">
                <label class="kb-form-label">目录描述 (可选)</label>
                <input type="text" class="kb-form-input" placeholder="简要描述该分类下的文档类型或用途" value="${esc(state.editColDesc)}" oninput="state.editColDesc = this.value" onkeydown="if (event.key === 'Enter') window.__kbSubmitEditCol()" />
              </div>
            </div>
            <div class="kb-modal-footer">
              <button class="btn" onclick="window.__kbCloseEditColModal()">取消</button>
              <button class="btn btn-primary" onclick="window.__kbSubmitEditCol()" ${!state.editColName.trim() ? "disabled" : ""}>保存修改</button>
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

(window as any).__kbSwitchView = (phase: KbPhaseView) => {
  state.activePhase = phase;
  render();
};

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

(window as any).__kbOpenCraftModal = () => {
  void openCraftModal();
};

(window as any).__kbCloseCraftModal = () => {
  if (state.craftImporting) return;
  state.showCraftModal = false;
  render();
};

(window as any).__kbOnCraftSearch = (val: string) => {
  if (craftSearchTimer) clearTimeout(craftSearchTimer);
  craftSearchTimer = setTimeout(() => {
    void searchCraftDocuments(val);
  }, 300);
};

(window as any).__kbToggleCraftDoc = (id: string, checked: boolean) => {
  if (checked) {
    state.craftSelectedIds.add(id);
  } else {
    state.craftSelectedIds.delete(id);
  }
  render();
};

(window as any).__kbToggleAllCraftDocs = (checked: boolean) => {
  if (checked) {
    state.craftSelectedIds = new Set(state.craftDocuments.map((d) => d.id));
  } else {
    state.craftSelectedIds.clear();
  }
  render();
};

(window as any).__kbImportSingleCraftDoc = (id: string, title: string) => {
  void importSingleCraftDoc(id, title);
};

(window as any).__kbBatchImportCraftDocs = () => {
  void batchImportCraftDocs();
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

(window as any).__kbOpenEditColModal = (id: string) => {
  const col = state.collections.find((c) => c.id === id);
  if (!col) return;
  state.editingColId = id;
  state.editColName = col.name;
  state.editColDesc = col.description || "";
  state.showEditColModal = true;
  render();
};

(window as any).__kbCloseEditColModal = () => {
  state.showEditColModal = false;
  state.editingColId = "";
  state.editColName = "";
  state.editColDesc = "";
  render();
};

(window as any).__kbSubmitEditCol = async () => {
  if (!state.editingColId || !state.editColName.trim()) return;
  try {
    await apiFetch(`/v1/kb/collections/${state.editingColId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: state.editColName.trim(),
        description: state.editColDesc.trim(),
      }),
    });
    state.showEditColModal = false;
    state.editingColId = "";
    state.editColName = "";
    state.editColDesc = "";
    await loadCollections();
  } catch (err: any) {
    alert(`修改知识库失败: ${err.message}`);
  }
};

(window as any).__kbDeleteCollection = async (id: string, name: string) => {
  if (id === "col_default") {
    alert("默认知识库为系统基础目录，不支持删除。如需调整，可直接点击重命名。");
    return;
  }
  if (!confirm(`确定要删除知识库目录「${name}」吗？\n\n注意：该目录下的所有文档及其解析数据将被一并删除，此操作不可撤销！`)) {
    return;
  }
  try {
    await apiFetch(`/v1/kb/collections/${id}`, { method: "DELETE" });
    if (state.activeCollectionId === id) {
      state.activeCollectionId = "col_default";
    }
    await loadCollections();
    await loadDocuments();
  } catch (err: any) {
    alert(`删除知识库失败: ${err.message}`);
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
    initKnowledgeBase();
  },
});
