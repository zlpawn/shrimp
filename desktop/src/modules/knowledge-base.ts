import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";

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
  source_type: "file" | "url" | "text" | "craft" | "weread" | "video" | "image";
  doc_type?: "document" | "video" | "image" | string;
  source_url?: string;
  file_name?: string;
  file_size?: number;
  file_hash?: string;
  final_content?: string;
  accepted_at?: number;
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

interface CompileConcept {
  title: string;
  aliases: string[];
  category: string;
  tags: string[];
  summary: string;
  content_markdown: string;
}

interface CompileDraft {
  summary: string;
  index_category: string;
  log_entry: string;
  concepts: CompileConcept[];
}

interface CompileModelOption {
  client: string;
  endpointId: string;
  endpointName: string;
  model: string;
  displayName: string;
  isDefault?: boolean;
}

// --- State ---
const state = {
  activePhase: "parser" as KbPhaseView,
  activeSubTab: "document" as "document" | "video" | "image",
  docViewMode: "adopted" as "adopted" | "compare",
  selectedDocIds: new Set<string>(),
  showIntakeDropdown: false,
  showIntakeDropdownType: "" as "doc-sidebar" | "doc-toolbar" | "video-sidebar" | "video-toolbar" | "image-sidebar" | "",
  // Image Ingest Modal
  showImageModal: false,
  imageModalTab: (localStorage.getItem("kb_image_modal_tab") as "local" | "url") || "local",
  imageFileInput: null as File | null,
  imagePreviewUrl: "",
  imageUrlInput: "",
  imageTitleInput: "",
  imageClientInput: localStorage.getItem("kb_vision_client") || "code",
  imageEndpointIdInput: localStorage.getItem("kb_vision_endpoint_id") || "",
  imageModelInput: localStorage.getItem("kb_vision_model") || "qwen-vl-max",
  imageIngesting: false,
  collections: [] as KbCollection[],
  activeCollectionId: localStorage.getItem("kb_active_collection_id") || "col_default",
  documents: [] as KbDocument[],
  activeDocId: "",
  activeDoc: null as KbDocument | null,
  searchQuery: "",
  engineStatuses: {} as Record<string, EngineStatus>,
  activeFormat: "markdown" as "markdown" | "html" | "json",
  splitMode: "both" as "both" | "markitdown" | "docling",
  showRaw: { markitdown: false, docling: false },
  reparsingEngine: "" as "markitdown" | "docling" | "",
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
  craftFolders: [] as Array<{ id: string; name: string; depth: number; docCount: number }>,
  craftSelectedFolderId: "",
  craftDocuments: [] as Array<{ id: string; title: string; snippet?: string }>,
  craftSelectedIds: new Set<string>(),
  craftSearchQuery: "",
  craftImporting: false,
  craftImportTargetCol: "col_default",
  // Karpathy LLM Wiki Compiler
  showCompileModal: false,
  compileTargetDocId: "",
  compileVaultRoot: localStorage.getItem("kb_obsidian_vault_root") || "",
  compileModels: [] as CompileModelOption[],
  compileSelectedClient: "code",
  compileSelectedEndpointId: "",
  compileSelectedModel: "",
  compileSelectedModelKey: "",
  compileCustomInstruction: "",
  compileLoading: false,
  compileLoadingText: "",
  compileDraft: null as CompileDraft | null,
  compileActiveConceptIdx: 0,
  compileFeedback: "",
  compileRefining: false,
  compileApplying: false,
  compileApplyResult: null as { ok: boolean; vaultRoot: string; writtenFiles: string[]; conceptsCount: number } | null,
  compileTargetEngine: "markitdown" as "markitdown" | "docling",
  // Video KB Integration Modal
  showVideoModal: false,
  videoModalTab: (localStorage.getItem("kb_video_modal_tab") as "url" | "local") || "url",
  videoFileInput: null as File | null,
  videoLoading: false,
  videoList: [] as any[],
  videoImporting: false,
  videoUrlInput: "",
  videoTitleInput: "",
  videoLanguageInput: localStorage.getItem("kb_video_lang") || "auto",
  videoWhisperModelInput: localStorage.getItem("kb_video_whisper_model") || "base",
  videoSummaryClientInput: localStorage.getItem("kb_video_summary_client") || "code",
  videoSummaryEndpointIdInput: localStorage.getItem("kb_video_summary_endpoint_id") || "",
  videoSummaryModelInput: localStorage.getItem("kb_video_summary_model") || "glm-5.2",
  videoFrameStrategyInput: (localStorage.getItem("kb_video_frame_strategy") as "scene" | "interval" | "none") || "scene",
  videoFrameIntervalInput: Number(localStorage.getItem("kb_video_frame_interval")) || 5,
  videoMaxFramesInput: Number(localStorage.getItem("kb_video_max_frames")) || 30,
  videoEnableVisionAudit: localStorage.getItem("kb_video_enable_vision_audit") === "true",
  videoVisionClientInput: localStorage.getItem("kb_video_vision_client") || localStorage.getItem("kb_vision_client") || "code",
  videoVisionEndpointIdInput: localStorage.getItem("kb_video_vision_endpoint_id") || localStorage.getItem("kb_vision_endpoint_id") || "",
  videoVisionModelInput: localStorage.getItem("kb_video_vision_model") || localStorage.getItem("kb_vision_model") || "qwen-vl-max",
  videoTaskStatus: "idle" as "idle" | "running" | "succeeded" | "failed",
  videoTaskStep: "",
  videoTaskId: "",

  // Document Vision Transcription Modal
  showVisionModal: false,
  visionTargetAssetUrl: "",
  visionTargetAssetName: "",
  visionTargetTitle: "",
  visionTargetDocId: "",
  visionTargetEngine: "docling" as "docling" | "markitdown",
  visionClientInput: localStorage.getItem("kb_vision_client") || "code",
  visionEndpointIdInput: localStorage.getItem("kb_vision_endpoint_id") || "",
  visionModelInput: localStorage.getItem("kb_vision_model") || "qwen-vl-max",
  visionLoading: false,
  visionResult: null as any,
  // WeRead & Multi-Channel Auto Sync
  showWereadModal: false,
  wereadModalTab: (localStorage.getItem("kb_weread_modal_tab") as "notebooks" | "stream" | "settings") || "notebooks",
  wereadLoading: false,
  wereadStatus: null as null | { connected: boolean; totalBookCount?: number; totalNoteCount?: number; error?: string },
  wereadBooks: [] as Array<{
    bookId: string;
    title: string;
    author: string;
    cover: string;
    category: string;
    readingProgress: number;
    markedStatus: string;
    noteCount: number;
    reviewCount: number;
    totalNotes: number;
    sort: number;
    lastNoteTimeStr: string;
  }>,
  wereadSelectedIds: new Set<string>(),
  wereadSearchQuery: "",
  wereadImporting: false,
  wereadImportTargetCol: "col_default",
  channelsConfig: null as any,
  wereadApiKeyInput: "",
  wereadShowApiKey: false,
  syncScheduleEnabledInput: false,
  syncScheduleModeInput: "daily" as "daily" | "interval",
  syncDailyTimeInput: "04:00",
  syncIntervalHoursInput: 12,
  syncOnStartupInput: true,
  syncTargetColInput: "col_default",
  syncRunning: false,
  syncHighlightsStream: [] as Array<{
    date: string;
    total_items: number;
    channel: string;
    channel_name: string;
    items: Array<{
      type: string;
      book_id: string;
      book_title: string;
      chapter_title: string;
      mark_text: string;
      create_time: number;
      create_time_str: string;
      deep_link: string;
      doc_id?: string;
    }>;
  }>,
  // Phase 2-4 interactive preview state
  chunkSize: 1024,
  chunkOverlap: 128,
  selectedEmbeddingModel: "text-embedding-3-small",
  hybridWeight: 0.5,
};

function resolveCraftWebUrl(sourceUrl?: string): string {
  if (!sourceUrl) return "";
  if (sourceUrl.startsWith("https://docs.craft.do/")) return sourceUrl;
  if (sourceUrl.startsWith("craftdocs://")) {
    try {
      const u = new URL(sourceUrl);
      const sId = u.searchParams.get("spaceId");
      const bId = u.searchParams.get("blockId");
      if (sId && bId) return `https://docs.craft.do/editor/d/${sId}/${bId}`;
      if (bId) return `https://docs.craft.do/editor/d/_/${bId}`;
    } catch {
      const sMatch = sourceUrl.match(/spaceId=([^&]+)/);
      const bMatch = sourceUrl.match(/blockId=([^&]+)/);
      if (sMatch && bMatch) return `https://docs.craft.do/editor/d/${sMatch[1]}/${bMatch[1]}`;
    }
  }
  return sourceUrl;
}

function clientDisplayName(client: string): string {
  const fn = (window as any).__clientDisplayName;
  if (fn) return fn(client);
  if (client === "code") return "代码代理 (code)";
  if (client === "chat") return "对话代理 (chat)";
  return client;
}

function getCompileClients(): string[] {
  const clients = Array.from(new Set(state.compileModels.map((m) => m.client))).filter(Boolean);
  return clients.length > 0 ? clients : ["code"];
}

function getCompileEndpoints(client: string): Array<{ id: string; name: string }> {
  const seen = new Set<string>();
  const list: Array<{ id: string; name: string }> = [];
  for (const m of state.compileModels) {
    if (m.client === client && !seen.has(m.endpointId)) {
      seen.add(m.endpointId);
      list.push({ id: m.endpointId, name: m.endpointName || m.endpointId });
    }
  }
  return list;
}

function getCompileModels(client: string, endpointId: string): string[] {
  return state.compileModels
    .filter((m) => m.client === client && (!endpointId || m.endpointId === endpointId))
    .map((m) => m.model)
    .filter(Boolean);
}

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
  html = html.replace(/^###### (.*$)/gim, '<h6 class="kb-md-h6">$1</h6>');
  html = html.replace(/^##### (.*$)/gim, '<h5 class="kb-md-h5">$1</h5>');
  html = html.replace(/^#### (.*$)/gim, '<h4 class="kb-md-h4">$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3 class="kb-md-h3">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="kb-md-h2">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="kb-md-h1">$1</h1>');

  // Blockquotes
  html = html.replace(/^> (.*$)/gim, '<blockquote class="kb-md-quote">$1</blockquote>');

  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/gim, "<em>$1</em>");

  // Code blocks & Mermaid diagrams
  html = html.replace(/```(?:mermaid)?\n?([\s\S]*?)```/gim, (_match, code) => {
    const raw = code.trim();
    if (
      raw.startsWith("flowchart") ||
      raw.startsWith("graph") ||
      raw.startsWith("sequenceDiagram") ||
      raw.startsWith("classDiagram") ||
      raw.startsWith("stateDiagram") ||
      raw.startsWith("erDiagram") ||
      raw.startsWith("pie") ||
      raw.startsWith("gitGraph")
    ) {
      return `<div class="kb-mermaid-block"><div class="kb-mermaid-header"><span>📊 Mermaid 架构 / 流程图</span><button class="btn btn-xs" onclick="window.__kbCopyText(decodeURIComponent('${encodeURIComponent(raw)}'), '已复制 Mermaid 代码')">📋 复制 Mermaid</button></div><pre class="kb-mermaid-code"><code>${raw}</code></pre></div>`;
    }
    return `<pre class="kb-md-pre"><code>${code}</code></pre>`;
  });
  html = html.replace(/`([^`]+)`/gim, '<code class="kb-md-code">$1</code>');

  // Images
  html = html.replace(/!\[(.*?)\]\((.*?)\)/gim, (_match, alt, src) => {
    return `<div class="kb-md-img-wrap"><img src="${src}" alt="${alt}" class="kb-md-img" onclick="window.__kbPreviewImage('${src}')" /><span class="kb-md-caption">${alt || "文档配图"}</span></div>`;
  });

  // Links
  html = html.replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank" rel="noopener" class="kb-source-link">$1</a>');

  // Wikilinks [[Concept]]
  html = html.replace(/\[\[(.*?)\]\]/g, '<span class="kb-wikilink-badge" style="display:inline-flex; align-items:center; background:rgba(99,102,241,0.15); color:#6366f1; border:1px solid rgba(99,102,241,0.3); border-radius:4px; padding:1px 6px; font-weight:500; margin:0 2px;">[[$1]]</span>');

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

let clickListenerAttached = false;

function checkUrlWereadModal(): void {
  const hash = window.location.hash || "";
  const queryIdx = hash.indexOf("?");
  const queryPart = queryIdx !== -1 ? hash.slice(queryIdx + 1) : window.location.search.slice(1);
  const params = new URLSearchParams(queryPart);
  const wereadTab = params.get("weread");
  if (wereadTab === "notebooks" || wereadTab === "stream" || wereadTab === "settings") {
    void openWereadModal(wereadTab);
  }
}

/**
 * Instant initialization: renders immediately without blocking on network/process detection!
 */
export function initKnowledgeBase(): void {
  if (!clickListenerAttached) {
    clickListenerAttached = true;
    window.addEventListener("hashchange", () => {
      checkUrlWereadModal();
    });
    document.addEventListener("click", (e: MouseEvent) => {
      if (state.showIntakeDropdown) {
        const target = e.target as HTMLElement;
        if (!target.closest(".kb-dropdown-wrapper")) {
          state.showIntakeDropdown = false;
          state.showIntakeDropdownType = "";
          render();
        }
      }
    });
  }

  // 1. Instant optimistic render (0ms delay)
  render();

  // 2. Load collections & documents asynchronously
  void loadCollections()
    .then(() => loadDocuments())
    .then(() => render());

  // 3. Load engine statuses asynchronously in background
  void loadEngineStatuses().then(() => render());

  // 4. Prefetch compile models asynchronously for Vision LLM status
  void prefetchCompileModels().then(() => render());

  // 5. Load external channels & auto sync config
  void loadChannelsConfig().then(() => {
    checkUrlWereadModal();
    render();
  });
}

async function prefetchCompileModels(): Promise<void> {
  try {
    const res = await apiFetch<{ models: CompileModelOption[] }>("/v1/kb/compile/models");
    if (res.models && res.models.length > 0) {
      state.compileModels = res.models;
    }
  } catch (err) {
    console.warn("[KB] Prefetch compile models warning:", err);
  }
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

function getFilteredDocuments(): KbDocument[] {
  return state.documents.filter((d) => {
    if (state.activeSubTab === "video") {
      return d.doc_type === "video" || d.source_type === "video";
    }
    if (state.activeSubTab === "image") {
      return d.doc_type === "image" || d.source_type === "image";
    }
    return d.doc_type === "document" || (!d.doc_type && d.source_type !== "video" && d.source_type !== "image");
  });
}

function getModalityCounts(): { docCount: number; videoCount: number; imageCount: number } {
  let docCount = 0;
  let videoCount = 0;
  let imageCount = 0;
  for (const d of state.documents) {
    if (d.doc_type === "video" || d.source_type === "video") {
      videoCount++;
    } else if (d.doc_type === "image" || d.source_type === "image") {
      imageCount++;
    } else {
      docCount++;
    }
  }
  return { docCount, videoCount, imageCount };
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
    const filtered = getFilteredDocuments();
    if (filtered.length > 0) {
      if (!state.activeDocId || !filtered.some((d) => d.id === state.activeDocId)) {
        state.activeDocId = filtered[0].id;
      }
      state.activeDoc = filtered.find((d) => d.id === state.activeDocId) || filtered[0];
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

async function adoptDocument(docId: string, engine: "markitdown" | "docling" | "custom", content?: string): Promise<void> {
  try {
    const res = await apiFetch<{ ok: boolean; document: KbDocument }>(`/v1/kb/documents/${docId}/adopt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine, content }),
    });
    if (res.document) {
      state.activeDoc = res.document;
      const idx = state.documents.findIndex((d) => d.id === docId);
      if (idx >= 0) {
        state.documents[idx] = res.document;
      }
      state.docViewMode = "adopted";
      showToast("已成功采纳为官方正文版本！本地已同步生成 final.md", "success");
      render();
    }
  } catch (err: any) {
    showToast(`采纳版本失败: ${err.message}`, "error");
  }
}

async function copyAgentPrompt(params: { docIds?: string[]; collectionId?: string }): Promise<void> {
  try {
    const res = await apiFetch<{ ok: boolean; promptText: string; items: any[] }>("/v1/kb/documents/agent-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_ids: params.docIds || [],
        collection_id: params.collectionId || null,
      }),
    });
    if (res.promptText) {
      await navigator.clipboard.writeText(res.promptText);
      showToast("已复制 Agent 任务引导词与跨平台本地绝对路径！可直接粘贴给 Antigravity 或 Codex。", "success");
    }
  } catch (err: any) {
    showToast(`复制 Agent 提示词失败: ${err.message}`, "error");
  }
}

async function handleImageIngest(): Promise<void> {
  if (!state.imageFileInput) {
    showToast("请先选择或拖拽图片文件", "error");
    return;
  }
  state.imageIngesting = true;
  render();
  try {
    const file = state.imageFileInput;
    const buffer = await file.arrayBuffer();
    const res = await fetch("/v1/kb/ingest/image", {
      method: "POST",
      headers: {
        "x-filename": encodeURIComponent(file.name),
        "x-title": encodeURIComponent(state.imageTitleInput.trim() || file.name),
        "x-collection-id": state.activeCollectionId || "col_default",
        "x-gateway-client": state.imageClientInput || "code",
        "x-gateway-endpoint": state.imageEndpointIdInput || "",
        "x-gateway-model": state.imageModelInput || "qwen-vl-max",
      },
      body: buffer,
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    showToast("图片深度转译完成！已转译为结构化 Markdown 与 Mermaid 架构图", "success");
    state.showImageModal = false;
    state.imageFileInput = null;
    state.imagePreviewUrl = "";
    state.imageTitleInput = "";
    state.activeSubTab = "image";
    state.activeDocId = data.document.id;
    await loadCollections();
    await loadDocuments();
  } catch (err: any) {
    showToast(`图片转译失败: ${err.message}`, "error");
  } finally {
    state.imageIngesting = false;
    render();
  }
}

async function handleImageUrlIngest(): Promise<void> {
  const url = state.imageUrlInput.trim();
  if (!url) {
    showToast("请输入图片或网页链接", "error");
    return;
  }
  state.imageIngesting = true;
  render();
  try {
    const res = await fetch("/v1/kb/ingest/image-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        title: state.imageTitleInput.trim() || "",
        collection_id: state.activeCollectionId || "col_default",
        client: state.imageClientInput || "code",
        endpoint_id: state.imageEndpointIdInput || "",
        model: state.imageModelInput || "qwen-vl-max",
      }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    showToast("网页图片下载并深度转译完成！已转译为结构化 Markdown 与 Mermaid", "success");
    state.showImageModal = false;
    state.imageUrlInput = "";
    state.imageTitleInput = "";
    state.activeSubTab = "image";
    state.activeDocId = data.document.id;
    await loadCollections();
    await loadDocuments();
  } catch (err: any) {
    showToast(`图片下载/转译失败: ${err.message}`, "error");
  } finally {
    state.imageIngesting = false;
    render();
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
    showToast(`文件解析失败: ${err.message}`, "error");
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
    showToast(`URL 解析失败: ${err.message}`, "error");
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
    showToast(`文本解析失败: ${err.message}`, "error");
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
  state.craftSelectedFolderId = "";
  state.craftFolders = [];
  state.craftImportTargetCol = state.activeCollectionId || "col_default";
  render();

  try {
    const status = await apiFetch<{ connected: boolean; spaceName?: string; error?: string }>("/v1/kb/channels/craft/status");
    state.craftStatus = status;
    if (status.connected) {
      const [foldersRes, docsRes] = await Promise.all([
        apiFetch<{ folders: Array<{ id: string; name: string; depth: number; docCount: number }> }>("/v1/kb/channels/craft/folders").catch(() => ({ folders: [] })),
        apiFetch<{ documents: Array<{ id: string; title: string; snippet?: string }> }>("/v1/kb/channels/craft/documents?all=true&filter_empty=true").catch(() => ({ documents: [] })),
      ]);
      state.craftFolders = foldersRes.folders || [];
      state.craftDocuments = docsRes.documents || [];
    } else {
      state.craftFolders = [];
      state.craftDocuments = [];
    }
  } catch (err: any) {
    state.craftStatus = { connected: false, error: err.message };
    state.craftFolders = [];
    state.craftDocuments = [];
  } finally {
    state.craftLoading = false;
    render();
  }
}

async function selectCraftFolder(folderId: string): Promise<void> {
  state.craftSelectedFolderId = folderId;
  state.craftLoading = true;
  state.craftSelectedIds = new Set();
  render();

  try {
    let url = "/v1/kb/channels/craft/documents?all=true&filter_empty=true";
    if (folderId === "__unsorted__") {
      url += "&location=unsorted";
    } else if (folderId) {
      url += `&folder_id=${encodeURIComponent(folderId)}`;
    }
    if (state.craftSearchQuery.trim()) {
      url += `&q=${encodeURIComponent(state.craftSearchQuery.trim())}`;
    }
    const data = await apiFetch<{ documents: Array<{ id: string; title: string; snippet?: string }> }>(url);
    state.craftDocuments = data.documents || [];
  } catch (err: any) {
    console.error("Fetch craft docs by folder error:", err);
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
    let url = "/v1/kb/channels/craft/documents?all=true&filter_empty=true";
    if (state.craftSelectedFolderId === "__unsorted__") {
      url += "&location=unsorted";
    } else if (state.craftSelectedFolderId) {
      url += `&folder_id=${encodeURIComponent(state.craftSelectedFolderId)}`;
    }
    if (query.trim()) {
      url += `&q=${encodeURIComponent(query.trim())}`;
    }
    const data = await apiFetch<{ documents: Array<{ id: string; title: string; snippet?: string }> }>(url);
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
    showToast(`导入 Craft 笔记失败: ${err.message}`, "error");
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
    showToast(`批量导入失败: ${err.message}`, "error");
  } finally {
    state.craftImporting = false;
    render();
  }
}

// --- WeRead & Multi-Channel Auto Sync Handlers ---
let wereadSearchTimer: any = null;

async function loadChannelsConfig(): Promise<void> {
  try {
    const data = await apiFetch<any>("/v1/kb/channels/config");
    state.channelsConfig = data;
    if (data.schedule) {
      state.syncScheduleEnabledInput = data.schedule.enabled;
      state.syncScheduleModeInput = data.schedule.mode || "daily";
      state.syncDailyTimeInput = data.schedule.daily_time || "04:00";
      state.syncIntervalHoursInput = data.schedule.interval_hours || 12;
      state.syncOnStartupInput = data.schedule.sync_on_startup !== false;
      state.syncTargetColInput = data.schedule.target_collection_id || "col_default";
    }
  } catch (err) {
    console.warn("Load channels config error:", err);
  }
}

async function openWereadModal(tab?: "notebooks" | "stream" | "settings"): Promise<void> {
  state.showWereadModal = true;
  if (tab) {
    state.wereadModalTab = tab;
    localStorage.setItem("kb_weread_modal_tab", tab);
  } else {
    state.wereadModalTab = (localStorage.getItem("kb_weread_modal_tab") as any) || "notebooks";
  }
  state.wereadLoading = true;
  state.wereadSearchQuery = "";
  state.wereadSelectedIds = new Set();
  state.wereadImportTargetCol = state.activeCollectionId || "col_default";
  render();

  await loadChannelsConfig();

  if (state.wereadModalTab === "notebooks") {
    await loadWereadNotebooks();
  } else if (state.wereadModalTab === "stream") {
    await loadSyncHighlightsStream();
  } else {
    state.wereadLoading = false;
    render();
  }
}

function closeWereadModal(): void {
  if (state.wereadImporting || state.syncRunning) return;
  state.showWereadModal = false;
  if (window.location.hash.includes("weread=")) {
    window.location.hash = window.location.hash.replace(/[?&]weread=[^&]+/, "");
  }
  render();
}

async function setWereadModalTab(tab: "notebooks" | "stream" | "settings"): Promise<void> {
  state.wereadModalTab = tab;
  localStorage.setItem("kb_weread_modal_tab", tab);
  if (window.location.hash.includes("#knowledge-base")) {
    const baseHash = window.location.hash.split("?")[0];
    window.history.replaceState(null, "", `${baseHash}?weread=${tab}`);
  }
  state.wereadLoading = true;
  render();

  if (tab === "notebooks") {
    await loadWereadNotebooks();
  } else if (tab === "stream") {
    await loadSyncHighlightsStream();
  } else {
    await loadChannelsConfig();
    state.wereadLoading = false;
    render();
  }
}

async function loadWereadNotebooks(): Promise<void> {
  state.wereadLoading = true;
  render();

  try {
    const status = await apiFetch<{ connected: boolean; totalBookCount?: number; totalNoteCount?: number; error?: string }>("/v1/kb/channels/weread/status");
    state.wereadStatus = status;
    if (status.connected) {
      const res = await apiFetch<{ books: any[] }>("/v1/kb/channels/weread/notebooks?count=100&all=true");
      state.wereadBooks = res.books || [];
    } else {
      state.wereadBooks = [];
    }
  } catch (err: any) {
    state.wereadStatus = { connected: false, error: err.message };
    state.wereadBooks = [];
  } finally {
    state.wereadLoading = false;
    render();
  }
}

async function loadSyncHighlightsStream(): Promise<void> {
  state.wereadLoading = true;
  render();

  try {
    const res = await apiFetch<{ daily_highlights: any[] }>("/v1/kb/channels/sync/history");
    state.syncHighlightsStream = res.daily_highlights || [];
  } catch (err: any) {
    console.warn("Load sync highlights error:", err);
    state.syncHighlightsStream = [];
  } finally {
    state.wereadLoading = false;
    render();
  }
}

async function saveChannelsConfig(): Promise<void> {
  try {
    const body: any = {
      schedule: {
        enabled: state.syncScheduleEnabledInput,
        mode: state.syncScheduleModeInput,
        daily_time: state.syncDailyTimeInput,
        interval_hours: Number(state.syncIntervalHoursInput) || 12,
        sync_on_startup: state.syncOnStartupInput,
        target_collection_id: state.syncTargetColInput,
      },
    };

    if (state.wereadApiKeyInput.trim()) {
      body.weread = {
        credentials: {
          api_key: state.wereadApiKeyInput.trim(),
        },
      };
    }

    const res = await apiFetch<any>("/v1/kb/channels/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    state.channelsConfig = res;
    state.wereadApiKeyInput = "";
    showToast("✅ 外部渠道设置与自动同步计划已保存！", "success");
    await loadChannelsConfig();
    render();
  } catch (err: any) {
    showToast(`保存失败: ${err.message}`, "error");
  }
}

async function testWereadConnection(): Promise<void> {
  try {
    const testKey = state.wereadApiKeyInput.trim();
    const res = await apiFetch<{ connected: boolean; totalBookCount?: number; totalNoteCount?: number; error?: string }>("/v1/kb/channels/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "weread",
        apiKey: testKey || undefined,
      }),
    });

    if (res.connected) {
      showToast(`🟢 微信读书连接成功！共检测到 ${res.totalBookCount || 0} 本书，${res.totalNoteCount || 0} 条笔记`, "success");
      state.wereadStatus = res;
      render();
    } else {
      showToast(`🔴 连通失败: ${res.error || "请检查 API Key"}`, "error");
    }
  } catch (err: any) {
    showToast(`连通测试失败: ${err.message}`, "error");
  }
}

async function triggerManualSync(): Promise<void> {
  if (state.syncRunning) return;
  state.syncRunning = true;
  render();

  try {
    const res = await apiFetch<{ ok: boolean; summary: string }>("/v1/kb/channels/sync", {
      method: "POST",
    });

    if (res.ok) {
      showToast(`🎉 ${res.summary}`, "success");
    } else {
      showToast(`⚠️ ${res.summary}`, "error");
    }

    await loadCollections();
    await loadDocuments();
    await loadChannelsConfig();
    if (state.showWereadModal && state.wereadModalTab === "stream") {
      await loadSyncHighlightsStream();
    }
  } catch (err: any) {
    showToast(`增量同步失败: ${err.message}`, "error");
  } finally {
    state.syncRunning = false;
    render();
  }
}

async function importSingleWereadBook(bookId: string, title?: string): Promise<void> {
  state.wereadImporting = true;
  render();

  try {
    const targetCol = state.wereadImportTargetCol || state.activeCollectionId || "col_default";
    const res = await apiFetch<{ document: KbDocument }>("/v1/kb/channels/weread/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId,
        title,
        collection_id: targetCol,
      }),
    });

    showToast(`已成功将《${title || "原书"}》精读划线导入知识库！`, "success");
    state.showWereadModal = false;
    state.activeDocId = res.document.id;
    await loadCollections();
    await loadDocuments();
  } catch (err: any) {
    showToast(`导入失败: ${err.message}`, "error");
  } finally {
    state.wereadImporting = false;
    render();
  }
}

async function batchImportWereadBooks(): Promise<void> {
  if (state.wereadSelectedIds.size === 0) return;
  state.wereadImporting = true;
  render();

  try {
    const targetCol = state.wereadImportTargetCol || state.activeCollectionId || "col_default";
    const bookIds = Array.from(state.wereadSelectedIds);

    const res = await apiFetch<{ imported: KbDocument[]; failed: any[]; total: number }>("/v1/kb/channels/weread/batch-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookIds,
        collection_id: targetCol,
      }),
    });

    showToast(`批量导入完成：成功 ${res.imported?.length || 0} 本，失败 ${res.failed?.length || 0} 本`, "success");
    state.showWereadModal = false;
    state.wereadSelectedIds.clear();
    await loadCollections();
    await loadDocuments();
    if (res.imported && res.imported.length > 0) {
      state.activeDocId = res.imported[0].id;
    }
  } catch (err: any) {
    showToast(`批量导入失败: ${err.message}`, "error");
  } finally {
    state.wereadImporting = false;
    render();
  }
}

function onWereadSearch(query: string): void {
  state.wereadSearchQuery = query;
  if (wereadSearchTimer) clearTimeout(wereadSearchTimer);
  wereadSearchTimer = setTimeout(() => {
    render();
  }, 150);
}

// --- Karpathy LLM Wiki Compilation Handlers ---
async function openCompileModal(docId?: string, engine?: "markitdown" | "docling"): Promise<void> {
  state.showCompileModal = true;
  state.compileTargetDocId = docId || "";
  state.compileTargetEngine = engine || (state.splitMode === "docling" ? "docling" : "markitdown");
  state.compileVaultRoot = localStorage.getItem("kb_obsidian_vault_root") || "";
  state.compileDraft = null;
  state.compileFeedback = "";
  state.compileApplyResult = null;
  state.compileLoading = true;
  state.compileLoadingText = "正在加载网关已配置的 LLM 模型...";
  render();

  try {
    const res = await apiFetch<{ models: CompileModelOption[] }>("/v1/kb/compile/models");
    state.compileModels = res.models || [];

    const clients = getCompileClients();
    if (!state.compileSelectedClient || !clients.includes(state.compileSelectedClient)) {
      state.compileSelectedClient = clients[0] || "code";
    }

    const eps = getCompileEndpoints(state.compileSelectedClient);
    if (!state.compileSelectedEndpointId || !eps.some((e) => e.id === state.compileSelectedEndpointId)) {
      const defEp = state.compileModels.find((m) => m.client === state.compileSelectedClient && m.isDefault);
      state.compileSelectedEndpointId = defEp ? defEp.endpointId : (eps[0]?.id || "");
    }

    const models = getCompileModels(state.compileSelectedClient, state.compileSelectedEndpointId);
    if (!state.compileSelectedModel || !models.includes(state.compileSelectedModel)) {
      state.compileSelectedModel = models[0] || "glm-5.2";
    }
  } catch (err: any) {
    console.error("加载模型列表失败:", err);
  } finally {
    state.compileLoading = false;
    render();
  }
}

function closeCompileModal(): void {
  if (state.compileLoading || state.compileRefining || state.compileApplying) return;
  state.showCompileModal = false;
  render();
}

async function startCompilePreview(): Promise<void> {
  const vaultRoot = state.compileVaultRoot.trim();
  if (!vaultRoot) {
    showToast("请指定目标 Obsidian 知识库 (Vault) 根目录绝对路径！", "error");
    return;
  }
  localStorage.setItem("kb_obsidian_vault_root", vaultRoot);

  state.compileLoading = true;
  state.compileLoadingText = "正在基于 Karpathy 范式深度编译原子概念与双向链接... (约需 10~30 秒)";
  render();

  try {
    const body: any = {
      vault_root: vaultRoot,
      client: state.compileSelectedClient || "code",
      endpoint_id: state.compileSelectedEndpointId || "",
      model: state.compileSelectedModel || "",
      custom_instruction: state.compileCustomInstruction,
      engine: state.compileTargetEngine || "markitdown",
    };

    if (state.compileTargetDocId) {
      body.document_ids = [state.compileTargetDocId];
    } else {
      body.collection_id = state.activeCollectionId || "col_default";
    }

    const res = await apiFetch<{ draft: CompileDraft }>("/v1/kb/compile/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    state.compileDraft = res.draft;
    state.compileActiveConceptIdx = 0;
    state.compileApplyResult = null;
  } catch (err: any) {
    showToast(`编译草稿生成失败: ${err.message}`, "error");
  } finally {
    state.compileLoading = false;
    render();
  }
}

async function refineCompileDraft(): Promise<void> {
  if (!state.compileDraft) return;
  const feedback = state.compileFeedback.trim();
  if (!feedback) {
    showToast("请输入具体的增量修改建议！", "error");
    return;
  }

  state.compileRefining = true;
  render();

  try {
    const body: any = {
      draft: state.compileDraft,
      feedback,
      vault_root: state.compileVaultRoot.trim(),
      client: state.compileSelectedClient || "code",
      endpoint_id: state.compileSelectedEndpointId || "",
      model: state.compileSelectedModel || "",
    };

    if (state.compileTargetDocId) {
      body.document_ids = [state.compileTargetDocId];
    } else {
      body.collection_id = state.activeCollectionId || "col_default";
    }

    const res = await apiFetch<{ draft: CompileDraft }>("/v1/kb/compile/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    state.compileDraft = res.draft;
    state.compileFeedback = "";
    state.compileActiveConceptIdx = 0;
  } catch (err: any) {
    showToast(`增量优化失败: ${err.message}`, "error");
  } finally {
    state.compileRefining = false;
    render();
  }
}

async function applyCompileDraft(): Promise<void> {
  if (!state.compileDraft) return;
  const vaultRoot = state.compileVaultRoot.trim();
  if (!vaultRoot) {
    showToast("请指定目标 Obsidian 知识库 (Vault) 根目录绝对路径！", "error");
    return;
  }
  localStorage.setItem("kb_obsidian_vault_root", vaultRoot);

  state.compileApplying = true;
  render();

  try {
    const body: any = {
      draft: state.compileDraft,
      vault_root: vaultRoot,
      engine: state.compileTargetEngine || "markitdown",
    };
    if (state.compileTargetDocId) {
      body.document_ids = [state.compileTargetDocId];
    } else {
      body.collection_id = state.activeCollectionId || "col_default";
    }

    const res = await apiFetch<{ ok: boolean; vaultRoot: string; writtenFiles: string[]; conceptsCount: number }>("/v1/kb/compile/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    state.compileApplyResult = res;
    showToast(`成功编译并写入 ${res.conceptsCount} 个原子概念卡片至 Obsidian！`, "success");
  } catch (err: any) {
    showToast(`写入 Obsidian Vault 失败: ${err.message}`, "error");
  } finally {
    state.compileApplying = false;
    render();
  }
}

// --- Video Knowledge Base Handlers ---
async function openVideoModal(tab?: "url" | "local"): Promise<void> {
  state.showVideoModal = true;
  if (tab) {
    state.videoModalTab = tab;
    localStorage.setItem("kb_video_modal_tab", tab);
  } else {
    state.videoModalTab = (localStorage.getItem("kb_video_modal_tab") as "url" | "local") || "url";
  }
  state.videoFileInput = null;
  state.videoLoading = true;
  state.videoList = [];
  state.videoTaskStatus = "idle";
  state.videoTaskStep = "";
  render();

  try {
    const [videoRes] = await Promise.all([
      apiFetch<{ videos: any[] }>("/v1/video-kb/videos").catch(() => ({ videos: [] })),
      (async () => {
        if (state.compileModels.length === 0) {
          try {
            const mRes = await apiFetch<{ models: CompileModelOption[] }>("/v1/kb/compile/models");
            state.compileModels = mRes.models || [];
          } catch {}
        }
      })(),
    ]);
    state.videoList = videoRes.videos || [];

    // Initialize summary model selectors
    const clients = getCompileClients();
    if (!state.videoSummaryClientInput || !clients.includes(state.videoSummaryClientInput)) {
      state.videoSummaryClientInput = clients[0] || "code";
    }
    const eps = getCompileEndpoints(state.videoSummaryClientInput);
    if (!state.videoSummaryEndpointIdInput || !eps.some((e) => e.id === state.videoSummaryEndpointIdInput)) {
      const savedEp = localStorage.getItem("kb_video_summary_endpoint_id");
      if (savedEp && eps.some((e) => e.id === savedEp)) {
        state.videoSummaryEndpointIdInput = savedEp;
      } else {
        const defEp = state.compileModels.find((m) => m.client === state.videoSummaryClientInput && m.isDefault);
        state.videoSummaryEndpointIdInput = defEp ? defEp.endpointId : (eps[0]?.id || "");
      }
    }
    const models = getCompileModels(state.videoSummaryClientInput, state.videoSummaryEndpointIdInput);
    if (!state.videoSummaryModelInput || !models.includes(state.videoSummaryModelInput)) {
      const savedModel = localStorage.getItem("kb_video_summary_model");
      if (savedModel && models.includes(savedModel)) {
        state.videoSummaryModelInput = savedModel;
      } else {
        state.videoSummaryModelInput = models[0] || "glm-5.2";
      }
    }

    // Initialize vision model selectors for video keyframes
    const vClients = getCompileClients();
    if (!state.videoVisionClientInput || !vClients.includes(state.videoVisionClientInput)) {
      state.videoVisionClientInput = state.videoSummaryClientInput || vClients[0] || "code";
    }
    const vEps = getCompileEndpoints(state.videoVisionClientInput);
    if (!state.videoVisionEndpointIdInput || !vEps.some((e) => e.id === state.videoVisionEndpointIdInput)) {
      const savedVEp = localStorage.getItem("kb_video_vision_endpoint_id") || localStorage.getItem("kb_vision_endpoint_id");
      if (savedVEp && vEps.some((e) => e.id === savedVEp)) {
        state.videoVisionEndpointIdInput = savedVEp;
      } else {
        const defEp = state.compileModels.find((m) => m.client === state.videoVisionClientInput && m.isDefault);
        state.videoVisionEndpointIdInput = defEp ? defEp.endpointId : (vEps[0]?.id || "");
      }
    }
    const vModels = getCompileModels(state.videoVisionClientInput, state.videoVisionEndpointIdInput);
    if (!state.videoVisionModelInput || !vModels.includes(state.videoVisionModelInput)) {
      const savedVModel = localStorage.getItem("kb_video_vision_model") || localStorage.getItem("kb_vision_model");
      if (savedVModel && vModels.includes(savedVModel)) {
        state.videoVisionModelInput = savedVModel;
      } else {
        const visionModel = vModels.find((m) => /vl|vision|4o|claude|gemini|glm-4v/i.test(m));
        state.videoVisionModelInput = visionModel || vModels[0] || "qwen-vl-max";
      }
    }
  } catch (err: any) {
    console.warn("加载视频知识库列表失败:", err);
    state.videoList = [];
  } finally {
    state.videoLoading = false;
    render();
  }
}

async function startVideoIngest(): Promise<void> {
  let targetUrl = "";
  let displayTitle = state.videoTitleInput.trim();

  if (state.videoModalTab === "local") {
    if (!state.videoFileInput) {
      showToast("请先选择或拖拽本地音视频文件", "error");
      return;
    }
    state.videoTaskStatus = "running";
    state.videoTaskStep = `正在上传本地文件 ${state.videoFileInput.name} 至网关缓存...`;
    render();

    try {
      const upRes = await fetch("/v1/video-kb/upload", {
        method: "POST",
        headers: {
          "x-filename": encodeURIComponent(state.videoFileInput.name),
        },
        body: await state.videoFileInput.arrayBuffer(),
      });
      if (!upRes.ok) throw new Error(`文件上传失败: HTTP ${upRes.status}`);
      const upData = await upRes.json();
      targetUrl = upData.filePath;
      if (!displayTitle) {
        displayTitle = state.videoFileInput.name.replace(/\.[^/.]+$/, "");
      }
    } catch (err: any) {
      state.videoTaskStatus = "failed";
      state.videoTaskStep = `本地音视频文件上传失败: ${err.message}`;
      render();
      return;
    }
  } else {
    targetUrl = state.videoUrlInput.trim();
    if (!targetUrl) {
      showToast("请输入音视频链接 (支持 Bilibili, YouTube, 播客音频等)", "error");
      return;
    }
  }

  state.videoTaskStatus = "running";
  state.videoTaskStep = "正在提交音视频解析与转录任务...";
  render();

  try {
    const steps = ["fetch_info", "download_audio", "transcribe", "summarize"];
    if (state.videoFrameStrategyInput !== "none") {
      steps.push("download_video", "extract_frames");
      if (state.videoEnableVisionAudit) {
        steps.push("vision_audit");
      }
    }

    const res = await apiFetch<{ task_id: string; video_id: string }>("/v1/video-kb/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: targetUrl,
        display_title: displayTitle || undefined,
        language: state.videoLanguageInput || "auto",
        whisper_model: state.videoWhisperModelInput || "base",
        whisper_tool: "whisper-ctranslate2",
        collection: state.activeCollectionId || "default",
        summary_client: state.videoSummaryClientInput || "code",
        summary_endpoint_id: state.videoSummaryEndpointIdInput || undefined,
        summary_model: state.videoSummaryModelInput || "glm-5.2",
        frame_strategy: state.videoFrameStrategyInput || "scene",
        frame_interval: Number(state.videoFrameIntervalInput) || 5,
        max_frames: Number(state.videoMaxFramesInput) || 30,
        vision_client: state.videoVisionClientInput || state.videoSummaryClientInput || "code",
        vision_endpoint_id: state.videoVisionEndpointIdInput || undefined,
        vision_model: state.videoVisionModelInput || "qwen-vl-max",
        steps,
      }),
    });

    state.videoTaskId = res.task_id;
    state.videoTaskStep = "任务已提交队列，正在调度音轨下载与 Whisper 转录...";
    render();
    void pollVideoTask(res.task_id);
  } catch (err: any) {
    state.videoTaskStatus = "failed";
    state.videoTaskStep = `提交任务失败: ${err.message}`;
    render();
  }
}

async function pollVideoTask(taskId: string): Promise<void> {
  if (!state.showVideoModal || state.videoTaskId !== taskId) return;

  try {
    const task = await apiFetch<any>(`/v1/tasks/${taskId}`);
    if (!task) return;

    if (task.step_label || task.status_message) {
      state.videoTaskStep = task.step_label || task.status_message;
    }

    if (task.status === "running" || task.status === "pending" || task.status === "queued") {
      state.videoTaskStatus = "running";
      render();
      setTimeout(() => void pollVideoTask(taskId), 1500);
    } else if (task.status === "succeeded") {
      state.videoTaskStatus = "succeeded";
      state.videoTaskStep = "音视频转录与 AI 智能摘要已完成！正在自动导入文档知识库...";
      render();

      const videoId = task.result?.videoId || task.result?.video_id || task.payload?.videoId || "";
      if (videoId) {
        await importVideoDoc(videoId);
      } else {
        await openVideoModal();
      }
    } else if (task.status === "failed" || task.status === "cancelled") {
      state.videoTaskStatus = "failed";
      state.videoTaskStep = `处理失败: ${task.error?.message || "未知错误"}`;
      render();
    }
  } catch (err: any) {
    console.error("Poll video task error:", err);
  }
}

function closeVideoModal(): void {
  if (state.videoImporting) return;
  state.showVideoModal = false;
  render();
}

async function importVideoDoc(videoId: string): Promise<void> {
  state.videoImporting = true;
  render();

  try {
    const detail = await apiFetch<any>(`/v1/video-kb/videos/${encodeURIComponent(videoId)}`);
    const title = detail.display_title || detail.source_title || detail.video_title || "视频知识库文档";
    const duration = detail.duration ? `${Math.round(detail.duration)}秒` : "";
    const lang = detail.language || "zh";
    const url = detail.video_url || "";

    const lines: string[] = [];
    lines.push(`# ${title}\n`);
    if (url || duration || lang) {
      lines.push(`> 来源链接: ${url ? `[${url}](${url})` : "本地处理"}  `);
      if (duration) lines.push(`> 视频时长: ${duration} | 语言识别: ${lang}  `);
      lines.push("");
    }

    if (detail.summary_full || detail.summary_short) {
      lines.push(`## 视频摘要\n`);
      lines.push(detail.summary_full || detail.summary_short || "");
      lines.push("");
    }

    if (Array.isArray(detail.key_points) && detail.key_points.length > 0) {
      lines.push(`## 核心要点\n`);
      detail.key_points.forEach((kp: string) => lines.push(`- ${kp}`));
      lines.push("");
    }

    if (Array.isArray(detail.chunks) && detail.chunks.length > 0) {
      lines.push(`## 语音转录全文 (Whisper)\n`);
      detail.chunks.forEach((c: any) => {
        const start = Math.floor(c.start || 0);
        const end = Math.floor(c.end || 0);
        const timeFmt = `${Math.floor(start / 60)}:${String(start % 60).padStart(2, "0")} - ${Math.floor(end / 60)}:${String(end % 60).padStart(2, "0")}`;
        lines.push(`**[${timeFmt}]** ${c.text}\n`);
      });
    }

    const markdownText = lines.join("\n");
    const targetCol = state.activeCollectionId || "col_default";

    const res = await apiFetch<{ document: KbDocument }>("/v1/kb/ingest/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        text: markdownText,
        collection_id: targetCol,
        source_type: "video",
        source_url: url,
      }),
    });

    state.showVideoModal = false;
    await loadCollections();
    await loadDocuments();
    if (res.document) {
      state.activeDocId = res.document.id;
      showToast("视频转录与 AI 摘要已成功入库！", "success");
    }
  } catch (err: any) {
    showToast(`导入视频知识库失败: ${err.message}`, "error");
  } finally {
    state.videoImporting = false;
    render();
  }
}

// --- Vision Multimodal Transcription Modal Handlers ---
function openVisionModal(assetUrl: string, assetName: string, title?: string, docId?: string, engine?: "docling" | "markitdown"): void {
  state.showVisionModal = true;
  state.visionTargetAssetUrl = assetUrl;
  state.visionTargetAssetName = assetName;
  state.visionTargetTitle = title || assetName || "图像凭证";
  state.visionTargetDocId = docId || state.activeDoc?.id || "";
  state.visionTargetEngine = engine || (state.activeDoc?.adopted_engine as any) || "docling";
  state.visionLoading = false;
  state.visionResult = null;

  // Initialize vision models
  const clients = getCompileClients();
  if (!state.visionClientInput || !clients.includes(state.visionClientInput)) {
    state.visionClientInput = clients[0] || "code";
  }
  const eps = getCompileEndpoints(state.visionClientInput);
  if (!state.visionEndpointIdInput || !eps.some((e) => e.id === state.visionEndpointIdInput)) {
    const defEp = state.compileModels.find((m) => m.client === state.visionClientInput && m.isDefault);
    state.visionEndpointIdInput = defEp ? defEp.endpointId : (eps[0]?.id || "");
  }
  const models = getCompileModels(state.visionClientInput, state.visionEndpointIdInput);
  if (!state.visionModelInput || !models.includes(state.visionModelInput)) {
    const visionModel = models.find((m) => /vl|vision|4o|claude|gemini|glm-4v/i.test(m));
    state.visionModelInput = visionModel || models[0] || "qwen-vl-max";
  }

  render();
}

async function executeVisionTranscribe(): Promise<void> {
  if (!state.visionTargetDocId || !state.visionTargetAssetName) {
    showToast("缺少待转译的图片信息", "error");
    return;
  }

  state.visionLoading = true;
  state.visionResult = null;
  render();

  try {
    const res = await apiFetch<any>("/v1/kb/vision/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_id: state.visionTargetDocId,
        asset_name: state.visionTargetAssetName,
        asset_url: state.visionTargetAssetUrl,
        title: state.visionTargetTitle,
        source_type: "doc",
        timestamp_or_page: "插图",
        client: state.visionClientInput,
        endpoint_id: state.visionEndpointIdInput || undefined,
        model: state.visionModelInput,
        apply_to_doc: true,
        engine: state.visionTargetEngine,
      }),
    });

    state.visionResult = res;
    state.visionLoading = false;

    // Refresh active document in memory
    if (state.activeDoc && state.activeDoc.id === state.visionTargetDocId) {
      const updatedDoc = await apiFetch<KbDocument>(`/v1/kb/documents/${state.activeDoc.id}`);
      if (updatedDoc) {
        state.activeDoc = updatedDoc;
        const idx = state.documents.findIndex((d) => d.id === updatedDoc.id);
        if (idx !== -1) state.documents[idx] = updatedDoc;
      }
    }

    showToast("🎉 视觉图表深度转译完成并已追加至文档！", "success");
    render();
  } catch (err: any) {
    state.visionLoading = false;
    showToast(`转译失败: ${err.message}`, "error");
    render();
  }
}

// --- OS Protocol / External URL Opener ---
async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;
  try {
    const res = await apiFetch<{ ok: boolean; error?: string }>("/v1/kb/open-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      window.open(url, "_blank");
    }
  } catch {
    window.open(url, "_blank");
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
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; row-gap:6px; flex-wrap:wrap; margin-bottom:4px;">
          <div style="font-weight:600;">⚠️ ${toolName} 解析失败</div>
          <button class="btn btn-xs btn-primary" onclick="window.__kbReparseDocument('${doc.id}', '${engine}')" ${state.reparsingEngine ? "disabled" : ""}>
            ${state.reparsingEngine === engine ? "⏳ 重跑中..." : "🔄 重跑解析"}
          </button>
        </div>
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
          <button class="btn btn-primary" onclick="window.__kbShowToast('知识切片引擎正在流水线集成中，解析出的所有 Markdown 与富文本将可无缝直接灌入！', 'info')">▶️ 开启切片索引构建</button>
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
          <button class="btn btn-primary" onclick="window.__kbShowToast('混合检索评测室正在对齐 RRF 参数算法！当前 SQLite FTS5 全文搜索已可用。', 'info')">🔍 运行检索召回基准评测</button>
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
          <button class="btn btn-primary" onclick="window.__kbShowToast('问答工作舱与 MCP 适配器正在对接，未来 Claude Code、Codex、Antigravity 即可直接对话检索此库！', 'info')">💬 开启对话舱</button>
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

// --- WeRead & Channels Modal Tab Renderers ---
function renderWereadNotebooksTab(): string {
  if (!state.wereadStatus?.connected && !state.wereadLoading) {
    return `
      <div class="kb-alert kb-alert-error" style="margin-bottom: 14px; padding: 16px; border-radius: 8px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25);">
        <div style="font-weight: 600; color: #ef4444; font-size: 14px; display: flex; align-items: center; gap: 6px;">
          <span>⚠️</span> 微信读书未配置 API Key 或连接失败
        </div>
        <div style="font-size: 12px; margin-top: 6px; color: var(--text-secondary); line-height: 1.6;">
          ${esc(state.wereadStatus?.error || "尚未检测到有效的微信读书凭证。")}
        </div>
        <div style="margin-top: 12px;">
          <button class="btn btn-sm btn-primary" onclick="window.__kbSetWereadModalTab('settings')">
            ⚙️ 前往【凭证隔离与同步计划】配置 API Key ➔
          </button>
        </div>
      </div>
    `;
  }

  if (state.wereadLoading) {
    return `
      <div style="text-align: center; padding: 60px; color: var(--text-secondary);">
        <span class="kb-spinner" style="width: 24px; height: 24px; margin-bottom: 12px;"></span>
        <div style="font-size: 14px; font-weight: 500;">正在从微信读书获取书架笔记列表...</div>
      </div>
    `;
  }

  const query = state.wereadSearchQuery.toLowerCase().trim();
  const books = query
    ? state.wereadBooks.filter((b) => (b.title || "").toLowerCase().includes(query) || (b.author || "").toLowerCase().includes(query) || (b.category || "").toLowerCase().includes(query))
    : state.wereadBooks;

  return `
    <div style="display: flex; flex-direction: column; gap: 12px; min-height: 440px; height: 55vh;">
      <!-- Filter Bar: Search + Target Collection -->
      <div style="display: flex; gap: 12px; align-items: center; flex-shrink: 0;">
        <div style="flex: 1;">
          <input type="text" class="kb-form-input" placeholder="🔍 搜索书架中的书名、作者或分类..."
            value="${esc(state.wereadSearchQuery)}"
            oninput="window.__kbOnWereadSearch(this.value)"
            ${state.wereadImporting ? "disabled" : ""} />
        </div>
        <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; flex-shrink: 0;">
          <span style="white-space: nowrap; color: var(--text-secondary);">目标知识库:</span>
          <select class="kb-form-input" style="width: 140px; padding: 5px 8px; font-size: 12px;"
            onchange="window.__kbSetStateValue('wereadImportTargetCol', this.value)"
            ${state.wereadImporting ? "disabled" : ""}>
            ${state.collections.map((c) => `
              <option value="${c.id}" ${(state.wereadImportTargetCol || state.activeCollectionId || 'col_default') === c.id ? 'selected' : ''}>
                ${getCollectionIcon(c.icon)} ${esc(c.name)}
              </option>
            `).join('')}
          </select>
        </div>
        <button class="btn btn-sm" onclick="window.__kbReloadWereadNotebooks()" ${state.wereadLoading || state.wereadImporting ? "disabled" : ""} title="刷新微信读书书架">
          🔄 刷新
        </button>
      </div>

      <!-- Books List Container -->
      <div style="flex: 1; border: 1px solid var(--border-color); border-radius: 8px; overflow-y: auto; background: var(--bg-secondary); padding: 12px;">
        ${books.length === 0 ? `
          <div style="text-align: center; padding: 48px; color: var(--text-secondary);">
            <div style="font-size: 24px; margin-bottom: 8px;">📚</div>
            <div>${state.wereadSearchQuery ? "未找到符合条件的图书笔记" : "微信读书书架暂无带有划线或书评的图书"}</div>
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${books.map((b) => {
              const isSelected = state.wereadSelectedIds.has(b.bookId);
              return `
                <div class="kb-weread-book-card ${isSelected ? 'is-selected' : ''}">
                  <div style="display: flex; align-items: center; padding: 0 4px;">
                    <input type="checkbox" value="${b.bookId}"
                      ${isSelected ? "checked" : ""}
                      onchange="window.__kbToggleWereadBook('${b.bookId}', this.checked)"
                      ${state.wereadImporting ? "disabled" : ""} />
                  </div>
                  ${b.cover ? `
                    <img src="${esc(b.cover)}" class="kb-weread-cover" alt="${esc(b.title)}" onerror="this.style.display='none'" />
                  ` : `
                    <div class="kb-weread-cover" style="display: flex; align-items: center; justify-content: center; font-size: 20px;">📖</div>
                  `}
                  <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="font-weight: 600; font-size: 14px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        《${esc(b.title)}》
                      </span>
                      ${b.category ? `<span class="badge" style="font-size: 10px; padding: 1px 6px;">${esc(b.category)}</span>` : ''}
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 3px;">
                      作者: ${esc(b.author || "未知作者")}
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; display: flex; align-items: center; gap: 10px;">
                      <span>🖊️ <b>${b.noteCount || 0}</b> 处划线</span>
                      <span>💭 <b>${b.reviewCount || 0}</b> 条想法</span>
                      ${b.lastNoteTimeStr ? `<span>🕒 最近划线: ${b.lastNoteTimeStr}</span>` : ""}
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; padding-left: 8px;">
                    <button class="btn btn-xs btn-primary" onclick="window.__kbImportSingleWereadBook('${b.bookId}', '${esc(b.title)}')" ${state.wereadImporting ? "disabled" : ""}>
                      ${state.wereadImporting ? "导入中..." : "导入知识库"}
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

function renderWereadStreamTab(): string {
  if (state.wereadLoading) {
    return `
      <div style="text-align: center; padding: 60px; color: var(--text-secondary);">
        <span class="kb-spinner" style="width: 24px; height: 24px; margin-bottom: 12px;"></span>
        <div style="font-size: 14px; font-weight: 500;">正在加载划线流水记录...</div>
      </div>
    `;
  }

  const stream = state.syncHighlightsStream || [];

  return `
    <div style="display: flex; flex-direction: column; gap: 12px; min-height: 440px; height: 55vh;">
      <!-- Header banner with fast sync trigger -->
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(59, 130, 246, 0.06); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; flex-shrink: 0;">
        <div style="font-size: 12px; color: var(--text-secondary);">
          📅 <b>每日同步划线与想法流水</b> · 按日期聚合沉淀的增量精读划线，支持溯源直达原书
        </div>
        <button class="btn btn-xs btn-primary" onclick="window.__kbTriggerManualSync()" ${state.syncRunning ? "disabled" : ""} title="立即执行增量同步拉取最新划线">
          ${state.syncRunning ? `<span class="kb-spinner" style="width:10px;height:10px;margin-right:4px;"></span> 正在同步...` : `🔄 立即增量同步`}
        </button>
      </div>

      <!-- Scrollable Stream Container -->
      <div style="flex: 1; border: 1px solid var(--border-color); border-radius: 8px; overflow-y: auto; background: var(--bg-secondary); padding: 14px;">
        ${stream.length === 0 ? `
          <div style="text-align: center; padding: 48px; color: var(--text-secondary);">
            <div style="font-size: 28px; margin-bottom: 10px;">📅</div>
            <div style="font-weight: 500;">暂无增量划线记录</div>
            <div style="font-size: 12px; margin-top: 6px; color: var(--text-muted);">
              请前往【⚙️ 计划设置】开启自动定时同步，或点击上方【🔄 立即增量同步】立即拉取微信读书划线。
            </div>
          </div>
        ` : `
          <div>
            ${stream.map((day) => `
              <div class="kb-stream-date-group">
                <div class="kb-stream-date-header">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span>📅</span>
                    <span style="font-weight: 600;">${esc(day.date)}</span>
                    <span class="badge" style="font-size: 11px;">${day.items.length} 条笔记</span>
                  </div>
                  <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">
                    渠道: ${esc(day.channel_name || "微信读书")}
                  </span>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${day.items.map((item) => `
                    <div class="kb-stream-item">
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                          <span style="font-weight: 600; color: var(--text-primary);">📖 《${esc(item.book_title)}》</span>
                          ${item.chapter_title ? `<span style="color: var(--text-muted);">· ${esc(item.chapter_title)}</span>` : ""}
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <span class="badge ${item.type === 'thought' ? 'badge-warn' : 'badge-info'}" style="font-size: 10px; padding: 1px 6px;">
                            ${item.type === 'thought' ? '💭 想法' : '🖊️ 划线'}
                          </span>
                          <span style="font-size: 11px; color: var(--text-muted);">${esc(item.create_time_str || '')}</span>
                        </div>
                      </div>

                      <div class="kb-stream-quote">${esc(item.mark_text)}</div>

                      <div style="display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 6px; font-size: 11px;">
                        ${item.deep_link ? `
                          <a href="${esc(item.deep_link)}" target="_blank" rel="noopener noreferrer" class="kb-source-link" title="在微信读书中查看原书">
                            📚 在微信读书中打开 ↗
                          </a>
                        ` : ""}
                        ${item.doc_id ? `
                          <button class="btn btn-xs" onclick="window.__kbSelectDocAndCloseModal('${item.doc_id}')" title="在知识库工作台中打开文档">
                            📄 查看知识库文档
                          </button>
                        ` : ""}
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

function renderWereadSettingsTab(): string {
  const wereadKey = state.channelsConfig?.weread?.credentials?.api_key || "";
  const sched = state.channelsConfig?.schedule || {};

  return `
    <div style="display: flex; flex-direction: column; gap: 18px; min-height: 440px; height: 55vh; overflow-y: auto; padding-right: 4px;">
      <!-- Credential Isolation Box -->
      <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; background: var(--surface);">
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
          <span>🔒</span>
          <span>读书软件凭证隔离存储 (Credential Isolation)</span>
          <span class="badge badge-success" style="font-size: 10px; padding: 1px 6px;">Git 隔离安全</span>
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">
          为了保障凭证安全与架构解耦，渠道 API Key 均独立保存在本地 <code>data/knowledge-base/channel-secrets.json</code> 中，已被 <code>.gitignore</code> 严格排除，绝不提交至 GitHub；且独立于网关模型专属的 <code>gateway.config.json</code>，具备未来支持得到、豆瓣读书等软件的高扩展性。
        </div>

        <div class="kb-form-group" style="margin-bottom: 10px;">
          <label class="kb-form-label" style="display: flex; justify-content: space-between;">
            <span>微信读书 API Key (wrk-...)</span>
            <span style="font-size: 11px; color: var(--text-muted);">
              ${wereadKey ? `当前状态: 已配置 (<code>${esc(wereadKey)}</code>)` : "当前状态: 未配置"}
            </span>
          </label>
          <div style="display: flex; gap: 8px;">
            <input type="${state.wereadShowApiKey ? 'text' : 'password'}" class="kb-form-input"
              placeholder="${wereadKey ? '如需修改，请输入新的 API Key' : '请输入微信读书 API Key (wrk-...)'}"
              value="${esc(state.wereadApiKeyInput)}"
              oninput="window.__kbSetStateValue('wereadApiKeyInput', this.value)" />
            <button class="btn btn-sm" onclick="window.__kbToggleShowWereadApiKey()" title="切换明文显示">
              ${state.wereadShowApiKey ? "🙈 隐藏" : "👁️ 显示"}
            </button>
            <button class="btn btn-sm" onclick="window.__kbTestWereadConnection()" title="测试 API Key 连接状态">
              🔌 测试连通
            </button>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
            提示：也可直接在启动网关前设置环境变量 <code>WEREAD_API_KEY</code>，系统会自动继承。
          </div>
        </div>
      </div>

      <!-- Auto Incremental Sync Schedule Configuration -->
      <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; background: var(--surface);">
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
          <span>⏰</span>
          <span>存量与每日增量自动同步计划 (Incremental Sync Scheduler)</span>
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px; line-height: 1.5;">
          自动增量同步会在后台静默比对书架图书与划线时间戳（水线 Watermark），仅拉取最新变动的笔记和想法，极速且 0 冗余流量；同时将每日划线写入流水，方便随时回溯。
        </div>

        <div class="kb-form-group" style="margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-weight: 500; font-size: 13px; color: var(--text-primary);">开启自动增量同步计划</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">开启后系统将按照设定的频率在后台静默增量同步划线与想法</div>
          </div>
          <label class="kb-switch">
            <input type="checkbox" class="kb-switch-input" ${state.syncScheduleEnabledInput ? "checked" : ""}
              onchange="window.__kbSetStateValue('syncScheduleEnabledInput', this.checked); render();" />
            <span class="kb-switch-track"></span>
          </label>
        </div>

        ${state.syncScheduleEnabledInput ? `
          <div style="display: flex; flex-direction: column; gap: 14px; padding: 14px; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 14px;">
            <!-- Schedule Mode: Segmented Slider -->
            <div class="kb-form-group">
              <label class="kb-form-label" style="margin-bottom: 6px; font-weight: 600;">同步触发频率与模式</label>
              <div class="kb-segmented-group">
                <label class="kb-segmented-item ${state.syncScheduleModeInput === 'daily' ? 'active' : ''}">
                  <input type="radio" name="syncMode" value="daily" ${state.syncScheduleModeInput === "daily" ? "checked" : ""}
                    onchange="window.__kbSetStateValue('syncScheduleModeInput', 'daily'); render();" />
                  <span>⏰ 每日指定时间定时执行 (推荐)</span>
                </label>
                <label class="kb-segmented-item ${state.syncScheduleModeInput === 'interval' ? 'active' : ''}">
                  <input type="radio" name="syncMode" value="interval" ${state.syncScheduleModeInput === "interval" ? "checked" : ""}
                    onchange="window.__kbSetStateValue('syncScheduleModeInput', 'interval'); render();" />
                  <span>🔄 固定间隔循环执行</span>
                </label>
              </div>
            </div>

            ${state.syncScheduleModeInput === "daily" ? `
              <div class="kb-form-group">
                <label class="kb-form-label">每日定时执行时间 (24小时制，例如 04:00 凌晨静默同步)</label>
                <input type="time" class="kb-form-input" style="width: 160px;"
                  value="${esc(state.syncDailyTimeInput)}"
                  oninput="window.__kbSetStateValue('syncDailyTimeInput', this.value)" />
              </div>
            ` : `
              <div class="kb-form-group">
                <label class="kb-form-label">循环执行间隔 (小时)</label>
                <select class="kb-form-input" style="width: 160px;"
                  onchange="window.__kbSetStateValue('syncIntervalHoursInput', Number(this.value))">
                  <option value="4" ${state.syncIntervalHoursInput === 4 ? "selected" : ""}>每 4 小时</option>
                  <option value="6" ${state.syncIntervalHoursInput === 6 ? "selected" : ""}>每 6 小时</option>
                  <option value="12" ${state.syncIntervalHoursInput === 12 ? "selected" : ""}>每 12 小时</option>
                  <option value="24" ${state.syncIntervalHoursInput === 24 ? "selected" : ""}>每 24 小时</option>
                </select>
              </div>
            `}

            <!-- Startup Sync Switch -->
            <div class="kb-form-group" style="display: flex; align-items: center; justify-content: space-between; padding-top: 8px; border-top: 1px dashed var(--border-color);">
              <div>
                <div style="font-size: 12px; font-weight: 500; color: var(--text-primary);">网关启动时自动补全同步一次 (Sync on Startup)</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">防止网关离线期间遗漏微信读书划线或想法数据</div>
              </div>
              <label class="kb-switch">
                <input type="checkbox" class="kb-switch-input" ${state.syncOnStartupInput ? "checked" : ""}
                  onchange="window.__kbSetStateValue('syncOnStartupInput', this.checked)" />
                <span class="kb-switch-track"></span>
              </label>
            </div>

            <!-- Target Collection -->
            <div class="kb-form-group">
              <label class="kb-form-label">自动增量笔记默认保存知识库目录</label>
              <select class="kb-form-input" style="width: 220px;"
                onchange="window.__kbSetStateValue('syncTargetColInput', this.value)">
                ${state.collections.map((c) => `
                  <option value="${c.id}" ${(state.syncTargetColInput || 'col_default') === c.id ? 'selected' : ''}>
                    ${getCollectionIcon(c.icon)} ${esc(c.name)}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
        ` : ""}

        <!-- Next run and Last run info tags -->
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-muted); background: var(--bg-secondary); padding: 10px 12px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between;">
            <span>🕒 下次预计自动执行:</span>
            <span style="font-weight: 600; color: var(--text-primary);">${esc(sched.next_run_str || (state.syncScheduleEnabledInput ? "保存后计算" : "未开启调度"))}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>✅ 上次增量同步时间:</span>
            <span>${esc(sched.last_run_str || "尚未执行")}</span>
          </div>
          ${sched.last_sync_summary ? `
            <div style="display: flex; justify-content: space-between;">
              <span>📊 上次同步摘要:</span>
              <span style="color: var(--color-primary, #3b82f6);">${esc(sched.last_sync_summary)}</span>
            </div>
          ` : ""}
        </div>
      </div>
    </div>
  `;
}

// --- Main Render ---


export function render(): void {
  const root = getRoot();
  if (!root) return;

  const { docCount, videoCount, imageCount } = getModalityCounts();
  const filteredDocs = getFilteredDocuments();
  const doc = state.activeDoc || (filteredDocs.length > 0 && state.activeDocId ? (filteredDocs.find((d) => d.id === state.activeDocId) || filteredDocs[0]) : null);
  const mdStatus = state.engineStatuses.markitdown || { installed: false, version: null, installCommand: "uv tool install markitdown", upgradeCommand: "uv tool upgrade markitdown" };
  const doclingStatus = state.engineStatuses.docling || { installed: false, version: null, installCommand: "uv tool install docling", upgradeCommand: "uv tool upgrade docling" };
  const whisperStatus = state.engineStatuses.whisper || { installed: false, version: null, installCommand: "uv tool install whisper-ctranslate2", upgradeCommand: "uv tool upgrade whisper-ctranslate2" };
  const hasModels = state.compileModels.length > 0;
  const modelCount = state.compileModels.length;

  root.innerHTML = `
    <div class="kb-root-container" id="kb-dropzone">
      <!-- Section Header -->
      <div class="section-header kb-section-header">
        <div>
          <h2>知识库 (Knowledge Base)</h2>
          <p>多模态知识高保真解析与深度提炼 · 文档解析（MarkItDown/Docling）、音视频转录（Whisper ASR）与视觉多模态深度转译</p>
        </div>
        <div class="section-header-actions">
          <input type="file" id="kb-file-input" style="display:none;" onchange="window.__kbOnFileSelected(event)" />
          <input type="file" id="kb-media-file-input" accept="video/*,audio/*,.mp4,.mp3,.wav,.m4a,.mkv,.flv" style="display:none;" onchange="window.__kbOnMediaFileSelected(event)" />
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="kb-nav-tabs">
        <button class="kb-nav-tab-btn ${state.activePhase === "parser" ? "active" : ""}" onclick="window.__kbSwitchView('parser')">
          <span>📑 多模态解析与提炼工作台</span>
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
        <!-- Modality Sub-tabs Bar & Ingestion Actions -->
        <div class="kb-subtabs-bar">
          <div class="kb-subtabs-group">
            <button class="kb-subtab-btn ${state.activeSubTab === "document" ? "active" : ""}" onclick="window.__kbSwitchSubTab('document')">
              <span>📄</span>
              <span>文档类 (Documents)</span>
              <span class="kb-subtab-badge">${docCount}</span>
            </button>
            <button class="kb-subtab-btn ${state.activeSubTab === "video" ? "active" : ""}" onclick="window.__kbSwitchSubTab('video')">
              <span>🎥</span>
              <span>视频与音频类 (Video & Audio)</span>
              <span class="kb-subtab-badge">${videoCount}</span>
            </button>
            <button class="kb-subtab-btn ${state.activeSubTab === "image" ? "active" : ""}" onclick="window.__kbSwitchSubTab('image')">
              <span>🖼️</span>
              <span>图像类 (Images)</span>
              <span class="kb-subtab-badge">${imageCount}</span>
            </button>
          </div>
        </div>

        <!-- Scoped Engine Status Cards -->
        <div class="kb-engines-row">
          ${state.activeSubTab === "document" ? `
            <!-- MarkItDown Card -->
            <div class="kb-engine-card ${mdStatus.installed ? "is-ready" : "is-missing"}">
              <div class="kb-engine-card-head">
                <div class="kb-engine-title-group">
                  <span class="kb-engine-icon">⚡</span>
                  <span class="kb-engine-name">MarkItDown</span>
                  <span class="kb-engine-vendor">📄 文档类 · 微软</span>
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
                  <span class="kb-engine-vendor">📄 文档类 · IBM</span>
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
          ` : ""}

          ${state.activeSubTab === "video" ? `
            <!-- Whisper ASR Card -->
            <div class="kb-engine-card ${whisperStatus.installed ? "is-ready" : "is-missing"}" style="grid-column: span 2;">
              <div class="kb-engine-card-head">
                <div class="kb-engine-title-group">
                  <span class="kb-engine-icon">🎙️</span>
                  <span class="kb-engine-name">Whisper ASR</span>
                  <span class="kb-engine-vendor">🎥 音视频类 · OpenAI</span>
                </div>
                <div class="kb-engine-status-tag">
                  <span class="${whisperStatus.installed ? "dot-on" : "dot-warn"}"></span>
                  <span>${whisperStatus.installed ? `已就绪 ${whisperStatus.version ? `· v${whisperStatus.version}` : ""}` : "未安装"}</span>
                </div>
              </div>
              <div class="kb-engine-desc">音视频逐句逐词识别与精确时间戳对齐，生成时间轴切片字幕与全文转录</div>
              <div class="kb-engine-foot">
                <code class="kb-engine-cmd" title="${esc(whisperStatus.installed ? whisperStatus.upgradeCommand : whisperStatus.installCommand)}">${esc(whisperStatus.installed ? whisperStatus.upgradeCommand : whisperStatus.installCommand)}</code>
                <div class="kb-engine-actions">
                  ${whisperStatus.installed
                    ? `<button class="btn btn-xs" onclick="window.__kbToolAction('whisper', 'upgrade')">🔄 更新</button>`
                    : `<button class="btn btn-xs btn-primary" onclick="window.__kbToolAction('whisper', 'install')">⬇️ 一键安装</button>`
                  }
                </div>
              </div>
            </div>
          ` : ""}

          ${state.activeSubTab === "image" ? `
            <!-- Vision LLM Card -->
            <div class="kb-engine-card ${hasModels ? "is-ready" : "is-missing"}" style="grid-column: span 2;">
              <div class="kb-engine-card-head">
                <div class="kb-engine-title-group">
                  <span class="kb-engine-icon">👁️</span>
                  <span class="kb-engine-name">Vision LLM 深度视觉转译</span>
                  <span class="kb-engine-vendor">🖼️ 图像类 · 大模型多模态</span>
                </div>
                <div class="kb-engine-status-tag">
                  <span class="${hasModels ? "dot-on" : "dot-warn"}"></span>
                  <span>${hasModels ? `已就绪 · ${modelCount} 个可用模型` : "待配置网关模型"}</span>
                </div>
              </div>
              <div class="kb-engine-desc">深度解析架构图、流程图、白板草图、表格及真实摄影照片，转译为 100% 兼容 Typora 与 VS Code 的 Mermaid 代码与 Markdown 结构化文档。</div>
            </div>
          ` : ""}
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
                        <button class="kb-col-btn" title="复制此知识库目录的 Agent 任务引导词与文件绝对路径" onclick="window.__kbCopyCollectionAgentPrompt('${c.id}')">🤖</button>
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
                <span class="kb-section-title">📚 ${state.activeSubTab === "video" ? "音视频知识列表" : state.activeSubTab === "image" ? "图像转译列表" : "文档知识列表"} (${filteredDocs.length})</span>
                ${state.activeSubTab === "video" ? `
                  <div class="kb-dropdown-wrapper">
                    <button class="btn btn-xs" onclick="window.__kbToggleIntakeMenu(event, 'video-sidebar')" title="录入新音视频">+ 录入 ▾</button>
                    ${state.showIntakeDropdown && state.showIntakeDropdownType === "video-sidebar" ? `
                      <div class="kb-dropdown-menu align-right" style="right: 0; left: auto; width: 230px;">
                        <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenVideoModal('url');">
                          <span class="kb-dropdown-icon">🔗</span>
                          <div class="kb-dropdown-text">
                            <div class="kb-dropdown-title">录入在线音视频</div>
                            <div class="kb-dropdown-sub">B站、YouTube、播客、在线音视频</div>
                          </div>
                        </button>
                        <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenVideoModal('local');">
                          <span class="kb-dropdown-icon">📂</span>
                          <div class="kb-dropdown-text">
                            <div class="kb-dropdown-title">上传本地音视频</div>
                            <div class="kb-dropdown-sub">MP4, MP3, WAV, M4A 语音识别</div>
                          </div>
                        </button>
                      </div>
                    ` : ""}
                  </div>
                ` : state.activeSubTab === "image" ? `
                  <div class="kb-dropdown-wrapper">
                    <button class="btn btn-xs" onclick="window.__kbToggleIntakeMenu(event, 'image-sidebar')" title="录入新图像">+ 录入 ▾</button>
                    ${state.showIntakeDropdown && state.showIntakeDropdownType === "image-sidebar" ? `
                      <div class="kb-dropdown-menu align-right" style="right: 0; left: auto; width: 230px;">
                        <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenImageModal('local');">
                          <span class="kb-dropdown-icon">📂</span>
                          <div class="kb-dropdown-text">
                            <div class="kb-dropdown-title">上传本地图片</div>
                            <div class="kb-dropdown-sub">PNG, JPG, WEBP, SVG 等</div>
                          </div>
                        </button>
                        <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenImageModal('url');">
                          <span class="kb-dropdown-icon">🌐</span>
                          <div class="kb-dropdown-text">
                            <div class="kb-dropdown-title">录入网络图片链接</div>
                            <div class="kb-dropdown-sub">自动解析下载在线高清原图</div>
                          </div>
                        </button>
                      </div>
                    ` : ""}
                  </div>
                ` : `
                  <div class="kb-dropdown-wrapper">
                    <button class="btn btn-xs" onclick="window.__kbToggleIntakeMenu(event, 'doc-sidebar')" title="选择录入知识来源">+ 录入 ▾</button>
                    ${state.showIntakeDropdown && state.showIntakeDropdownType === "doc-sidebar" ? `
                      <div class="kb-dropdown-menu align-right" style="right: 0; left: auto; width: 230px;">
                        <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); document.getElementById('kb-file-input').click();">
                          <span class="kb-dropdown-icon">📂</span>
                          <div class="kb-dropdown-text">
                            <div class="kb-dropdown-title">上传本地文档解析</div>
                            <div class="kb-dropdown-sub">Word, PDF, Excel, Markdown, TXT 等</div>
                          </div>
                        </button>
                        <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenCraftModal();">
                          <span class="kb-dropdown-icon">📓</span>
                          <div class="kb-dropdown-text">
                            <div class="kb-dropdown-title">导入 Craft 笔记</div>
                            <div class="kb-dropdown-sub">自动扫描连接本地 Craft Space 空间</div>
                          </div>
                        </button>
                        <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenWereadModal('notebooks');">
                          <span class="kb-dropdown-icon">📖</span>
                          <div class="kb-dropdown-text">
                            <div class="kb-dropdown-title">导入微信读书笔记</div>
                            <div class="kb-dropdown-sub">划线、想法批注与书评一键结构化导入</div>
                          </div>
                        </button>
                        <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenUrlModal();">
                          <span class="kb-dropdown-icon">🌐</span>
                          <div class="kb-dropdown-text">
                            <div class="kb-dropdown-title">抓取网页文章</div>
                            <div class="kb-dropdown-sub">抓取微信公众号、文章及在线网页文档</div>
                          </div>
                        </button>
                        <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenTextModal();">
                          <span class="kb-dropdown-icon">📝</span>
                          <div class="kb-dropdown-text">
                            <div class="kb-dropdown-title">纯文本录入</div>
                            <div class="kb-dropdown-sub">直接输入或粘贴 Markdown / 文本内容</div>
                          </div>
                        </button>
                      </div>
                    ` : ""}
                  </div>
                `}
              </div>
              <div class="kb-search-box">
                <span class="kb-search-icon">🔍</span>
                <input class="kb-search-input" type="text" placeholder="搜索文档标题或全文内容..." value="${esc(state.searchQuery)}" oninput="window.__kbOnSearchInput(event)" />
                ${state.searchQuery ? `<button class="kb-search-clear" onclick="window.__kbClearSearch()">✕</button>` : ""}
              </div>

              ${state.selectedDocIds.size > 0 ? `
                <div class="kb-batch-bar">
                  <span>已选 <strong>${state.selectedDocIds.size}</strong> 篇文档</span>
                  <div class="kb-batch-actions">
                    <button class="btn btn-xs btn-agent" onclick="window.__kbCopySelectedAgentPrompt()" title="批量复制所选文档的提示词与本地路径给 Agent">
                      🤖 复制所选给 Agent
                    </button>
                    <button class="btn btn-xs" onclick="window.__kbClearSelectedDocs()">✕ 取消</button>
                  </div>
                </div>
              ` : ""}

              <div class="kb-docs-list">
                ${state.loadingDocs ? `
                  <div class="kb-empty-box">
                    <span class="kb-spinner"></span>
                    <div class="kb-empty-box-sub" style="margin-top:6px;">正在加载文档...</div>
                  </div>
                ` : ""}
                ${!state.loadingDocs && filteredDocs.length === 0 ? `
                  <div class="kb-empty-box">
                    <div class="kb-empty-box-icon">📂</div>
                    <div class="kb-empty-box-text">${state.searchQuery ? "未找到匹配内容" : `当前${state.activeSubTab === "video" ? "音视频" : state.activeSubTab === "image" ? "图像" : "文档"}库暂无内容`}</div>
                    <div class="kb-empty-box-sub">点击上方按钮录入或拖拽文件上传</div>
                  </div>
                ` : ""}
                ${filteredDocs.map((d) => `
                  <div class="kb-doc-card ${d.id === state.activeDocId ? "active" : ""}" onclick="window.__kbSelectDocument('${d.id}')">
                    <div class="kb-doc-card-top">
                      <input type="checkbox" class="kb-doc-checkbox" ${state.selectedDocIds.has(d.id) ? "checked" : ""} onclick="event.stopPropagation(); window.__kbToggleSelectDoc('${d.id}')" title="勾选加入批量 Agent 复制" />
                      <span class="kb-doc-type-icon">${d.source_type === "url" ? "🌐" : d.source_type === "text" ? "📝" : d.source_type === "craft" ? "📓" : d.source_type === "weread" ? "📖" : d.source_type === "video" || d.doc_type === "video" ? "🎥" : d.doc_type === "image" ? "🖼️" : "📄"}</span>
                      <span class="kb-doc-card-title" title="${esc(d.title)}">${esc(d.title)}</span>
                    </div>
                    <div class="kb-doc-card-engines">
                      ${d.doc_type === "image" ? `
                        <span class="kb-engine-tag tag-ok">👁️ 视觉转译</span>
                        <span class="kb-engine-tag tag-ok">📊 Mermaid</span>
                      ` : d.source_type === "video" || d.doc_type === "video" ? `
                        <span class="kb-engine-tag tag-ok">🎙️ Whisper 转录</span>
                        ${d.assets && d.assets.length > 0 ? `<span class="kb-engine-tag tag-ok">👁️ ${d.assets.length} 帧/图</span>` : ""}
                      ` : `
                        <span class="kb-engine-tag ${d.markitdown_status === "done" ? "tag-ok" : d.markitdown_status === "failed" ? "tag-err" : "tag-skip"}">
                          ⚡ MD: ${d.markitdown_status === "done" ? `${d.markitdown_duration_ms}ms` : d.markitdown_status === "failed" ? "失败" : "未就绪"}
                        </span>
                        <span class="kb-engine-tag ${d.docling_status === "done" ? "tag-ok" : d.docling_status === "failed" ? "tag-err" : "tag-skip"}">
                          🧠 DL: ${d.docling_status === "done" ? `${(d.docling_duration_ms / 1000).toFixed(1)}s` : d.docling_status === "failed" ? "失败" : "未就绪"}
                        </span>
                      `}
                    </div>
                    <div class="kb-doc-card-meta">
                      <span class="kb-doc-time">${formatDate(d.created_at)}</span>
                      <span>
                        ${d.final_content ? `<span class="kb-adopted-pill" style="font-size:10px; padding:1px 5px;" title="已确认官方采纳版本">✅ 已采纳</span>` : ""}
                        <span class="kb-doc-size">${d.word_count ? `${d.word_count.toLocaleString()} 字` : formatBytes(d.file_size || 0)}</span>
                      </span>
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
                <div class="mcp-empty-hero-icon">${state.activeSubTab === "video" ? "🎥" : state.activeSubTab === "image" ? "🖼️" : "📚"}</div>
                <div class="mcp-empty-hero-title">${state.activeSubTab === "video" ? "音视频多模态提炼工作台" : state.activeSubTab === "image" ? "图像多模态视觉转译工作台" : "文档类高保真解析与对比工作台"}</div>
                <p>${
                  state.activeSubTab === "video"
                    ? "支持 B站、YouTube、播客及本地 MP4/MP3 等格式，提供 Whisper 语音转录与视频关键帧提取，生成结构化笔记。"
                    : state.activeSubTab === "image"
                    ? "支持架构图、流程图、复杂表格、白板草图及摄影照片，由视觉大模型深度转译为 100% 兼容 Typora/VS Code 的 Mermaid 代码与 Markdown 结构。"
                    : "微软 MarkItDown 与 IBM Docling 双引擎驱动：快速解析 Office、PDF 与网页，支持双轨对比与一键采纳官方版本，生成本地 final.md 并无缝给到 Agent。"
                }</p>
                <div class="kb-hero-actions">
                  ${state.activeSubTab === "document" ? `
                    <button class="btn btn-lg" onclick="document.getElementById('kb-file-input').click()">
                      <span>📂</span> 上传文档解析
                    </button>
                    <button class="btn btn-lg" onclick="window.__kbOpenCraftModal()">
                      <span>📓</span> 导入 Craft 笔记
                    </button>
                    <button class="btn btn-lg" onclick="window.__kbOpenWereadModal('notebooks')">
                      <span>📖</span> 导入微信读书
                    </button>
                    <button class="btn btn-lg" onclick="window.__kbOpenUrlModal()">
                      <span>🌐</span> 抓取网页内容
                    </button>
                    <button class="btn btn-lg" onclick="window.__kbOpenTextModal()">
                      <span>📝</span> 纯文本录入
                    </button>
                  ` : ""}
                  ${state.activeSubTab === "video" ? `
                    <button class="btn btn-lg" onclick="window.__kbOpenVideoModal('url')">
                      <span>🔗</span> 录入在线音视频
                    </button>
                    <button class="btn btn-lg" onclick="window.__kbOpenVideoModal('local')">
                      <span>📂</span> 上传本地音视频
                    </button>
                  ` : ""}
                  ${state.activeSubTab === "image" ? `
                    <button class="btn btn-lg" onclick="window.__kbOpenImageModal('local')">
                      <span>📂</span> 上传本地图片
                    </button>
                    <button class="btn btn-lg" onclick="window.__kbOpenImageModal('url')">
                      <span>🌐</span> 录入网络图片链接
                    </button>
                  ` : ""}
                </div>
              </div>
            ` : `
              <!-- Active Document Workbench -->
              <div class="kb-doc-workbench">
                <!-- Workbench Toolbar -->
                <div class="kb-wb-toolbar">
                  <div class="kb-wb-meta-group">
                    <div class="kb-wb-doc-title" title="${esc(doc.title)}">
                      <span class="kb-wb-type-badge">${doc.source_type === "url" ? "网页" : doc.source_type === "text" ? "纯文本" : doc.source_type === "craft" ? "Craft 笔记" : doc.source_type === "weread" ? "微信读书" : doc.source_type === "video" || doc.doc_type === "video" ? "视频" : doc.doc_type === "image" ? "图像" : "文件"}</span>
                      <span>${esc(doc.title)}</span>
                      ${doc.final_content ? `<span class="kb-adopted-pill" title="已采纳官方正文版本">✅ 已采纳</span>` : `<span class="kb-unadopted-pill" title="尚未确认采纳版本">⚠️ 待采纳</span>`}
                    </div>
                    <div class="kb-wb-doc-subinfo">
                      ${doc.source_url ? (
                        doc.source_type === "craft"
                          ? (() => {
                              const craftWebUrl = resolveCraftWebUrl(doc.source_url);
                              return `<a href="${esc(craftWebUrl)}" target="_blank" rel="noopener noreferrer" onclick="window.__kbHandleCraftLinkClick(event, '${esc(craftWebUrl)}')" class="kb-source-link" title="在 Craft 网页/应用中打开">📓 在 Craft 中打开 ↗</a><button class="btn btn-xs" style="margin-left: -2px; margin-right: 6px; padding: 1px 6px; font-size: 11px;" onclick="window.__kbCopyText('${esc(craftWebUrl)}', '已复制 Craft 访问链接')" title="复制 Craft 访问链接">📋</button><span>·</span>`;
                            })()
                          : doc.source_type === "weread"
                          ? `<a href="${esc(doc.source_url)}" target="_blank" rel="noopener noreferrer" class="kb-source-link" title="在微信读书中打开原书">📚 在微信读书中打开 ↗</a><button class="btn btn-xs" style="margin-left: -2px; margin-right: 6px; padding: 1px 6px; font-size: 11px;" onclick="window.__kbCopyText('${esc(doc.source_url)}', '已复制微信读书访问链接')" title="复制微信读书链接">📋</button><span>·</span>`
                          : `<a href="${esc(doc.source_url)}" target="_blank" rel="noopener" class="kb-source-link" title="${esc(doc.source_url)}">🔗 ${esc(doc.source_url)} ↗</a><span>·</span>`
                      ) : ""}
                      <span>创建于 ${formatDate(doc.created_at)}</span>
                      <span>·</span>
                      <span>${doc.word_count ? `${doc.word_count.toLocaleString()} 字` : formatBytes(doc.file_size || 0)}</span>
                      ${doc.assets && doc.assets.length > 0 ? `<span>·</span><span>🖼️ ${doc.assets.length} 张配图/抽帧</span>` : ""}
                    </div>
                  </div>

                  <div class="kb-wb-controls">
                    <!-- Quick Ingest Button in Toolbar -->
                    ${state.activeSubTab === "document" ? `
                      <div class="kb-dropdown-wrapper">
                        <button class="btn btn-sm" onclick="window.__kbToggleIntakeMenu(event, 'doc-toolbar')" title="录入新文档">
                          ➕ 录入新文档 ▾
                        </button>
                        ${state.showIntakeDropdown && state.showIntakeDropdownType === "doc-toolbar" ? `
                          <div class="kb-dropdown-menu align-left" style="left: 0; right: auto; width: 260px;">
                            <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); document.getElementById('kb-file-input').click();">
                              <span class="kb-dropdown-icon">📂</span>
                              <div class="kb-dropdown-text">
                                <div class="kb-dropdown-title">上传本地文档解析</div>
                                <div class="kb-dropdown-sub">Word, PDF, Excel, Markdown, TXT 等</div>
                              </div>
                            </button>
                            <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenCraftModal();">
                              <span class="kb-dropdown-icon">📓</span>
                              <div class="kb-dropdown-text">
                                <div class="kb-dropdown-title">导入 Craft 笔记</div>
                                <div class="kb-dropdown-sub">自动扫描连接本地 Craft Space 空间</div>
                              </div>
                            </button>
                            <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenWereadModal('notebooks');">
                              <span class="kb-dropdown-icon">📖</span>
                              <div class="kb-dropdown-text">
                                <div class="kb-dropdown-title">导入微信读书笔记</div>
                                <div class="kb-dropdown-sub">划线、想法批注与书评一键结构化导入</div>
                              </div>
                            </button>
                            <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenUrlModal();">
                              <span class="kb-dropdown-icon">🌐</span>
                              <div class="kb-dropdown-text">
                                <div class="kb-dropdown-title">抓取网页文章</div>
                                <div class="kb-dropdown-sub">抓取微信公众号、文章及在线网页文档</div>
                              </div>
                            </button>
                            <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenTextModal();">
                              <span class="kb-dropdown-icon">📝</span>
                              <div class="kb-dropdown-text">
                                <div class="kb-dropdown-title">纯文本录入</div>
                                <div class="kb-dropdown-sub">直接输入或粘贴 Markdown / 文本内容</div>
                              </div>
                            </button>
                          </div>
                        ` : ""}
                      </div>
                    ` : state.activeSubTab === "video" ? `
                      <div class="kb-dropdown-wrapper">
                        <button class="btn btn-sm" onclick="window.__kbToggleIntakeMenu(event, 'video-toolbar')" title="录入新音视频">
                          🎥 录入新音视频 ▾
                        </button>
                        ${state.showIntakeDropdown && state.showIntakeDropdownType === "video-toolbar" ? `
                          <div class="kb-dropdown-menu align-left" style="left: 0; right: auto; width: 250px;">
                            <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenVideoModal('url');">
                              <span class="kb-dropdown-icon">🔗</span>
                              <div class="kb-dropdown-text">
                                <div class="kb-dropdown-title">录入在线音视频</div>
                                <div class="kb-dropdown-sub">B站、YouTube、播客、在线音视频</div>
                              </div>
                            </button>
                            <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenVideoModal('local');">
                              <span class="kb-dropdown-icon">📂</span>
                              <div class="kb-dropdown-text">
                                <div class="kb-dropdown-title">上传本地音视频</div>
                                <div class="kb-dropdown-sub">MP4, MP3, WAV, M4A 语音识别</div>
                              </div>
                            </button>
                          </div>
                        ` : ""}
                      </div>
                    ` : `
                      <div class="kb-dropdown-wrapper">
                        <button class="btn btn-sm" onclick="window.__kbToggleIntakeMenu(event, 'image-toolbar')" title="录入新图像">
                          🖼️ 录入新图像 ▾
                        </button>
                        ${state.showIntakeDropdown && state.showIntakeDropdownType === "image-toolbar" ? `
                          <div class="kb-dropdown-menu align-left" style="left: 0; right: auto; width: 250px;">
                            <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenImageModal('local');">
                              <span class="kb-dropdown-icon">📂</span>
                              <div class="kb-dropdown-text">
                                <div class="kb-dropdown-title">上传本地图片</div>
                                <div class="kb-dropdown-sub">PNG, JPG, WEBP, SVG 等</div>
                              </div>
                            </button>
                            <button class="kb-dropdown-item" onclick="window.__kbCloseIntakeMenu(); window.__kbOpenImageModal('url');">
                              <span class="kb-dropdown-icon">🌐</span>
                              <div class="kb-dropdown-text">
                                <div class="kb-dropdown-title">录入网络图片链接</div>
                                <div class="kb-dropdown-sub">自动解析下载在线高清原图</div>
                              </div>
                            </button>
                          </div>
                        ` : ""}
                      </div>
                    `}

                    <!-- Return to Overview / Hero Guide -->
                    <button class="btn btn-sm" onclick="window.__kbDeselectDoc()" title="返回知识库导览中心（大卡片视图）">
                      ✨ 导览概览
                    </button>

                    <!-- If doc is document/file, show view mode switcher: Adopted vs Compare -->
                    ${doc.source_type !== "video" && doc.doc_type !== "video" && doc.doc_type !== "image" ? `
                      <div class="mcp-segmented" title="切换正文视图与双引擎对比">
                        <button class="mcp-seg-btn ${state.docViewMode === "adopted" ? "active" : ""}" onclick="window.__kbSetDocViewMode('adopted')">
                          📄 最终采纳正文
                        </button>
                        <button class="mcp-seg-btn ${state.docViewMode === "compare" ? "active" : ""}" onclick="window.__kbSetDocViewMode('compare')">
                          ⚖️ 双引擎解析对比
                        </button>
                      </div>
                    ` : ""}

                    <!-- Agent Copy Button -->
                    <button class="btn btn-sm btn-agent" onclick="window.__kbCopyDocAgentPrompt('${doc.id}')" title="复制当前文档的 Agent 引导词与本地物理文件绝对路径，可直接粘贴给 Antigravity 或 Codex">
                      🤖 复制给 Agent
                    </button>

                    <button class="btn btn-sm btn-danger" onclick="window.__kbDeleteDoc('${doc.id}')" title="删除此文档">
                      🗑️ 删除
                    </button>
                  </div>
                </div>

                <!-- Body Switcher based on Type & ViewMode -->
                ${doc.doc_type === "image" || doc.source_type === "image" ? `
                  <!-- Image Workbench View -->
                  <div class="kb-panel-box" style="flex: 1; display: flex; flex-direction: column;">
                    <div class="kb-adopted-bar" style="background: rgba(99, 102, 241, 0.08); border-bottom: 1px solid rgba(99, 102, 241, 0.2); color: #3730a3;">
                      <div class="kb-adopted-info">
                        <span>👁️ <b>视觉大模型深度转译</b> · 包含 Mermaid 架构图与 Markdown 结构 · 对应文件: <code>final.md</code></span>
                      </div>
                      <div class="kb-adopted-actions">
                        <button class="btn btn-xs ${state.showRaw.markitdown ? "is-active" : ""}" onclick="window.__kbToggleRaw('markitdown')">
                          ${state.showRaw.markitdown ? "👁️ 富文本" : "⌨️ 源码"}
                        </button>
                        <button class="btn btn-xs" onclick="window.__kbCopyFinalContent()">📋 复制 Markdown</button>
                        <button class="btn btn-xs" onclick="window.__kbExportFinalContent()">💾 导出 final.md</button>
                      </div>
                    </div>

                    ${doc.assets && doc.assets[0] ? `
                      <div class="kb-evidence-preview" style="background: var(--surface-hover); padding: 14px; border-bottom: 1px solid var(--border-color); text-align: center;">
                        <img src="${doc.assets[0].url}" class="kb-evidence-img" alt="${esc(doc.title)}" onclick="window.__kbPreviewImage('${doc.assets[0].url}')" style="cursor: zoom-in; max-height: 280px;" />
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">原始图片：${esc(doc.assets[0].name)} (${formatBytes(doc.assets[0].sizeBytes)}) · 点击可放大全屏预览</div>
                      </div>
                    ` : ""}

                    <div class="kb-panel-body kb-final-panel-body">
                      ${state.showRaw.markitdown ? `<textarea class="kb-raw-textarea" readonly spellcheck="false">${esc(doc.final_content || doc.markitdown_md)}</textarea>` : renderMarkdownToHtml(doc.final_content || doc.markitdown_md)}
                    </div>
                  </div>
                ` : doc.doc_type === "video" || doc.source_type === "video" ? `
                  <!-- Video Workbench View -->
                  <div class="kb-panel-box" style="flex: 1; display: flex; flex-direction: column;">
                    <div class="kb-adopted-bar" style="background: rgba(16, 185, 129, 0.08); border-bottom: 1px solid rgba(16, 185, 129, 0.2); color: #065f46;">
                      <div class="kb-adopted-info">
                        <span>🎙️ <b>音视频智能转录与提炼</b> · Whisper ASR 语音识别 + AI 核心要点 · 对应文件: <code>final.md</code></span>
                      </div>
                      <div class="kb-adopted-actions">
                        <button class="btn btn-xs ${state.showRaw.markitdown ? "is-active" : ""}" onclick="window.__kbToggleRaw('markitdown')">
                          ${state.showRaw.markitdown ? "👁️ 富文本" : "⌨️ 源码"}
                        </button>
                        <button class="btn btn-xs" onclick="window.__kbCopyFinalContent()">📋 复制 Markdown</button>
                        <button class="btn btn-xs" onclick="window.__kbExportFinalContent()">💾 导出 final.md</button>
                      </div>
                    </div>

                    ${doc.source_url ? `
                      <div style="padding: 10px 16px; background: var(--surface-hover); border-bottom: 1px solid var(--border-color); font-size: 12px; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                          <span style="color: var(--text-muted);">🔗 原始音视频地址:</span>
                          <a href="${esc(doc.source_url)}" target="_blank" rel="noopener noreferrer" style="color: var(--color-primary, #3b82f6); text-decoration: underline;">
                            ${esc(doc.source_url)}
                          </a>
                        </div>
                        ${doc.word_count ? `<span class="badge" style="font-size: 11px;">约 ${doc.word_count} 字</span>` : ""}
                      </div>
                    ` : ""}

                    <div class="kb-panel-body kb-final-panel-body">
                      ${state.showRaw.markitdown ? `<textarea class="kb-raw-textarea" readonly spellcheck="false">${esc(doc.final_content || doc.docling_md || doc.markitdown_md || "")}</textarea>` : renderMarkdownToHtml(doc.final_content || doc.docling_md || doc.markitdown_md || "")}
                    </div>
                  </div>
                ` : state.docViewMode === "adopted" ? `
                  <!-- Final Adopted View for Documents -->
                  <div class="kb-panel-box" style="flex: 1; display: flex; flex-direction: column;">
                    ${doc.adopted_engine ? `
                      <div class="kb-adopted-bar">
                        <div class="kb-adopted-info">
                          <span>✅ <b>官方采纳版本</b> · 已生成本地文件: <code>final.md</code> (${doc.adopted_engine.toUpperCase()})</span>
                        </div>
                        <div class="kb-adopted-actions">
                          <button class="btn btn-xs ${state.showRaw.markitdown ? "is-active" : ""}" onclick="window.__kbToggleRaw('markitdown')">
                            ${state.showRaw.markitdown ? "👁️ 富文本" : "⌨️ 源码"}
                          </button>
                          <button class="btn btn-xs" onclick="window.__kbCopyFinalContent()">📋 复制正文</button>
                          <button class="btn btn-xs" onclick="window.__kbExportFinalContent()">💾 导出 final.md</button>
                          <button class="btn btn-xs" onclick="window.__kbSetDocViewMode('compare')" title="重新打开双引擎对比进行比对与再次采纳">⚖️ 重新比对与采纳</button>
                        </div>
                      </div>
                      <div class="kb-panel-body kb-final-panel-body">
                        ${state.showRaw.markitdown ? `<textarea class="kb-raw-textarea" readonly spellcheck="false">${esc(doc.final_content)}</textarea>` : renderMarkdownToHtml(doc.final_content)}
                      </div>
                    ` : `
                      <div class="kb-unadopted-banner">
                        <div>
                          <div style="font-weight:600; margin-bottom:2px;">⚠️ 当前文档尚未确认官方采纳版本</div>
                          <div style="font-size:12px; color:var(--text-secondary);">系统已完成双引擎解析，下方为默认推荐预览。请确认采纳版本或前往双引擎对比。</div>
                        </div>
                        <div class="kb-unadopted-buttons">
                          ${doc.markitdown_status === "done" ? `<button class="btn btn-xs kb-btn-adopt" onclick="window.__kbAdoptEngine('markitdown')">✅ 采纳 MarkItDown 版本</button>` : ""}
                          ${doc.docling_status === "done" ? `<button class="btn btn-xs kb-btn-adopt" onclick="window.__kbAdoptEngine('docling')">✅ 采纳 Docling 版本</button>` : ""}
                          <button class="btn btn-xs" onclick="window.__kbSetDocViewMode('compare')">⚖️ 前往双引擎对比</button>
                        </div>
                      </div>
                      <div class="kb-panel-body kb-final-panel-body">
                        ${renderMarkdownToHtml(doc.docling_md || doc.markitdown_md || "")}
                      </div>
                    `}
                  </div>
                ` : `
                  <!-- Dual Engine Split Grid (Compare Mode / Video Mode) -->
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
                            <button class="btn btn-xs kb-btn-adopt" onclick="window.__kbAdoptEngine('markitdown')" title="将 MarkItDown 解析结果采纳为官方知识库正文并生成本地 final.md">
                              ✅ 采纳为此版本
                            </button>
                            <button class="btn btn-xs ${state.showRaw.markitdown ? "is-active" : ""}" onclick="window.__kbToggleRaw('markitdown')">
                              ${state.showRaw.markitdown ? "👁️ 富文本" : "⌨️ 源码"}
                            </button>
                            <button class="btn btn-xs" onclick="window.__kbCopyContent('markitdown')">📋 复制</button>
                            <button class="btn btn-xs" onclick="window.__kbExportContent('markitdown')">💾 导出</button>
                            ${doc.assets && doc.assets.length > 0 ? `
                              <button class="btn btn-xs" onclick="window.__kbOpenVisionModalForDoc('${doc.id}', 'markitdown')" title="使用视觉大模型将插图深度转译为 Mermaid 并追加到 MarkItDown">
                                🧠 视觉转译
                              </button>
                            ` : ""}
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
                            <button class="btn btn-xs kb-btn-adopt" onclick="window.__kbAdoptEngine('docling')" title="将 Docling 解析结果采纳为官方知识库正文并生成本地 final.md">
                              ✅ 采纳为此版本
                            </button>
                            <button class="btn btn-xs ${state.showRaw.docling ? "is-active" : ""}" onclick="window.__kbToggleRaw('docling')">
                              ${state.showRaw.docling ? "👁️ 富文本" : "⌨️ 源码"}
                            </button>
                            <button class="btn btn-xs" onclick="window.__kbCopyContent('docling')">📋 复制</button>
                            <button class="btn btn-xs" onclick="window.__kbExportContent('docling')">💾 导出</button>
                            ${doc.assets && doc.assets.length > 0 ? `
                              <button class="btn btn-xs" onclick="window.__kbOpenVisionModalForDoc('${doc.id}', 'docling')" title="使用视觉大模型将插图深度转译为 Mermaid 并追加到 Docling">
                                🧠 视觉转译
                              </button>
                            ` : ""}
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
                        <span class="kb-assets-hint">点击配图可放大预览，点击「🧠 转译」可由多模态大模型转译为 Mermaid 架构图</span>
                      </div>
                      <div class="kb-assets-gallery">
                        ${doc.assets.map((a) => `
                          <div class="kb-asset-card" title="${esc(a.name)} (${formatBytes(a.sizeBytes)})">
                            <img src="${a.url}" class="kb-asset-thumb" alt="${esc(a.name)}" onclick="window.__kbPreviewImage('${a.url}')" loading="lazy" />
                            <div class="kb-asset-meta">
                              <span class="kb-asset-name">${esc(a.name)}</span>
                              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                                <span class="kb-asset-size">${formatBytes(a.sizeBytes)}</span>
                                <button class="btn btn-xs" style="padding: 1px 6px; font-size: 10px; background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.4);" onclick="event.stopPropagation(); window.__kbOpenVisionModal('${a.url}', '${esc(a.name)}', '${esc(doc.title)}')">
                                  🧠 转译
                                </button>
                              </div>
                            </div>
                          </div>
                        `).join("")}
                      </div>
                    </div>
                  ` : ""}
                `}
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
                <input type="text" class="kb-form-input" placeholder="输入网页链接 (例如: https://mp.weixin.qq.com/s/...)" value="${esc(state.modalUrl)}" oninput="window.__kbSetStateValue('modalUrl', this.value)" onkeydown="if (event.key === 'Enter') window.__kbSubmitUrlIngest()" autofocus />
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
                <input type="text" class="kb-form-input" placeholder="输入文档标题 (默认为纯文本草稿)" value="${esc(state.modalTextTitle)}" oninput="window.__kbSetStateValue('modalTextTitle', this.value)" />
              </div>
              <div class="kb-form-group">
                <label class="kb-form-label">正文内容</label>
              <textarea class="kb-form-textarea" placeholder="在此粘贴任意文本、HTML 或 Markdown 结构..." oninput="window.__kbSetStateValue('modalText', this.value)">${esc(state.modalText)}</textarea>
              </div>
            </div>
            <div class="kb-modal-footer">
              <button class="btn" onclick="window.__kbCloseTextModal()">取消</button>
              <button class="btn btn-primary" onclick="window.__kbSubmitTextIngest()" ${!state.modalText.trim() ? "disabled" : ""}>提交并开始解析</button>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Image Ingest Modal -->
      ${state.showImageModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this && !state.imageIngesting) window.__kbCloseImageModal()">
          <div class="kb-modal" style="width: 580px;">
            <div class="kb-modal-header">
              <span>🖼️ 录入图像并由视觉大模型深度转译</span>
              ${!state.imageIngesting ? `<button class="vk-modal-close" onclick="window.__kbCloseImageModal()">✕</button>` : ""}
            </div>
            <div class="kb-modal-body">
              <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                <button class="btn btn-sm ${state.imageModalTab === "local" ? "btn-primary" : ""}" onclick="window.__kbSetImageModalTab('local')" style="flex: 1; padding: 7px 12px; font-weight: 600;">
                  📂 本地图片上传
                </button>
                <button class="btn btn-sm ${state.imageModalTab === "url" ? "btn-primary" : ""}" onclick="window.__kbSetImageModalTab('url')" style="flex: 1; padding: 7px 12px; font-weight: 600;">
                  🌐 网络图片链接
                </button>
              </div>

              ${state.imageModalTab === "local" ? `
                <div class="kb-form-group">
                  <label class="kb-form-label">选择本地图片 (支持架构图、流程图、白板、表格、摄影照片)</label>
                  <div class="kb-dropzone" style="border: 2px dashed var(--border-color); border-radius: 8px; padding: 20px; text-align: center; cursor: pointer; background: var(--bg-secondary);" onclick="document.getElementById('kb-image-modal-file').click()">
                    <input type="file" id="kb-image-modal-file" accept="image/*" style="display:none;" onchange="window.__kbOnImageFileSelected(event)" />
                    ${state.imagePreviewUrl ? `
                      <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                        <img src="${state.imagePreviewUrl}" style="max-height: 180px; max-width: 100%; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);" />
                        <span style="font-size: 12px; color: #818cf8;">${esc(state.imageFileInput?.name || "")} (${formatBytes(state.imageFileInput?.size || 0)}) · 点击可更换</span>
                      </div>
                    ` : `
                      <div style="padding: 16px 0;">
                        <span style="font-size: 32px;">🖼️</span>
                        <div style="font-size: 13px; font-weight: 600; margin-top: 8px;">点击选择或拖拽图片到此处</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">支持 PNG、JPG、JPEG、WEBP、SVG</div>
                      </div>
                    `}
                  </div>
                </div>
              ` : `
                <div class="kb-form-group">
                  <label class="kb-form-label">网络图片直链 / 网页图片地址</label>
                  <input type="text" class="kb-form-input" placeholder="输入图片直链或包含图片的网页地址 (如 https://...)" value="${esc(state.imageUrlInput)}" oninput="window.__kbSetStateValue('imageUrlInput', this.value)" />
                  <div style="font-size: 11px; color: var(--text-secondary); margin-top: 6px; line-height: 1.5;">
                    💡 支持直接图片直链、图床、微信公众号、文章及各类公开网页图片。系统将自动解析抓取高清原图并交由视觉大模型深度转译。
                  </div>
                </div>
              `}

              <div class="kb-form-group" style="margin-top: 14px;">
                <label class="kb-form-label">图片文档标题 (可选)</label>
                <input type="text" class="kb-form-input" placeholder="输入文档标题 (可选，留空将自动提取或使用文件名)" value="${esc(state.imageTitleInput)}" oninput="window.__kbSetStateValue('imageTitleInput', this.value)" />
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 10px; margin-top: 14px;">
                <div class="kb-form-group">
                  <label class="kb-form-label">视觉客户端</label>
                  <select class="kb-form-input" onchange="window.__kbOnImageClientChange(this.value)">
                    ${getCompileClients().map((c) => `
                      <option value="${esc(c)}" ${state.imageClientInput === c ? "selected" : ""}>
                        ${esc(clientDisplayName(c))}
                      </option>
                    `).join("")}
                  </select>
                </div>
                <div class="kb-form-group">
                  <label class="kb-form-label">接口节点</label>
                  <select class="kb-form-input" onchange="window.__kbOnImageEndpointChange(this.value)">
                    ${getCompileEndpoints(state.imageClientInput).length === 0 ? `<option value="">无可用节点</option>` : getCompileEndpoints(state.imageClientInput).map((ep) => `
                      <option value="${esc(ep.id)}" ${state.imageEndpointIdInput === ep.id ? "selected" : ""}>${esc(ep.name)}</option>
                    `).join("")}
                  </select>
                </div>
                <div class="kb-form-group">
                  <label class="kb-form-label">视觉模型 (VL)</label>
                  <select class="kb-form-input" onchange="window.__kbOnImageModelChange(this.value)">
                    ${getCompileModels(state.imageClientInput, state.imageEndpointIdInput).length === 0 ? `<option value="">默认模型</option>` : getCompileModels(state.imageClientInput, state.imageEndpointIdInput).map((m) => `
                      <option value="${esc(m)}" ${state.imageModelInput === m ? "selected" : ""}>${esc(m)}</option>
                    `).join("")}
                  </select>
                </div>
              </div>

              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 12px; line-height: 1.5; background: rgba(99, 102, 241, 0.08); padding: 10px; border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.2);">
                💡 <b>深度视觉转译说明</b>：系统将结合视觉大模型提取图像细节，若是流程图/架构图将自动生成 100% 兼容 Typora/VS Code 的 <b>Mermaid 代码</b>；若是表格将转译为 <b>Markdown 规范表格</b>；若是照片/风景/白板将输出高结构化分析说明。生成后将自动写入本地 <code>final.md</code>，并可一键复制路径给本地 Agent！
              </div>
            </div>
            <div class="kb-modal-footer">
              <button class="btn" onclick="window.__kbCloseImageModal()" ${state.imageIngesting ? "disabled" : ""}>取消</button>
              ${state.imageModalTab === "local" ? `
                <button class="btn btn-primary" onclick="window.__kbSubmitImageIngest()" ${!state.imageFileInput || state.imageIngesting ? "disabled" : ""}>
                  ${state.imageIngesting ? `<span class="kb-spinner" style="width:14px;height:14px;margin-right:6px;"></span> 正在视觉转译...` : "🚀 开始视觉深度转译"}
                </button>
              ` : `
                <button class="btn btn-primary" onclick="window.__kbSubmitImageUrlIngest()" ${!state.imageUrlInput.trim() || state.imageIngesting ? "disabled" : ""}>
                  ${state.imageIngesting ? `<span class="kb-spinner" style="width:14px;height:14px;margin-right:6px;"></span> 正在下载并深度转译...` : "🌐 下载并深度转译"}
                </button>
              `}
            </div>
          </div>
        </div>
      ` : ""}

       <!-- Craft Notes Import Modal -->
      ${state.showCraftModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this && !state.craftImporting) window.__kbCloseCraftModal()">
          <div class="kb-modal" style="width: 880px; max-height: 85vh; display: flex; flex-direction: column;">
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
                <div style="display: flex; gap: 16px; min-height: 420px; height: 52vh;">
                  <!-- Left Column: Folders Tree -->
                  <div style="width: 250px; flex-shrink: 0; border-right: 1px solid var(--border-color); padding-right: 12px; display: flex; flex-direction: column; overflow: hidden;">
                    <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                      <span>📂 目录层级结构</span>
                      <span style="font-size: 10px; color: var(--text-secondary);">${state.craftFolders.length} 个文件夹</span>
                    </div>
                    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;">
                      <!-- All Notes Item -->
                      <button class="kb-craft-tree-item ${!state.craftSelectedFolderId ? 'active' : ''}"
                        onclick="window.__kbSelectCraftFolder('')" ${state.craftImporting ? 'disabled' : ''}>
                        <span style="display: inline-flex; align-items: center; gap: 6px;">
                          <span>📚</span>
                          <span style="font-weight: ${!state.craftSelectedFolderId ? '600' : '500'};">全部笔记</span>
                        </span>
                      </button>

                      <!-- Unsorted Item -->
                      <button class="kb-craft-tree-item ${state.craftSelectedFolderId === '__unsorted__' ? 'active' : ''}"
                        onclick="window.__kbSelectCraftFolder('__unsorted__')" ${state.craftImporting ? 'disabled' : ''}>
                        <span style="display: inline-flex; align-items: center; gap: 6px;">
                          <span>📥</span>
                          <span style="font-weight: ${state.craftSelectedFolderId === '__unsorted__' ? '600' : '500'};">未归档笔记</span>
                        </span>
                      </button>

                      <!-- Folders list with visible tree hierarchy -->
                      ${state.craftFolders.map((f) => {
                        const depth = f.depth || 0;
                        const isSelected = state.craftSelectedFolderId === f.id;
                        const icon = depth === 0 ? "📁" : depth === 1 ? "📂" : "🗂️";
                        const branchPrefix = depth > 0
                          ? `<span class="kb-tree-branch">${"&nbsp;&nbsp;".repeat(Math.max(0, depth - 1))}└─</span>`
                          : "";
                        const indentPx = 8 + depth * 14;

                        return `
                          <button class="kb-craft-tree-item ${isSelected ? 'active' : ''}"
                            style="padding-left: ${indentPx}px !important;"
                            onclick="window.__kbSelectCraftFolder('${esc(f.id)}')"
                            ${state.craftImporting ? 'disabled' : ''}
                            title="${esc(f.name)} (${f.docCount} 篇)">
                            <span style="display: inline-flex; align-items: center; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                              ${branchPrefix}
                              <span style="margin-right: 5px;">${icon}</span>
                              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${depth === 0 ? 'font-weight: 600;' : ''}">${esc(f.name)}</span>
                            </span>
                            ${f.docCount > 0 ? `<span class="kb-craft-tree-count">(${f.docCount})</span>` : ""}
                          </button>
                        `;
                      }).join('')}
                    </div>
                  </div>

                  <!-- Right Column: Document List & Actions -->
                  <div style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
                    <!-- Filter bar: Search + Target Collection -->
                    <div style="display: flex; gap: 12px; margin-bottom: 12px; align-items: center;">
                      <div style="flex: 1; position: relative;">
                        <input type="text" class="kb-form-input" placeholder="🔍 在当前目录搜索笔记标题或全文..."
                          value="${esc(state.craftSearchQuery)}"
                          oninput="window.__kbOnCraftSearch(this.value)"
                          ${state.craftImporting ? "disabled" : ""} />
                      </div>
                      <div style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
                        <span style="white-space: nowrap; color: var(--text-secondary);">目标知识库:</span>
                        <select class="kb-form-input" style="width: 140px; padding: 5px 8px; font-size: 12px;"
                          onchange="window.__kbSetStateValue('craftImportTargetCol', this.value)"
                          ${state.craftImporting ? "disabled" : ""}>
                          ${state.collections.map((c) => `
                            <option value="${c.id}" ${(state.craftImportTargetCol || state.activeCollectionId || 'col_default') === c.id ? 'selected' : ''}>
                              ${getCollectionIcon(c.icon)} ${esc(c.name)}
                            </option>
                          `).join('')}
                        </select>
                      </div>
                    </div>

                    <!-- Notes Table Container -->
                    <div style="flex: 1; border: 1px solid var(--border-color); border-radius: 6px; overflow-y: auto; background: var(--bg-secondary);">
                      ${state.craftLoading ? `
                        <div style="text-align: center; padding: 48px; color: var(--text-secondary);">
                          <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
                          <div>正在从 Craft 获取笔记列表...</div>
                        </div>
                      ` : state.craftDocuments.length === 0 ? `
                        <div style="text-align: center; padding: 48px; color: var(--text-secondary);">
                          <div style="font-size: 24px; margin-bottom: 8px;">🔍</div>
                          <div>当前目录下未找到笔记</div>
                        </div>
                      ` : `
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                          <thead style="background: var(--bg-tertiary); position: sticky; top: 0; z-index: 1;">
                            <tr style="border-bottom: 1px solid var(--border-color); text-align: left;">
                              <th style="padding: 10px 14px; width: 36px;">
                                <input type="checkbox" class="kb-doc-checkbox"
                                  ${state.craftSelectedIds.size === state.craftDocuments.length && state.craftDocuments.length > 0 ? "checked" : ""}
                                  onchange="window.__kbToggleAllCraftDocs(this.checked)"
                                  ${state.craftImporting ? "disabled" : ""} />
                              </th>
                              <th style="padding: 10px 14px;">笔记标题与摘要</th>
                              <th style="padding: 10px 14px; width: 70px; text-align: right;">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${state.craftDocuments.map((d) => `
                              <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.15s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
                                <td style="padding: 8px 14px; vertical-align: middle;">
                                  <input type="checkbox" class="kb-doc-checkbox" value="${d.id}"
                                    ${state.craftSelectedIds.has(d.id) ? "checked" : ""}
                                    onchange="window.__kbToggleCraftDoc('${d.id}', this.checked)"
                                    ${state.craftImporting ? "disabled" : ""} />
                                </td>
                                <td style="padding: 8px 14px; vertical-align: middle;">
                                  <div style="font-weight: 500; color: var(--text-primary); font-size: 13px;">${esc(d.title)}</div>
                                  ${d.snippet ? `<div style="font-size: 11px; color: var(--text-muted); max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;">${esc(d.snippet)}</div>` : ''}
                                </td>
                                <td style="padding: 8px 14px; text-align: right; vertical-align: middle;">
                                  <button class="btn btn-xs btn-primary" onclick="window.__kbImportSingleCraftDoc('${d.id}', '${esc(d.title)}')" ${state.craftImporting ? "disabled" : ""}>
                                    导入
                                  </button>
                                </td>
                              </tr>
                            `).join('')}
                          </tbody>
                        </table>
                      `}
                    </div>
                  </div>
                </div>
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
      ` : ""}

      <!-- WeChat Read (WeRead) & Multi-Channel Sync Modal -->
      ${state.showWereadModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this && !state.wereadImporting && !state.syncRunning) window.__kbCloseWereadModal()">
          <div class="kb-modal" style="width: 920px; max-height: 88vh; display: flex; flex-direction: column;">
            <div class="kb-modal-header" style="flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 20px;">📖</span>
                <div>
                  <span style="font-weight: 600; font-size: 15px;">微信读书知识互联与增量同步</span>
                  <span style="font-size: 11px; color: var(--text-muted); margin-left: 8px;">(同层级知识库数据源)</span>
                </div>
                ${state.wereadStatus?.connected
                  ? `<span class="badge badge-success" style="font-size: 11px; padding: 2px 8px; border-radius: 12px;">🟢 已连接 (${state.wereadStatus.totalBookCount || 0} 本书 / ${state.wereadStatus.totalNoteCount || 0} 条笔记)</span>`
                  : state.wereadLoading
                  ? `<span class="badge" style="font-size: 11px; padding: 2px 8px;">检测中...</span>`
                  : `<span class="badge badge-error" style="font-size: 11px; padding: 2px 8px; border-radius: 12px;">🔴 未连接 / 请配置 API Key</span>`
                }
              </div>
              ${!state.wereadImporting && !state.syncRunning ? `<button class="vk-modal-close" onclick="window.__kbCloseWereadModal()">✕</button>` : ""}
            </div>

            <!-- Modal Sub-Navigation Tabs -->
            <div style="display: flex; gap: 6px; padding: 8px 20px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
              <button class="btn btn-xs ${state.wereadModalTab === "notebooks" ? "btn-primary" : ""}" onclick="window.__kbSetWereadModalTab('notebooks')">
                📚 书架笔记列表
              </button>
              <button class="btn btn-xs ${state.wereadModalTab === "stream" ? "btn-primary" : ""}" onclick="window.__kbSetWereadModalTab('stream')">
                📅 每日划线流水
                ${state.syncHighlightsStream.length > 0 ? `<span class="badge" style="margin-left: 4px; font-size: 10px; padding: 1px 5px;">${state.syncHighlightsStream.length}天</span>` : ""}
              </button>
              <button class="btn btn-xs ${state.wereadModalTab === "settings" ? "btn-primary" : ""}" onclick="window.__kbSetWereadModalTab('settings')">
                ⚙️ 凭证隔离与自动同步计划
              </button>
            </div>

            <!-- Modal Body by Tab -->
            <div class="kb-modal-body" style="overflow-y: auto; flex: 1; padding: 16px 20px;">
              ${state.wereadModalTab === "notebooks" ? renderWereadNotebooksTab() : ""}
              ${state.wereadModalTab === "stream" ? renderWereadStreamTab() : ""}
              ${state.wereadModalTab === "settings" ? renderWereadSettingsTab() : ""}
            </div>

            <!-- Modal Footer -->
            <div class="kb-modal-footer" style="flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;">
              ${state.wereadModalTab === "notebooks" ? `
                <div style="display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-secondary);">
                  <span>${state.wereadSelectedIds.size > 0 ? `已选 <b style="color: var(--text-primary);">${state.wereadSelectedIds.size}</b> 本书` : `共 ${state.wereadBooks.length} 本笔记图书`}</span>
                  ${state.wereadBooks.length > 0 ? `
                    <button class="btn btn-xs" onclick="window.__kbToggleAllWereadBooks()" ${state.wereadImporting ? "disabled" : ""}>
                      ${state.wereadSelectedIds.size === state.wereadBooks.length ? "取消全选" : "全选全部"}
                    </button>
                  ` : ""}
                </div>
                <div style="display: flex; gap: 8px;">
                  <button class="btn" onclick="window.__kbCloseWereadModal()" ${state.wereadImporting ? "disabled" : ""}>取消</button>
                  <button class="btn btn-primary" onclick="window.__kbBatchImportWereadBooks()" ${state.wereadSelectedIds.size === 0 || state.wereadImporting ? "disabled" : ""}>
                    ${state.wereadImporting ? `正在批量解析导入中...` : `批量导入知识库 (${state.wereadSelectedIds.size})`}
                  </button>
                </div>
              ` : state.wereadModalTab === "stream" ? `
                <div style="font-size: 12px; color: var(--text-secondary);">
                  💡 划线与想法已自动保存在知识库对应图书文档中，支持搜索与溯源。
                </div>
                <div>
                  <button class="btn" onclick="window.__kbCloseWereadModal()">关闭</button>
                </div>
              ` : `
                <div style="font-size: 12px; color: var(--text-secondary);">
                  🔒 凭证隔离于 <code>channel-secrets.json</code>，安全无漏。
                </div>
                <div style="display: flex; gap: 8px;">
                  <button class="btn" onclick="window.__kbCloseWereadModal()">取消</button>
                  <button class="btn" onclick="window.__kbTriggerManualSync()" ${state.syncRunning ? "disabled" : ""}>
                    ${state.syncRunning ? "正在同步..." : "🔄 立即执行一次增量同步"}
                  </button>
                  <button class="btn btn-primary" onclick="window.__kbSaveChannelsConfig()">
                    💾 保存配置与计划
                  </button>
                </div>
              `}
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
                <input type="text" class="kb-form-input" placeholder="例如: 深度研报、工程架构、竞品跟踪" value="${esc(state.modalColName)}" oninput="window.__kbSetStateValue('modalColName', this.value)" onkeydown="if (event.key === 'Enter') window.__kbSubmitCreateCol()" autofocus />
              </div>
              <div class="kb-form-group">
                <label class="kb-form-label">分类描述 (可选)</label>
                <input type="text" class="kb-form-input" placeholder="简要描述该分类下的文档类型" value="${esc(state.modalColDesc)}" oninput="window.__kbSetStateValue('modalColDesc', this.value)" onkeydown="if (event.key === 'Enter') window.__kbSubmitCreateCol()" />
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
                <input type="text" class="kb-form-input" placeholder="请输入知识库名称" value="${esc(state.editColName)}" oninput="window.__kbSetEditColName(this.value)" onkeydown="if (event.key === 'Enter') window.__kbSubmitEditCol()" autofocus />
              </div>
              <div class="kb-form-group">
                <label class="kb-form-label">目录描述 (可选)</label>
                <input type="text" class="kb-form-input" placeholder="简要描述该分类下的文档类型或用途" value="${esc(state.editColDesc)}" oninput="window.__kbSetEditColDesc(this.value)" onkeydown="if (event.key === 'Enter') window.__kbSubmitEditCol()" />
              </div>
            </div>
            <div class="kb-modal-footer">
              <button class="btn" onclick="window.__kbCloseEditColModal()">取消</button>
              <button class="btn btn-primary" onclick="window.__kbSubmitEditCol()" ${!state.editColName.trim() ? "disabled" : ""}>保存修改</button>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Karpathy LLM Wiki Compilation Modal -->
      ${state.showCompileModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this) window.__kbCloseCompileModal()">
          <div class="kb-modal" style="width: 920px; max-height: 90vh; display: flex; flex-direction: column;">
            <div class="kb-modal-header" style="flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px;">🧠</span>
                <div>
                  <span style="font-weight: 600; font-size: 15px;">Karpathy LLM Wiki 知识编译与沉淀</span>
                  <div style="font-size: 11px; color: var(--text-secondary);">Stop retrieving. Start compiling. 编译为离线自包含的 Obsidian 双链知识库</div>
                </div>
              </div>
              <button class="vk-modal-close" onclick="window.__kbCloseCompileModal()">✕</button>
            </div>

            <div class="kb-modal-body" style="overflow-y: auto; flex: 1; padding: 16px 20px;">
              ${state.compileApplyResult ? `
                <!-- Apply Success Result View -->
                <div style="text-align: center; padding: 24px 16px;">
                  <div style="font-size: 40px; margin-bottom: 12px;">🎉</div>
                  <h3 style="margin-bottom: 8px; font-size: 18px; color: var(--text-primary);">知识库已成功编译并写入本地 Obsidian Vault！</h3>
                  <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
                    目标目录: <code style="background: var(--bg-tertiary); padding: 3px 8px; border-radius: 4px; font-weight: 600; color: #6366f1;">${esc(state.compileApplyResult.vaultRoot)}</code>
                  </div>
                  <div style="display: inline-flex; gap: 12px; margin-bottom: 20px;">
                    <span class="badge badge-success" style="padding: 4px 12px; border-radius: 12px; font-size: 12px;">✅ 成功提炼 ${state.compileApplyResult.conceptsCount} 个原子概念卡片</span>
                    <span class="badge" style="padding: 4px 12px; border-radius: 12px; font-size: 12px;">📦 原材料与配图已沉淀到 raw/assets/ (离线可用)</span>
                  </div>

                  <div style="text-align: left; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px 16px; max-height: 200px; overflow-y: auto; margin-bottom: 20px;">
                    <div style="font-weight: 600; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">📄 写入与更新的文件清单：</div>
                    <ul style="margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.8; color: var(--text-primary);">
                      ${state.compileApplyResult.writtenFiles.map((f) => `<li><code>${esc(f)}</code></li>`).join("")}
                    </ul>
                  </div>

                  <div style="display: flex; justify-content: center; gap: 12px;">
                    <button class="btn btn-primary" onclick="window.__kbResetCompileDraft()">继续编译其他材料</button>
                    <button class="btn" onclick="window.__kbCloseCompileModal()">完成并关闭</button>
                  </div>
                </div>
              ` : `
                <!-- Main Configuration Panel -->
                <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; padding: 14px 16px; margin-bottom: 16px;">
                  <div style="margin-bottom: 12px;">
                    <label class="kb-form-label" style="display: flex; justify-content: space-between;">
                      <span>Obsidian 知识库根目录 (必填)</span>
                      <span style="font-size: 11px; color: var(--text-muted);">自动记忆上次路径</span>
                    </label>
                    <input type="text" class="kb-form-input" placeholder="例如：D:\\Obsidian\\MyNotes 或 /Users/name/Vault"
                      value="${esc(state.compileVaultRoot)}"
                      oninput="window.__kbSetCompileVaultRoot(this.value)"
                      ${state.compileLoading || state.compileRefining || state.compileApplying ? 'disabled' : ''} />
                  </div>

                  <!-- 3-Tier Cascading Model Select: 代理节点 -> 模型配置节点 -> 具体模型 -->
                  <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 10px; margin-bottom: 12px;">
                    <div>
                      <label class="kb-form-label">代理节点</label>
                      <select class="kb-form-input" onchange="window.__kbOnCompileClientChange(this.value)" ${state.compileLoading || state.compileRefining || state.compileApplying ? 'disabled' : ''}>
                        ${getCompileClients().map((c) => `
                          <option value="${esc(c)}" ${state.compileSelectedClient === c ? "selected" : ""}>
                            ${esc(clientDisplayName(c))}
                          </option>
                        `).join("")}
                      </select>
                    </div>

                    <div>
                      <label class="kb-form-label">模型配置节点</label>
                      <select class="kb-form-input" onchange="window.__kbOnCompileEndpointChange(this.value)" ${state.compileLoading || state.compileRefining || state.compileApplying ? 'disabled' : ''}>
                        ${getCompileEndpoints(state.compileSelectedClient).length === 0 ? `<option value="">无可用节点</option>` : getCompileEndpoints(state.compileSelectedClient).map((ep) => `
                          <option value="${esc(ep.id)}" ${state.compileSelectedEndpointId === ep.id ? "selected" : ""}>
                            ${esc(ep.name)}
                          </option>
                        `).join("")}
                      </select>
                    </div>

                    <div>
                      <label class="kb-form-label">具体模型</label>
                      <select class="kb-form-input" onchange="window.__kbOnCompileModelChange(this.value)" ${state.compileLoading || state.compileRefining || state.compileApplying ? 'disabled' : ''}>
                        ${getCompileModels(state.compileSelectedClient, state.compileSelectedEndpointId).length === 0 ? `<option value="">默认模型</option>` : getCompileModels(state.compileSelectedClient, state.compileSelectedEndpointId).map((m) => `
                          <option value="${esc(m)}" ${state.compileSelectedModel === m ? "selected" : ""}>
                            ${esc(m)}
                          </option>
                        `).join("")}
                      </select>
                    </div>
                  </div>

                  <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-secondary); border-top: 1px dashed var(--border-color); padding-top: 8px;">
                    <div>
                      <span>待编译材料：</span>
                      <strong style="color: var(--text-primary);">
                        ${state.compileTargetDocId
                          ? `📄 单篇文档《${esc(state.documents.find((d) => d.id === state.compileTargetDocId)?.title || "已选文档")}》 <span class="badge" style="font-size: 10px; margin-left: 4px; padding: 1px 6px;">以 ${state.compileTargetEngine === "docling" ? "Docling" : "MarkItDown"} 解析为输入源</span>`
                          : `📁 知识库目录「${esc(state.collections.find((c) => c.id === state.activeCollectionId)?.name || "默认知识库")}」(${state.documents.length} 篇文档)`
                        }
                      </strong>
                    </div>
                    <div style="color: var(--text-muted); font-size: 11px;">
                      自动建立 raw/assets 相对路径配图，支持纯离线脱机浏览
                    </div>
                  </div>
                </div>

                ${state.compileLoading ? `
                  <div style="text-align: center; padding: 48px 16px;">
                    <div class="kb-spinner" style="width: 32px; height: 32px; margin: 0 auto 16px;"></div>
                    <div style="font-weight: 600; font-size: 15px; margin-bottom: 6px;">${esc(state.compileLoadingText)}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">模型正在遵循第一性原理提炼承重概念、拆解推导机理并织入双向链接 [[...]]</div>
                  </div>
                ` : !state.compileDraft ? `
                  <!-- Pre-compile Prompt Setting & Launch Button -->
                  <div class="kb-form-group">
                    <label class="kb-form-label">自定义提炼偏好或额外指令 (可选)</label>
                    <textarea class="kb-form-textarea" style="height: 60px;"
                      placeholder="例如：提炼偏向于架构实战；概念数量控制在 3 个以内；重点提取反常识论点..."
                      oninput="window.__kbSetStateValue('compileCustomInstruction', this.value)">${esc(state.compileCustomInstruction)}</textarea>
                  </div>
                  <div style="margin-top: 16px;">
                    <button class="btn btn-primary btn-lg" style="width: 100%; justify-content: center; padding: 12px;" onclick="window.__kbStartCompilePreview()">
                      🚀 开始编译为 Karpathy Wiki 草稿 (Preview Draft)
                    </button>
                  </div>
                ` : `
                  <!-- Draft Workspace (Two-Phase Incremental Refinement) -->
                  <div style="margin-bottom: 12px; padding: 10px 14px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                      <div style="font-weight: 600; color: #6366f1; font-size: 13px;">📌 编译草稿已就绪 (暂未落盘，可预览与增量修改)</div>
                      <span class="badge" style="font-size: 11px;">主题: ${esc(state.compileDraft.index_category)}</span>
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary);">${esc(state.compileDraft.summary)}</div>
                  </div>

                  <!-- Concept Cards Split Preview -->
                  <div style="display: grid; grid-template-columns: 240px 1fr; gap: 14px; min-height: 320px; max-height: 420px; border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden; background: var(--bg-primary);">
                    <!-- Concept Tabs List -->
                    <div style="border-right: 1px solid var(--border-color); background: var(--bg-secondary); overflow-y: auto; padding: 8px;">
                      <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); padding: 4px 8px; margin-bottom: 4px;">提炼出的原子概念 (${state.compileDraft.concepts.length})：</div>
                      ${state.compileDraft.concepts.map((concept, idx) => `
                        <div onclick="window.__kbSetCompileActiveConcept(${idx})"
                          style="padding: 8px 10px; border-radius: 6px; cursor: pointer; margin-bottom: 4px; border: 1px solid ${state.compileActiveConceptIdx === idx ? 'rgba(99, 102, 241, 0.5)' : 'transparent'}; background: ${state.compileActiveConceptIdx === idx ? 'rgba(99, 102, 241, 0.12)' : 'transparent'};">
                          <div style="font-weight: 600; font-size: 13px; color: ${state.compileActiveConceptIdx === idx ? '#6366f1' : 'var(--text-primary)'}; display: flex; align-items: center; gap: 4px;">
                            <span>[[${esc(concept.title)}]]</span>
                          </div>
                          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${esc(concept.summary || concept.category || "")}
                          </div>
                        </div>
                      `).join("")}
                    </div>

                    <!-- Active Concept Markdown Preview -->
                    <div style="overflow-y: auto; padding: 14px 18px;">
                      ${(() => {
                        const activeConcept = state.compileDraft?.concepts[state.compileActiveConceptIdx] || state.compileDraft?.concepts[0];
                        if (!activeConcept) return '<div class="kb-empty-box">暂无概念卡片</div>';
                        return `
                          <div style="margin-bottom: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                              <h3 style="margin: 0; font-size: 18px;">[[${esc(activeConcept.title)}]]</h3>
                              <span class="badge" style="font-size: 11px;">${esc(activeConcept.category || "未分类")}</span>
                            </div>
                            ${activeConcept.tags && activeConcept.tags.length > 0 ? `
                              <div style="display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;">
                                ${activeConcept.tags.map((t) => `<span class="badge" style="font-size: 10px; padding: 1px 6px;">#${esc(t)}</span>`).join("")}
                              </div>
                            ` : ""}
                          </div>
                          <div class="kb-preview-markdown" style="font-size: 13px; line-height: 1.6;">
                            ${renderMarkdownToHtml(activeConcept.content_markdown)}
                          </div>
                        `;
                      })()}
                    </div>
                  </div>

                  <!-- Incremental Refinement & Apply Box -->
                  <div style="margin-top: 14px; padding: 12px 14px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px;">
                    <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                      <span>💬 增量优化意见（第一次输出不满意？在此输入具体要求，模型将增量微调）：</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                      <input type="text" class="kb-form-input" style="flex: 1;"
                        placeholder="例如：概念切分太细，把前两个合并为一个高阶决策模型；增加实操案例；语气更第一性原理一点..."
                        value="${esc(state.compileFeedback)}"
                        oninput="window.__kbSetStateValue('compileFeedback', this.value)"
                        onkeydown="if (event.key === 'Enter') window.__kbRefineCompileDraft()"
                        ${state.compileRefining || state.compileApplying ? 'disabled' : ''} />
                      <button class="btn" onclick="window.__kbRefineCompileDraft()" ${state.compileRefining || state.compileApplying || !state.compileFeedback.trim() ? 'disabled' : ''}>
                        ${state.compileRefining ? "⏳ 重提炼中..." : "🔄 增量优化草稿"}
                      </button>
                    </div>
                  </div>

                  <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px;">
                    <button class="btn btn-sm" onclick="window.__kbResetCompileDraft()">重新初次生成</button>
                    <button class="btn btn-primary" style="padding: 8px 24px; font-size: 14px;" onclick="window.__kbApplyCompileDraft()" ${state.compileApplying || state.compileRefining ? 'disabled' : ''}>
                      ${state.compileApplying ? "⏳ 正在写入 Obsidian..." : "✅ 满意，一键写入 Obsidian Vault"}
                    </button>
                  </div>
                `}
              `}
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Image Lightbox Modal -->
      ${state.previewAsset ? `
        <div class="kb-modal-backdrop" onclick="window.__kbCloseImagePreview()">
          <div style="max-width:90vw; max-height:90vh; display:flex; flex-direction:column; align-items:center;">
            <img src="${state.previewAsset.url}" style="max-width:100%; max-height:80vh; border-radius:var(--radius-lg, 8px); box-shadow:0 8px 30px rgba(0,0,0,0.15); border:1px solid var(--border-color); background:var(--surface);" />
            <div style="display:flex; gap:10px; align-items:center; margin-top:12px;">
              <div style="color:var(--text-primary); font-size:13px; font-weight:500; background:var(--surface); padding:4px 14px; border-radius:999px; border:1px solid var(--border-color); box-shadow:0 2px 8px rgba(0,0,0,0.06);">
                ${esc(state.previewAsset.name)} · ${formatBytes(state.previewAsset.sizeBytes)}
              </div>
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); window.__kbOpenVisionModal('${state.previewAsset.url}', '${esc(state.previewAsset.name)}', '${esc(state.activeDoc?.title || '文档配图')}')">
                🧠 视觉转译 (Mermaid / 证据卡片)
              </button>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Video Knowledge Base Modal -->
      ${state.showVideoModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this && !state.videoImporting) window.__kbCloseVideoModal()">
          <div class="kb-modal" style="width: 780px; max-height: 85vh; display: flex; flex-direction: column;">
            <div class="kb-modal-header" style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px;">🎥</span>
                <div>
                  <span style="font-weight: 600; font-size: 15px;">录入音视频并智能转录提炼</span>
                  <div style="font-size: 11px; color: var(--text-secondary);">输入在线或本地视频链接，由 Whisper 转录并提炼核心要点沉淀至知识库</div>
                </div>
              </div>
              ${!state.videoImporting && state.videoTaskStatus !== "running" ? `<button class="vk-modal-close" onclick="window.__kbCloseVideoModal()">✕</button>` : ""}
            </div>

            <div class="kb-modal-body" style="overflow-y: auto; flex: 1; padding: 16px 20px;">
              <!-- New Video Intake Form -->
              <div style="display: flex; flex-direction: column; gap: 14px; padding: 4px 0;">
                  <!-- Dual Tab Switcher -->
                  <div style="display: flex; gap: 8px; margin-bottom: 2px;">
                    <button class="btn btn-sm ${state.videoModalTab === "url" ? "btn-primary" : ""}" onclick="window.__kbSetVideoModalTab('url')" style="flex: 1; padding: 7px 12px; font-weight: 600;">
                      🌐 在线音视频链接 (URL)
                    </button>
                    <button class="btn btn-sm ${state.videoModalTab === "local" ? "btn-primary" : ""}" onclick="window.__kbSetVideoModalTab('local')" style="flex: 1; padding: 7px 12px; font-weight: 600;">
                      📂 本地音视频上传 (File)
                    </button>
                  </div>

                  ${state.videoModalTab === "url" ? `
                    <div class="kb-form-group" style="margin-bottom: 0;">
                      <label class="kb-form-label" style="display: flex; justify-content: space-between;">
                        <span>音视频链接 (URL) <span style="color: #ef4444;">*</span></span>
                        <span style="font-size: 11px; color: var(--text-muted);">支持 Bilibili, YouTube, 播客音频, 在线 MP4/MP3</span>
                      </label>
                      <input type="text" class="kb-form-input" placeholder="https://www.bilibili.com/video/BV... 或 https://www.youtube.com/watch?v=..."
                        value="${esc(state.videoUrlInput)}"
                        oninput="window.__kbSetStateValue('videoUrlInput', this.value)"
                        ${state.videoTaskStatus === "running" ? "disabled" : ""} />
                    </div>
                  ` : `
                    <div class="kb-form-group" style="margin-bottom: 0;">
                      <label class="kb-form-label" style="display: flex; justify-content: space-between;">
                        <span>选择本地音视频文件 <span style="color: #ef4444;">*</span></span>
                        <span style="font-size: 11px; color: var(--text-muted);">支持 MP4, MKV, WebM, MOV, FLV, MP3, WAV, M4A, AAC, FLAC</span>
                      </label>
                      <div class="kb-dropzone" style="border: 2px dashed var(--border-color); border-radius: 8px; padding: 22px 16px; text-align: center; cursor: pointer; background: var(--bg-secondary);" onclick="document.getElementById('kb-video-modal-file').click()">
                        <input type="file" id="kb-video-modal-file" accept="video/*,audio/*,.mp4,.mkv,.webm,.mov,.flv,.mp3,.wav,.m4a,.aac,.flac" style="display:none;" onchange="window.__kbOnVideoFileSelected(event)" />
                        ${state.videoFileInput ? `
                          <div style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
                            <span style="font-size: 32px;">🎬</span>
                            <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${esc(state.videoFileInput.name)}</div>
                            <span style="font-size: 11px; color: #818cf8;">${formatBytes(state.videoFileInput.size)} · 点击可更换音视频文件</span>
                          </div>
                        ` : `
                          <div style="padding: 10px 0;">
                            <span style="font-size: 32px;">🎬</span>
                            <div style="font-size: 13px; font-weight: 600; margin-top: 8px;">点击选择或拖拽本地音视频文件到此处</div>
                            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">由本地 Whisper 进行精准语音识别与时间戳转写，并调用所选大模型生成知识卡片</div>
                          </div>
                        `}
                      </div>
                    </div>
                  `}

                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="kb-form-group" style="margin-bottom: 0;">
                      <label class="kb-form-label">文档标题 (可选，留空自动提取)</label>
                      <input type="text" class="kb-form-input" placeholder="${state.videoModalTab === 'local' ? '留空则使用本地文件名' : '留空则自动抓取原视频标题'}"
                        value="${esc(state.videoTitleInput)}"
                        oninput="window.__kbSetStateValue('videoTitleInput', this.value)"
                        ${state.videoTaskStatus === "running" ? "disabled" : ""} />
                    </div>

                    <div class="kb-form-group" style="margin-bottom: 0;">
                      <label class="kb-form-label">存入目标知识库</label>
                      <select class="kb-form-input"
                        onchange="window.__kbSelectCollection(this.value)"
                        ${state.videoTaskStatus === "running" ? "disabled" : ""}>
                        ${state.collections.map((c) => `
                          <option value="${c.id}" ${(state.activeCollectionId || 'col_default') === c.id ? 'selected' : ''}>
                            ${getCollectionIcon(c.icon)} ${esc(c.name)}
                          </option>
                        `).join('')}
                      </select>
                    </div>
                  </div>

                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="kb-form-group" style="margin-bottom: 0;">
                      <label class="kb-form-label">原视频语种</label>
                      <select class="kb-form-input"
                        onchange="window.__kbOnVideoLanguageChange(this.value)"
                        ${state.videoTaskStatus === "running" ? "disabled" : ""}>
                        <option value="auto" ${state.videoLanguageInput === "auto" ? "selected" : ""}>🌐 自动检测 (Auto Detect)</option>
                        <option value="zh" ${state.videoLanguageInput === "zh" ? "selected" : ""}>🇨🇳 中文 (Chinese)</option>
                        <option value="en" ${state.videoLanguageInput === "en" ? "selected" : ""}>🇺🇸 英语 (English)</option>
                        <option value="ja" ${state.videoLanguageInput === "ja" ? "selected" : ""}>🇯🇵 日语 (Japanese)</option>
                      </select>
                    </div>

                    <div class="kb-form-group" style="margin-bottom: 0;">
                      <label class="kb-form-label">Whisper 语音转录模型</label>
                      <select class="kb-form-input"
                        onchange="window.__kbOnVideoWhisperModelChange(this.value)"
                        ${state.videoTaskStatus === "running" ? "disabled" : ""}>
                        <option value="base" ${state.videoWhisperModelInput === "base" ? "selected" : ""}>⚡ base (快速，适合快速抓取)</option>
                        <option value="small" ${state.videoWhisperModelInput === "small" ? "selected" : ""}>⚖️ small (均衡，推荐日常使用)</option>
                        <option value="medium" ${state.videoWhisperModelInput === "medium" ? "selected" : ""}>🎯 medium (精准，专业播客/访谈)</option>
                        <option value="large-v3" ${state.videoWhisperModelInput === "large-v3" ? "selected" : ""}>🏆 large-v3 (高精，需要充足显存)</option>
                      </select>
                    </div>
                  </div>

                  <!-- 3-Tier AI Summary Model Select: 代理节点 -> 模型配置节点 -> 具体模型 -->
                  <div>
                    <label class="kb-form-label" style="display: flex; justify-content: space-between;">
                      <span>🤖 AI 核心摘要与提炼模型 (LLM)</span>
                      <span style="font-size: 11px; color: var(--text-muted);">调用网关配置节点进行音视频长文分析与要点萃取</span>
                    </label>
                    <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 10px;">
                      <div>
                        <select class="kb-form-input" onchange="window.__kbOnVideoSummaryClientChange(this.value)" ${state.videoTaskStatus === "running" ? 'disabled' : ''}>
                          ${getCompileClients().map((c) => `
                            <option value="${esc(c)}" ${state.videoSummaryClientInput === c ? "selected" : ""}>
                              ${esc(clientDisplayName(c))}
                            </option>
                          `).join("")}
                        </select>
                      </div>

                      <div>
                        <select class="kb-form-input" onchange="window.__kbOnVideoSummaryEndpointChange(this.value)" ${state.videoTaskStatus === "running" ? 'disabled' : ''}>
                          ${getCompileEndpoints(state.videoSummaryClientInput).length === 0 ? `<option value="">无可用节点</option>` : getCompileEndpoints(state.videoSummaryClientInput).map((ep) => `
                            <option value="${esc(ep.id)}" ${state.videoSummaryEndpointIdInput === ep.id ? "selected" : ""}>
                              ${esc(ep.name)}
                            </option>
                          `).join("")}
                        </select>
                      </div>

                      <div>
                        <select class="kb-form-input" onchange="window.__kbOnVideoSummaryModelChange(this.value)" ${state.videoTaskStatus === "running" ? 'disabled' : ''}>
                          ${getCompileModels(state.videoSummaryClientInput, state.videoSummaryEndpointIdInput).length === 0 ? `<option value="">默认模型</option>` : getCompileModels(state.videoSummaryClientInput, state.videoSummaryEndpointIdInput).map((m) => `
                            <option value="${esc(m)}" ${state.videoSummaryModelInput === m ? "selected" : ""}>
                              ${esc(m)}
                            </option>
                          `).join("")}
                        </select>
                      </div>
                    </div>
                  </div>

                  <!-- 视频抽帧规则与视觉大模型解读配置 -->
                  <div style="background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px 14px;">
                    <div style="font-weight: 600; font-size: 12px; color: var(--text-primary); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                      <span style="display: flex; align-items: center; gap: 6px;">
                        <span>🎞️ 视频抽帧规则配置 (Video Keyframes)</span>
                      </span>
                      <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">控制关键帧采样密度与 Token 消耗</span>
                    </div>

                    <div style="display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                      <div>
                        <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">抽帧策略</label>
                        <select class="kb-form-input" onchange="window.__kbOnVideoFrameStrategyChange(this.value)" ${state.videoTaskStatus === "running" ? 'disabled' : ''}>
                          <option value="scene" ${state.videoFrameStrategyInput === "scene" ? "selected" : ""}>智能场景突变检测 (推荐，过滤静止画面)</option>
                          <option value="interval" ${state.videoFrameStrategyInput === "interval" ? "selected" : ""}>固定步长均匀采样</option>
                          <option value="none" ${state.videoFrameStrategyInput === "none" ? "selected" : ""}>纯音频模式 (跳过抽帧)</option>
                        </select>
                      </div>

                      <div>
                        <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">采样间隔步长</label>
                        <select class="kb-form-input" onchange="window.__kbOnVideoFrameIntervalChange(this.value)" ${state.videoTaskStatus === "running" || state.videoFrameStrategyInput === "none" ? 'disabled' : ''}>
                          <option value="3" ${state.videoFrameIntervalInput === 3 ? "selected" : ""}>每 3 秒抽一帧 (高密度)</option>
                          <option value="5" ${state.videoFrameIntervalInput === 5 ? "selected" : ""}>每 5 秒抽一帧 (平衡推荐)</option>
                          <option value="10" ${state.videoFrameIntervalInput === 10 ? "selected" : ""}>每 10 秒抽一帧</option>
                          <option value="30" ${state.videoFrameIntervalInput === 30 ? "selected" : ""}>每 30 秒抽一帧 (省算力)</option>
                        </select>
                      </div>

                      <div>
                        <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">抽帧上限安全阈值</label>
                        <select class="kb-form-input" onchange="window.__kbOnVideoMaxFramesChange(this.value)" ${state.videoTaskStatus === "running" || state.videoFrameStrategyInput === "none" ? 'disabled' : ''}>
                          <option value="20" ${state.videoMaxFramesInput === 20 ? "selected" : ""}>最大 20 帧</option>
                          <option value="30" ${state.videoMaxFramesInput === 30 ? "selected" : ""}>最大 30 帧 (默认)</option>
                          <option value="50" ${state.videoMaxFramesInput === 50 ? "selected" : ""}>最大 50 帧</option>
                          <option value="100" ${state.videoMaxFramesInput === 100 ? "selected" : ""}>最大 100 帧</option>
                        </select>
                      </div>
                    </div>

                    <!-- 视觉大模型深度转译开关 -->
                    <div style="border-top: 1px dashed var(--border-color); padding-top: 10px; margin-top: 8px;">
                      <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                          <span>🤖 启用视觉大模型关键帧解读</span>
                          <span style="font-size: 11px; font-weight: normal; color: var(--text-muted);">(转译架构图/板书为 Mermaid 并生成可追溯证据卡片)</span>
                        </div>
                        <label class="kb-switch">
                          <input type="checkbox" class="kb-switch-input" ${state.videoEnableVisionAudit ? 'checked' : ''} onchange="window.__kbOnVideoEnableVisionAuditChange(this.checked)" ${state.videoTaskStatus === "running" || state.videoFrameStrategyInput === "none" ? 'disabled' : ''} />
                          <span class="kb-switch-slider"></span>
                        </label>
                      </div>

                      ${state.videoEnableVisionAudit ? `
                        <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.4fr; gap: 8px; margin-top: 8px; background: var(--surface); border: 1px solid var(--border-color); padding: 8px; border-radius: 4px;">
                          <div>
                            <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">视觉客户端</label>
                            <select class="kb-form-input" onchange="window.__kbOnVideoVisionClientChange(this.value)" ${state.videoTaskStatus === "running" ? 'disabled' : ''}>
                              ${getCompileClients().map((c) => `
                                <option value="${esc(c)}" ${state.videoVisionClientInput === c ? "selected" : ""}>${esc(clientDisplayName(c))}</option>
                              `).join("")}
                            </select>
                          </div>
                          <div>
                            <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">视觉节点</label>
                            <select class="kb-form-input" onchange="window.__kbOnVideoVisionEndpointChange(this.value)" ${state.videoTaskStatus === "running" ? 'disabled' : ''}>
                              ${getCompileEndpoints(state.videoVisionClientInput).map((ep) => `
                                <option value="${esc(ep.id)}" ${state.videoVisionEndpointIdInput === ep.id ? "selected" : ""}>${esc(ep.name)}</option>
                              `).join("")}
                            </select>
                          </div>
                          <div>
                            <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">视觉模型 (支持多模态)</label>
                            <select class="kb-form-input" onchange="window.__kbOnVideoVisionModelChange(this.value)" ${state.videoTaskStatus === "running" ? 'disabled' : ''}>
                              ${getCompileModels(state.videoVisionClientInput, state.videoVisionEndpointIdInput).map((m) => `
                                <option value="${esc(m)}" ${state.videoVisionModelInput === m ? "selected" : ""}>${esc(m)}</option>
                              `).join("")}
                            </select>
                          </div>
                        </div>
                      ` : ""}
                    </div>
                  </div>

                  <!-- 知识沉淀存储归宿说明卡片 -->
                  <div style="background: var(--surface-hover); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px 14px;">
                    <div style="font-weight: 600; font-size: 12px; color: var(--text-primary); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                      <span>💾 知识沉淀归宿</span>
                    </div>
                    <div style="background: var(--surface); padding: 8px 10px; border-radius: 4px; border: 1px solid var(--border-color); font-size: 11px; color: var(--text-secondary); line-height: 1.5;">
                      <strong style="color: var(--text-primary); display: block; margin-bottom: 2px;">📁 存入网关知识库文档 (Local Markdown & FTS5)</strong>
                      AI 智能摘要、核心论点及 Whisper 逐句时间戳文字稿将沉淀为独立本地 Markdown 文件 (<code>final.md</code>)，保存在「<strong>${esc((state.collections.find((c) => c.id === (state.activeCollectionId || 'col_default'))?.name) || "默认知识库")}</strong>」中，可直接在工作台查看并一键复制路径供本地 Agent (Antigravity / Codex) 深度演进与改写。
                    </div>
                  </div>

                  <!-- Task Progress & Status Card -->
                  ${state.videoTaskStatus === "running" ? `
                    <div style="background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; padding: 16px; margin-top: 6px;">
                      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <div class="kb-spinner" style="width: 20px; height: 20px; flex-shrink: 0;"></div>
                        <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">流水线处理中...</div>
                      </div>
                      <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
                        ${esc(state.videoTaskStep || "正在下载视频音频素材并调度 Whisper 语音转录...")}
                      </div>
                      <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px; display: flex; justify-content: space-between;">
                        <span>任务 ID: <code>${esc(state.videoTaskId)}</code></span>
                        <span>阶段：音轨抓取 ➔ Whisper 语音识别 ➔ AI 摘要提炼 ➔ 自动入库</span>
                      </div>
                    </div>
                  ` : state.videoTaskStatus === "failed" ? `
                    <div class="kb-alert kb-alert-error" style="padding: 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3);">
                      <div style="font-weight: 600; color: #ef4444; font-size: 13px;">视频处理失败</div>
                      <div style="font-size: 12px; margin-top: 4px; color: var(--text-secondary);">${esc(state.videoTaskStep)}</div>
                    </div>
                  ` : state.videoTaskStatus === "succeeded" ? `
                    <div class="kb-alert kb-alert-success" style="padding: 12px; border-radius: 6px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3);">
                      <div style="font-weight: 600; color: #22c55e; font-size: 13px;">🎉 视频转录已成功沉淀至知识库！</div>
                      <div style="font-size: 12px; margin-top: 4px; color: var(--text-secondary);">${esc(state.videoTaskStep)}</div>
                    </div>
                  ` : ""}

                  <!-- Action buttons -->
                  <div style="margin-top: 6px; display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="btn btn-primary" onclick="window.__kbStartVideoIngest()" ${state.videoTaskStatus === "running" || (state.videoModalTab === "url" ? !state.videoUrlInput.trim() : !state.videoFileInput) ? "disabled" : ""}>
                      ${state.videoTaskStatus === "running" ? "⏳ 正在处理中..." : (state.videoModalTab === "local" ? "🚀 上传并开始转录提炼" : "🚀 开始处理并自动沉淀至知识库")}
                    </button>
                  </div>
                </div>
            </div>

            <div class="kb-modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border-color);">
              <button class="btn" onclick="window.__kbCloseVideoModal()" ${state.videoImporting ? 'disabled' : ''}>关闭</button>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Vision Transcription Modal -->
      ${state.showVisionModal ? `
        <div class="kb-modal-backdrop" onclick="if (event.target === this && !state.visionLoading) window.__kbCloseVisionModal()">
          <div class="kb-modal" style="width: 760px; max-height: 88vh; display: flex; flex-direction: column;">
            <div class="kb-modal-header" style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px;">🧠</span>
                <div>
                  <span style="font-weight: 600; font-size: 15px;">视觉大模型图表深度转译 (Vision LLM & Mermaid)</span>
                  <div style="font-size: 11px; color: var(--text-secondary);">将文档插图或关键帧转译为可编辑 Mermaid 代码与结构化凭据卡片</div>
                </div>
              </div>
              ${!state.visionLoading ? `<button class="vk-modal-close" onclick="window.__kbCloseVisionModal()">✕</button>` : ""}
            </div>

            <div class="kb-modal-body" style="padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px;">
              <!-- 原始图表预览与凭证信息 -->
              <div style="display: grid; grid-template-columns: 240px 1fr; gap: 14px; background: var(--surface-hover); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px;">
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--surface); border: 1px solid var(--border-color); border-radius: 4px; overflow: hidden; max-height: 200px;">
                  <img src="${state.visionTargetAssetUrl}" style="max-width: 100%; max-height: 190px; object-fit: contain;" alt="待转译原始图表" />
                </div>
                <div style="display: flex; flex-direction: column; justify-content: space-between;">
                  <div>
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                      <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 11px;">📸 原始物理凭证</span>
                      <span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${esc(state.visionTargetTitle || "文档插图")}</span>
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
                      <div>文件名：<code>${esc(state.visionTargetAssetName || "image.png")}</code></div>
                      <div>所属文档：${esc(state.activeDoc?.title || "当前文档")}</div>
                      <div style="margin-top: 4px; color: var(--text-muted); font-size: 11px;">
                        ⚠️ 原图作为不可变客观事实永久保留。LLM 将识别图中的架构流向、数据表格与核心论点，生成高保真 Mermaid 代码与双向可追溯卡片。
                      </div>
                    </div>
                  </div>

                  <div style="margin-top: 10px;">
                    <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 6px;">🎯 转译结果插入目标引擎 Markdown：</label>
                    <div class="kb-segmented-group">
                      <label class="kb-segmented-item ${state.visionTargetEngine === 'docling' ? 'active' : ''}">
                        <input type="radio" name="vision_engine" value="docling" ${state.visionTargetEngine === 'docling' ? 'checked' : ''} onchange="window.__kbSetVisionTargetEngine('docling')" />
                        <span>Docling 视图</span>
                      </label>
                      <label class="kb-segmented-item ${state.visionTargetEngine === 'markitdown' ? 'active' : ''}">
                        <input type="radio" name="vision_engine" value="markitdown" ${state.visionTargetEngine === 'markitdown' ? 'checked' : ''} onchange="window.__kbSetVisionTargetEngine('markitdown')" />
                        <span>MarkItDown 视图</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 视觉大模型 3 级配置 -->
              <div style="background: var(--surface-hover); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px 14px;">
                <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                  <span>🤖 多模态视觉模型选择 (Vision LLM)</span>
                  <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">(支持 Qwen-VL, Claude 3.5 Sonnet, GPT-4o 等多模态视觉模型)</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.4fr; gap: 8px;">
                  <div>
                    <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">代理客户端</label>
                    <select class="kb-form-input" onchange="window.__kbOnVisionClientChange(this.value)" ${state.visionLoading ? 'disabled' : ''}>
                      ${getCompileClients().map((c) => `
                        <option value="${esc(c)}" ${state.visionClientInput === c ? "selected" : ""}>${esc(clientDisplayName(c))}</option>
                      `).join("")}
                    </select>
                  </div>
                  <div>
                    <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">模型节点</label>
                    <select class="kb-form-input" onchange="window.__kbOnVisionEndpointChange(this.value)" ${state.visionLoading ? 'disabled' : ''}>
                      ${getCompileEndpoints(state.visionClientInput).map((ep) => `
                        <option value="${esc(ep.id)}" ${state.visionEndpointIdInput === ep.id ? "selected" : ""}>${esc(ep.name)}</option>
                      `).join("")}
                    </select>
                  </div>
                  <div>
                    <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">视觉模型</label>
                    <select class="kb-form-input" onchange="window.__kbOnVisionModelChange(this.value)" ${state.visionLoading ? 'disabled' : ''}>
                      ${getCompileModels(state.visionClientInput, state.visionEndpointIdInput).map((m) => `
                        <option value="${esc(m)}" ${state.visionModelInput === m ? "selected" : ""}>${esc(m)}</option>
                      `).join("")}
                    </select>
                  </div>
                </div>
              </div>

              <!-- 转译结果展示区 (如果已转译) -->
              ${state.visionLoading ? `
                <div style="background: var(--surface-hover); border: 1px solid var(--border-color); border-radius: 6px; padding: 20px; text-align: center;">
                  <div class="kb-spinner" style="width: 24px; height: 24px; margin: 0 auto 10px auto;"></div>
                  <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">正在调用视觉大模型深度转译图表...</div>
                  <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">正在提取架构拓扑、Mermaid 代码与核心结论</div>
                </div>
              ` : state.visionResult ? `
                <div style="background: var(--surface-hover); border: 1px solid var(--border-color); border-radius: 6px; padding: 14px;">
                  <div style="font-size: 12px; font-weight: 600; color: #22c55e; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                    <span>✅ 转译成功并已写入当前文档与 FTS5 全文索引</span>
                  </div>
                  ${state.visionResult.mermaidCode ? `
                    <div style="margin-bottom: 10px;">
                      <span style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">生成的 Mermaid 代码：</span>
                      <pre style="background: var(--input-bg); border: 1px solid var(--border-color); padding: 8px 12px; border-radius: 4px; font-size: 11px; color: var(--text-primary); overflow-x: auto; margin-top: 4px;"><code>${esc(state.visionResult.mermaidCode)}</code></pre>
                    </div>
                  ` : ""}
                  <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.6; max-height: 150px; overflow-y: auto;">
                    ${state.visionResult.bulletPoints?.length ? `
                      <ul style="margin: 0; padding-left: 18px;">
                        ${state.visionResult.bulletPoints.map((b: string) => `<li>${esc(b)}</li>`).join("")}
                      </ul>
                    ` : esc(state.visionResult.rawContent || "")}
                  </div>
                </div>
              ` : ""}
            </div>

            <div class="kb-modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-top: 1px solid var(--border-color);">
              <span style="font-size: 11px; color: var(--text-muted);">
                💡 转译完成后将自动生成 Traceable Evidence Card，在对比工作台与 Karpathy Wiki 均可渲染
              </span>
              <div style="display: flex; gap: 8px;">
                <button class="btn" onclick="window.__kbCloseVisionModal()" ${state.visionLoading ? 'disabled' : ''}>关闭</button>
                <button class="btn btn-primary" onclick="window.__kbExecuteVisionTranscribe()" ${state.visionLoading ? 'disabled' : ''}>
                  ${state.visionLoading ? "⏳ 转译中..." : "🚀 开始深度转译并追加证据卡片"}
                </button>
              </div>
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
  localStorage.setItem("kb_active_collection_id", id);
  state.searchQuery = "";
  state.activeDocId = "";
  state.activeDoc = null;
  state.showIntakeDropdown = false;
  void loadDocuments();
};

(window as any).__kbSelectDocument = (id: string) => {
  state.activeDocId = id;
  state.showIntakeDropdown = false;
  const filtered = getFilteredDocuments();
  state.activeDoc = filtered.find((d) => d.id === id) || null;
  render();
  void loadActiveDocDetail(id).then(() => render());
};

(window as any).__kbToggleIntakeMenu = (e: MouseEvent, type: "doc-sidebar" | "doc-toolbar" | "video-sidebar" | "video-toolbar") => {
  e.stopPropagation();
  if (state.showIntakeDropdown && state.showIntakeDropdownType === type) {
    state.showIntakeDropdown = false;
    state.showIntakeDropdownType = "";
  } else {
    state.showIntakeDropdown = true;
    state.showIntakeDropdownType = type;
  }
  render();
};

(window as any).__kbCloseIntakeMenu = () => {
  state.showIntakeDropdown = false;
  state.showIntakeDropdownType = "";
  render();
};

(window as any).__kbDeselectDoc = () => {
  state.activeDocId = "";
  state.activeDoc = null;
  state.showIntakeDropdown = false;
  render();
};

(window as any).__kbOnMediaFileSelected = (e: any) => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = "";
  void handleFileUpload(file);
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

(window as any).__kbReparseDocument = async (docId: string, engine: "markitdown" | "docling") => {
  if (state.reparsingEngine) return;
  state.reparsingEngine = engine;
  render();
  try {
    const data = await apiFetch<{ ok: boolean; document: KbDocument }>(`/v1/kb/documents/${docId}/reparse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine }),
    });
    state.activeDocId = docId;
    state.activeDoc = data.document;
    await loadDocuments();
    showToast("解析引擎已更新", "success");
  } catch (err: any) {
    showToast(`重跑解析失败: ${err.message}`, "error");
    await loadActiveDocDetail(docId);
  } finally {
    state.reparsingEngine = "";
    render();
  }
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

// WeRead & Channel Sync Window Bindings
(window as any).__kbOpenWereadModal = (tab?: "notebooks" | "stream" | "settings") => {
  void openWereadModal(tab);
};

(window as any).__kbCloseWereadModal = () => {
  closeWereadModal();
};

(window as any).__kbSetWereadModalTab = (tab: "notebooks" | "stream" | "settings") => {
  void setWereadModalTab(tab);
};

(window as any).__kbReloadWereadNotebooks = () => {
  void loadWereadNotebooks();
};

(window as any).__kbOnWereadSearch = (val: string) => {
  onWereadSearch(val);
};

(window as any).__kbToggleWereadBook = (bookId: string, checked: boolean) => {
  if (checked) {
    state.wereadSelectedIds.add(bookId);
  } else {
    state.wereadSelectedIds.delete(bookId);
  }
  render();
};

(window as any).__kbToggleAllWereadBooks = (checked: boolean) => {
  if (checked) {
    state.wereadSelectedIds = new Set(state.wereadBooks.map((b) => b.bookId));
  } else {
    state.wereadSelectedIds.clear();
  }
  render();
};

(window as any).__kbImportSingleWereadBook = (bookId: string, title?: string) => {
  void importSingleWereadBook(bookId, title);
};

(window as any).__kbBatchImportWereadBooks = () => {
  void batchImportWereadBooks();
};

(window as any).__kbSaveChannelsConfig = () => {
  void saveChannelsConfig();
};

(window as any).__kbTestWereadConnection = () => {
  void testWereadConnection();
};

(window as any).__kbTriggerManualSync = () => {
  void triggerManualSync();
};

(window as any).__kbToggleShowWereadApiKey = () => {
  state.wereadShowApiKey = !state.wereadShowApiKey;
  render();
};

(window as any).__kbSelectDocAndCloseModal = (docId: string) => {
  state.showWereadModal = false;
  state.activeDocId = docId;
  void loadDocuments().then(() => render());
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
    showToast(`创建分类失败: ${err.message}`, "error");
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
    render();
    showToast("知识库目录已更新", "success");
  } catch (err: any) {
    showToast(`修改知识库失败: ${err.message}`, "error");
  }
};

(window as any).__kbDeleteCollection = async (id: string, name: string) => {
  if (id === "col_default") {
    showToast("默认知识库为系统基础目录，不支持删除。如需调整，可直接点击重命名。", "info");
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
    showToast(`删除知识库失败: ${err.message}`, "error");
  }
};

(window as any).__kbDeleteDoc = async (id: string) => {
  if (!confirm("确定要删除此文档吗？相关的解析缓存和配图也将一并清理。")) return;
  try {
    await apiFetch(`/v1/kb/documents/${id}`, { method: "DELETE" });
    await loadCollections();
    await loadDocuments();
  } catch (err: any) {
    showToast(`删除失败: ${err.message}`, "error");
  }
};

(window as any).__kbCopyContent = (engine: "markitdown" | "docling") => {
  if (!state.activeDoc) return;
  const content = getOutputContent(state.activeDoc, engine, state.activeFormat);
  navigator.clipboard.writeText(content).then(() => {
    showToast("已复制解析内容到剪贴板！", "success");
  }).catch(() => {
    showToast("复制失败，请重试", "error");
  });
};

// Inline event attributes execute in global scope, while `state` is module-local.
// Expose explicit setters so modal inputs can never submit stale values.
(window as any).__kbSetStateValue = <K extends keyof typeof state>(key: K, value: (typeof state)[K]) => {
  state[key] = value;
};

(window as any).__kbSetEditColName = (value: string) => {
  state.editColName = value;
};

(window as any).__kbSetEditColDesc = (value: string) => {
  state.editColDesc = value;
};

(window as any).__kbSetCompileVaultRoot = (value: string) => {
  state.compileVaultRoot = value;
  localStorage.setItem("kb_obsidian_vault_root", value);
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

// Karpathy Compiler Window Bindings
(window as any).__kbOpenCompileModal = (docId?: string, engine?: "markitdown" | "docling") => {
  void openCompileModal(docId, engine);
};

(window as any).__kbCloseCompileModal = () => {
  closeCompileModal();
};

(window as any).__kbStartCompilePreview = () => {
  void startCompilePreview();
};

(window as any).__kbRefineCompileDraft = () => {
  void refineCompileDraft();
};

(window as any).__kbApplyCompileDraft = () => {
  void applyCompileDraft();
};

(window as any).__kbSetCompileActiveConcept = (idx: number) => {
  state.compileActiveConceptIdx = idx;
  render();
};

(window as any).__kbResetCompileDraft = () => {
  state.compileDraft = null;
  state.compileApplyResult = null;
  state.compileFeedback = "";
  render();
};

(window as any).__kbOnCompileClientChange = (client: string) => {
  state.compileSelectedClient = client;
  const eps = getCompileEndpoints(client);
  state.compileSelectedEndpointId = eps[0]?.id || "";
  const models = getCompileModels(client, state.compileSelectedEndpointId);
  state.compileSelectedModel = models[0] || "";
  render();
};

(window as any).__kbOnCompileEndpointChange = (endpointId: string) => {
  state.compileSelectedEndpointId = endpointId;
  const models = getCompileModels(state.compileSelectedClient, endpointId);
  state.compileSelectedModel = models[0] || "";
  render();
};

(window as any).__kbOnCompileModelChange = (model: string) => {
  state.compileSelectedModel = model;
  render();
};

// Video KB Integration Window Bindings
(window as any).__kbOpenVideoModal = (tab?: "url" | "local") => {
  void openVideoModal(tab);
};

(window as any).__kbSetVideoModalTab = (tab: "url" | "local") => {
  state.videoModalTab = tab;
  localStorage.setItem("kb_video_modal_tab", tab);
  render();
};

(window as any).__kbOnVideoFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    state.videoFileInput = input.files[0];
    if (!state.videoTitleInput.trim()) {
      state.videoTitleInput = input.files[0].name.replace(/\.[^/.]+$/, "");
    }
    render();
  }
};

(window as any).__kbCloseVideoModal = () => {
  closeVideoModal();
};

(window as any).__kbSetVideoTab = (tab: "existing" | "new") => {
  state.videoTab = tab;
  render();
};

(window as any).__kbStartVideoIngest = () => {
  void startVideoIngest();
};

(window as any).__kbImportVideoDoc = (videoId: string) => {
  void importVideoDoc(videoId);
};

// Craft Folder Navigation Binding
(window as any).__kbSelectCraftFolder = (folderId: string) => {
  void selectCraftFolder(folderId);
};

// OS Protocol / External Link Opener Binding
(window as any).__kbOpenExternalUrl = (url: string) => {
  void openExternalUrl(url);
};

(window as any).__kbHandleCraftLinkClick = (event: MouseEvent, url: string) => {
  const finalUrl = resolveCraftWebUrl(url);
  void apiFetch("/v1/kb/open-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: finalUrl }),
  }).catch(() => {});
};

(window as any).__kbCopyText = (text: string, msg?: string) => {
  const toCopy = resolveCraftWebUrl(text);
  navigator.clipboard.writeText(toCopy).then(() => {
    showToast(msg || "已复制到剪贴板！", "success");
  }).catch(() => {
    showToast("复制失败，请重试", "error");
  });
};

(window as any).__kbShowToast = (msg: string, type: "success" | "error" | "info" = "info") => {
  showToast(msg, type);
};

(window as any).__kbOnVideoLanguageChange = (lang: string) => {
  state.videoLanguageInput = lang;
  localStorage.setItem("kb_video_lang", lang);
  render();
};

(window as any).__kbOnVideoWhisperModelChange = (model: string) => {
  state.videoWhisperModelInput = model;
  localStorage.setItem("kb_video_whisper_model", model);
  render();
};

(window as any).__kbOnVideoSummaryClientChange = (client: string) => {
  state.videoSummaryClientInput = client;
  localStorage.setItem("kb_video_summary_client", client);
  const eps = getCompileEndpoints(client);
  const defEp = state.compileModels.find((m) => m.client === client && m.isDefault);
  state.videoSummaryEndpointIdInput = defEp ? defEp.endpointId : (eps[0]?.id || "");
  localStorage.setItem("kb_video_summary_endpoint_id", state.videoSummaryEndpointIdInput);
  const models = getCompileModels(client, state.videoSummaryEndpointIdInput);
  state.videoSummaryModelInput = models[0] || "glm-5.2";
  localStorage.setItem("kb_video_summary_model", state.videoSummaryModelInput);
  render();
};

(window as any).__kbOnVideoSummaryEndpointChange = (endpointId: string) => {
  state.videoSummaryEndpointIdInput = endpointId;
  localStorage.setItem("kb_video_summary_endpoint_id", endpointId);
  const models = getCompileModels(state.videoSummaryClientInput, endpointId);
  state.videoSummaryModelInput = models[0] || "glm-5.2";
  localStorage.setItem("kb_video_summary_model", state.videoSummaryModelInput);
  render();
};

(window as any).__kbOnVideoSummaryModelChange = (model: string) => {
  state.videoSummaryModelInput = model;
  localStorage.setItem("kb_video_summary_model", model);
  render();
};

(window as any).__kbOnVideoFrameStrategyChange = (strategy: "scene" | "interval" | "none") => {
  state.videoFrameStrategyInput = strategy;
  localStorage.setItem("kb_video_frame_strategy", strategy);
  render();
};

(window as any).__kbOnVideoFrameIntervalChange = (val: string) => {
  state.videoFrameIntervalInput = Number(val) || 5;
  localStorage.setItem("kb_video_frame_interval", String(state.videoFrameIntervalInput));
  render();
};

(window as any).__kbOnVideoMaxFramesChange = (val: string) => {
  state.videoMaxFramesInput = Number(val) || 30;
  localStorage.setItem("kb_video_max_frames", String(state.videoMaxFramesInput));
  render();
};

(window as any).__kbOnVideoEnableVisionAuditChange = (checked: boolean) => {
  state.videoEnableVisionAudit = checked;
  localStorage.setItem("kb_video_enable_vision_audit", String(checked));
  render();
};

(window as any).__kbOnVideoVisionClientChange = (client: string) => {
  state.videoVisionClientInput = client;
  localStorage.setItem("kb_video_vision_client", client);
  const eps = getCompileEndpoints(client);
  const defEp = state.compileModels.find((m) => m.client === client && m.isDefault);
  state.videoVisionEndpointIdInput = defEp ? defEp.endpointId : (eps[0]?.id || "");
  localStorage.setItem("kb_video_vision_endpoint_id", state.videoVisionEndpointIdInput);
  const models = getCompileModels(client, state.videoVisionEndpointIdInput);
  const visionModel = models.find((m) => /vl|vision|4o|claude|gemini|glm-4v/i.test(m));
  state.videoVisionModelInput = visionModel || models[0] || "qwen-vl-max";
  localStorage.setItem("kb_video_vision_model", state.videoVisionModelInput);
  render();
};

(window as any).__kbOnVideoVisionEndpointChange = (endpointId: string) => {
  state.videoVisionEndpointIdInput = endpointId;
  localStorage.setItem("kb_video_vision_endpoint_id", endpointId);
  const models = getCompileModels(state.videoVisionClientInput, endpointId);
  const visionModel = models.find((m) => /vl|vision|4o|claude|gemini|glm-4v/i.test(m));
  state.videoVisionModelInput = visionModel || models[0] || "qwen-vl-max";
  localStorage.setItem("kb_video_vision_model", state.videoVisionModelInput);
  render();
};

(window as any).__kbOnVideoVisionModelChange = (model: string) => {
  state.videoVisionModelInput = model;
  localStorage.setItem("kb_video_vision_model", model);
  render();
};

// Vision Transcription Modal Bindings
(window as any).__kbOpenVisionModal = (assetUrl: string, assetName: string, title?: string, docId?: string, engine?: "docling" | "markitdown") => {
  openVisionModal(assetUrl, assetName, title, docId, engine);
};

(window as any).__kbOpenVisionModalForDoc = (docId: string, engine: "docling" | "markitdown") => {
  const doc = state.documents.find((d) => d.id === docId) || state.activeDoc;
  if (!doc) return;
  if (doc.assets && doc.assets.length > 0) {
    const firstAsset = doc.assets[0];
    openVisionModal(firstAsset.url, firstAsset.name, doc.title, doc.id, engine);
  } else {
    showToast("当前文档暂未提取出可供转译的图片素材", "info");
  }
};

(window as any).__kbCloseVisionModal = () => {
  state.showVisionModal = false;
  state.visionLoading = false;
  render();
};

(window as any).__kbSetVisionTargetEngine = (engine: "docling" | "markitdown") => {
  state.visionTargetEngine = engine;
  render();
};

(window as any).__kbOnVisionClientChange = (client: string) => {
  state.visionClientInput = client;
  localStorage.setItem("kb_vision_client", client);
  const eps = getCompileEndpoints(client);
  const defEp = state.compileModels.find((m) => m.client === client && m.isDefault);
  state.visionEndpointIdInput = defEp ? defEp.endpointId : (eps[0]?.id || "");
  localStorage.setItem("kb_vision_endpoint_id", state.visionEndpointIdInput);
  const models = getCompileModels(client, state.visionEndpointIdInput);
  const visionModel = models.find((m) => /vl|vision|4o|claude|gemini|glm-4v/i.test(m));
  state.visionModelInput = visionModel || models[0] || "qwen-vl-max";
  localStorage.setItem("kb_vision_model", state.visionModelInput);
  render();
};

(window as any).__kbOnVisionEndpointChange = (endpointId: string) => {
  state.visionEndpointIdInput = endpointId;
  localStorage.setItem("kb_vision_endpoint_id", endpointId);
  const models = getCompileModels(state.visionClientInput, endpointId);
  const visionModel = models.find((m) => /vl|vision|4o|claude|gemini|glm-4v/i.test(m));
  state.visionModelInput = visionModel || models[0] || "qwen-vl-max";
  localStorage.setItem("kb_vision_model", state.visionModelInput);
  render();
};

(window as any).__kbOnVisionModelChange = (model: string) => {
  state.visionModelInput = model;
  localStorage.setItem("kb_vision_model", model);
  render();
};

(window as any).__kbExecuteVisionTranscribe = () => {
  void executeVisionTranscribe();
};

(window as any).__kbTriggerVisionEnhance = () => {
  const doc = state.activeDoc;
  if (doc && doc.assets && doc.assets.length > 0) {
    const firstAsset = doc.assets[0];
    openVisionModal(firstAsset.url, firstAsset.name, doc.title, doc.id, "docling");
  } else if (doc) {
    showToast("当前选中的文档暂未提取出可供转译的图片素材。导入包含图表的文档或音视频抽帧后即可体验视觉转译！", "info");
  } else {
    showToast("请先在左侧选择包含图片/抽帧的文档，或点击上方「上传文件」/「视频知识库」录入内容", "info");
  }
};

// Sub-tabs & Modality Switcher
(window as any).__kbSwitchSubTab = (subTab: "document" | "video" | "image") => {
  state.activeSubTab = subTab;
  state.showIntakeDropdown = false;
  const filtered = getFilteredDocuments();
  if (filtered.length > 0) {
    if (!state.activeDocId || !filtered.some((d) => d.id === state.activeDocId)) {
      state.activeDocId = filtered[0].id;
    }
    state.activeDoc = filtered.find((d) => d.id === state.activeDocId) || filtered[0];
    void loadActiveDocDetail(state.activeDocId).then(() => render());
  } else {
    state.activeDocId = "";
    state.activeDoc = null;
  }
  render();
};

// Workbench View Mode Switcher: Adopted vs Compare
(window as any).__kbSetDocViewMode = (mode: "adopted" | "compare") => {
  state.docViewMode = mode;
  render();
};

// Multi-select Checkbox Controls
(window as any).__kbToggleSelectDoc = (docId: string) => {
  if (state.selectedDocIds.has(docId)) {
    state.selectedDocIds.delete(docId);
  } else {
    state.selectedDocIds.add(docId);
  }
  render();
};

(window as any).__kbClearSelectedDocs = () => {
  state.selectedDocIds.clear();
  render();
};

// Adopt Engine Output as Official Document
(window as any).__kbAdoptEngine = (engine: "markitdown" | "docling") => {
  if (!state.activeDoc) return;
  const content = engine === "markitdown" ? state.activeDoc.markitdown_md : state.activeDoc.docling_md;
  void adoptDocument(state.activeDoc.id, engine, content);
};

// Copy Agent Prompt (Native OS Absolute Paths + file:/// URIs)
(window as any).__kbCopyDocAgentPrompt = (docId: string) => {
  void copyAgentPrompt({ docIds: [docId] });
};

(window as any).__kbCopySelectedAgentPrompt = () => {
  if (state.selectedDocIds.size === 0) return;
  void copyAgentPrompt({ docIds: Array.from(state.selectedDocIds) });
};

(window as any).__kbCopyCollectionAgentPrompt = (colId: string) => {
  void copyAgentPrompt({ collectionId: colId });
};

// Final Content Copy & Export
(window as any).__kbCopyFinalContent = () => {
  if (!state.activeDoc) return;
  const content = state.activeDoc.final_content || state.activeDoc.docling_md || state.activeDoc.markitdown_md || "";
  navigator.clipboard.writeText(content).then(() => {
    showToast("已复制官方采纳正文到剪贴板！", "success");
  }).catch(() => {
    showToast("复制失败，请重试", "error");
  });
};

(window as any).__kbExportFinalContent = () => {
  if (!state.activeDoc) return;
  const content = state.activeDoc.final_content || state.activeDoc.docling_md || state.activeDoc.markitdown_md || "";
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.activeDoc.title || "document"}_final.md`;
  a.click();
  URL.revokeObjectURL(url);
};

// Image Ingest Modal Bindings
(window as any).__kbOpenImageModal = (tab?: "local" | "url") => {
  state.showImageModal = true;
  if (tab) {
    state.imageModalTab = tab;
    localStorage.setItem("kb_image_modal_tab", tab);
  } else {
    state.imageModalTab = (localStorage.getItem("kb_image_modal_tab") as "local" | "url") || "local";
  }
  state.imageFileInput = null;
  state.imagePreviewUrl = "";
  state.imageUrlInput = "";
  state.imageTitleInput = "";
  state.imageIngesting = false;
  const client = state.imageClientInput || localStorage.getItem("kb_vision_client") || "code";
  state.imageClientInput = client;
  const eps = getCompileEndpoints(client);
  if (!state.imageEndpointIdInput || !eps.some((e) => e.id === state.imageEndpointIdInput)) {
    const savedEp = localStorage.getItem("kb_vision_endpoint_id");
    if (savedEp && eps.some((e) => e.id === savedEp)) {
      state.imageEndpointIdInput = savedEp;
    } else {
      const defEp = state.compileModels.find((m) => m.client === client && m.isDefault);
      state.imageEndpointIdInput = defEp ? defEp.endpointId : (eps[0]?.id || "");
    }
  }
  const models = getCompileModels(client, state.imageEndpointIdInput);
  if (!state.imageModelInput || !models.includes(state.imageModelInput)) {
    const savedModel = localStorage.getItem("kb_vision_model");
    if (savedModel && models.includes(savedModel)) {
      state.imageModelInput = savedModel;
    } else {
      const visionModel = models.find((m) => /vl|vision|4o|claude|gemini|glm-4v/i.test(m));
      state.imageModelInput = visionModel || models[0] || "qwen-vl-max";
    }
  }
  render();
};

(window as any).__kbSetImageModalTab = (tab: "local" | "url") => {
  state.imageModalTab = tab;
  localStorage.setItem("kb_image_modal_tab", tab);
  render();
};

(window as any).__kbSubmitImageUrlIngest = () => {
  void handleImageUrlIngest();
};

(window as any).__kbCloseImageModal = () => {
  if (state.imageIngesting) return;
  state.showImageModal = false;
  render();
};

(window as any).__kbOnImageFileSelected = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    const file = target.files[0];
    state.imageFileInput = file;
    if (!state.imageTitleInput.trim()) {
      state.imageTitleInput = file.name.replace(/\.[^/.]+$/, "");
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      state.imagePreviewUrl = (e.target?.result as string) || "";
      render();
    };
    reader.readAsDataURL(file);
  }
};

(window as any).__kbOnImageClientChange = (client: string) => {
  state.imageClientInput = client;
  localStorage.setItem("kb_vision_client", client);
  const eps = getCompileEndpoints(client);
  const defEp = state.compileModels.find((m) => m.client === client && m.isDefault);
  state.imageEndpointIdInput = defEp ? defEp.endpointId : (eps[0]?.id || "");
  localStorage.setItem("kb_vision_endpoint_id", state.imageEndpointIdInput);
  const models = getCompileModels(client, state.imageEndpointIdInput);
  const visionModel = models.find((m) => /vl|vision|4o|claude|gemini|glm-4v/i.test(m));
  state.imageModelInput = visionModel || models[0] || "qwen-vl-max";
  localStorage.setItem("kb_vision_model", state.imageModelInput);
  render();
};

(window as any).__kbOnImageEndpointChange = (endpointId: string) => {
  state.imageEndpointIdInput = endpointId;
  localStorage.setItem("kb_vision_endpoint_id", endpointId);
  const models = getCompileModels(state.imageClientInput, endpointId);
  const visionModel = models.find((m) => /vl|vision|4o|claude|gemini|glm-4v/i.test(m));
  state.imageModelInput = visionModel || models[0] || "qwen-vl-max";
  localStorage.setItem("kb_vision_model", state.imageModelInput);
  render();
};

(window as any).__kbOnImageModelChange = (model: string) => {
  state.imageModelInput = model;
  localStorage.setItem("kb_vision_model", model);
  render();
};

(window as any).__kbSubmitImageIngest = () => {
  void handleImageIngest();
};

// Register Tab Lifecycle
registerTab("knowledge-base", {
  onEnter: () => {
    initKnowledgeBase();
  },
});
