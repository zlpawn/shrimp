/**
 * Dream Skin panel module.
 */

import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";
import {
  getDreamSkinCapabilities,
  listDreamSkinThemes,
  loadDreamSkinMarket,
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
} from "../core/types";

let state: {
  activeView: "local" | "market" | "editor";
  capabilities: DreamSkinCapabilities | null;
  library: DreamSkinLibraryResponse | null;
  market: DreamSkinMarketResponse | null;
  editor: { mode: string; draft: DreamSkinDraft | null; originalId: string | null; scene: DreamSkinPreviewScene; busy: boolean } | null;
  loading: boolean;
  error: string;
  busyAction: string;
  loaded: boolean;
} = {
  activeView: "local",
  capabilities: null,
  library: null,
  market: null,
  editor: null,
  loading: false,
  error: "",
  busyAction: "",
  loaded: false,
};

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
    const [caps, library] = await Promise.all([getDreamSkinCapabilities(), listDreamSkinThemes()]);
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
    el.innerHTML = `<div class="dream-skin-error"><p>${escapeHtml(state.error)}</p><button class="btn" onclick="window.__dreamSkinRetry()">重试</button></div>`;
    return;
  }
  if (!state.library) {
    el.innerHTML = `<div class="dream-skin-empty">暂无数据</div>`;
    return;
  }
  el.innerHTML = `
    <div class="dream-skin-view-tabs" role="tablist">
      <button class="btn dream-skin-view-tab ${state.activeView === "local" ? "is-active" : ""}" data-view="local">本地主题</button>
      <button class="btn dream-skin-view-tab ${state.activeView === "market" ? "is-active" : ""}" data-view="market">主题市场</button>
      <button class="btn dream-skin-view-tab ${state.activeView === "editor" ? "is-active" : ""}" data-view="editor">主题编辑器</button>
    </div>
    <div class="dream-skin-view-content">${state.activeView === "local" ? renderLocal() : state.activeView === "market" ? renderMarket() : renderEditor()}</div>
  `;
  el.querySelectorAll(".dream-skin-view-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeView = (btn as HTMLElement).dataset.view as "local" | "market" | "editor";
      render();
    });
  });
}

function renderLocal(): string {
  if (!state.library) return "";
  const cards = state.library.themes.map((t) => `
    <div class="dream-skin-card" data-id="${escapeHtml(t.id)}">
      ${t.imageUrl ? `<img class="dream-skin-thumb" src="${escapeHtml(t.imageUrl)}" alt="" loading="lazy" />` : `<div class="dream-skin-thumb dream-skin-thumb-swatch"></div>`}
      <div class="dream-skin-card-body">
        <div class="dream-skin-card-title">${escapeHtml(t.name)} ${t.selected ? `<span class="dream-skin-badge is-selected">当前</span>` : ""}</div>
        <div class="dream-skin-card-meta">${escapeHtml(t.stylePreset || "基础")} · ${escapeHtml(t.appearance)}</div>
      </div>
    </div>`).join("");
  return `<div class="dream-skin-section-head"><h3>本地主题</h3></div><div class="dream-skin-grid">${cards || `<div class="dream-skin-empty">暂无主题</div>`}</div>`;
}

function renderMarket(): string {
  if (!state.market) return `<div class="dream-skin-empty"><button class="btn" onclick="window.__dreamSkinLoadMarket()">加载市场</button></div>`;
  const cards = state.market.themes.map((t) => `
    <div class="dream-skin-card" data-id="${escapeHtml(t.id)}">
      <img class="dream-skin-thumb" src="${escapeHtml(t.previewUrl)}" alt="" loading="lazy" />
      <div class="dream-skin-card-body">
        <div class="dream-skin-card-title">${escapeHtml(t.name)}</div>
        <div class="dream-skin-card-meta">${escapeHtml(t.author)} · v${escapeHtml(t.version)}</div>
      </div>
    </div>`).join("");
  const cached = state.market.cached ? `<div class="dream-skin-cache-warning">${escapeHtml(state.market.warning?.message || "")}</div>` : "";
  return `<div class="dream-skin-section-head"><h3>主题市场</h3><button class="btn" onclick="window.__dreamSkinLoadMarket(true)">刷新</button></div>${cached}<div class="dream-skin-grid">${cards}</div>`;
}

function renderEditor(): string {
  return `<div class="dream-skin-empty">选择主题开始编辑。</div>`;
}

window.__dreamSkinRetry = () => { void loadInitial(); };
window.__dreamSkinLoadMarket = async (force = false) => {
  state.market = await loadDreamSkinMarket(force);
  render();
};

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

if (typeof window !== "undefined" && window.location.hash.includes("dream-skin")) {
  void loadInitial();
}
