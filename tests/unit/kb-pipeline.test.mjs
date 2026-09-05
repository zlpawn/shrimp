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
  assert.equal(doc.docling_md, "# Hello Docling");

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("KbPipeline: Ingest file and calculate file hash", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-pipe-file-test-"));
  const store = createKbStore({ dbPath: path.join(tmpDir, "test.db") });
  store.init();
  const registry = createEngineRegistry();
  registry.register({
    id: "markitdown",
    name: "MarkItDown",
    detect: async () => ({ installed: true }),
    parse: async () => ({ engineId: "markitdown", markdown: "file md", durationMs: 15, wordCount: 2, assets: [] }),
  });
  registry.register({
    id: "docling",
    name: "Docling",
    detect: async () => ({ installed: true }),
    parse: async () => ({ engineId: "docling", markdown: "file docling", html: "<p>file docling</p>", durationMs: 25, wordCount: 2, assets: [] }),
  });
  const scraper = createWebScraper({});
  const pipeline = createKbPipeline({ store, registry, scraper, dataDir: tmpDir });

  const dummyFilePath = path.join(tmpDir, "sample.txt");
  fs.writeFileSync(dummyFilePath, "Hello World file content");

  const doc = await pipeline.ingestFile({
    filePath: dummyFilePath,
    originalFilename: "sample.txt",
    collectionId: "col_default",
  });

  assert.equal(doc.file_name, "sample.txt");
  assert.equal(Boolean(doc.file_hash), true);
  assert.equal(doc.markitdown_md, "file md");
  assert.equal(doc.docling_md, "file docling");

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
