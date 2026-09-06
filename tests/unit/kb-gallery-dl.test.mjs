import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectGalleryDl, downloadImageFromUrl } from "../../lib/knowledge-base/gallery-dl.mjs";
import { createKbStore } from "../../lib/knowledge-base/kb-store.mjs";
import { createEngineRegistry } from "../../lib/knowledge-base/engine-adapter.mjs";
import { createWebScraper } from "../../lib/knowledge-base/scraper.mjs";
import { createKbPipeline } from "../../lib/knowledge-base/pipeline.mjs";
import { createKbRoutes } from "../../lib/knowledge-base/routes.mjs";

test("GalleryDL: detectGalleryDl returns valid object or null", () => {
  const info = detectGalleryDl();
  // If installed, check properties
  if (info) {
    assert.equal(typeof info.path, "string");
    assert.equal(typeof info.version, "string");
    assert.ok(info.version.length > 0);
  }
});

test("GalleryDL: downloadImageFromUrl downloads from HTTP server fallback", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-dl-test-"));

  // Create a mock HTTP image server
  // 1x1 transparent PNG buffer
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );

  const mockServer = http.createServer((req, res) => {
    if (req.url === "/sample.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(png1x1);
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  await new Promise((r) => mockServer.listen(0, r));
  const port = mockServer.address().port;

  try {
    const result = await downloadImageFromUrl(`http://127.0.0.1:${port}/sample.png`, tmpDir);
    assert.ok(result.filePath);
    assert.ok(fs.existsSync(result.filePath));
    assert.equal(result.buffer.length, png1x1.length);
    assert.ok(result.fileName.endsWith(".png"));
  } finally {
    mockServer.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test("KbRoutes: POST /v1/kb/ingest/image-url and GET /v1/kb/tools/status", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-img-url-test-"));
  const store = createKbStore({ dbPath: path.join(tmpDir, "test.db") });
  store.init();
  const registry = createEngineRegistry();
  const scraper = createWebScraper({});
  const pipeline = createKbPipeline({ store, registry, scraper, dataDir: tmpDir });
  const handler = createKbRoutes({ store, pipeline, registry, dataDir: tmpDir });

  // 1x1 transparent PNG buffer
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );

  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url, "http://127.0.0.1");
    if (parsed.pathname === "/mock-pic.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(png1x1);
      return;
    }
    const handled = await handler(req, res, parsed, parsed.pathname);
    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });

  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  try {
    // 1. Check tools status has gallery_dl
    const resTools = await fetch(`http://127.0.0.1:${port}/v1/kb/tools/status`);
    const dataTools = await resTools.json();
    assert.equal(resTools.status, 200);
    assert.ok(dataTools.tools.gallery_dl);
    assert.equal(typeof dataTools.tools.gallery_dl.available, "boolean");

    // 2. POST /v1/kb/ingest/image-url
    const resIngest = await fetch(`http://127.0.0.1:${port}/v1/kb/ingest/image-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `http://127.0.0.1:${port}/mock-pic.png`,
        title: "测试网络图像",
        collection_id: "col_default",
      }),
    });

    assert.equal(resIngest.status, 200);
    const dataIngest = await resIngest.json();
    assert.equal(dataIngest.ok, true);
    assert.equal(dataIngest.document.title, "测试网络图像");
    assert.equal(dataIngest.document.doc_type, "image");
    assert.equal(dataIngest.document.source_url, `http://127.0.0.1:${port}/mock-pic.png`);

    // 3. Verify final.md was written
    const finalMdPath = path.join(tmpDir, "files", dataIngest.document.id, "final.md");
    assert.ok(fs.existsSync(finalMdPath));
  } finally {
    server.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});
