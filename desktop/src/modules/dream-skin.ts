/**
 * Dream Skin panel module: local themes, market, editor, simulated preview.
 * Registered via registerTab so app.ts stays a thin lifecycle owner.
 */

import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";
import {
  getDreamSkinCapabilities,
  listDreamSkinThemes,
  getDreamSkinTheme,
  createDreamSkinTheme,
  updateDreamSkinTheme,
  duplicateDreamSkinTheme,
  selectDreamSkinTheme,
  deleteDreamSkinTheme,
  importDreamSkinTheme,
  loadDreamSkinMarket,
  installDreamSkinMarketTheme,
  updateDreamSkinMarketTheme,
} from "../core/api";
import {
  filterMarketThemes,
  themeToDraft,
  draftToSaveInput,
  previewStyleModel,
  type DreamSkinDraft,
} from "./dream-skin-model";
import type {
  DreamSkinCapabilities,
  DreamSkinLibraryResponse,
  DreamSkinMarketResponse,
  DreamSkinPreviewScene,
  DreamSkinThemeDetail,
} from "../core/types";

export interface DreamSkinPanelState {
  activeView: "local" | "market" | "editor";
  capabilities: DreamSkinCapabilities | null;
  library: DreamSkinLibraryResponse | null;
  market: DreamSkinMarketResponse | null;
  marketQuery: string;
  marketTag: string;
  editor: {
    mode: "create" | "edit" | "save-as";
    draft: DreamSkinDraft;
    originalId: string | null;
    scene: DreamSkinPreviewScene;
    busy: boolean;
  } | null;
  loading: boolean;
  error: string;
  busyAction: string;
  deleteCandidateId: string;
  loaded: boolean;
}

export function createDreamSkinPanelState(): DreamSkinPanelState {
  return {
    activeView: "local",
    capabilities: null,
    library: null,
    market: null,
    marketQuery: "",
    marketTag: "",
    editor: null,
    loading: false,
    error: "",
    busyAction: "",
    deleteCandidateId: "",
    loaded: false,
  };
}

let state: DreamSkinPanelState = createDreamSkinPanelState();
let root: HTMLElement | null = null;

function getRoot(): HTMLElement {
  if (!root) root = document.getElementById("dream-skin-root");
  if (!root) throw new Error("dream-skin-root not found");
  return root;
}

async function loadInitial(): Promise<void> {
  state.loading = true;
  state.error = "";
  render();
  try {
    const [caps, library] = await Promise.all([
      getDreamSkinCapabilities(),
      listDreamSkinThemes(),
    ]);
    state.capabilities = caps;
    state.library = library;
    state.loaded = true;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    render();
  }
}

function render(): void {
  const el = getRoot();
  if (state.loading) {
    el.innerHTML = `<div class="dream-skin-loading">加载中…</div>`;
    return;
  }
  if (state.error) {
    el.innerHTML = `
      <div class="dream-skin-error">
        <p>${escapeHtml(state.error)}</p>
        <button class="btn" onclick="window.__dreamSkinRetry()">重试</button>
      </div>`;
    return;
  }
  if (!state.library) {
    el.innerHTML = `<div class="dream-skin-empty">暂无数据</div>`;
    return;
  }

  const viewTabs = `
    <div class="dream-skin-view-tabs" role="tablist">
      <button class="btn dream-skin-view-tab ${state.activeView === "local" ? "is-active" : ""}" data-view="local">本地主题</button>
      <button class="btn dream-skin-view-tab ${state.activeView === "market" ? "is-active" : ""}" data-view="market">主题市场</button>
      <button class="btn dream-skin-view-tab ${state.activeView === "editor" ? "is-active" : ""}" data-view="editor">主题编辑器</button>
    </div>`;

  const content =
    state.activeView === "local" ? renderLocalView()
    : state.activeView === "market" ? renderMarketView()
    : renderEditorView();

  el.innerHTML = viewTabs + content;
  el.querySelectorAll(".dream-skin-view-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeView = (btn as HTMLElement).dataset.view as "local" | "market" | "editor";
      render();
    });
  });
  bindActions(el);
}

// --- Local library view ---

function renderLocalView(): string {
  if (!state.library) return "";
  const cards = state.library.themes.map((t) => {
    const thumb = t.imageUrl
      ? `<img class="dream-skin-thumb" src="${escapeHtml(t.imageUrl)}" alt="" loading="lazy" />`
      : `<div class="dream-skin-thumb dream-skin-thumb-swatch"></div>`;
    const badge = t.selected ? `<span class="dream-skin-badge is-selected">当前主题</span>` : "";
    const actions = `
      <div class="dream-skin-card-actions">
        <button class="btn" data-action="select" data-id="${escapeHtml(t.id)}" ${t.selected ? "disabled" : ""}>设为当前</button>
        <button class="btn" data-action="edit" data-id="${escapeHtml(t.id)}">编辑</button>
        <button class="btn" data-action="duplicate" data-id="${escapeHtml(t.id)}">复制</button>
        ${t.builtin ? "" : `<button class="btn dream-skin-danger" data-action="delete" data-id="${escapeHtml(t.id)}" ${t.selected ? `disabled title="请先选择其他主题"` : ""}>删除</button>`}
      </div>`;
    return `
      <div class="dream-skin-card" data-id="${escapeHtml(t.id)}">
        ${thumb}
        <div class="dream-skin-card-body">
          <div class="dream-skin-card-title">${escapeHtml(t.name)} ${badge}</div>
          <div class="dream-skin-card-meta">${escapeHtml(t.stylePreset || "基础预设")} · ${escapeHtml(t.appearance)}</div>
          ${actions}
        </div>
      </div>`;
  }).join("");

  return `
    <div class="dream-skin-section-head">
      <h3>本地主题</h3>
      <div class="dream-skin-section-actions">
        <button class="btn" data-action="import">导入主题</button>
        <button class="btn" data-action="create">新建主题</button>
      </div>
    </div>
    <div class="dream-skin-grid">
      ${cards || `<div class="dream-skin-empty">暂无本地主题</div>`}
    </div>`;
}

// --- Market view ---

function renderMarketView(): string {
  if (!state.market) {
    return `
      <div class="dream-skin-section-head">
        <h3>主题市场</h3>
        <button class="btn" data-action="market-load">加载市场</button>
      </div>
      <div class="dream-skin-empty">市场尚未加载</div>`;
  }
  const filtered = filterMarketThemes(state.market.themes, {
    query: state.marketQuery,
    tag: state.marketTag,
  });
  const tags = [...new Set(state.market.themes.flatMap((t) => t.tags))].sort();
  const cards = filtered.map((t) => {
    const badge = t.installed
      ? t.updateAvailable
        ? `<span class="dream-skin-badge is-update">可更新</span>`
        : `<span class="dream-skin-badge is-installed">已安装</span>`
      : "";
    const action = t.installed
      ? `<button class="btn" data-action="market-update" data-id="${escapeHtml(t.id)}" ${t.updateAvailable ? "" : "disabled"}>更新</button>`
      : `<button class="btn btn-primary" data-action="market-install" data-id="${escapeHtml(t.id)}">安装</button>`;
    return `
      <div class="dream-skin-card" data-id="${escapeHtml(t.id)}">
        <img class="dream-skin-thumb" src="${escapeHtml(t.previewUrl)}" alt="" loading="lazy" />
        <div class="dream-skin-card-body">
          <div class="dream-skin-card-title">${escapeHtml(t.name)} ${badge}</div>
          <div class="dream-skin-card-meta">${escapeHtml(t.author)} · v${escapeHtml(t.version)} · ${escapeHtml(t.license)}</div>
          <div class="dream-skin-card-desc">${escapeHtml(t.description)}</div>
          <div class="dream-skin-card-tags">${t.tags.map((tag) => `<span class="dream-skin-tag">${escapeHtml(tag)}</span>`).join("")}</div>
          <div class="dream-skin-card-actions">${action}</div>
        </div>
      </div>`;
  }).join("");

  const cached = state.market.cached
    ? `<div class="dream-skin-cache-warning">${escapeHtml(state.market.warning?.message || "当前显示缓存")}</div>`
    : "";

  return `
    <div class="dream-skin-section-head">
      <h3>主题市场</h3>
      <button class="btn" data-action="market-refresh">刷新</button>
    </div>
    ${cached}
    <div class="dream-skin-market-toolbar">
      <input class="dream-skin-search" type="search" placeholder="搜索主题…" value="${escapeHtml(state.marketQuery)}" data-role="market-search" />
      <select class="dream-skin-tag-select" data-role="market-tag">
        <option value="">全部标签</option>
        ${tags.map((tag) => `<option value="${escapeHtml(tag)}" ${state.marketTag === tag ? "selected" : ""}>${escapeHtml(tag)}</option>`).join("")}
      </select>
    </div>
    <div class="dream-skin-grid">${cards || `<div class="dream-skin-empty">没有匹配的主题</div>`}</div>`;
}

// --- Editor view ---

function renderEditorView(): string {
  const d = state.editor?.draft;
  if (!d) {
    return `<div class="dream-skin-empty">选择主题开始编辑，或新建主题。</div>`;
  }
  const preview = previewStyleModel(d, state.editor?.scene || "home", d.appearance);
  const styleProps = Object.entries(preview.customProperties)
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  const homeScene = state.editor?.scene === "chat"
    ? `
      <div class="dream-preview-chat-msg is-user">帮我解释一下量子纠缠</div>
      <div class="dream-preview-chat-msg is-assistant">量子纠缠是粒子间的一种关联状态……</div>`
    : `
      <div class="dream-preview-home-hero">
        <div class="dream-preview-brand">${escapeHtml(d.brandSubtitle)}</div>
        <div class="dream-preview-tagline">${escapeHtml(d.tagline)}</div>
      </div>
      <div class="dream-preview-project-row">${escapeHtml(d.projectPrefix)}<strong>${escapeHtml(d.projectLabel)}</strong></div>
      <div class="dream-preview-status">${escapeHtml(d.statusText)} · ${escapeHtml(d.quote)}</div>`;

  return `
    <div class="dream-skin-editor">
      <div class="dream-skin-editor-fields">
        <label>名称<input class="form-input" data-field="name" value="${escapeHtml(d.name)}" /></label>
        <label>引擎预设
          <select class="form-input" data-field="stylePreset">
            <option value="">基础</option>
            <option value="codex-snow" ${d.stylePreset === "codex-snow" ? "selected" : ""}>Snow</option>
            <option value="glass-vision" ${d.stylePreset === "glass-vision" ? "selected" : ""}>Glass Vision</option>
            <option value="midnight-aurora" ${d.stylePreset === "midnight-aurora" ? "selected" : ""}>Midnight Aurora</option>
            <option value="amber-dusk" ${d.stylePreset === "amber-dusk" ? "selected" : ""}>Amber Dusk</option>
          </select>
        </label>
        <label>外观
          <select class="form-input" data-field="appearance">
            <option value="auto" ${d.appearance === "auto" ? "selected" : ""}>自动</option>
            <option value="light" ${d.appearance === "light" ? "selected" : ""}>亮色</option>
            <option value="dark" ${d.appearance === "dark" ? "selected" : ""}>暗色</option>
          </select>
        </label>
        <div class="dream-skin-editor-actions">
          <button class="btn btn-primary" data-action="editor-save">保存</button>
          <button class="btn" data-action="editor-save-as">另存为</button>
        </div>
      </div>
      <div class="dream-skin-editor-preview">
        <div class="dream-skin-preview-scene-tabs">
          <button class="btn ${state.editor?.scene === "home" ? "is-active" : ""}" data-action="scene-home">首页</button>
          <button class="btn ${state.editor?.scene === "chat" ? "is-active" : ""}" data-action="scene-chat">对话</button>
        </div>
        <div class="dream-skin-workspace-preview" style="${styleProps}">
          <div class="dream-preview-sidebar"></div>
          <div class="dream-preview-main">
            <div class="dream-preview-toolbar"></div>
            <div class="dream-preview-content">${homeScene}</div>
          </div>
        </div>
      </div>
    </div>`;
}

// --- Action binding ---

function bindActions(el: HTMLElement): void {
  // Market search / tag
  el.querySelectorAll('[data-role="market-search"]').forEach((input) => {
    input.addEventListener("input", () => {
      state.marketQuery = (input as HTMLInputElement).value;
      render();
    });
  });
  el.querySelectorAll('[data-role="market-tag"]').forEach((select) => {
    select.addEventListener("change", () => {
      state.marketTag = (select as HTMLSelectElement).value;
      render();
    });
  });

  // Editor field changes
  el.querySelectorAll("[data-field]").forEach((node) => {
    node.addEventListener("change", () => {
      const field = (node as HTMLElement).dataset.field;
      if (!field || !state.editor?.draft) return;
      const value = (node as HTMLInputElement | HTMLSelectElement).value;
      if (field === "name" || field === "stylePreset" || field === "appearance") {
        (state.editor.draft as Record<string, unknown>)[field] = value;
      }
      render();
    });
  });

  el.querySelectorAll("[data-action]").forEach((node) => {
    node.addEventListener("click", async () => {
      const btn = node as HTMLElement;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!action || state.busyAction) return;
      state.busyAction = `${action}:${id || ""}`;
      try {
        await handleAction(action, id);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      } finally {
        state.busyAction = "";
        render();
      }
    });
  });
}

async function handleAction(action: string, id?: string): Promise<void> {
  switch (action) {
    case "select": {
      if (!id) return;
      await selectDreamSkinTheme(id);
      state.library = await listDreamSkinThemes();
      showToast("已设为当前主题");
      break;
    }
    case "duplicate": {
      if (!id) return;
      const detail = (await getDreamSkinTheme(id)).theme;
      const dup = await duplicateDreamSkinTheme(id, { name: `${detail.name} Copy` });
      state.library = await listDreamSkinThemes();
      showToast(`已复制为 ${(dup as { name?: string }).name || ""}`);
      break;
    }
    case "delete": {
      if (!id) return;
      const confirmed = window.confirm("确定删除该主题？删除后不可恢复。");
      if (!confirmed) return;
      await deleteDreamSkinTheme(id);
      state.library = await listDreamSkinThemes();
      showToast("主题已删除");
      break;
    }
    case "edit": {
      if (!id) return;
      const detail = (await getDreamSkinTheme(id)).theme;
      state.editor = {
        mode: "edit",
        draft: themeToDraft(detail),
        originalId: id,
        scene: "home",
        busy: false,
      };
      state.activeView = "editor";
      break;
    }
    case "create": {
      const builtin = (await getDreamSkinTheme("shrimp-default")).theme;
      state.editor = {
        mode: "create",
        draft: { ...themeToDraft(builtin), id: "", name: "我的主题" },
        originalId: null,
        scene: "home",
        busy: false,
      };
      state.activeView = "editor";
      break;
    }
    case "import": {
      showToast("导入需通过文件选择器上传 theme.json 与背景图", "info");
      break;
    }
    case "market-load": {
      state.market = await loadDreamSkinMarket();
      break;
    }
    case "market-refresh": {
      state.market = await loadDreamSkinMarket(true);
      break;
    }
    case "market-install": {
      if (!id) return;
      await installDreamSkinMarketTheme(id);
      state.market = await loadDreamSkinMarket();
      state.library = await listDreamSkinThemes();
      showToast("主题已安装");
      break;
    }
    case "market-update": {
      if (!id) return;
      await updateDreamSkinMarketTheme(id);
      state.market = await loadDreamSkinMarket();
      state.library = await listDreamSkinThemes();
      showToast("主题已更新");
      break;
    }
    case "editor-save": {
      if (!state.editor?.draft) return;
      const d = state.editor.draft;
      const payload = { theme: draftToSaveInput(d) };
      if (state.editor.mode === "create") {
        await createDreamSkinTheme(payload as Parameters<typeof createDreamSkinTheme>[0]);
        showToast("主题已创建");
      } else if (state.editor.originalId) {
        await updateDreamSkinTheme(state.editor.originalId, payload as Parameters<typeof updateDreamSkinTheme>[1]);
        showToast("主题已保存");
      }
      state.library = await listDreamSkinThemes();
      break;
    }
    case "editor-save-as": {
      if (!state.editor?.draft) return;
      const d = state.editor.draft;
      const payload = { theme: { ...draftToSaveInput(d), id: "" } };
      await createDreamSkinTheme(payload as Parameters<typeof createDreamSkinTheme>[0]);
      state.library = await listDreamSkinThemes();
      showToast("已另存为新主题");
      break;
    }
    case "scene-home": {
      if (state.editor) state.editor.scene = "home";
      break;
    }
    case "scene-chat": {
      if (state.editor) state.editor.scene = "chat";
      break;
    }
    default:
      break;
  }
}

registerTab("dream-skin", {
  onEnter() {
    if (!state.loaded) void loadInitial();
    else render();
  },
  onLeave() {},
});

export function renderDreamSkinPanel(): void {
  render();
}

export function getDreamSkinPanelState(): DreamSkinPanelState {
  return state;
}

window.__dreamSkinRetry = () => { void loadInitial(); };
window.__dreamSkinLoadMarket = async (force = false) => {
  state.market = await loadDreamSkinMarket(force);
  render();
};

if (typeof window !== "undefined" && window.location.hash.includes("dream-skin")) {
  void loadInitial();
}
