# Dream Skin Web Panel And Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modular Dream Skin panel for browsing, installing, editing, selecting, and simulating themes without loading renderer injection assets or operating Codex Desktop.

**Architecture:** A self-contained TypeScript module owns Dream Skin state, rendering, events, and API calls; the existing application adds only a navigation shell and lifecycle hook bridge. A pure presentation-model module drives local/market filtering and the simulated home/chat workspace, keeping preview behavior testable without depending on Codex DOM.

**Tech Stack:** TypeScript, vanilla DOM, esbuild, Lucide icons, existing panel CSS variables/components, `node:test`.

## Global Constraints

- Complete `2026-08-11-dream-skin-market-api.md` first; consume its exact HTTP response contracts.
- Work only in `/Users/pa/project/AI/local-ai-gateway/.worktrees/dream-skin` on branch `codex/dream-skin`.
- Do not start, stop, restart, inspect, connect to, or inject Codex Desktop.
- The UI uses “设为当前主题” or “选择主题”; it never says a theme was applied to Codex.
- Do not add “应用到 Codex”, launch, inject, cleanup, runtime, community upload, ZIP, CSS, JavaScript, or arbitrary JSON controls.
- The simulated preview uses Shrimp-owned markup and CSS; it never imports or evaluates `renderer-inject.js`.
- Market images use only API-provided Shrimp preview URLs.
- Theme and market text is escaped or assigned through `textContent`; market HTML and Markdown HTML are never rendered.
- The editor exposes controlled fields only.
- Local and market action buttons remain fixed-size while busy and reject duplicate clicks.
- Support loading, failure, empty, cached-market, busy, validation, confirmation, and success states.
- Ensure compact desktop and mobile layouts at widths 1440, 1024, 760, and 390 pixels without overlapping or clipped text.
- Keep cards at 8px radius or less and do not nest cards inside cards.
- Preserve unrelated uncommitted work already present in the worktree.

---

### Task 1: Add Typed API Contracts And Error Handling

**Files:**
- Modify: `desktop/src/core/types.ts`
- Modify: `desktop/src/core/api.ts`
- Create: `desktop/src/modules/dream-skin-model.ts`
- Create: `tests/unit/dream-skin-panel.test.mjs`

**Interfaces:**
- Produces TypeScript interfaces: `DreamSkinCapabilities`, `DreamSkinTheme`, `DreamSkinThemeDetail`, `DreamSkinLibraryResponse`, `DreamSkinMarketTheme`, `DreamSkinMarketResponse`, `DreamSkinApiError`, `DreamSkinDraft`, and `DreamSkinPreviewScene`.
- Produces: `requestDreamSkin<T>(path, options?) -> Promise<T>`.
- Produces API functions:

```ts
getDreamSkinCapabilities()
listDreamSkinThemes()
getDreamSkinTheme(id)
createDreamSkinTheme(input)
updateDreamSkinTheme(id, input)
duplicateDreamSkinTheme(id, input)
selectDreamSkinTheme(id)
deleteDreamSkinTheme(id)
importDreamSkinTheme(input)
loadDreamSkinMarket(forceRefresh?)
installDreamSkinMarketTheme(id)
updateDreamSkinMarketTheme(id)
```

- Produces pure helpers:

```ts
filterMarketThemes(themes, { query, tag }): DreamSkinMarketTheme[]
themeToDraft(detail): DreamSkinDraft
draftToSaveInput(draft): Record<string, unknown>
previewStyleModel(draft, scene, panelAppearance): DreamSkinPreviewStyle
```

- [ ] **Step 1: Write a failing TypeScript bundle test**

In `tests/unit/dream-skin-panel.test.mjs`, use the installed `esbuild` API to bundle `desktop/src/modules/dream-skin-model.ts` with `write: false`. Assert the bundle succeeds and contains exported helper names.

- [ ] **Step 2: Add failing API source-contract tests**

Read `desktop/src/core/api.ts` and assert every function above uses a `/v1/dream-skin` path and `encodeURIComponent(id)` for dynamic IDs. Assert no API function accepts `url`, `themeUrl`, `imageUrl`, `previewUrl`, or hash parameters.

- [ ] **Step 3: Run and verify failure**

```bash
node --test tests/unit/dream-skin-panel.test.mjs
```

Expected: FAIL because the interfaces and modules do not exist.

- [ ] **Step 4: Implement exact response types**

Use:

```ts
export interface DreamSkinTheme {
  id: string;
  name: string;
  kind: "builtin" | "stored";
  builtin: boolean;
  selected: boolean;
  source: "builtin" | "local" | "market";
  version?: string | null;
  stylePreset: string;
  appearance: "auto" | "light" | "dark";
  imageUrl: string;
  updateAvailable?: boolean;
}
```

`DreamSkinMarketResponse` includes `themes`, `updatedAt`, `cached`, and optional `warning`. It does not include remote asset paths or hashes.

Use these controlled mutation input types:

```ts
export interface DreamSkinImageUpload {
  name: string;
  dataBase64: string;
}
export interface DreamSkinThemeMutation {
  theme: Record<string, unknown>;
  image?: DreamSkinImageUpload;
}
```

Creation requires `image`; update omits it only when retaining an existing background.

- [ ] **Step 5: Implement one throwing API helper**

`requestDreamSkin` parses the standard error envelope and throws an `Error` augmented with `code` and `details`. It returns decoded JSON for successful JSON responses and does not swallow failures into `null`.

- [ ] **Step 6: Implement pure model helpers**

Filtering is case-insensitive over name, author, description, and tags. `draftToSaveInput` emits only normalized theme fields. `previewStyleModel` returns CSS custom-property values and background positioning, never raw CSS rules or selectors.

- [ ] **Step 7: Run tests and commit**

```bash
node --test tests/unit/dream-skin-panel.test.mjs
npm run build:panel
git diff --check
git add desktop/src/core/types.ts desktop/src/core/api.ts desktop/src/modules/dream-skin-model.ts tests/unit/dream-skin-panel.test.mjs
git commit -m "feat: add dream skin panel contracts"
```

Expected: unit test and panel build PASS.

---

### Task 2: Add A Thin Tab Lifecycle Bridge And Page Shell

**Files:**
- Modify: `desktop/src/core/navigation.ts`
- Modify: `desktop/src/main.ts`
- Modify: `desktop/src/app.ts`
- Modify: `desktop/index.html`
- Modify: `tests/unit/config-panel-tabs.test.mjs`
- Modify: `tests/unit/dream-skin-panel.test.mjs`

**Interfaces:**
- Produces: `registerTab(tabId, hooks)`.
- Produces: `runTabEnter(tabId) -> void`.
- Produces: `runTabLeave(tabId) -> void`.
- Produces HTML nodes: `.nav-item[href="#dream-skin"]`, `#section-dream-skin`, and `#dream-skin-root`.

- [ ] **Step 1: Write failing navigation-shell tests**

Assert the nav item appears once under “系统扩展”, the section appears once, and the visible copy contains “主题皮肤” and not “应用到 Codex”.

- [ ] **Step 2: Write failing lifecycle-source tests**

Assert `app.ts` imports `runTabEnter`/`runTabLeave`, calls leave before changing `activeClient`, calls enter after the active section is displayed, and includes `dream-skin` in hash restoration. Assert Dream Skin implementation text is absent from `app.ts`.

- [ ] **Step 3: Run and verify failure**

```bash
node --test tests/unit/config-panel-tabs.test.mjs tests/unit/dream-skin-panel.test.mjs
```

Expected: FAIL because the tab shell and lifecycle bridge are absent.

- [ ] **Step 4: Reduce `navigation.ts` to lifecycle ownership**

Remove its unused duplicate DOM-switching implementation and keep:

```ts
type TabHooks = { onEnter?: () => void; onLeave?: () => void };
const tabHooks = new Map<string, TabHooks>();
export function registerTab(tabId: string, hooks: TabHooks): void {
  tabHooks.set(tabId, hooks);
}
export function runTabEnter(tabId: string): void {
  tabHooks.get(tabId)?.onEnter?.();
}
export function runTabLeave(tabId: string): void {
  tabHooks.get(tabId)?.onLeave?.();
}
```

- [ ] **Step 5: Wire lifecycle calls into existing `app.ts`**

Do not replace the current `window.switchTab`. Capture `previousTab`, call `runTabLeave(previousTab)` once when changing tabs, retain all existing special-tab behavior, then call `runTabEnter(tabId)` after `render()`.

- [ ] **Step 6: Add the Dream Skin shell**

Use one familiar palette icon in navigation and:

```html
<section id="section-dream-skin" class="tab-section" style="display: none;">
  <div id="dream-skin-root" class="dream-skin-root" aria-live="polite"></div>
</section>
```

`desktop/src/main.ts` imports `./app` and `./modules/dream-skin` so registration happens before user navigation.

- [ ] **Step 7: Run tests and commit**

```bash
node --test tests/unit/config-panel-tabs.test.mjs tests/unit/config-panel.test.mjs tests/unit/dream-skin-panel.test.mjs
npm run build:panel
git diff --check
git add desktop/src/core/navigation.ts desktop/src/main.ts desktop/src/app.ts desktop/index.html tests/unit/config-panel-tabs.test.mjs tests/unit/dream-skin-panel.test.mjs
git commit -m "feat: add dream skin panel shell"
```

Expected: existing panel tests and build PASS.

---

### Task 3: Implement Local Theme Library View

**Files:**
- Create: `desktop/src/modules/dream-skin.ts`
- Modify: `tests/unit/dream-skin-panel.test.mjs`

**Interfaces:**
- Consumes: Task 1 API/model functions and Task 2 `registerTab`.
- Produces: `renderDreamSkinPanel()`, registered through `registerTab("dream-skin", ...)`.
- Produces testable named exports:

```ts
createDreamSkinPanelState()
localThemeViewModel(state)
marketThemeViewModel(state)
```

Internal state includes:

```ts
{
  activeView: "local" | "market" | "editor",
  capabilities,
  library,
  market,
  editor,
  loading,
  error,
  busyAction,
  deleteCandidateId,
  loaded
}
```

- [ ] **Step 1: Add failing source and state tests**

Assert the module registers its tab, renders the three segmented views, uses `textContent`/the existing `escapeHtml` for external strings, and contains no `renderer-inject`, `Runtime.evaluate`, `WebSocket`, `launch`, or `/v1/dream-skin/runtime`.

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/unit/dream-skin-panel.test.mjs
```

Expected: FAIL because `dream-skin.ts` does not exist.

- [ ] **Step 3: Implement first-entry loading**

On first `onEnter`, fetch capabilities and local themes in parallel. Render:

```text
loading skeleton
error state with retry
empty stored-library state while still showing built-in
local theme grid
```

Subsequent entries reuse state unless an operation marked it stale.

- [ ] **Step 4: Implement local theme cards and details**

Each item shows preview image, name, engine label, source, version, selected state, and update badge. When `imageUrl` is empty, render a controlled color-swatch preview from the theme colors rather than requesting an image. Actions:

```text
查看
设为当前主题
编辑
复制
删除
导入主题
```

Hide delete for built-in themes. Disable delete for selected themes with a native `title` explaining that another theme must be selected first.

- [ ] **Step 5: Implement guarded actions**

Set `busyAction` to `<verb>:<id>` before each request and ignore a second invocation while non-empty. After select/duplicate/delete, reload the library and show an existing `showToast` success/error message. Delete opens an in-panel confirmation dialog and performs no request until confirmed.

- [ ] **Step 6: Add import interaction**

Use separate file inputs for one `.json` file and one supported image. Read JSON as text, image as `ArrayBuffer`, convert the image to Base64 only while constructing the HTTP request, and never display the full Base64. Conflict UI offers cancel, copy, and replace-local. Duplicating image-less `shrimp-default` opens save-as editing and requires a background image before submit; stored themes can still duplicate immediately.

- [ ] **Step 7: Initialize Lucide icons after render**

Install:

```bash
npm install --save-dev lucide
```

Import only the needed icons and call `createIcons` on the Dream Skin root after rendering. Do not add hand-authored SVG markup inside Dream Skin action buttons.

- [ ] **Step 8: Run tests and commit**

```bash
node --test tests/unit/dream-skin-panel.test.mjs
npm run build:panel
git diff --check
git add desktop/src/modules/dream-skin.ts tests/unit/dream-skin-panel.test.mjs package.json package-lock.json
git commit -m "feat: add dream skin local library panel"
```

Expected: build and panel tests PASS.

---

### Task 4: Implement The Market Browser

**Files:**
- Modify: `desktop/src/modules/dream-skin.ts`
- Modify: `desktop/src/modules/dream-skin-model.ts`
- Modify: `tests/unit/dream-skin-panel.test.mjs`

**Interfaces:**
- Consumes: `loadDreamSkinMarket`, install/update API functions, `filterMarketThemes`.
- Produces: market search, tag filter, refresh, install, update, detail, and source-link interactions.

- [ ] **Step 1: Add failing market-state tests**

Cover case-insensitive search, exact tag filter, cached warning, empty result, install busy state, update busy state, and failed refresh preserving the last rendered market.

- [ ] **Step 2: Add failing URL-boundary source tests**

Assert the module uses only `theme.previewUrl` for preview images and `theme.sourceUrl` for an explicit user-clicked source link. Assert no `theme.theme`, `theme.image`, `rawBaseUrl`, or submitted URL field exists.

- [ ] **Step 3: Run and verify failure**

```bash
node --test tests/unit/dream-skin-panel.test.mjs
```

Expected: FAIL on missing market behavior.

- [ ] **Step 4: Render market controls and states**

Use:

```text
search input
tag select/menu
refresh icon button with tooltip
updated-at text
online or cached status
theme grid
```

Market cards show preview, name, author, license, version, description, tags, installed/update state, and a source link with `target="_blank"` and `rel="noopener noreferrer"`.

- [ ] **Step 5: Implement explicit install/update only**

No market asset is downloaded on page entry except preview images requested by the browser. Install and update call their API only on click, lock the specific card action, refresh both market and local library on success, and keep the current view.

- [ ] **Step 6: Run tests and commit**

```bash
node --test tests/unit/dream-skin-panel.test.mjs
npm run build:panel
git diff --check
git add desktop/src/modules/dream-skin.ts desktop/src/modules/dream-skin-model.ts tests/unit/dream-skin-panel.test.mjs
git commit -m "feat: add dream skin market browser"
```

Expected: market panel tests and build PASS.

---

### Task 5: Implement Controlled Editing And Simulated Preview

**Files:**
- Modify: `desktop/src/modules/dream-skin.ts`
- Modify: `desktop/src/modules/dream-skin-model.ts`
- Modify: `tests/unit/dream-skin-panel.test.mjs`

**Interfaces:**
- Consumes: `DreamSkinDraft`, `previewStyleModel`, create/update APIs.
- Produces: editor modes `create`, `edit`, and `save-as`.
- Produces preview scenes `home` and `chat`.

- [ ] **Step 1: Add failing draft/preview tests**

Cover:

```text
theme detail to draft conversion
draft to controlled save payload
focus 0/0.5/1 to 0%/50%/100%
auto/light/dark appearance
safeArea left/right/center/none
taskMode ambient/banner/off
home/chat scene selection
market edit entering save-as mode
```

Assert no draft field named `css`, `javascript`, `html`, `json`, `url`, or `path`.

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/unit/dream-skin-panel.test.mjs
```

Expected: FAIL on missing editor and preview behavior.

- [ ] **Step 3: Render controlled editor fields**

Use text inputs for name/display copy; selects for engine, appearance, safe area, and task mode; native color inputs plus text inputs for colors; file input for image; range sliders for focus X/Y; and icon buttons for reset/save/save-as. Keep labels compact and associate every label with an input.

- [ ] **Step 4: Validate before submit**

Display server field issues next to matching controls. Perform only immediate client checks for required name, file size, supported extension, and color-input parseability; the server remains authoritative.

- [ ] **Step 5: Render the stable workspace preview**

Use fixed Shrimp markup:

```text
.dream-preview
  .dream-preview-sidebar
  .dream-preview-toolbar
  .dream-preview-main
  .dream-preview-home or .dream-preview-chat
  .dream-preview-composer
```

Apply controlled CSS custom properties from `previewStyleModel`. Use the selected local image URL or an object URL for a newly uploaded draft image. Revoke old object URLs on replacement and `onLeave`.

- [ ] **Step 6: Implement home/chat scene switch**

The home scene shows brand subtitle, tagline, project selector copy, status, and quote. The chat scene shows deterministic sample user/assistant messages and task background behavior. Neither scene reads gateway conversations or contacts Codex.

- [ ] **Step 7: Implement reset/save/save-as**

Reset restores the last loaded/saved draft. Save updates local themes; editing a market theme uses the backend copy behavior and displays that a local copy was created. Creating from blank remains disabled until a valid background image is selected. Save-as submits create with the controlled theme plus image upload through the backend, then selects the returned local detail in the editor.

- [ ] **Step 8: Run tests and commit**

```bash
node --test tests/unit/dream-skin-panel.test.mjs
npm run build:panel
git diff --check
git add desktop/src/modules/dream-skin.ts desktop/src/modules/dream-skin-model.ts tests/unit/dream-skin-panel.test.mjs
git commit -m "feat: add dream skin editor and preview"
```

Expected: editor/model tests and build PASS.

---

### Task 6: Add Responsive Styling And Regression Guards

**Files:**
- Modify: `desktop/src/styles/panel.css`
- Modify: `tests/unit/config-panel.test.mjs`
- Modify: `tests/unit/dream-skin-panel.test.mjs`

**Interfaces:**
- Produces: `.dream-skin-*` and `.dream-preview-*` styles scoped to the module.

- [ ] **Step 1: Add failing style-contract tests**

Assert:

```text
three-view segmented control
fixed action-button dimensions
theme grid using minmax
editor two-column layout
preview aspect-ratio/min-height constraints
760px single-column breakpoint
390px action wrapping
word-break/overflow-wrap for long names, authors, and tags
card radius no greater than 8px
```

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/unit/config-panel.test.mjs tests/unit/dream-skin-panel.test.mjs
```

Expected: FAIL because Dream Skin styles are absent.

- [ ] **Step 3: Implement restrained operational styling**

Reuse existing panel variables for surfaces, borders, text, status, buttons, and focus rings. Give the preview its theme-specific colors, but keep the surrounding management UI visually consistent with the gateway. Do not add gradient/orb decoration, oversized hero typography, nested cards, or marketing copy.

- [ ] **Step 4: Stabilize dimensions**

Set explicit min-height/aspect ratio for previews, fixed width/height for icon buttons, `minmax(0, 1fr)` grid tracks, and `min-width: 0` on textual children. Busy labels may change, but button boxes must not resize.

- [ ] **Step 5: Run automated frontend checks**

```bash
node --test tests/unit/config-panel-tabs.test.mjs tests/unit/config-panel.test.mjs tests/unit/dream-skin-panel.test.mjs
npm run build:panel
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 6: Run browser layout verification without Codex**

Start only the gateway on a non-default test port with a temporary `GATEWAY_CONFIG_FILE`:

```bash
GATEWAY_PORT=8791 GATEWAY_CONFIG_FILE="$(mktemp -d)/gateway.config.json" node server.js
```

Open `http://127.0.0.1:8791/#dream-skin` and capture/check 1440x900, 1024x768, 760x900, and 390x844. Verify local, market, editor-home, and editor-chat states; long text does not overflow; controls do not overlap; images render; and no runtime action appears. Stop only this test gateway process afterward.

- [ ] **Step 7: Commit styles and guards**

```bash
git add desktop/src/styles/panel.css tests/unit/config-panel.test.mjs tests/unit/dream-skin-panel.test.mjs
git commit -m "style: finish dream skin panel"
```

Expected: commit contains no generated `desktop/dist` files unless the repository's existing release policy explicitly tracks them.

---

### Task 7: Verify Plan 3 Product Boundaries

**Files:**
- Verify: `desktop/src/modules/dream-skin.ts`
- Verify: `desktop/src/modules/dream-skin-model.ts`
- Verify: `desktop/src/core/api.ts`
- Verify: `desktop/index.html`
- Verify: `desktop/src/styles/panel.css`

**Interfaces:**
- Produces: the complete first-phase Dream Skin management and simulation UI.

- [ ] **Step 1: Run the frontend and backend contract suites**

```bash
npm run test:dream-skin
npm run test:config-panel
npm run build:panel
```

Expected: all commands exit `0`.

- [ ] **Step 2: Scan for forbidden UI/runtime behavior**

```bash
rg -n '应用到 Codex|启动 Codex|注入|Runtime\.evaluate|renderer-inject|WebSocket|/v1/dream-skin/(apply|launch|inject|runtime|community|packages)' desktop/src desktop/index.html
rg -n 'innerHTML\\s*=.*(?:theme|author|description|tagline|quote)' desktop/src/modules/dream-skin.ts
rg -n 'https?://.*(?:preview|theme|image)' desktop/src/modules/dream-skin.ts desktop/src/core/api.ts
```

Expected: no runtime action, no unescaped external-text interpolation, and no direct remote theme asset URL.

- [ ] **Step 3: Confirm minimal coupling**

```bash
git diff --stat
git diff -- desktop/src/app.ts
git diff --check
```

Expected: `app.ts` changes are limited to lifecycle import/calls and hash tab registration; Dream Skin implementation remains in its own modules.
