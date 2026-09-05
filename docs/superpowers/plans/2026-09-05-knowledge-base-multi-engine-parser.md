# 知识库第一阶段：多引擎文档解析与双引擎对比工作台实施计划 (Knowledge Base Phase 1 Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前网关的「系统扩展」新增「知识库 (Knowledge Base)」Tab，提供基于 OCP 插件式架构的多格式文档解析、MarkItDown 与 Docling 双引擎并发对比、网页抓取与图片本地化防盗链、多知识库分类管理及三种格式（Markdown/HTML/JSON）预览导出。

**Architecture:** 
- 后端在 `lib/knowledge-base/` 采用模块化分层：SQLite 存储层（`kb-store.mjs`）、引擎适配器注册中心（`engine-adapter.mjs`）、内容抓取策略中心（`scraper.mjs`）、任务流水线协调器（`pipeline.mjs`）以及 REST 路由（`routes.mjs`）。
- 前端在 `desktop/src/modules/knowledge-base.ts` 配合 `desktop/index.html`，构建三栏响应式工作台（集合列表、文档搜索列表、双引擎分屏对比工作台），并通过 esbuild 统一打包。
- 全程采用按需子进程拉起 Python/CLI 引擎，零常驻闲置开销，保证对历史功能零破坏。

**Tech Stack:** Node.js (ESM), `node:sqlite` (DatabaseSync + FTS5), TypeScript, HTML5/CSS3, `markitdown` CLI, `docling` CLI, `leo-lantern` CLI, `gallery-dl`.

## Global Constraints

- **Port for testing**: 8788 (`PORT=8788`).
- **Regression boundary**: All knowledge base endpoints strictly mounted under `/v1/kb/...`; no modifications to existing proxy, video-kb, remote-session, or chat routes.
- **Open-Closed Principle (OCP)**: Engine adapters must implement `ParserEngineAdapter`; adding an engine never alters pipeline core.
- **Data directory**: Persistent data at `data/knowledge-base/` (`kb.db`, `raw/`, `files/<doc_id>/assets/`).

---

### Task 1: SQLite 存储层实现与单元测试 (Storage Layer & FTS5)

**Files:**
- Create: `lib/knowledge-base/kb-store.mjs`
- Test: `tests/unit/kb-store.test.mjs`

**Interfaces:**
- Produces:
  - `createKbStore({ dbPath })`: returns `{ init(), createCollection(col), listCollections(), getCollection(id), deleteCollection(id), createDocument(doc), getDocument(id), listDocuments(filter), updateDocumentResult(id, updates), deleteDocument(id), searchDocuments(query) }`

- [ ] **Step 1: Write the failing test for kb-store**

```javascript
// tests/unit/kb-store.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createKbStore } from "../../lib/knowledge-base/kb-store.mjs";

test("KbStore: CRUD collections and documents with FTS5 search", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-store-test-"));
  const dbPath = path.join(tmpDir, "test-kb.db");
  const store = createKbStore({ dbPath });
  store.init();

  // Test collection creation and retrieval
  const col = store.createCollection({
    id: "col_test",
    name: "测试知识库",
    description: "用于测试的集合",
    icon: "folder",
  });
  assert.equal(col.id, "col_test");
  assert.equal(col.name, "测试知识库");

  const cols = store.listCollections();
  assert.equal(cols.length >= 1, true);
  assert.equal(cols.some(c => c.id === "col_test"), true);

  // Test document creation
  const doc = store.createDocument({
    id: "doc_001",
    collection_id: "col_test",
    title: "深度学习研报.pdf",
    source_type: "file",
    file_name: "深度学习研报.pdf",
    file_path: "/tmp/fake.pdf",
    file_size: 1024,
    file_hash: "hash123",
  });
  assert.equal(doc.id, "doc_001");
  assert.equal(doc.title, "深度学习研报.pdf");

  // Test update parse results
  store.updateDocumentResult("doc_001", {
    markitdown_status: "done",
    markitdown_md: "# MarkItDown 深度学习研报内容",
    markitdown_duration_ms: 250,
    docling_status: "done",
    docling_md: "# Docling 深度学习研报详细内容与表格",
    docling_html: "<h1>Docling 深度学习研报详细内容与表格</h1>",
    docling_json: JSON.stringify({ pages: 5 }),
    docling_duration_ms: 2400,
    word_count: 500,
  });

  const updatedDoc = store.getDocument("doc_001");
  assert.equal(updatedDoc.markitdown_status, "done");
  assert.equal(updatedDoc.docling_status, "done");
  assert.equal(updatedDoc.word_count, 500);

  // Test search
  const searchResults = store.searchDocuments("研报");
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].id, "doc_001");

  // Clean up
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/kb-store.test.mjs`
Expected: FAIL (Cannot find module `../../lib/knowledge-base/kb-store.mjs`)

- [ ] **Step 3: Write implementation of kb-store.mjs**

Implement `createKbStore` in `lib/knowledge-base/kb-store.mjs` using `DatabaseSync` from `node:sqlite`. Ensure:
- Collections table (`kb_collections`)
- Documents table (`kb_documents`)
- Full-text search virtual table (`kb_documents_fts`)
- Collection document count auto-increment / decrement on document create / delete.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/kb-store.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge-base/kb-store.mjs tests/unit/kb-store.test.mjs
git commit -m "feat(kb): implement SQLite storage layer with FTS5 search"
```

---

### Task 2: 解析引擎适配器架构 (Engine Adapters & Registry)

**Files:**
- Create: `lib/knowledge-base/engine-adapter.mjs`
- Test: `tests/unit/kb-engine-adapter.test.mjs`

**Interfaces:**
- Produces:
  - `BaseEngineAdapter` class
  - `MarkItDownAdapter` class
  - `DoclingAdapter` class
  - `createEngineRegistry()`: returns `{ register(adapter), get(id), list(), detectAll(), install(id, onLog), upgrade(id, onLog) }`

- [ ] **Step 1: Write the failing test for engine adapters**

```javascript
// tests/unit/kb-engine-adapter.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  createEngineRegistry,
  MarkItDownAdapter,
  DoclingAdapter
} from "../../lib/knowledge-base/engine-adapter.mjs";

test("EngineAdapters: Registry, detection interfaces and command definitions", async () => {
  const registry = createEngineRegistry();
  const mdAdapter = new MarkItDownAdapter();
  const docAdapter = new DoclingAdapter();

  registry.register(mdAdapter);
  registry.register(docAdapter);

  assert.equal(registry.list().length, 2);
  assert.equal(registry.get("markitdown").id, "markitdown");
  assert.equal(registry.get("docling").id, "docling");

  // Test detect interface returns well-formed status
  const statuses = await registry.detectAll();
  assert.equal("markitdown" in statuses, true);
  assert.equal("docling" in statuses, true);
  assert.equal(typeof statuses.markitdown.installed, "boolean");
  assert.equal(typeof statuses.docling.installed, "boolean");
  assert.equal(statuses.markitdown.installCommand, "uv tool install markitdown");
  assert.equal(statuses.docling.installCommand, "uv tool install docling");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/kb-engine-adapter.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement engine-adapter.mjs**

Implement `lib/knowledge-base/engine-adapter.mjs` with:
- Standard `BaseEngineAdapter` interface defining `detect()`, `install()`, `upgrade()`, and `parse()`.
- `MarkItDownAdapter` executing `markitdown` CLI with stdout capture.
- `DoclingAdapter` executing `docling` CLI with options `--to md --to html --to json --artifacts-path` with stdout capture.
- `createEngineRegistry` providing dynamic registration fulfilling OCP.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/kb-engine-adapter.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge-base/engine-adapter.mjs tests/unit/kb-engine-adapter.test.mjs
git commit -m "feat(kb): implement OCP parser engine adapter registry"
```

---

### Task 3: 网页抓取与图片本地化防盗链策略 (Scraper & Image Localization)

**Files:**
- Create: `lib/knowledge-base/scraper.mjs`
- Test: `tests/unit/kb-scraper.test.mjs`

**Interfaces:**
- Produces:
  - `createWebScraper({ lanternPath, galleryDlAvailable })`: returns `{ scrape(url, options) }`

- [ ] **Step 1: Write the failing test for web scraper**

```javascript
// tests/unit/kb-scraper.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createWebScraper, rewriteHtmlImages } from "../../lib/knowledge-base/scraper.mjs";

test("Scraper: rewriteHtmlImages maps remote image tags to local asset paths", () => {
  const html = `<html><body><article><p>Hello</p><img src="https://example.com/img1.png" alt="Test"/><img data-src="https://example.com/img2.jpg"/></article></body></html>`;
  const imageMap = new Map([
    ["https://example.com/img1.png", "/v1/kb/files/doc_123/assets/img_0.png"],
    ["https://example.com/img2.jpg", "/v1/kb/files/doc_123/assets/img_1.jpg"],
  ]);
  const rewritten = rewriteHtmlImages(html, imageMap);
  assert.equal(rewritten.includes("/v1/kb/files/doc_123/assets/img_0.png"), true);
  assert.equal(rewritten.includes("/v1/kb/files/doc_123/assets/img_1.jpg"), true);
  assert.equal(rewritten.includes("https://example.com/img1.png"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/kb-scraper.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement scraper.mjs**

Implement `lib/knowledge-base/scraper.mjs` with:
- HTML extraction (title, clean body, image URLs via regex/DOM)
- Stream downloading of images using `fetch` with `Referer` and `User-Agent` headers
- Saving images to `data/knowledge-base/files/<docId>/assets/`
- `rewriteHtmlImages` to redirect images to local `/v1/kb/files/:id/assets/...`
- Integration with `clis/leo-lantern` when `use_leo=true` or when auth cookies are requested.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/kb-scraper.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge-base/scraper.mjs tests/unit/kb-scraper.test.mjs
git commit -m "feat(kb): implement web scraping and image localization"
```

---

### Task 4: 解析流水线调度器与任务管理 (Pipeline Orchestrator)

**Files:**
- Create: `lib/knowledge-base/pipeline.mjs`
- Test: `tests/unit/kb-pipeline.test.mjs`

**Interfaces:**
- Consumes: `createKbStore`, `createEngineRegistry`, `createWebScraper`
- Produces: `createKbPipeline({ store, registry, scraper, dataDir, taskQueue })`: returns `{ ingestFile(), ingestUrl(), ingestText(), getTask(id) }`

- [ ] **Step 1: Write the failing test for pipeline**

```javascript
// tests/unit/kb-pipeline.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createKbStore } from "../../lib/knowledge-base/kb-store.mjs";
import { createEngineRegistry } from "../../lib/knowledge-base/engine-adapter.mjs";
import { createWebScraper } from "../../lib/knowledge-base/scraper.mjs";
import { createKbPipeline } from "../../lib/knowledge-base/pipeline.mjs";

test("KbPipeline: Ingest plain text and generate document entries", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-pipe-test-"));
  const store = createKbStore({ dbPath: path.join(tmpDir, "test.db") });
  store.init();
  store.createCollection({ id: "col_default", name: "默认" });

  const registry = createEngineRegistry();
  // Mock simple adapters for pipeline unit test
  registry.register({
    id: "markitdown",
    name: "MarkItDown",
    detect: async () => ({ installed: true }),
    parse: async (input) => ({ engineId: "markitdown", markdown: "# Hello MarkItDown", durationMs: 10, wordCount: 3, assets: [] }),
  });
  registry.register({
    id: "docling",
    name: "Docling",
    detect: async () => ({ installed: true }),
    parse: async (input) => ({ engineId: "docling", markdown: "# Hello Docling", html: "<h1>Hello Docling</h1>", jsonStructure: {}, durationMs: 50, wordCount: 3, assets: [] }),
  });

  const scraper = createWebScraper({});
  const pipeline = createKbPipeline({ store, registry, scraper, dataDir: tmpDir });

  const doc = await pipeline.ingestText({
    text: "This is test input text.",
    title: "测试文本",
    collectionId: "col_default",
  });

  assert.equal(doc.title, "测试文本");
  assert.equal(doc.markitdown_status, "done");
  assert.equal(doc.docling_status, "done");
  assert.equal(doc.markitdown_md, "# Hello MarkItDown");

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/kb-pipeline.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement pipeline.mjs**

Implement `lib/knowledge-base/pipeline.mjs` orchestrating:
- Raw file saving & SHA256 hashing
- Document record creation
- Parallel execution of available engines
- Assets persistence
- Database record updates with duration, word count, markdown, html, json

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/kb-pipeline.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge-base/pipeline.mjs tests/unit/kb-pipeline.test.mjs
git commit -m "feat(kb): implement multi-engine ingest pipeline"
```

---

### Task 5: REST API 路由实现与网关挂载 (REST Routes & Gateway Integration)

**Files:**
- Create: `lib/knowledge-base/routes.mjs`
- Modify: `server.js`
- Test: `tests/unit/kb-routes.test.mjs`

**Interfaces:**
- Produces: `createKbRoutes({ store, pipeline, registry, taskQueue, dataDir })`: returns request handler `(req, res, reqUrl, reqPath) => Promise<boolean>`

- [ ] **Step 1: Write the failing test for REST routes**

```javascript
// tests/unit/kb-routes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createKbStore } from "../../lib/knowledge-base/kb-store.mjs";
import { createEngineRegistry } from "../../lib/knowledge-base/engine-adapter.mjs";
import { createWebScraper } from "../../lib/knowledge-base/scraper.mjs";
import { createKbPipeline } from "../../lib/knowledge-base/pipeline.mjs";
import { createKbRoutes } from "../../lib/knowledge-base/routes.mjs";

test("KbRoutes: Collections and Tools status endpoints", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-routes-test-"));
  const store = createKbStore({ dbPath: path.join(tmpDir, "test.db") });
  store.init();
  const registry = createEngineRegistry();
  const scraper = createWebScraper({});
  const pipeline = createKbPipeline({ store, registry, scraper, dataDir: tmpDir });
  const handler = createKbRoutes({ store, pipeline, registry, dataDir: tmpDir });

  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url, "http://127.0.0.1");
    const handled = await handler(req, res, parsed, parsed.pathname);
    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });

  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  // GET /v1/kb/collections
  const res = await fetch(`http://127.0.0.1:${port}/v1/kb/collections`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(Array.isArray(data.collections), true);

  server.close();
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/kb-routes.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement routes.mjs and mount in server.js**

Implement `lib/knowledge-base/routes.mjs` handling all `/v1/kb/...` routes.
In `server.js`, import and mount `kbRoutesHandler(req, res, reqUrl, reqPath)` right before other extension routes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/kb-routes.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge-base/routes.mjs server.js tests/unit/kb-routes.test.mjs
git commit -m "feat(kb): mount /v1/kb REST routes into gateway"
```

---

### Task 6: 前端双引擎对比工作台与页面集成 (Desktop UI & Workbench)

**Files:**
- Create: `desktop/src/modules/knowledge-base.ts`
- Modify: `desktop/index.html`
- Modify: `desktop/src/app.ts`

**Interfaces:**
- Produces: `renderKnowledgeBase()`, `initKnowledgeBase()` mounted on window

- [ ] **Step 1: Add Knowledge Base Nav item and Section Container in desktop/index.html**

Add nav item:
```html
<a href="#knowledge-base" class="nav-item" onclick="switchTab('knowledge-base')">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
    知识库 (Knowledge Base)
</a>
```
And add `<section id="section-knowledge-base" class="section" style="display:none;">...</section>`.

- [ ] **Step 2: Implement desktop/src/modules/knowledge-base.ts**

Implement:
- Collections sidebar with document counter badges and modal for adding new collections.
- Documents search bar & list with status indicators.
- Ingest bar:
  - File drag & drop zone.
  - URL input with "Leo Cookie" toggle and "Grab Active Browser Tab" button.
  - Text input modal.
- Engine status bar with live installation progress modal (showing dynamic percentage & live terminal output).
- Dual-engine workbench:
  - Split view toggle (`Both`, `MarkItDown only`, `Docling only`).
  - Format selector: `[ Markdown | HTML | JSON ]`.
  - Side-by-side comparison panels with execution times, copy button, export button.
  - Extracted images carousel / thumbnail drawer.

- [ ] **Step 3: Wire into desktop/src/app.ts and build desktop bundle**

Modify `desktop/src/app.ts` to include `switchTab('knowledge-base')` hook.
Run: `npm run build:desktop`
Expected: esbuild completes with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/index.html desktop/src/app.ts desktop/src/modules/knowledge-base.ts desktop/dist/
git commit -m "feat(kb): implement desktop frontend workbench and dual-engine comparison view"
```

---

### Task 7: 端到端集成验证与端口 8788 联调 (End-to-End Verification on Port 8788)

**Files:**
- Test: `tests/integration/kb-e2e.test.mjs`

- [ ] **Step 1: Write integration test on port 8788**

Verify:
- Starting server on port 8788
- Checking `GET /v1/kb/tools/status`
- Creating a collection
- Ingesting a test Markdown/HTML document
- Verifying dual engine records and Markdown/HTML/JSON retrieval
- Clean shutdown

- [ ] **Step 2: Run integration test**

Run: `PORT=8788 node --test tests/integration/kb-e2e.test.mjs`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/kb-e2e.test.mjs
git commit -m "test(kb): add end-to-end integration test for knowledge base"
```
