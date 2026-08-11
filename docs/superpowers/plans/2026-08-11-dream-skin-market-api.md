# Dream Skin Market And HTTP API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only theme market, verified install/update flows, an application service, and a local-authenticated HTTP API without exposing any Codex runtime operation.

**Architecture:** Normalize untrusted market data at the boundary, fetch bytes through an injected bounded request adapter, and install only assets referenced by the current validated index. The application service is the sole orchestration API for HTTP routes; `server.js` contributes one authenticated prefix dispatch and never imports Dream Skin runtime modules.

**Tech Stack:** Node.js 18+ ESM, `node:http`, `node:https`, `node:crypto`, existing proxy-agent helpers, `node:test`, JSON HTTP.

## Global Constraints

- Complete `2026-08-11-dream-skin-domain-library.md` first; use its exact exported interfaces.
- Work only in `/Users/pa/project/AI/local-ai-gateway/.worktrees/dream-skin` on branch `codex/dream-skin`.
- Do not start, stop, restart, inspect, connect to, or inject Codex Desktop.
- The default market index is `https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-Themes/main/index.json`.
- The default raw asset base is `https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-Themes/main/`.
- Market URLs are constructor dependencies, not request parameters and not scattered constants.
- Market index size is at most 1 MiB, contains at most 200 themes, and has no duplicate IDs.
- Theme JSON is at most 256 KiB; theme and preview images are at most 16 MiB.
- Install/update verifies SHA-256 before parsing or committing an asset.
- Client requests may submit only theme IDs and controlled edit/import data, never download URLs, local paths, hashes, CSS, JavaScript, or ZIP content.
- Market previews are served through Shrimp validation/cache routes; the Web panel never receives the remote preview URL.
- Every Dream Skin HTTP route uses existing `checkLocalAuth`.
- Runtime, package, community, launch, inject, and apply paths return 404.
- API responses never expose local absolute paths.
- Preserve unrelated uncommitted work already present in the worktree.

---

### Task 1: Validate And Normalize The Market Index

**Files:**
- Create: `lib/dream-skin/market/schema.mjs`
- Create: `tests/unit/dream-skin-market-schema.test.mjs`

**Interfaces:**
- Consumes: `DreamSkinError`, `assertThemeId`.
- Produces: `MAX_MARKET_INDEX_BYTES = 1024 * 1024`.
- Produces: `MAX_MARKET_THEMES = 200`.
- Produces: `assertMarketIndex(input) -> NormalizedMarketIndex`.
- Produces: `assertMarketAssetPath(value, field) -> string`.
- Produces: `joinMarketAssetUrl(rawBaseUrl, relativePath) -> URL`.

`NormalizedMarketIndex` is:

```js
{
  schemaVersion: 1,
  updatedAt: "2026-08-11T00:00:00Z",
  themes: [{
    id, name, version, author, description, license, sourceUrl,
    tags, theme, image, preview, themeSha256, imageSha256
  }]
}
```

- [ ] **Step 1: Write failing canonical and alias tests**

Verify camelCase plus `schema_version`, `updated_at`, `source_url`, `theme_sha256`, and `image_sha256` normalize to the exact shape above.

```js
const index = assertMarketIndex({
  schema_version: 1,
  updated_at: "2026-08-11T00:00:00Z",
  themes: [{
    id: "aurora-night",
    name: "Aurora Night",
    version: "1.0.0",
    author: "Example",
    description: "Dark theme",
    license: "MIT",
    source_url: "https://example.com/theme",
    tags: ["dark"],
    theme: "themes/aurora-night/theme.json",
    image: "themes/aurora-night/background.webp",
    preview: "themes/aurora-night/preview.webp",
    theme_sha256: "a".repeat(64),
    image_sha256: "b".repeat(64),
  }],
});
assert.equal(index.themes[0].themeSha256, "a".repeat(64));
```

- [ ] **Step 2: Add failing malicious-index tests**

Reject duplicate IDs, missing license, more than 12 tags, non-HTTP source URL, unknown URL protocols, full URLs in asset fields, absolute paths, `..`, backslashes, query strings, fragments, NUL, invalid hashes, overlong fields, more than 200 themes, and reserved IDs.

- [ ] **Step 3: Run the focused test and verify failure**

```bash
node --test tests/unit/dream-skin-market-schema.test.mjs
```

Expected: FAIL because `market/schema.mjs` does not exist.

- [ ] **Step 4: Implement strict normalization**

Use URL parsing for `sourceUrl`, require `http:` or `https:`, and cap:

```text
name, author, license, version: 100 characters
description: 1000 characters
sourceUrl and each relative asset path: 2048 characters
tag: 40 characters
```

`joinMarketAssetUrl` must resolve only after `assertMarketAssetPath` succeeds and must confirm the result retains the configured base URL origin and path prefix.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/unit/dream-skin-market-schema.test.mjs
git diff --check
git add lib/dream-skin/market/schema.mjs tests/unit/dream-skin-market-schema.test.mjs
git commit -m "feat: validate dream skin market index"
```

Expected: all market-schema tests PASS.

---

### Task 2: Implement The Bounded Market Client

**Files:**
- Create: `lib/dream-skin/market/client.mjs`
- Create: `tests/unit/dream-skin-market-client.test.mjs`

**Interfaces:**
- Consumes: `joinMarketAssetUrl`.
- Produces: `createNodeBinaryRequest({ agent? } = {})`.
- Produces: `createMarketClient({ requestBinary, indexUrl, rawBaseUrl, timeoutMs = 10000 })`.

Request adapter signature:

```js
requestBinary(url, {
  timeoutMs,
  maxBytes,
  allowedRedirect
}) -> Promise<{
  bytes: Buffer,
  finalUrl: string,
  status: number,
  headers: Record<string, string>
}>
```

Market client interface:

```js
{
  fetchIndexBytes() -> Promise<Buffer>,
  fetchThemeBytes(entry) -> Promise<Buffer>,
  fetchImageBytes(entry) -> Promise<Buffer>,
  fetchPreviewBytes(entry) -> Promise<Buffer>
}
```

- [ ] **Step 1: Write failing fake-request tests**

Capture URL/options passed to the adapter and assert exact limits:

```js
assert.equal(calls[0].url, indexUrl);
assert.equal(calls[0].options.maxBytes, 1024 * 1024);
assert.equal(themeCall.options.maxBytes, 256 * 1024);
assert.equal(imageCall.options.maxBytes, 16 * 1024 * 1024);
```

Reject non-2xx status, timeout, truncated/oversize stream, redirect outside provider policy, malformed final URL, and asset requests not derived from an index entry.

- [ ] **Step 2: Run the test and verify failure**

```bash
node --test tests/unit/dream-skin-market-client.test.mjs
```

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement provider-bound URL policy**

Parse `indexUrl` and `rawBaseUrl` once in the constructor. `allowedRedirect(from, to)` permits HTTP-to-HTTPS upgrade or same-protocol redirects only when the destination origin and normalized path remain under the configured provider base.

- [ ] **Step 4: Implement streaming byte limits**

`createNodeBinaryRequest` chooses `http` or `https`, supports an injected proxy agent, sets connection and total timeout, accumulates chunks only up to `maxBytes`, destroys the request on overflow, follows at most 3 allowed redirects, and returns `market_unavailable` for transport failures.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/unit/dream-skin-market-client.test.mjs
git diff --check
git add lib/dream-skin/market/client.mjs tests/unit/dream-skin-market-client.test.mjs
git commit -m "feat: add bounded dream skin market client"
```

Expected: tests PASS without making a real network request.

---

### Task 3: Add Validated Market Cache And Offline Fallback

**Files:**
- Create: `lib/dream-skin/market/cache.mjs`
- Create: `tests/unit/dream-skin-market-cache.test.mjs`

**Interfaces:**
- Consumes: `assertMarketIndex`, `marketClient.fetchIndexBytes`, `paths.marketIndexPath`.
- Produces: `createMarketCache({ indexPath, client, clock?, logger? })`.

```js
{
  load({ forceRefresh = false } = {}) -> Promise<{
    index: NormalizedMarketIndex,
    cached: boolean,
    warning: null | { code, message }
  }>,
  readValidated() -> Promise<NormalizedMarketIndex>,
  getCurrent() -> NormalizedMarketIndex | null
}
```

- [ ] **Step 1: Write failing online/cache tests**

Cover remote success and atomic cache write, remote failure with valid cache, forced refresh still falling back to valid cache, invalid remote preserving old cache, corrupt cache plus remote failure, and no partial/empty success.

- [ ] **Step 2: Run the test and verify failure**

```bash
node --test tests/unit/dream-skin-market-cache.test.mjs
```

Expected: FAIL because the cache module does not exist.

- [ ] **Step 3: Implement parse-before-write**

Check byte length, decode UTF-8, parse JSON, and call `assertMarketIndex` before writing. Write a sibling temp file, `sync()` it, rename it, and sync the parent directory. Never replace a valid cache with invalid or empty content.

- [ ] **Step 4: Implement fallback semantics**

Remote failures return valid cache with:

```js
{
  cached: true,
  warning: {
    code: "market_cache_fallback",
    message: "在线主题市场暂不可用，当前显示本地缓存。",
  }
}
```

If neither source validates, throw `market_unavailable`. Keep the last validated index in memory for installers and preview routes.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/unit/dream-skin-market-cache.test.mjs
git diff --check
git add lib/dream-skin/market/cache.mjs tests/unit/dream-skin-market-cache.test.mjs
git commit -m "feat: cache dream skin market index"
```

Expected: cache tests PASS.

---

### Task 4: Track Installed Versions Transactionally

**Files:**
- Create: `lib/dream-skin/market/install-records.mjs`
- Create: `tests/unit/dream-skin-install-records.test.mjs`

**Interfaces:**
- Produces: `createInstallRecords({ installedPath, clock? })`.

```js
{
  load() -> Promise<{ schemaVersion: 1, themes: Record<string, InstallRecord> }>,
  get(id) -> Promise<InstallRecord | null>,
  set(id, { version, source: "market" }) -> Promise<InstallRecord>,
  remove(id) -> Promise<void>,
  snapshot() -> Promise<object>,
  restore(snapshot) -> Promise<void>
}
```

`InstallRecord` contains `version`, `source`, `installedAt`, and `updatedAt`.

- [ ] **Step 1: Write failing record tests**

Assert first install preserves identical `installedAt`/`updatedAt`, update preserves `installedAt`, delete removes one key, malformed records are rejected rather than silently accepted, and snapshot/restore round-trips exact data.

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/unit/dream-skin-install-records.test.mjs
```

Expected: FAIL because the record store does not exist.

- [ ] **Step 3: Implement atomic JSON persistence**

Validate schema version, theme IDs, source value, version length, and ISO date strings. Use temp-file, file `sync()`, rename, and directory `sync()`. Wrap failures as `storage_error`.

- [ ] **Step 4: Run tests and commit**

```bash
node --test tests/unit/dream-skin-install-records.test.mjs
git diff --check
git add lib/dream-skin/market/install-records.mjs tests/unit/dream-skin-install-records.test.mjs
git commit -m "feat: track installed dream skin themes"
```

Expected: record tests PASS.

---

### Task 5: Install, Update, Delete, And Cache Previews

**Files:**
- Create: `lib/dream-skin/market/installer.mjs`
- Create: `tests/unit/dream-skin-market-installer.test.mjs`

**Interfaces:**
- Consumes: `marketCache`, `marketClient`, `themeLibrary`, `installRecords`, `assertValidTheme`, `inspectImage`.
- Produces: `sha256Hex(bytes) -> string`.
- Produces: `createMarketInstaller({ marketCache, marketClient, themeLibrary, installRecords, paths, logger? })`.

```js
{
  install(id) -> Promise<ThemeSummary>,
  update(id) -> Promise<ThemeSummary>,
  uninstall(id) -> Promise<void>,
  getPreview(id) -> Promise<{ bytes, mime, etag }>,
  mergeMarketState(index, localThemes) -> Promise<MarketThemeSummary[]>
}
```

- [ ] **Step 1: Write failing install integrity tests**

Cover valid install plus:

```text
theme hash mismatch
image hash mismatch
theme JSON parse failure
theme.id differs from index id
theme.name differs from index name
image extension differs from real bytes
unknown style preset
existing local theme collision
request body cannot replace index URL/hash data
```

Assert failed installation leaves no final theme directory and no install record.

- [ ] **Step 2: Write failing update/delete rollback tests**

Install version `1.0.0`, make `1.1.0` fail during record write, and assert the old theme bytes and old record remain. Verify selected theme ID stays unchanged after a successful update. Verify uninstall removes the record only when theme deletion succeeds.

- [ ] **Step 3: Write failing preview proxy/cache tests**

Assert preview bytes are downloaded only from the current validated index, validated by size and magic bytes, written under `market/previews/<id>.<ext>`, served from cache after network failure, and never selected by a request-provided URL.

- [ ] **Step 4: Run and verify failure**

```bash
node --test tests/unit/dream-skin-market-installer.test.mjs
```

Expected: FAIL because the installer does not exist.

- [ ] **Step 5: Implement verified asset loading**

For install/update:

1. Find `id` in `marketCache.getCurrent()` or `readValidated()`.
2. Download theme bytes and compare lowercase SHA-256 using `timingSafeEqual`.
3. Parse and validate theme.
4. Require normalized `id` and `name` to equal the index entry.
5. Download image bytes and verify hash.
6. Inspect actual image format.
7. Rewrite `theme.image` to `background.<canonical-extension>`.
8. Snapshot install records.
9. Call `themeLibrary.putStoredTheme({ replace, onCommit })`.
10. In `onCommit`, set the record; restore the snapshot if the callback fails.

- [ ] **Step 6: Implement market state projection**

Return:

```js
{
  id, name, version, author, description, license, sourceUrl, tags,
  previewUrl: `/v1/dream-skin/market/themes/${encodeURIComponent(id)}/preview`,
  installed,
  installedVersion,
  updateAvailable
}
```

Do not include `theme`, `image`, `preview`, hashes, `rawBaseUrl`, cache paths, or theme paths.

- [ ] **Step 7: Run tests and commit**

```bash
node --test tests/unit/dream-skin-market-installer.test.mjs
git diff --check
git add lib/dream-skin/market/installer.mjs tests/unit/dream-skin-market-installer.test.mjs
git commit -m "feat: install verified dream skin themes"
```

Expected: installer, updater, uninstaller, and preview tests PASS.

---

### Task 6: Build The Dream Skin Application Service

**Files:**
- Create: `lib/dream-skin/application/service.mjs`
- Create: `tests/unit/dream-skin-service.test.mjs`

**Interfaces:**
- Consumes: Plan 1 library/importer/preview interfaces and Tasks 1-5 market interfaces.
- Produces: `createDreamSkinService(options) -> DreamSkinService`.

Constructor options:

```js
{
  paths,
  builtinThemePath,
  requestBinary,
  indexUrl,
  rawBaseUrl,
  timeoutMs,
  clock,
  logger,
  packageProvider,
  cssCompiler,
  communityProvider
}
```

The last three providers default to `null`; no empty provider files are created.

Service methods:

```js
initialize()
getCapabilities()
listThemes()
getTheme(id)
getThemeImage(id)
createTheme(input)
updateTheme(id, input)
duplicateTheme(id, input)
selectTheme(id)
deleteTheme(id)
importTheme({ theme, imageBytes, conflict, requestedId })
loadMarket({ forceRefresh })
installMarketTheme(id)
updateMarketTheme(id)
getMarketPreview(id)
```

- [ ] **Step 1: Write failing capability and orchestration tests**

Capabilities must be exactly:

```js
{
  packageImport: false,
  customCss: false,
  communityPublishing: false,
  codexRuntime: false,
}
```

Assert CRUD delegates to the local library, market methods delegate to cache/installer, deleting a market theme clears its record, editing a market theme duplicates to a local copy before saving, and no service method starts with `apply`, `launch`, `inject`, or `runtime`.

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/unit/dream-skin-service.test.mjs
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement composition and source-aware editing**

`initialize()` creates/recover directories and initializes the library. `listThemes()` merges install records into local summaries. `updateTheme` checks market source; for a market theme it duplicates with a generated local ID and edits that copy, returning `{ theme, copiedFrom }`.

- [ ] **Step 4: Implement import extension boundaries**

When input contains `theme.css`, package bytes, or a community action, throw:

```js
new DreamSkinError("unsupported_feature", "当前版本不支持该主题能力。")
```

Do not call a null provider and do not expose these capabilities as routes.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/unit/dream-skin-service.test.mjs
git diff --check
git add lib/dream-skin/application/service.mjs tests/unit/dream-skin-service.test.mjs
git commit -m "feat: add dream skin application service"
```

Expected: service tests PASS.

---

### Task 7: Add The Isolated HTTP Router

**Files:**
- Create: `lib/dream-skin/http/routes.mjs`
- Create: `lib/dream-skin/http/body.mjs`
- Create: `tests/unit/dream-skin-http.test.mjs`

**Interfaces:**
- Consumes: `DreamSkinService`.
- Produces: `routeDreamSkinRequest(req, res, context, reqPath, { service })`.
- Produces: `readJsonBody(req, { maxBytes }) -> Promise<object>`.
- Produces: `sendDreamSkinError(res, error)`.

- [ ] **Step 1: Write failing route table tests**

Use fake request/response objects and assert every method/path in the design maps to the exact service method. Dynamic IDs must be decoded and then validated by the service.

Define create/update request bodies exactly:

```js
{
  theme: { /* controlled theme fields */ },
  image: {
    name: "background.png",
    dataBase64: "..."
  }
}
```

`POST /themes` requires `image`; `PUT /themes/:id` permits it to be absent when retaining the current image. Duplicate/select/delete/market action bodies cannot contain image, URL, path, or hash fields.

- [ ] **Step 2: Write failing request-limit and error tests**

Use 1 MiB for ordinary JSON and 24 MiB only for `/v1/dream-skin/import`. Reject invalid JSON, aborted requests, and excess bytes. Map error codes exactly:

```js
const STATUS_BY_CODE = {
  invalid_request: 400,
  invalid_theme: 400,
  invalid_theme_id: 400,
  invalid_image: 400,
  payload_too_large: 413,
  theme_not_found: 404,
  theme_already_exists: 409,
  theme_in_use: 409,
  builtin_theme_readonly: 409,
  market_unavailable: 503,
  market_manifest_invalid: 502,
  market_asset_invalid: 502,
  hash_mismatch: 502,
  unsupported_feature: 501,
  storage_error: 500,
};
```

- [ ] **Step 3: Run and verify failure**

```bash
node --test tests/unit/dream-skin-http.test.mjs
```

Expected: FAIL because the HTTP modules do not exist.

- [ ] **Step 4: Implement JSON and binary responses**

JSON errors use:

```js
{
  error: {
    type: error.code,
    message: error.message,
    ...(error.details.length ? { details: error.details } : {})
  }
}
```

Theme images and market previews set validated `Content-Type`, exact `Content-Length`, `Cache-Control: private, max-age=300`, and `ETag` when provided. `GET /themes/shrimp-default/image` returns 404 `theme_not_found` with message `主题没有背景图片`; no arbitrary fallback file is read.

- [ ] **Step 5: Explicitly return 404 for forbidden route families**

The catch-all within `/v1/dream-skin` returns `not_found`, including:

```text
/apply
/launch
/inject
/runtime/*
/community/*
/packages/*
```

Do not add handlers or capability-disabled stubs for them.

- [ ] **Step 6: Run tests and commit**

```bash
node --test tests/unit/dream-skin-http.test.mjs
git diff --check
git add lib/dream-skin/http/routes.mjs lib/dream-skin/http/body.mjs tests/unit/dream-skin-http.test.mjs
git commit -m "feat: add dream skin HTTP routes"
```

Expected: router tests PASS.

---

### Task 8: Compose The Service In `server.js`

**Files:**
- Modify: `server.js`
- Modify: `package.json`
- Create: `tests/integration/dream-skin-api.test.mjs`
- Create: `tests/unit/dream-skin-server-isolation.test.mjs`

**Interfaces:**
- Consumes: `createDreamSkinService`, `createNodeBinaryRequest`, `routeDreamSkinRequest`, `resolveDreamSkinPaths`, existing proxy helpers and `checkLocalAuth`.
- Produces: one `/v1/dream-skin` prefix dispatch.
- Produces: `npm run test:dream-skin`.

- [ ] **Step 1: Write a failing source-isolation test**

Read `server.js` as text and assert:

```js
assert.doesNotMatch(serverSource, /dream-skin\/runtime/);
assert.doesNotMatch(serverSource, /dream-skin\/(?:launcher|cdp-client|injector)\.mjs/);
assert.equal((serverSource.match(/startsWith\("\\/v1\\/dream-skin"\)/g) || []).length, 1);
```

- [ ] **Step 2: Write failing HTTP integration tests**

Start a local fake market HTTP server, then spawn the gateway with a temporary absolute `GATEWAY_CONFIG_FILE`, an ephemeral port, and these test-only server composition overrides:

```text
DREAM_SKIN_MARKET_INDEX_URL=http://127.0.0.1:<fake-port>/index.json
DREAM_SKIN_MARKET_RAW_BASE_URL=http://127.0.0.1:<fake-port>/
```

The overrides are read once in `server.js` and passed into `createDreamSkinService`; they are never accepted through Dream Skin HTTP requests. Cover:

```text
capabilities
local list/detail/image
create/edit/duplicate/select/delete
import JSON plus Base64 image
market online list
market cached warning
install/update/delete
24 MiB import limit
standard error envelope
no absolute path leakage
forbidden runtime/community/package routes return 404
```

- [ ] **Step 3: Run and verify failure**

```bash
node --test tests/unit/dream-skin-server-isolation.test.mjs tests/integration/dream-skin-api.test.mjs
```

Expected: FAIL because the server has no Dream Skin service or route.

- [ ] **Step 4: Add imports and one service instance**

At server composition time:

1. Resolve paths from `GATEWAY_CONFIG_FILE`.
2. Derive the existing global proxy URL and call `createProxyAgent`.
3. Build `requestBinary`.
4. Construct the service with `process.env.DREAM_SKIN_MARKET_INDEX_URL || DEFAULT_DREAM_SKIN_MARKET_INDEX_URL` and `process.env.DREAM_SKIN_MARKET_RAW_BASE_URL || DEFAULT_DREAM_SKIN_MARKET_RAW_BASE_URL`.
5. Await `service.initialize()` before listening or store the initialization promise and await it inside the first route.

Do not import `runtime/`, `launcher.mjs`, `cdp-client.mjs`, or an executable Dream Skin entry point.

- [ ] **Step 5: Add one authenticated prefix dispatch**

Place near other local management APIs:

```js
if (reqPath.startsWith("/v1/dream-skin")) {
  if (!checkLocalAuth(req, res)) return;
  await routeDreamSkinRequest(req, res, context, reqPath, {
    service: globalDreamSkinService,
  });
  return;
}
```

- [ ] **Step 6: Decode all submitted image bytes only in the HTTP boundary**

For create, update, and import, validate `image.name` as a basename and `dataBase64` as canonical Base64. Convert it to `Buffer`; pass `{ theme, imageBytes }` to create/update and `{ theme, imageBytes, conflict, requestedId }` to import. Do not let Base64 strings enter the domain/library layer.

- [ ] **Step 7: Add the focused package script**

Add:

```json
"test:dream-skin": "node --test tests/unit/dream-skin-*.test.mjs tests/integration/dream-skin-api.test.mjs"
```

- [ ] **Step 8: Run integration and regression tests**

```bash
npm run test:dream-skin
npm run test:config-panel
npm run check
git diff --check
```

Expected: all commands exit `0`; test logs show no Codex process, CDP, WebSocket, or real market access.

- [ ] **Step 9: Commit only market/API changes**

```bash
git add lib/dream-skin/market lib/dream-skin/application lib/dream-skin/http server.js package.json tests/unit/dream-skin-market-schema.test.mjs tests/unit/dream-skin-market-client.test.mjs tests/unit/dream-skin-market-cache.test.mjs tests/unit/dream-skin-install-records.test.mjs tests/unit/dream-skin-market-installer.test.mjs tests/unit/dream-skin-service.test.mjs tests/unit/dream-skin-http.test.mjs tests/unit/dream-skin-server-isolation.test.mjs tests/integration/dream-skin-api.test.mjs
git commit -m "feat: add dream skin market and API"
```

Expected: no runtime asset or runtime module is staged by this commit.

---

### Task 9: Verify Plan 2 Security Boundaries

**Files:**
- Verify: `lib/dream-skin/market/`
- Verify: `lib/dream-skin/application/`
- Verify: `lib/dream-skin/http/`
- Verify: `server.js`
- Verify: `package.json`

**Interfaces:**
- Produces: stable HTTP contracts consumed by the Web panel plan.

- [ ] **Step 1: Run the complete Dream Skin backend suite**

```bash
npm run test:dream-skin
```

Expected: PASS using temporary directories and fake requests only.

- [ ] **Step 2: Scan for unsafe route and URL surfaces**

```bash
rg -n '/v1/dream-skin/(apply|launch|inject|runtime|community|packages)' server.js lib/dream-skin/http
rg -n 'body\.(url|themeUrl|imageUrl|previewUrl|sha256)|reqPath.*https?://' lib/dream-skin
rg -n 'themePath|imagePath|configDir|rootDir' lib/dream-skin/http lib/dream-skin/application
```

Expected: the first command matches only explicit 404 tests/documented rejection; the second has no request-controlled download surface; the third has no response serialization of local paths.

- [ ] **Step 3: Confirm runtime isolation**

```bash
node --test tests/unit/dream-skin-server-isolation.test.mjs
rg -n 'dream-skin.*(launcher|cdp-client|Runtime\.evaluate|open -a)' server.js package.json desktop/src desktop/index.html
```

Expected: test PASS and search has no executable runtime entry in product code.
