# Video Clip Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add video collections, reusable clip anchors, and a shared bottom seek player, then hang I Ching judgment/line explanations off those anchors.

**Architecture:** Keep `video-kb` as the media store (files, transcript, chunks). Add a separate `clip_anchors` table for object-to-clip links. Play clips through one panel-wide player that seeks a local video file. I Ching is only the first consumer.

**Tech Stack:** Node.js `node:test` + `node:sqlite`, existing LanceDB vector store, desktop TypeScript panel bundled by esbuild.

**Spec:** `docs/superpowers/specs/2026-08-20-video-clip-anchors-design.md`

## Global Constraints

- Collection IDs: lowercase letters, digits, and hyphens only (`iching-up`, `rust-course`).
- One video belongs to one collection in v1. Missing collection on ingest writes `default`.
- Search without `collection` keeps old search-all behavior. I Ching queries must pass `iching-up`.
- Anchors never store classic text and never live in `iching-data.ts`.
- Detail pages show only `role=primary` and (`confirmed=1` or `confidence >= 0.85`).
- Mentions (`role=mention`) are stored but not rendered on I Ching detail.
- Do not auto-cut 64 hexagrams in v1. Do not rewrite spoken commentary into new judgments.
- Play local files with frontend seek. Do not cut new clip files. Bilibili is fallback only when the local video is missing.
- Reject writes where `end_seconds <= start_seconds`.
- Work in the isolated worktree on branch `codex/video-clip-anchors`.

## File map

- Modify: `lib/video-kb/meta-store.mjs` — `videos.collection`, list-by-collection
- Modify: `lib/video-kb/vector-store.mjs` — chunk `collection`, search filter
- Modify: `lib/video-kb/pipeline.mjs` — persist collection onto meta and chunks
- Modify: `server.js` — ingest/list/search/patch collection; Range on assets; clip-anchor routes
- Modify: `desktop/src/modules/video-kb.ts` — collection field on ingest/list/search
- Create: `lib/video-kb/clip-anchors.mjs` — SQLite CRUD for anchors
- Create: `lib/video-kb/clip-player-state.mjs` — normalize clip playback commands
- Create: `desktop/src/modules/clip-player.ts` — shared bottom player
- Modify: `desktop/src/modules/iching.ts` — judgment/line explanation cards
- Modify: `desktop/src/styles/panel.css` — player + explanation card styles
- Modify: `desktop/index.html` — mount `#clip-player-root`
- Test: `tests/unit/video-kb-meta-pipeline.test.mjs`
- Test: `tests/unit/video-kb-vector-store.test.mjs`
- Create: `tests/unit/clip-anchors.test.mjs`
- Create: `tests/unit/clip-player-state.test.mjs`
- Modify: `tests/unit/config-panel.test.mjs` — source-level UI contracts

---

### Task 1: Video collection on metadata

**Files:**
- Modify: `lib/video-kb/meta-store.mjs`
- Test: `tests/unit/video-kb-meta-pipeline.test.mjs`

**Interfaces:**
- Consumes: existing `createMetaStore({ dbPath })`
- Produces: `upsertVideo({ collection })`, `listVideos({ collection } = {})`, `updateCollection(videoId, collection)`, each video row includes `collection: string`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/video-kb-meta-pipeline.test.mjs`:

```js
test("meta-store: collection defaults and list filter", () => {
  const dir = tmpDir("video-meta-col-");
  const dbPath = path.join(dir, "meta.sqlite");
  try {
    const store = createMetaStore({ dbPath });
    const created = store.upsertVideo({
      video_id: "v1",
      video_url: "https://example.com/v1",
      source_title: "plain",
    });
    assert.equal(created.collection, "default");

    store.upsertVideo({
      video_id: "v2",
      video_url: "https://example.com/v2",
      source_title: "iching",
      collection: "iching-up",
    });
    const iching = store.listVideos({ collection: "iching-up" });
    assert.equal(iching.length, 1);
    assert.equal(iching[0].video_id, "v2");
    assert.equal(store.listVideos().length, 2);

    const moved = store.updateCollection("v1", "iching-up");
    assert.equal(moved.collection, "iching-up");
    assert.equal(store.listVideos({ collection: "iching-up" }).length, 2);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("meta-store: reject invalid collection id", () => {
  const dir = tmpDir("video-meta-bad-");
  const dbPath = path.join(dir, "meta.sqlite");
  try {
    const store = createMetaStore({ dbPath });
    assert.throws(
      () => store.upsertVideo({ video_id: "v1", collection: "I Ching" }),
      /collection/,
    );
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/video-kb-meta-pipeline.test.mjs`

Expected: FAIL because `collection` / `updateCollection` / `listVideos({ collection })` do not exist.

- [ ] **Step 3: Write minimal implementation**

In `lib/video-kb/meta-store.mjs`:

```js
const COLLECTION_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeCollection(value, fallback = "default") {
  const raw = String(value ?? "").trim().toLowerCase();
  const collection = raw || fallback;
  if (!COLLECTION_RE.test(collection)) {
    throw new Error(`Invalid collection: ${value}`);
  }
  return collection;
}
```

Also:
- `ensureColumn(db, "videos", "collection", "TEXT NOT NULL DEFAULT 'default'")`
- include `collection` in `rowToVideo`, INSERT, and ON CONFLICT update (always take excluded.collection)
- `listVideos({ collection } = {})` uses `WHERE collection = ?` when collection is provided
- `updateCollection(videoId, collection)` updates the column and `updated_at`
- empty / omitted collection on upsert becomes `"default"`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/video-kb-meta-pipeline.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/video-kb/meta-store.mjs tests/unit/video-kb-meta-pipeline.test.mjs
git commit -m "feat(video-kb): add collection field to video metadata"
```

---

### Task 2: Collection on chunks and search

**Files:**
- Modify: `lib/video-kb/vector-store.mjs`
- Modify: `lib/video-kb/pipeline.mjs`
- Test: `tests/unit/video-kb-vector-store.test.mjs`

**Interfaces:**
- Consumes: chunk upsert records from pipeline
- Produces: chunk records include `collection`; `search(query, { topK, videoId, collection, threshold })` filters by collection when provided

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/video-kb-vector-store.test.mjs`:

```js
test("vector-store: search can filter by collection", async () => {
  const dir = tmpDir();
  try {
    const mockEmbed = async (text) => {
      if (text.includes("qian")) return [1, 0, 0];
      return [0, 1, 0];
    };
    const store = createVectorStore({ dbPath: dir, embeddingFn: mockEmbed });
    await store.upsertChunks([
      {
        chunk_id: "c1",
        video_id: "v1",
        collection: "iching-up",
        text: "qian hexagram intro",
        start_seconds: 10,
        end_seconds: 20,
        vector: [1, 0, 0],
      },
      {
        chunk_id: "c2",
        video_id: "v2",
        collection: "other-course",
        text: "qian mentioned in passing",
        start_seconds: 0,
        end_seconds: 8,
        vector: [1, 0, 0],
      },
    ], { dim: 3 });

    const all = await store.search("qian", { topK: 5 });
    assert.equal(all.length, 2);
    const filtered = await store.search("qian", { topK: 5, collection: "iching-up" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].video_id, "v1");
    assert.equal(filtered[0].collection, "iching-up");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/video-kb-vector-store.test.mjs`

Expected: FAIL because records/search ignore `collection`.

- [ ] **Step 3: Write minimal implementation**

In `upsertChunks` records add `collection: chunk.collection || "default"`.

In `search`, after the optional `videoId` filter:

```js
if (collection) {
  query_builder = query_builder.where(`collection = '${escapeSqlLiteral(collection)}'`);
}
```

Map `collection` onto returned hits. In `pipeline.mjs` vectorize records and `persistMetadata()`, pass `collection: ctx.collection || "default"`.

Existing LanceDB tables created without `collection` are not migrated in v1. If search throws because the column is missing, the route layer in Task 3 should log and return `{ results: [] }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/video-kb-vector-store.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/video-kb/vector-store.mjs lib/video-kb/pipeline.mjs tests/unit/video-kb-vector-store.test.mjs
git commit -m "feat(video-kb): persist and search chunks by collection"
```

---

### Task 3: Collection through ingest, list, search, and panel

**Files:**
- Modify: `server.js`
- Modify: `desktop/src/modules/video-kb.ts`
- Test: `tests/unit/config-panel.test.mjs`

**Interfaces:**
- Consumes: `normalizeCollection`, `listVideos({ collection })`, `search(..., { collection })`
- Produces: ingest payload `collection`; `GET /v1/video-kb/videos?collection=`; search body `collection`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/config-panel.test.mjs`:

```js
test("video kb ingest form includes collection field", async () => {
  const src = await readFile(path.join(ROOT, "desktop", "src", "modules", "video-kb.ts"), "utf8");
  assert.match(src, /vk-collection/);
  assert.match(src, /collection:/);
  assert.match(src, /iching-up/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/config-panel.test.mjs`

Expected: FAIL on missing `vk-collection`.

- [ ] **Step 3: Write minimal implementation**

In `server.js` ingest payload set `collection: body.collection || "default"`. Invalid IDs return 400 `{ type: "invalid_request_error" }` using `normalizeCollection`.

`GET /v1/video-kb/videos` reads `?collection=` and calls `listVideos({ collection })` when present.

Search body accepts `collection` and passes it to `store.search`.

PATCH video: if `body.collection` is present, call `metaStore.updateCollection`.

Panel: add input `id="vk-collection"` placeholder `iching-up`, remember last value in `localStorage` key `video-kb:last-collection`, send `collection` on ingest and search, and optionally filter the video list.

- [ ] **Step 4: Run tests**

Run: `node --test tests/unit/config-panel.test.mjs tests/unit/video-kb-meta-pipeline.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server.js desktop/src/modules/video-kb.ts tests/unit/config-panel.test.mjs
git commit -m "feat(video-kb): thread collection through ingest, list, and search"
```

---

### Task 4: Clip anchor store

**Files:**
- Create: `lib/video-kb/clip-anchors.mjs`
- Create: `tests/unit/clip-anchors.test.mjs`

**Interfaces:**
- Consumes: same SQLite file as meta-store (`meta.sqlite`), `normalizeCollection`
- Produces:

```js
createClipAnchorStore({ dbPath }) -> {
  upsertAnchor(input) -> anchor,
  getAnchor(id) -> anchor | null,
  listAnchors({ collection, object_type, object_id, confirmed, role, for_display }) -> anchor[],
  deleteAnchor(id) -> { ok, id },
  close()
}
```

`for_display: true` means `role === "primary"` AND (`confirmed === 1` OR `confidence >= 0.85`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/clip-anchors.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClipAnchorStore } from "../../lib/video-kb/clip-anchors.mjs";

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "clip-anchors-"));
}

test("clip-anchors: reject inverted time range", () => {
  const dir = tmpDir();
  try {
    const store = createClipAnchorStore({ dbPath: path.join(dir, "meta.sqlite") });
    assert.throws(() => store.upsertAnchor({
      collection: "iching-up",
      object_type: "line",
      object_id: "谦/初六",
      video_id: "v1",
      start_seconds: 20,
      end_seconds: 10,
    }), /end_seconds/);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clip-anchors: display query hides mentions and low confidence", () => {
  const dir = tmpDir();
  try {
    const store = createClipAnchorStore({ dbPath: path.join(dir, "meta.sqlite") });
    store.upsertAnchor({
      id: "a1",
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "谦",
      video_id: "v1",
      start_seconds: 12,
      end_seconds: 40,
      quote: "山藏在地里",
      role: "primary",
      confidence: 0.9,
      confirmed: 0,
      source: "model",
    });
    store.upsertAnchor({
      id: "a2",
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "乾",
      video_id: "v1",
      start_seconds: 40,
      end_seconds: 50,
      quote: "和前面乾卦一样",
      role: "mention",
      confidence: 0.99,
      confirmed: 1,
      source: "model",
    });
    store.upsertAnchor({
      id: "a3",
      collection: "iching-up",
      object_type: "line",
      object_id: "谦/初六",
      video_id: "v1",
      start_seconds: 50,
      end_seconds: 80,
      quote: "最底下先自收",
      role: "primary",
      confidence: 0.4,
      confirmed: 0,
      source: "model",
    });
    const displayed = store.listAnchors({
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "谦",
      for_display: true,
    });
    assert.equal(displayed.length, 1);
    assert.equal(displayed[0].id, "a1");
    assert.equal(store.listAnchors({
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "乾",
      for_display: true,
    }).length, 0);
    assert.equal(store.listAnchors({
      collection: "iching-up",
      object_type: "line",
      object_id: "谦/初六",
      for_display: true,
    }).length, 0);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/clip-anchors.test.mjs`

Expected: FAIL module not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/video-kb/clip-anchors.mjs` with table:

```sql
CREATE TABLE IF NOT EXISTS clip_anchors (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'primary',
  confidence REAL NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clip_anchors_unique
  ON clip_anchors(collection, object_type, object_id, video_id, start_seconds, end_seconds);
```

Generate `id` with `crypto.randomUUID()` when omitted. Role must be `primary|mention`. Source must be `manual|rule|model`. Reject `end_seconds <= start_seconds`. Display SQL: `role = 'primary' AND (confirmed = 1 OR confidence >= 0.85)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/clip-anchors.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/video-kb/clip-anchors.mjs tests/unit/clip-anchors.test.mjs
git commit -m "feat(video-kb): add clip anchor store"
```

---

### Task 5: Clip anchor HTTP API

**Files:**
- Modify: `server.js`
- Optional create: `lib/video-kb/clip-anchor-routes.mjs` if inline routing in `server.js` is too large
- Test: `tests/unit/config-panel.test.mjs`

**Interfaces:**
- Consumes: `createClipAnchorStore({ dbPath: metaDbPath })`
- Produces:

```
GET    /v1/clip-anchors?collection=&object_type=&object_id=&confirmed=&for_display=
POST   /v1/clip-anchors
PATCH  /v1/clip-anchors/:id
DELETE /v1/clip-anchors/:id
```

When listing, if the referenced video is missing from meta-store, add `asset_missing: true`. Do not delete the anchor.

- [ ] **Step 1: Write the failing test**

```js
test("server exposes clip-anchor routes", async () => {
  const src = await readFile(path.join(ROOT, "server.js"), "utf8");
  assert.match(src, /\/v1\/clip-anchors/);
  assert.match(src, /for_display/);
});
```

Keep behavioral coverage on the store from Task 4.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/config-panel.test.mjs`

Expected: FAIL on missing `/v1/clip-anchors`.

- [ ] **Step 3: Write minimal implementation**

Add routes next to video-kb. Map errors: invalid JSON / missing fields / inverted range → 400 `invalid_request_error`; unknown id → 404 `anchor_not_found`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/unit/clip-anchors.test.mjs tests/unit/config-panel.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server.js lib/video-kb/clip-anchor-routes.mjs tests/unit/config-panel.test.mjs tests/unit/clip-anchors.test.mjs
git commit -m "feat(video-kb): add clip anchor REST API"
```

---

### Task 6: Playback command helper and Range assets

**Files:**
- Create: `lib/video-kb/clip-player-state.mjs`
- Create: `tests/unit/clip-player-state.test.mjs`
- Modify: `server.js` asset streaming

**Interfaces:**
- Consumes: asset URL `/v1/video-kb/assets/:video_id/video`
- Produces: `normalizeClipPlayback({ video_id, start_seconds, end_seconds, title, quote, source_url })` → `{ ok:true, src, start_seconds, end_seconds, ... }` or `{ ok:false, error }`

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClipPlayback } from "../../lib/video-kb/clip-player-state.mjs";

test("normalizeClipPlayback rejects inverted range", () => {
  const result = normalizeClipPlayback({
    video_id: "v1",
    start_seconds: 20,
    end_seconds: 10,
  });
  assert.equal(result.ok, false);
});

test("normalizeClipPlayback builds local asset src", () => {
  const result = normalizeClipPlayback({
    video_id: "v1",
    start_seconds: 12.4,
    end_seconds: 40,
    title: "谦 初六",
    quote: "山藏在地里",
  });
  assert.equal(result.ok, true);
  assert.equal(result.src, "/v1/video-kb/assets/v1/video");
  assert.equal(result.start_seconds, 12.4);
  assert.equal(result.end_seconds, 40);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/clip-player-state.test.mjs`

Expected: FAIL module not found.

- [ ] **Step 3: Write minimal implementation**

Implement `normalizeClipPlayback`. Missing `video_id` or `end <= start` returns `{ ok:false }`.

In the assets route, if `req.headers.range` is `bytes=start-end`, respond 206 with `Content-Range`. If Range is absent, keep current 200 full-file stream. HTML `<video>` seek needs this.

- [ ] **Step 4: Run tests**

Run: `node --test tests/unit/clip-player-state.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/video-kb/clip-player-state.mjs tests/unit/clip-player-state.test.mjs server.js
git commit -m "feat(video-kb): normalize clip playback and support asset Range requests"
```

---

### Task 7: Shared bottom clip player

**Files:**
- Create: `desktop/src/modules/clip-player.ts`
- Modify: `desktop/src/main.ts`
- Modify: `desktop/index.html`
- Modify: `desktop/src/styles/panel.css`
- Test: `tests/unit/config-panel.test.mjs`

**Interfaces:**
- Consumes: `/v1/video-kb/assets/:id/video`
- Produces: `window.clipPlayerOpen(clip)`, `window.clipPlayerClose()`

Copy the 20-line normalize helper into `clip-player.ts` instead of importing `.mjs` from the panel bundle. Keep `.mjs` as the tested source of truth.

- [ ] **Step 1: Write the failing test**

```js
test("panel mounts shared clip player", async () => {
  const html = await readFile(path.join(ROOT, "desktop", "index.html"), "utf8");
  const ts = await readFile(path.join(ROOT, "desktop", "src", "modules", "clip-player.ts"), "utf8");
  const css = await readFile(path.join(ROOT, "desktop", "src", "styles", "panel.css"), "utf8");
  assert.match(html, /id="clip-player-root"/);
  assert.match(ts, /clipPlayerOpen/);
  assert.match(css, /clip-player-bar/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/config-panel.test.mjs`

Expected: FAIL missing `#clip-player-root`.

- [ ] **Step 3: Write minimal implementation**

Add `<div id="clip-player-root"></div>` to `desktop/index.html`.

`clipPlayerOpen` renders a fixed bottom bar with `<video controls>`, sets `currentTime = start` on `loadedmetadata`, pauses when `currentTime >= end`. On 404 show “本地视频缺失”; if `source_url` exists, render it as a fallback link. Do not auto-redirect.

Import `./modules/clip-player` from `desktop/src/main.ts`. CSS tokens: `--bg-secondary`, `--border-color`. Classes: `.clip-player-bar`, `.clip-player-meta`, `.clip-player-close`.

- [ ] **Step 4: Run tests and build**

Run:

```bash
node --test tests/unit/config-panel.test.mjs
npm run build:panel
```

Expected: PASS, bundle succeeds.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/clip-player.ts desktop/src/main.ts desktop/index.html desktop/src/styles/panel.css tests/unit/config-panel.test.mjs
git commit -m "feat(panel): add shared bottom clip player"
```

---

### Task 8: I Ching detail consumes anchors

**Files:**
- Modify: `desktop/src/modules/iching.ts`
- Modify: `desktop/src/styles/panel.css`
- Test: `tests/unit/config-panel.test.mjs`

**Interfaces:**
- Consumes: `GET /v1/clip-anchors?collection=iching-up&object_type=hexagram&object_id=谦&for_display=1` and line objects `谦/初六`
- Produces: explanation cards that call `window.clipPlayerOpen(...)`

Hard-code collection `iching-up` in this consumer. No settings UI in v1.

- [ ] **Step 1: Write the failing test**

```js
test("iching detail loads clip anchors for judgment and lines", async () => {
  const src = await readFile(path.join(ROOT, "desktop", "src", "modules", "iching.ts"), "utf8");
  assert.match(src, /iching-up/);
  assert.match(src, /clip-anchors/);
  assert.match(src, /object_type=hexagram/);
  assert.match(src, /clipPlayerOpen/);
  assert.match(src, /iching-explain-card/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/config-panel.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

After `openHexagramDetail` paints the detail page:
1. Fetch judgment anchors for `h.name`.
2. Fetch each line as `object_id = h.name + "/" + line.position`.
3. Render `.iching-explain` under 卦辞 and each 爻; leave empty if none.
4. Card content: `mm:ss–mm:ss`, quote, button “播放这一段”.
5. Button calls `clipPlayerOpen({ video_id, start_seconds, end_seconds, title, quote })`.

If fetch fails, leave the explain area empty. Never copy quote into classic text. CSS: `.iching-explain-card` using existing iching tokens.

- [ ] **Step 4: Run tests and build**

Run:

```bash
node --test tests/unit/config-panel.test.mjs tests/unit/clip-anchors.test.mjs tests/unit/clip-player-state.test.mjs tests/unit/video-kb-meta-pipeline.test.mjs
npm run build:panel
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/iching.ts desktop/src/styles/panel.css tests/unit/config-panel.test.mjs
git commit -m "feat(iching): play confirmed clip anchors from hexagram detail"
```

---

## Spec coverage check

- Collection on ingest/list/search/patch → Tasks 1-3
- Chunk collection filter → Task 2
- Old clients omit collection → Task 1 default `default`, Task 3 search-all
- `clip_anchors` schema, uniqueness, inverted range → Task 4
- primary / mention / 0.85 display rule → Tasks 4 and 8
- I Ching object ids `谦` and `谦/初六` → Task 8
- Manual/API write first, no auto-cutter → no extra task
- Shared bottom player + local seek → Tasks 6-7
- Range requests for seek → Task 6
- Missing local asset fallback URL → Task 7
- Anchors survive deleted videos via `asset_missing` → Task 5
- I Ching empty explain area when no anchors → Task 8
- Out of scope auto-generation / Bilibili-first / rewriting commentary → not scheduled
