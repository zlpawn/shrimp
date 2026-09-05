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
  filterType: "all",
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

// Simple Markdown Renderer
function renderMarkdownToHtml(md: string): string {
  if (!md) return '<div class="kb-empty-doc">暂无内容</div>';
  let html = esc(md);

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3 class="kb-md-h3">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="kb-md-h2">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="kb-md-h1">$1</h1>');

  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/gim, "<em>$1</em>");

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/gim, '<pre class="kb-md-pre"><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/gim, '<code class="kb-md-code">$1</code>');

  // Images
  html = html.replace(/!\[(.*?)\]\((.*?)\)/gim, (match, alt, src) => {
    return `<div class="kb-md-img-wrap"><img src="${src}" alt="${alt}" class="kb-md-img" onclick="window.__kbPreviewImage('${src}')" /><span class="kb-md-caption">${alt || "文档配图"}</span></div>`;
  });

  // Links
  html = html.replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank" rel="noopener" class="kb-md-a">$1</a>');

  // Tables
  const lines = html.split("\n");
  const outLines: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      tableRows.push(trimmed);
    } else {
      if (inTable) {
        outLines.push(convertMarkdownTable(tableRows));
        inTable = false;
        tableRows = [];
      }
      outLines.push(line);
    }
  }
  if (inTable) {
    outLines.push(convertMarkdownTable(tableRows));
  }

  return outLines.join("<br/>");
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
  state.ingestStatusText = `正在上传并解析 ${file.name}...`;
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
  state.ingestStatusText = `正在抓取网页与本地化图片并解析...`;
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
  state.ingestStatusText = `正在解析纯文本并生成双版本...`;
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

// --- Render Functions ---

function renderStyles(): string {
  return `
    <style>
      .kb-root {
        display: flex;
        flex-direction: column;
        height: calc(100vh - 48px);
        background: var(--bg-primary, #0f172a);
        color: var(--text-primary, #f1f5f9);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
        overflow: hidden;
      }
      .kb-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 16px;
        background: var(--bg-secondary, #1e293b);
        border-bottom: 1px solid var(--border-color, #334155);
        gap: 12px;
      }
      .kb-title-area {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 15px;
      }
      .kb-engine-pills {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .kb-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 6px;
        background: rgba(255,255,255,0.06);
        border: 1px solid var(--border-color, #334155);
      }
      .kb-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #94a3b8;
      }
      .kb-dot.ok { background: #10b981; }
      .kb-dot.warn { background: #f59e0b; }
      .kb-btn-xs {
        padding: 2px 6px;
        font-size: 11px;
        border-radius: 4px;
        border: 1px solid var(--border-color, #475569);
        background: var(--bg-primary, #0f172a);
        color: var(--text-primary, #f1f5f9);
        cursor: pointer;
      }
      .kb-btn-xs:hover { background: #334155; }
      .kb-actions-bar {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .kb-btn-primary {
        background: #2563eb;
        color: #fff;
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .kb-btn-primary:hover { background: #1d4ed8; }
      .kb-btn-secondary {
        background: var(--bg-primary, #0f172a);
        color: var(--text-primary, #f1f5f9);
        border: 1px solid var(--border-color, #334155);
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .kb-btn-secondary:hover { background: #334155; }
      .kb-body {
        display: flex;
        flex: 1;
        overflow: hidden;
      }
      /* Left Column: Collections */
      .kb-col-pane {
        width: 210px;
        background: var(--bg-secondary, #1e293b);
        border-right: 1px solid var(--border-color, #334155);
        display: flex;
        flex-direction: column;
      }
      .kb-pane-header {
        padding: 10px 12px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        color: #94a3b8;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .kb-col-list {
        flex: 1;
        overflow-y: auto;
        padding: 6px;
      }
      .kb-col-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        margin-bottom: 2px;
        color: #cbd5e1;
      }
      .kb-col-item:hover { background: rgba(255,255,255,0.05); }
      .kb-col-item.active { background: #2563eb; color: #fff; font-weight: 500; }
      .kb-col-badge {
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 10px;
        background: rgba(255,255,255,0.1);
      }
      /* Mid Column: Document list */
      .kb-doc-pane {
        width: 260px;
        background: var(--bg-primary, #0f172a);
        border-right: 1px solid var(--border-color, #334155);
        display: flex;
        flex-direction: column;
      }
      .kb-doc-search {
        padding: 8px 10px;
        border-bottom: 1px solid var(--border-color, #334155);
      }
      .kb-search-input {
        width: 100%;
        background: var(--bg-secondary, #1e293b);
        border: 1px solid var(--border-color, #334155);
        color: #fff;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        outline: none;
      }
      .kb-doc-list {
        flex: 1;
        overflow-y: auto;
        padding: 6px;
      }
      .kb-doc-card {
        padding: 10px;
        border-radius: 6px;
        background: var(--bg-secondary, #1e293b);
        border: 1px solid transparent;
        margin-bottom: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .kb-doc-card:hover { border-color: #475569; }
      .kb-doc-card.active { border-color: #2563eb; background: #1e3a8a33; }
      .kb-doc-card-title {
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .kb-doc-card-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: #94a3b8;
      }
      /* Right Column: Workbench */
      .kb-workbench-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: var(--bg-primary, #0f172a);
        overflow: hidden;
      }
      .kb-wb-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        background: var(--bg-secondary, #1e293b);
        border-bottom: 1px solid var(--border-color, #334155);
      }
      .kb-seg-control {
        display: flex;
        background: var(--bg-primary, #0f172a);
        padding: 2px;
        border-radius: 6px;
        border: 1px solid var(--border-color, #334155);
      }
      .kb-seg-btn {
        padding: 4px 10px;
        font-size: 12px;
        border: none;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        border-radius: 4px;
      }
      .kb-seg-btn.active {
        background: #2563eb;
        color: #fff;
        font-weight: 500;
      }
      .kb-split-view {
        flex: 1;
        display: flex;
        overflow: hidden;
      }
      .kb-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--border-color, #334155);
        overflow: hidden;
      }
      .kb-panel:last-child { border-right: none; }
      .kb-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: rgba(30, 41, 59, 0.7);
        border-bottom: 1px solid var(--border-color, #334155);
        font-size: 12px;
      }
      .kb-panel-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
      }
      .kb-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        line-height: 1.6;
        font-size: 13px;
      }
      /* Markdown render styling */
      .kb-md-h1 { font-size: 20px; font-weight: 700; margin: 16px 0 10px 0; border-bottom: 1px solid #334155; padding-bottom: 6px; }
      .kb-md-h2 { font-size: 17px; font-weight: 600; margin: 14px 0 8px 0; }
      .kb-md-h3 { font-size: 14px; font-weight: 600; margin: 12px 0 6px 0; }
      .kb-md-pre { background: #020617; padding: 10px; border-radius: 6px; overflow-x: auto; border: 1px solid #334155; margin: 10px 0; }
      .kb-md-code { background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px; font-size: 12px; font-family: monospace; }
      .kb-md-a { color: #60a5fa; text-decoration: underline; }
      .kb-table-wrap { overflow-x: auto; margin: 12px 0; }
      .kb-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; }
      .kb-table th, .kb-table td { border: 1px solid #334155; padding: 6px 10px; }
      .kb-table th { background: #1e293b; font-weight: 600; }
      .kb-md-img-wrap { margin: 12px 0; text-align: center; }
      .kb-md-img { max-width: 100%; max-height: 320px; border-radius: 6px; border: 1px solid #334155; cursor: zoom-in; }
      .kb-md-caption { display: block; font-size: 11px; color: #94a3b8; margin-top: 4px; }
      /* Assets Drawer */
      .kb-assets-drawer {
        background: var(--bg-secondary, #1e293b);
        border-top: 1px solid var(--border-color, #334155);
        padding: 8px 12px;
      }
      .kb-assets-title {
        font-size: 11px;
        font-weight: 600;
        color: #94a3b8;
        margin-bottom: 6px;
      }
      .kb-assets-strip {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 4px;
      }
      .kb-asset-thumb {
        width: 64px;
        height: 64px;
        object-fit: cover;
        border-radius: 4px;
        border: 1px solid #334155;
        cursor: pointer;
      }
      /* Terminal Modal */
      .kb-modal-backdrop {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      }
      .kb-modal {
        background: #1e293b;
        border: 1px solid #475569;
        border-radius: 8px;
        width: 580px;
        max-width: 90vw;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
      }
      .kb-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid #334155;
        font-weight: 600;
        font-size: 14px;
      }
      .kb-modal-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }
      .kb-terminal-box {
        background: #020617;
        color: #38bdf8;
        font-family: Consolas, monospace;
        font-size: 12px;
        padding: 12px;
        border-radius: 6px;
        max-height: 280px;
        overflow-y: auto;
        white-space: pre-wrap;
        border: 1px solid #1e293b;
      }
      .kb-progress-bar-bg {
        width: 100%;
        height: 6px;
        background: #334155;
        border-radius: 3px;
        overflow: hidden;
        margin: 12px 0;
      }
      .kb-progress-bar-fill {
        height: 100%;
        background: #10b981;
        transition: width 0.3s ease;
      }
      .kb-drag-overlay {
        position: absolute;
        inset: 0;
        background: rgba(37, 99, 235, 0.2);
        border: 2px dashed #2563eb;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        font-weight: 600;
        z-index: 50;
        pointer-events: none;
      }
      .kb-empty-doc {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: #64748b;
        font-size: 14px;
      }
      .kb-raw-textarea {
        width: 100%;
        height: 100%;
        background: #020617;
        color: #f1f5f9;
        font-family: Consolas, monospace;
        font-size: 12px;
        border: none;
        outline: none;
        resize: none;
      }
    </style>
  `;
}

export function render(): void {
  const root = getRoot();
  if (!root) return;

  const doc = state.activeDoc;
  const mdInstalled = state.engineStatuses.markitdown?.installed ?? false;
  const doclingInstalled = state.engineStatuses.docling?.installed ?? false;

  root.innerHTML = `
    ${renderStyles()}
    <div class="kb-root" id="kb-dropzone">
      <!-- Topbar -->
      <div class="kb-topbar">
        <div class="kb-title-area">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          <span>知识库 · 多引擎对比工作台</span>
        </div>

        <!-- Engine Status Pills -->
        <div class="kb-engine-pills">
          <div class="kb-pill">
            <span class="kb-dot ${mdInstalled ? "ok" : "warn"}"></span>
            <span>MarkItDown: ${mdInstalled ? "已就绪" : "未安装"}</span>
            ${mdInstalled
              ? `<button class="kb-btn-xs" onclick="window.__kbToolAction('markitdown', 'upgrade')">更新</button>`
              : `<button class="kb-btn-xs" onclick="window.__kbToolAction('markitdown', 'install')">一键安装</button>`
            }
          </div>
          <div class="kb-pill">
            <span class="kb-dot ${doclingInstalled ? "ok" : "warn"}"></span>
            <span>Docling: ${doclingInstalled ? "已就绪" : "未安装"}</span>
            ${doclingInstalled
              ? `<button class="kb-btn-xs" onclick="window.__kbToolAction('docling', 'upgrade')">更新</button>`
              : `<button class="kb-btn-xs" onclick="window.__kbToolAction('docling', 'install')">一键安装</button>`
            }
          </div>
        </div>

        <!-- Ingest Actions -->
        <div class="kb-actions-bar">
          <input type="file" id="kb-file-input" style="display:none;" onchange="window.__kbOnFileSelected(event)" />
          <button class="kb-btn-primary" onclick="document.getElementById('kb-file-input').click()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            上传文件
          </button>
          <button class="kb-btn-secondary" onclick="window.__kbOpenUrlModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            抓取 URL
          </button>
          <button class="kb-btn-secondary" onclick="window.__kbOpenTextModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
            纯文本测试
          </button>
        </div>
      </div>

      <!-- Ingest Loading Banner -->
      ${state.ingesting ? `
        <div style="background: #1e3a8a; color: #bfdbfe; padding: 6px 16px; font-size: 12px; display:flex; align-items:center; gap:8px;">
          <span>⏳ ${esc(state.ingestStatusText)}</span>
        </div>
      ` : ""}

      <!-- Main 3-Column Body -->
      <div class="kb-body">
        <!-- 1. Left: Collections -->
        <div class="kb-col-pane">
          <div class="kb-pane-header">
            <span>知识库目录</span>
            <button class="kb-btn-xs" onclick="window.__kbOpenCreateColModal()">+ 新建</button>
          </div>
          <div class="kb-col-list">
            ${state.collections.map((c) => `
              <div class="kb-col-item ${c.id === state.activeCollectionId ? "active" : ""}" onclick="window.__kbSelectCollection('${c.id}')">
                <span>📁 ${esc(c.name)}</span>
                <span class="kb-col-badge">${c.doc_count || 0}</span>
              </div>
            `).join("")}
          </div>
        </div>

        <!-- 2. Mid: Documents List -->
        <div class="kb-doc-pane">
          <div class="kb-doc-search">
            <input type="text" class="kb-search-input" placeholder="搜索文档标题或全文..." value="${esc(state.searchQuery)}" oninput="window.__kbOnSearchInput(event)" />
          </div>
          <div class="kb-doc-list">
            ${state.loadingDocs ? '<div class="kb-empty-doc">加载中...</div>' : ""}
            ${!state.loadingDocs && state.documents.length === 0 ? '<div class="kb-empty-doc">当前知识库暂无文档<br/><span style="font-size:11px;margin-top:4px;">拖拽文件到此处即可上传</span></div>' : ""}
            ${state.documents.map((d) => `
              <div class="kb-doc-card ${d.id === state.activeDocId ? "active" : ""}" onclick="window.__kbSelectDocument('${d.id}')">
                <div class="kb-doc-card-title" title="${esc(d.title)}">${d.source_type === "url" ? "🌐" : d.source_type === "text" ? "📝" : "📄"} ${esc(d.title)}</div>
                <div class="kb-doc-card-meta">
                  <span>${formatDate(d.created_at)}</span>
                  <span>${d.word_count ? d.word_count + " 字" : formatBytes(d.file_size || 0)}</span>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <!-- 3. Right: Workbench -->
        <div class="kb-workbench-pane">
          ${!doc ? `
            <div class="kb-empty-doc">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
              <p style="margin-top: 12px;">选择左侧文档或点击上方上传，开启双引擎对比解析</p>
            </div>
          ` : `
            <!-- Workbench Toolbar -->
            <div class="kb-wb-toolbar">
              <div style="display:flex; align-items:center; gap:12px;">
                <span style="font-weight:600; font-size:13px; max-width: 320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                  ${esc(doc.title)}
                </span>
                <!-- Output Format Switcher -->
                <div class="kb-seg-control">
                  <button class="kb-seg-btn ${state.activeFormat === "markdown" ? "active" : ""}" onclick="window.__kbSetFormat('markdown')">Markdown</button>
                  <button class="kb-seg-btn ${state.activeFormat === "html" ? "active" : ""}" onclick="window.__kbSetFormat('html')">HTML</button>
                  <button class="kb-seg-btn ${state.activeFormat === "json" ? "active" : ""}" onclick="window.__kbSetFormat('json')">JSON</button>
                </div>
              </div>

              <div style="display:flex; align-items:center; gap:8px;">
                <!-- Split View Controls -->
                <div class="kb-seg-control">
                  <button class="kb-seg-btn ${state.splitMode === "both" ? "active" : ""}" onclick="window.__kbSetSplit('both')">⫴ 双栏对比</button>
                  <button class="kb-seg-btn ${state.splitMode === "markitdown" ? "active" : ""}" onclick="window.__kbSetSplit('markitdown')">⚡ 仅 MarkItDown</button>
                  <button class="kb-seg-btn ${state.splitMode === "docling" ? "active" : ""}" onclick="window.__kbSetSplit('docling')">🧠 仅 Docling</button>
                </div>
                <button class="kb-btn-xs" style="color:#ef4444;" onclick="window.__kbDeleteDoc('${doc.id}')" title="删除此文档">删除</button>
              </div>
            </div>

            <!-- Split View Panes -->
            <div class="kb-split-view">
              <!-- MarkItDown Pane -->
              ${state.splitMode !== "docling" ? `
                <div class="kb-panel">
                  <div class="kb-panel-header">
                    <div class="kb-panel-title">
                      <span>⚡ MarkItDown (微软)</span>
                      <span class="kb-col-badge">${doc.markitdown_duration_ms ? `${doc.markitdown_duration_ms}ms` : "未完成"}</span>
                    </div>
                    <div>
                      <button class="kb-btn-xs" onclick="window.__kbToggleRaw('markitdown')">
                        ${state.showRaw.markitdown ? "富文本视图" : "原始源码"}
                      </button>
                      <button class="kb-btn-xs" onclick="window.__kbCopyContent('markitdown')">复制</button>
                      <button class="kb-btn-xs" onclick="window.__kbExportContent('markitdown')">导出</button>
                    </div>
                  </div>
                  <div class="kb-panel-content">
                    ${doc.markitdown_status === "failed" ? `<div style="color:#ef4444;">解析失败: ${esc(doc.markitdown_error)}</div>` : ""}
                    ${doc.markitdown_status === "skipped" ? `<div style="color:#f59e0b;">MarkItDown 未安装，点击顶部一键安装</div>` : ""}
                    ${doc.markitdown_status === "done" ? (
                      state.showRaw.markitdown
                        ? `<textarea class="kb-raw-textarea" readonly>${esc(getOutputContent(doc, "markitdown", state.activeFormat))}</textarea>`
                        : state.activeFormat === "markdown"
                          ? renderMarkdownToHtml(doc.markitdown_md)
                          : state.activeFormat === "html"
                            ? `<iframe srcdoc="${esc(doc.markitdown_html || renderMarkdownToHtml(doc.markitdown_md))}" style="width:100%; height:100%; border:none; background:#fff;"></iframe>`
                            : `<pre class="kb-md-pre"><code>${esc(getOutputContent(doc, "markitdown", "json"))}</code></pre>`
                    ) : ""}
                  </div>
                </div>
              ` : ""}

              <!-- Docling Pane -->
              ${state.splitMode !== "markitdown" ? `
                <div class="kb-panel">
                  <div class="kb-panel-header">
                    <div class="kb-panel-title">
                      <span>🧠 Docling (IBM)</span>
                      <span class="kb-col-badge">${doc.docling_duration_ms ? `${(doc.docling_duration_ms / 1000).toFixed(1)}s` : "未完成"}</span>
                    </div>
                    <div>
                      <button class="kb-btn-xs" onclick="window.__kbToggleRaw('docling')">
                        ${state.showRaw.docling ? "富文本视图" : "原始源码"}
                      </button>
                      <button class="kb-btn-xs" onclick="window.__kbCopyContent('docling')">复制</button>
                      <button class="kb-btn-xs" onclick="window.__kbExportContent('docling')">导出</button>
                    </div>
                  </div>
                  <div class="kb-panel-content">
                    ${doc.docling_status === "failed" ? `<div style="color:#ef4444;">解析失败: ${esc(doc.docling_error)}</div>` : ""}
                    ${doc.docling_status === "skipped" ? `<div style="color:#f59e0b;">Docling 未安装，点击顶部一键安装</div>` : ""}
                    ${doc.docling_status === "done" ? (
                      state.showRaw.docling
                        ? `<textarea class="kb-raw-textarea" readonly>${esc(getOutputContent(doc, "docling", state.activeFormat))}</textarea>`
                        : state.activeFormat === "markdown"
                          ? renderMarkdownToHtml(doc.docling_md)
                          : state.activeFormat === "html"
                            ? `<iframe srcdoc="${esc(doc.docling_html || renderMarkdownToHtml(doc.docling_md))}" style="width:100%; height:100%; border:none; background:#fff;"></iframe>`
                            : `<pre class="kb-md-pre"><code>${esc(getOutputContent(doc, "docling", "json"))}</code></pre>`
                    ) : ""}
                  </div>
                </div>
              ` : ""}
            </div>

            <!-- Extracted Assets Strip -->
            ${doc.assets && doc.assets.length > 0 ? `
              <div class="kb-assets-drawer">
                <div class="kb-assets-title">提取到的本地图片与图表 (${doc.assets.length} 张)</div>
                <div class="kb-assets-strip">
                  ${doc.assets.map((a) => `
                    <img src="${a.url}" class="kb-asset-thumb" title="${esc(a.name)} (${formatBytes(a.sizeBytes)})" onclick="window.__kbPreviewImage('${a.url}')" />
                  `).join("")}
                </div>
              </div>
            ` : ""}
          `}
        </div>
      </div>

      <!-- Install / Upgrade Modal -->
      ${state.showInstallModal && state.installTask ? `
        <div class="kb-modal-backdrop">
          <div class="kb-modal">
            <div class="kb-modal-header">
              <span>环境安装与更新：${esc(state.installTask.tool)}</span>
              <button class="kb-btn-xs" onclick="window.__kbCloseInstallModal()">✕</button>
            </div>
            <div class="kb-modal-body">
              <div>状态: <strong>${state.installTask.status === "running" ? "⏳ 执行中..." : state.installTask.status === "succeeded" ? "✅ 成功完成" : "❌ 执行失败"}</strong></div>
              <div class="kb-progress-bar-bg">
                <div class="kb-progress-bar-fill" style="width: ${state.installTask.progress}%;"></div>
              </div>
              <div class="kb-terminal-box" id="kb-term-logs">${esc(state.installTask.logs.join("\n"))}</div>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- URL Ingest Modal -->
      ${state.showUrlModal ? `
        <div class="kb-modal-backdrop">
          <div class="kb-modal" style="width:480px;">
            <div class="kb-modal-header">
              <span>抓取网页 URL</span>
              <button class="kb-btn-xs" onclick="window.__kbCloseUrlModal()">✕</button>
            </div>
            <div class="kb-modal-body" style="display:flex; flex-direction:column; gap:12px;">
              <input type="text" class="kb-search-input" placeholder="输入网页链接 (如 https://...)" value="${esc(state.modalUrl)}" oninput="state.modalUrl = this.value" />
              <label style="font-size:12px; display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" ${state.modalUseLeo ? "checked" : ""} onchange="state.modalUseLeo = this.checked" />
                <span>使用 Leo 浏览器插件 Cookie（突破知乎/公众号等防盗链与登录）</span>
              </label>
              <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
                <button class="kb-btn-secondary" onclick="window.__kbCloseUrlModal()">取消</button>
                <button class="kb-btn-primary" onclick="window.__kbSubmitUrlIngest()">开始抓取解析</button>
              </div>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Text Ingest Modal -->
      ${state.showTextModal ? `
        <div class="kb-modal-backdrop">
          <div class="kb-modal" style="width:540px;">
            <div class="kb-modal-header">
              <span>纯文本 / Markdown 快速解析</span>
              <button class="kb-btn-xs" onclick="window.__kbCloseTextModal()">✕</button>
            </div>
            <div class="kb-modal-body" style="display:flex; flex-direction:column; gap:12px;">
              <input type="text" class="kb-search-input" placeholder="文档标题 (可选)" value="${esc(state.modalTextTitle)}" oninput="state.modalTextTitle = this.value" />
              <textarea class="kb-search-input" style="height:160px; resize:none;" placeholder="在此粘贴纯文本、HTML或Markdown..." oninput="state.modalText = this.value">${esc(state.modalText)}</textarea>
              <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button class="kb-btn-secondary" onclick="window.__kbCloseTextModal()">取消</button>
                <button class="kb-btn-primary" onclick="window.__kbSubmitTextIngest()">提交解析</button>
              </div>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Create Collection Modal -->
      ${state.showCreateColModal ? `
        <div class="kb-modal-backdrop">
          <div class="kb-modal" style="width:400px;">
            <div class="kb-modal-header">
              <span>新建知识库目录</span>
              <button class="kb-btn-xs" onclick="window.__kbCloseCreateColModal()">✕</button>
            </div>
            <div class="kb-modal-body" style="display:flex; flex-direction:column; gap:12px;">
              <input type="text" class="kb-search-input" placeholder="知识库名称 (例如: 研报分析)" value="${esc(state.modalColName)}" oninput="state.modalColName = this.value" />
              <input type="text" class="kb-search-input" placeholder="描述 (可选)" value="${esc(state.modalColDesc)}" oninput="state.modalColDesc = this.value" />
              <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button class="kb-btn-secondary" onclick="window.__kbCloseCreateColModal()">取消</button>
                <button class="kb-btn-primary" onclick="window.__kbSubmitCreateCol()">创建</button>
              </div>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Image Preview Modal -->
      ${state.previewAsset ? `
        <div class="kb-modal-backdrop" onclick="window.__kbCloseImagePreview()">
          <div style="max-width:90vw; max-height:90vh; text-align:center;">
            <img src="${state.previewAsset.url}" style="max-width:100%; max-height:85vh; border-radius:8px; box-shadow:0 10px 25px rgba(0,0,0,0.5);" />
            <div style="color:#fff; margin-top:8px; font-size:13px;">${esc(state.previewAsset.name)} (${formatBytes(state.previewAsset.sizeBytes)})</div>
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
    alert(`创建知识库失败: ${err.message}`);
  }
};

(window as any).__kbDeleteDoc = async (id: string) => {
  if (!confirm("确定要删除此文档吗？")) return;
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
    alert("已复制到剪贴板！");
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
  state.previewAsset = { name: "预览图片", url, localPath: "", sizeBytes: 0 };
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
