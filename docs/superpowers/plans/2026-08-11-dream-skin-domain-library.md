# Dream Skin Domain And Local Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the validated Dream Skin domain model and a crash-recoverable local theme library without starting, connecting to, or modifying Codex Desktop.

**Architecture:** Keep validation pure under `domain/`, filesystem transactions under `library/`, and preview projection under `preview/`. All mutations run through one queue and install into a same-filesystem staging directory before atomic rename; the built-in `shrimp-default` theme remains a read-only packaged asset.

**Tech Stack:** Node.js 18+ ESM, `node:fs`, `node:path`, `node:crypto`, `node:test`, JSON.

## Global Constraints

- Work only in `/Users/pa/project/AI/local-ai-gateway/.worktrees/dream-skin` on branch `codex/dream-skin`.
- Do not start, stop, restart, inspect, connect to, or inject Codex Desktop.
- Do not add HTTP routes, Web UI, ZIP support, Safe CSS, community publishing, arbitrary JavaScript, or remote theme resources in this plan.
- Dream Skin data follows `resolveProjectPath(process.env.GATEWAY_CONFIG_FILE || "gateway.config.json")`.
- The built-in theme ID is `shrimp-default`; both `shrimp-default` and `builtin` are reserved for local creation, import, and market installation.
- A stored theme directory contains exactly `theme.json` and one supported background image.
- The packaged `shrimp-default` theme is the only image-optional theme; stored copies still require an image.
- Supported image formats are PNG, JPEG, WebP, GIF, and BMP; SVG is rejected.
- Image bytes, not the extension or submitted MIME type, determine the actual format.
- Theme image size is limited to 16 MiB and theme JSON size is limited to 256 KiB.
- Theme data never contains arbitrary CSS, JavaScript, remote URLs, or filesystem paths.
- All writes use `.staging`, same-filesystem rename, rollback, and the process-local mutation queue.
- Preserve unrelated uncommitted work already present in the worktree.

---

### Task 1: Lock Path, Error, And Theme ID Contracts

**Files:**
- Modify: `lib/config/project-paths.mjs`
- Modify: `lib/dream-skin/paths.mjs`
- Create: `lib/dream-skin/domain/errors.mjs`
- Create: `lib/dream-skin/domain/theme-id.mjs`
- Modify: `tests/unit/dream-skin-paths.test.mjs`
- Create: `tests/unit/dream-skin-domain.test.mjs`

**Interfaces:**
- Produces: `resolveProjectPath(targetPath, projectRoot?) -> string`.
- Produces: `resolveDreamSkinPaths({ configFile?, projectRoot? }) -> DreamSkinPaths`.
- Produces: `DreamSkinError extends Error` with `code`, `details`, and optional `cause`.
- Produces: `assertThemeId(value, { allowBuiltin? }?) -> string`.
- Produces: `slugifyThemeId(name) -> string`.
- Produces: `allocateThemeId(name, exists) -> string`, where `exists(id) -> boolean`.

`DreamSkinPaths` is fixed as:

```js
{
  configPath,
  configDir,
  rootDir,
  themesDir,
  marketDir,
  previewsDir,
  stagingDir,
  statePath,
  marketIndexPath,
  installedPath
}
```

- [ ] **Step 1: Extend the failing path tests**

Add assertions that a relative config resolves under the supplied project root and returns every path above:

```js
assert.deepEqual(resolveDreamSkinPaths({
  configFile: "config/gateway.config.json",
  projectRoot: "/workspace/shrimp",
}), {
  configPath: "/workspace/shrimp/config/gateway.config.json",
  configDir: "/workspace/shrimp/config",
  rootDir: "/workspace/shrimp/config/dream-skin",
  themesDir: "/workspace/shrimp/config/dream-skin/themes",
  marketDir: "/workspace/shrimp/config/dream-skin/market",
  previewsDir: "/workspace/shrimp/config/dream-skin/market/previews",
  stagingDir: "/workspace/shrimp/config/dream-skin/.staging",
  statePath: "/workspace/shrimp/config/dream-skin/state.json",
  marketIndexPath: "/workspace/shrimp/config/dream-skin/market/index.json",
  installedPath: "/workspace/shrimp/config/dream-skin/market/installed.json",
});
```

- [ ] **Step 2: Add failing ID and error tests**

Cover valid IDs, uppercase, slash, backslash, `..`, leading punctuation, more than 64 UTF-8 bytes, and reserved IDs:

```js
assert.equal(assertThemeId("aurora-night"), "aurora-night");
assert.throws(() => assertThemeId("../escape"), { code: "invalid_theme_id" });
assert.throws(() => assertThemeId("shrimp-default"), { code: "invalid_theme_id" });
assert.equal(assertThemeId("shrimp-default", { allowBuiltin: true }), "shrimp-default");
assert.equal(allocateThemeId("Aurora Night", (id) => id === "aurora-night"), "aurora-night-2");
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```bash
node --test tests/unit/dream-skin-paths.test.mjs tests/unit/dream-skin-domain.test.mjs
```

Expected: FAIL because the expanded path object and domain modules do not exist.

- [ ] **Step 4: Implement the exact contracts**

Use this error shape:

```js
export class DreamSkinError extends Error {
  constructor(code, message, { details = [], cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "DreamSkinError";
    this.code = code;
    this.details = details;
  }
}
```

Use `/^[a-z0-9][a-z0-9._-]*$/`, UTF-8 byte length `1..64`, and a `Set(["shrimp-default", "builtin"])`. `allocateThemeId` tries the slug and then `-2`, `-3`, continuing until `exists` returns false.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node --test tests/unit/dream-skin-paths.test.mjs tests/unit/dream-skin-domain.test.mjs
git diff --check
git add lib/config/project-paths.mjs lib/dream-skin/paths.mjs lib/dream-skin/domain/errors.mjs lib/dream-skin/domain/theme-id.mjs tests/unit/dream-skin-paths.test.mjs tests/unit/dream-skin-domain.test.mjs
git commit -m "feat: define dream skin paths and ids"
```

Expected: all focused tests PASS and the commit contains no runtime code.

---

### Task 2: Validate And Normalize Theme JSON

**Files:**
- Create: `lib/dream-skin/domain/theme-schema.mjs`
- Modify: `tests/unit/dream-skin-domain.test.mjs`

**Interfaces:**
- Consumes: `DreamSkinError`, `assertThemeId`.
- Produces: `SUPPORTED_STYLE_PRESETS: ReadonlySet<string>`.
- Produces: `normalizeTheme(input, { allowBuiltin? }?) -> NormalizedTheme`.
- Produces: `validateTheme(input, options?) -> { ok, value?, issues }`.
- Produces: `assertValidTheme(input, options?) -> NormalizedTheme`.

`NormalizedTheme` uses only these keys:

```js
{
  schemaVersion: 1,
  id,
  name,
  stylePreset,
  brandSubtitle,
  tagline,
  projectPrefix,
  projectLabel,
  statusText,
  quote,
  image,
  appearance,
  art: { focusX, focusY, safeArea, taskMode },
  colors: {
    background, panel, panelAlt, accent, accentAlt,
    secondary, highlight, text, muted, line
  }
}
```

- [ ] **Step 1: Add failing schema tests**

Add table-driven cases for:

```js
const valid = {
  schemaVersion: 1,
  id: "aurora-night",
  name: "Aurora Night",
  style_preset: "midnight-aurora",
  backgroundImage: "background.webp",
  appearance: "auto",
  art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "ambient" },
  colors: {
    background: "#111318",
    panel: "#181b22",
    panelAlt: "#20242d",
    accent: "#8298a3",
    accentAlt: "#a8c0ca",
    secondary: "#6f8791",
    highlight: "#bfd4dc",
    text: "#edf2f4",
    muted: "#a4afb5",
    line: "rgba(130, 152, 163, 0.28)",
  },
};
```

Assert alias normalization, default text fields, exact color-key rejection, unsupported presets, invalid enums, out-of-range focus values, `url(...)`, `var(...)`, semicolons, newlines, image URLs, image path separators, and unknown top-level executable fields such as `css` or `javascript`.

- [ ] **Step 2: Run the domain test and verify failure**

Run:

```bash
node --test tests/unit/dream-skin-domain.test.mjs
```

Expected: FAIL because `theme-schema.mjs` does not exist.

- [ ] **Step 3: Implement normalization before validation**

Set these defaults exactly:

```js
const DEFAULT_TEXT = {
  brandSubtitle: "CODEX DREAM SKIN",
  tagline: "Make something wonderful.",
  projectPrefix: "选择项目 · ",
  projectLabel: "选择项目",
  statusText: "THEME READY",
  quote: "FOCUS",
};
const DEFAULT_ART = {
  focusX: 0.5,
  focusY: 0.5,
  safeArea: "auto",
  taskMode: "ambient",
};
```

Accept `backgroundImage` as `image` and `style_preset` as `stylePreset`, but emit only camelCase. Permit `stylePreset` values `""`, `codex-snow`, `glass-vision`, `midnight-aurora`, `amber-dusk`, `forest-mist`, `cyber-neon`, and `sakura-dawn`.

- [ ] **Step 4: Implement bounded field and color validation**

Use `Array<{ field, code, message }>` issues. Enforce:

```text
name: 1..100 characters
brandSubtitle, statusText, quote: 0..100 characters
tagline, projectPrefix, projectLabel: 0..200 characters
image: one basename, no slash, backslash, URL scheme, query, fragment, or NUL
appearance: auto | light | dark
safeArea: auto | left | right | center | none
taskMode: ambient | banner | off
focusX/focusY: finite number from 0 through 1
```

Colors accept `#RGB`, `#RRGGBB`, `#RRGGBBAA`, `rgb(...)`, and `rgba(...)` with numeric channel/range validation. Reject escape characters, semicolons, newlines, `url`, `var`, and `expression`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node --test tests/unit/dream-skin-domain.test.mjs
git diff --check
git add lib/dream-skin/domain/theme-schema.mjs tests/unit/dream-skin-domain.test.mjs
git commit -m "feat: validate dream skin themes"
```

Expected: schema tests PASS with stable issue codes.

---

### Task 3: Detect Real Image Formats

**Files:**
- Create: `lib/dream-skin/domain/image-format.mjs`
- Modify: `tests/unit/dream-skin-domain.test.mjs`

**Interfaces:**
- Produces: `MAX_THEME_IMAGE_BYTES = 16 * 1024 * 1024`.
- Produces: `inspectImage(bytes, { expectedName? }?) -> { extension, mime, size }`.
- Produces: `assertImageNameMatchesFormat(name, format) -> string`.
- Produces: `imageDataUri(bytes, format) -> string`.

- [ ] **Step 1: Add failing magic-byte tests**

Create minimal byte fixtures for PNG, JPEG, WebP, GIF87a/GIF89a, and BMP. Assert:

```js
assert.deepEqual(inspectImage(pngBytes, { expectedName: "background.png" }), {
  extension: "png",
  mime: "image/png",
  size: pngBytes.length,
});
assert.throws(
  () => inspectImage(pngBytes, { expectedName: "background.jpg" }),
  { code: "invalid_image" },
);
```

Also reject empty bytes, SVG/XML/HTML prefixes, unknown bytes, oversize bytes, path-like names, and unsupported extensions.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node --test tests/unit/dream-skin-domain.test.mjs
```

Expected: FAIL on the missing image module.

- [ ] **Step 3: Implement deterministic signature detection**

Recognize:

```text
PNG: 89 50 4E 47 0D 0A 1A 0A
JPEG: FF D8 FF
WebP: RIFF....WEBP
GIF: GIF87a or GIF89a
BMP: BM
```

Normalize `.jpeg` storage to `.jpg`. `imageDataUri` must use the MIME returned by `inspectImage`; it must not infer MIME from a submitted string.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node --test tests/unit/dream-skin-domain.test.mjs
git diff --check
git add lib/dream-skin/domain/image-format.mjs tests/unit/dream-skin-domain.test.mjs
git commit -m "feat: validate dream skin images"
```

Expected: all image-format tests PASS.

---

### Task 4: Build The Mutation Queue And Atomic Theme Transaction

**Files:**
- Create: `lib/dream-skin/library/mutation-queue.mjs`
- Create: `lib/dream-skin/library/filesystem.mjs`
- Create: `tests/unit/dream-skin-library.test.mjs`

**Interfaces:**
- Consumes: `DreamSkinPaths`, `DreamSkinError`.
- Produces: `createMutationQueue() -> { run(operation), idle() }`.
- Produces: `ensureDreamSkinDirectories(paths) -> Promise<void>`.
- Produces: `recoverThemeTransactions(paths, { logger? }?) -> Promise<{ warnings }>` .
- Produces: `commitThemeDirectory({ paths, themeId, writeStaging, replace, onCommit? }) -> Promise<void>`.
- Produces: `removeThemeDirectory({ paths, themeId, onCommit? }) -> Promise<void>`.

`writeStaging(stagingThemeDir) -> Promise<void>` writes and validates the complete staged theme. `onCommit() -> Promise<void>` runs while a backup is still available; if it rejects, the filesystem mutation is rolled back.

- [ ] **Step 1: Write failing queue and transaction tests**

Use `mkdtemp` and dependency-injected callbacks. Cover:

```js
const queue = createMutationQueue();
const events = [];
await Promise.all([
  queue.run(async () => { events.push("a:start"); await delay(10); events.push("a:end"); }),
  queue.run(async () => { events.push("b:start"); events.push("b:end"); }),
]);
assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
```

Also cover create, replace with backup, `onCommit` failure restoring the previous directory, stale staging cleanup, backup restoration when the formal directory is missing, and symlink rejection.

- [ ] **Step 2: Run the library test and verify failure**

Run:

```bash
node --test tests/unit/dream-skin-library.test.mjs
```

Expected: FAIL because queue and filesystem modules do not exist.

- [ ] **Step 3: Implement queue serialization**

`run(operation)` must continue processing after a rejected operation:

```js
let tail = Promise.resolve();
function run(operation) {
  const result = tail.then(operation, operation);
  tail = result.catch(() => {});
  return result;
}
```

- [ ] **Step 4: Implement staging, fsync, rename, and rollback**

Use operation directories named `<theme-id>-<randomUUID()>`. Before rename:

1. `lstat` every existing theme/staging/backup path and reject symbolic links.
2. Open and `sync()` `theme.json` and the image.
3. `sync()` the staged theme directory.
4. Rename the existing theme to `<theme-id>.backup-<operation-id>` when replacing.
5. Rename staged theme to the final path.
6. Await `onCommit`.
7. Remove backup only after `onCommit` succeeds.

On failure after step 4, remove the failed final directory and rename the backup into place. Wrap filesystem failures as `storage_error`.

- [ ] **Step 5: Implement startup recovery**

Remove staging entries older than 24 hours. For backup directories:

- restore the backup when the formal theme directory is absent;
- remove the backup when the formal directory is present;
- report one warning object per action without exposing an absolute path.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
node --test tests/unit/dream-skin-library.test.mjs
git diff --check
git add lib/dream-skin/library/mutation-queue.mjs lib/dream-skin/library/filesystem.mjs tests/unit/dream-skin-library.test.mjs
git commit -m "feat: add atomic dream skin storage"
```

Expected: transaction and recovery tests PASS.

---

### Task 5: Implement Active Theme State And Local CRUD

**Files:**
- Create: `lib/dream-skin/library/active-theme.mjs`
- Create: `lib/dream-skin/library/store.mjs`
- Modify: `lib/dream-skin/themes/default.json`
- Modify: `tests/unit/dream-skin-library.test.mjs`

**Interfaces:**
- Consumes: all Tasks 1-4 interfaces.
- Produces: `createActiveThemeStore({ statePath, clock? })`.
- Produces: `createThemeLibrary({ paths, builtinThemePath, mutationQueue?, clock?, idFactory?, logger? })`.

The active store exposes:

```js
{
  load(validThemeIds) -> Promise<{ selectedThemeId, selectedAt, warnings }>,
  select(themeId) -> Promise<{ selectedThemeId, selectedAt }>
}
```

The library exposes:

```js
{
  initialize() -> Promise<{ warnings }>,
  listThemes() -> Promise<{ selectedThemeId, themes, invalidEntries, warnings }>,
  getTheme(id) -> Promise<{ theme, kind, imageBytes: Buffer | null, imageFormat: object | null }>,
  createTheme({ theme, imageBytes }) -> Promise<ThemeSummary>,
  updateTheme(id, { theme, imageBytes? }) -> Promise<ThemeSummary>,
  duplicateTheme(id, { name, requestedId?, imageBytes? } = {}) -> Promise<ThemeSummary>,
  putStoredTheme({ theme, imageBytes, replace?, onCommit? }) -> Promise<ThemeSummary>,
  deleteTheme(id, { onCommit? } = {}) -> Promise<void>,
  selectTheme(id) -> Promise<{ selectedThemeId, themes, invalidEntries, warnings }>
}
```

- [ ] **Step 1: Add failing built-in and state tests**

Assert that initialization returns `shrimp-default`, repairs missing/corrupt selection state atomically, and never writes the built-in theme into `themes/`. The packaged built-in may use `image: ""`; it returns `imageBytes: null`, `imageFormat: null`, and `imageUrl: ""`.

The packaged default must be a complete normalized theme using:

```json
{
  "schemaVersion": 1,
  "id": "shrimp-default",
  "name": "Shrimp Default",
  "stylePreset": "",
  "image": "",
  "appearance": "auto"
}
```

with all normalized text, art, and color fields present.

- [ ] **Step 2: Add failing CRUD tests**

Cover empty library, create, duplicate ID allocation, edit, image replacement, select, delete, built-in read-only, selected-theme deletion, corrupt JSON isolation, extra files, multiple images, path escape, and symlink entries. Duplicating a stored theme reuses its validated image bytes. Duplicating image-less `shrimp-default` without new `imageBytes` throws `invalid_image`; supplying valid `imageBytes` succeeds.

Assert summaries never contain `themePath`, `imagePath`, `configDir`, or another absolute path:

```js
assert.deepEqual(summary, {
  id: "aurora-night",
  name: "Aurora Night",
  kind: "stored",
  builtin: false,
  selected: false,
  stylePreset: "midnight-aurora",
  appearance: "auto",
  imageUrl: "/v1/dream-skin/themes/aurora-night/image",
});
```

- [ ] **Step 3: Run the library tests and verify failure**

Run:

```bash
node --test tests/unit/dream-skin-library.test.mjs
```

Expected: FAIL on missing active store and library methods.

- [ ] **Step 4: Implement state writes**

Write:

```json
{
  "schemaVersion": 1,
  "selectedThemeId": "shrimp-default",
  "selectedAt": "2026-08-11T00:00:00.000Z"
}
```

through a sibling temp file, file `sync()`, rename, and parent directory `sync()`. When the selected theme is unavailable or invalid, select `shrimp-default`, persist the repair, and return warning code `selected_theme_repaired`.

- [ ] **Step 5: Implement strict directory reads**

For each stored theme:

1. Reject a symbolic-link directory.
2. Require exactly `theme.json` and one regular image.
3. Reject `theme.json` over 256 KiB.
4. Parse and validate the theme.
5. Require directory name, `theme.id`, and normalized image filename to agree.
6. Inspect image bytes.
7. Hide invalid entries from `themes` and increment `invalidEntries`.

- [ ] **Step 6: Implement CRUD through `putStoredTheme`**

`createTheme`, `updateTheme`, and `duplicateTheme` normalize their inputs and delegate to `putStoredTheme`. `duplicateTheme` reuses the source image when present and requires replacement image bytes for image-less built-ins. `deleteTheme` rejects `shrimp-default`, rejects the current selection with `theme_in_use`, rejects symbolic links, and calls `onCommit` before permanently discarding the backup.

`initialize`, `createTheme`, `updateTheme`, `duplicateTheme`, `putStoredTheme`, `deleteTheme`, and `selectTheme` all enter the same `mutationQueue.run(...)`; internal helpers invoked inside that operation do not enqueue a second time.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
node --test tests/unit/dream-skin-paths.test.mjs tests/unit/dream-skin-domain.test.mjs tests/unit/dream-skin-library.test.mjs
git diff --check
git add lib/dream-skin/library/active-theme.mjs lib/dream-skin/library/store.mjs lib/dream-skin/themes/default.json tests/unit/dream-skin-library.test.mjs
git commit -m "feat: add dream skin local library"
```

Expected: all domain and library tests PASS.

---

### Task 6: Add Local Import And Stable Preview Projection

**Files:**
- Create: `lib/dream-skin/library/importer.mjs`
- Create: `lib/dream-skin/preview/model.mjs`
- Create: `tests/unit/dream-skin-importer.test.mjs`
- Create: `tests/unit/dream-skin-preview.test.mjs`

**Interfaces:**
- Consumes: `assertValidTheme`, `inspectImage`, `allocateThemeId`, `library.putStoredTheme`.
- Produces: `createThemeImporter({ library, canReplace })`.
- Produces: `buildPreviewModel(theme, { scene? }?) -> PreviewModel`.

Importer interface:

```js
{
  importTheme({ theme, imageBytes, conflict = "error", requestedId? })
    -> Promise<ThemeSummary>
}
```

Allowed conflict modes are `error`, `copy`, and `replace-local`. `canReplace(id) -> Promise<boolean>` is required and `replace-local` may replace only a stored theme that the callback identifies as local; Plan 2 supplies the source-aware callback when composing the importer.

- [ ] **Step 1: Add failing importer tests**

Cover valid import, Base64-independent byte input, absent image, image-name mismatch, remote image URL, CSS/JavaScript keys, duplicate ID with each conflict mode, reserved ID, and replacement refusal when `canReplace(id)` is false.

Construct with:

```js
const importer = createThemeImporter({
  library,
  canReplace: async (id) => id === "local-theme",
});
```

- [ ] **Step 2: Add failing preview-model tests**

Assert `buildPreviewModel(theme, { scene: "home" })` and `scene: "chat"` return only controlled values:

```js
{
  scene: "home",
  appearance: "dark",
  imageUrl: "/v1/dream-skin/themes/aurora-night/image",
  imagePosition: "50% 50%",
  safeArea: "right",
  taskMode: "ambient",
  colors: { /* exact normalized color keys */ },
  text: { /* exact normalized display text keys */ }
}
```

No HTML, CSS selector, script, renderer source, or local path is emitted.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
node --test tests/unit/dream-skin-importer.test.mjs tests/unit/dream-skin-preview.test.mjs
```

Expected: FAIL because importer and preview modules do not exist.

- [ ] **Step 4: Implement importer conflict behavior**

`error` throws `theme_already_exists`. `copy` allocates a new ID and rewrites `theme.id`. `replace-local` requires `canReplace(id) === true` and invokes `putStoredTheme({ replace: true })`. The importer accepts bytes, never Base64 strings, URLs, paths, ZIPs, CSS, or scripts.

- [ ] **Step 5: Implement preview projection**

Resolve `appearance: "auto"` to `"dark"` only for deterministic server-side projection; the Web panel may override it from its own light/dark context. Convert focus to bounded percentages and retain only normalized text/color/art fields.

- [ ] **Step 6: Run the full Plan 1 suite and commit**

Run:

```bash
node --test tests/unit/dream-skin-paths.test.mjs tests/unit/dream-skin-domain.test.mjs tests/unit/dream-skin-library.test.mjs tests/unit/dream-skin-importer.test.mjs tests/unit/dream-skin-preview.test.mjs
git diff --check
git add lib/dream-skin/library/importer.mjs lib/dream-skin/preview/model.mjs tests/unit/dream-skin-importer.test.mjs tests/unit/dream-skin-preview.test.mjs
git commit -m "feat: add dream skin import and preview model"
```

Expected: all Plan 1 tests PASS; no file imports `runtime/`, `child_process`, `ws`, `http`, or `https`.

---

### Task 7: Verify Plan 1 Boundaries

**Files:**
- Verify: `lib/dream-skin/domain/`
- Verify: `lib/dream-skin/library/`
- Verify: `lib/dream-skin/preview/`
- Verify: `lib/dream-skin/paths.mjs`
- Verify: `tests/unit/dream-skin-*.test.mjs`

**Interfaces:**
- Produces: the stable local-library API consumed by the market/application plan.

- [ ] **Step 1: Run syntax and focused tests**

```bash
node --check lib/dream-skin/domain/errors.mjs
node --check lib/dream-skin/domain/theme-id.mjs
node --check lib/dream-skin/domain/theme-schema.mjs
node --check lib/dream-skin/domain/image-format.mjs
node --check lib/dream-skin/library/store.mjs
node --test tests/unit/dream-skin-paths.test.mjs tests/unit/dream-skin-domain.test.mjs tests/unit/dream-skin-library.test.mjs tests/unit/dream-skin-importer.test.mjs tests/unit/dream-skin-preview.test.mjs
```

Expected: all commands exit `0`.

- [ ] **Step 2: Audit prohibited dependencies and path leakage**

Run:

```bash
rg -n 'child_process|from "ws"|node:http|node:https|Runtime\.evaluate|open -a|Codex\.app' lib/dream-skin/domain lib/dream-skin/library lib/dream-skin/preview lib/dream-skin/paths.mjs
rg -n 'themePath|imagePath|configDir|rootDir' lib/dream-skin/library/store.mjs lib/dream-skin/preview/model.mjs
```

Expected: first command has no matches; second command shows internal path use only, never response-object properties.

- [ ] **Step 3: Inspect the diff and commit any verification-only correction**

```bash
git diff --check
git status --short
```

Expected: no generated files, no Codex process activity, and no unrelated files staged.
