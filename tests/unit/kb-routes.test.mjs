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

test("KbRoutes: Collections, documents, and tools status endpoints", async () => {
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

  // 1. GET /v1/kb/collections
  const resCol = await fetch(`http://127.0.0.1:${port}/v1/kb/collections`);
  const dataCol = await resCol.json();
  assert.equal(resCol.status, 200);
  assert.equal(Array.isArray(dataCol.collections), true);
  assert.equal(dataCol.collections.length >= 1, true);

  // 2. POST /v1/kb/collections
  const resCreateCol = await fetch(`http://127.0.0.1:${port}/v1/kb/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "新项目研报", description: "项目专属" }),
  });
  const dataCreateCol = await resCreateCol.json();
  assert.equal(resCreateCol.status, 200);
  assert.equal(dataCreateCol.collection.name, "新项目研报");

  // 3. GET /v1/kb/tools/status
  const resTools = await fetch(`http://127.0.0.1:${port}/v1/kb/tools/status`);
  const dataTools = await resTools.json();
  assert.equal(resTools.status, 200);
  assert.equal("tools" in dataTools, true);

  // 4. POST /v1/kb/ingest/text
  const resIngestText = await fetch(`http://127.0.0.1:${port}/v1/kb/ingest/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "# 接口测试内容\n这是段落测试。",
      title: "接口测试标题",
      collection_id: dataCreateCol.collection.id,
    }),
  });
  const dataIngestText = await resIngestText.json();
  assert.equal(resIngestText.status, 200);
  assert.equal(dataIngestText.document.title, "接口测试标题");

  // 5. GET /v1/kb/documents
  const resDocs = await fetch(`http://127.0.0.1:${port}/v1/kb/documents?collection_id=${dataCreateCol.collection.id}`);
  const dataDocs = await resDocs.json();
  assert.equal(resDocs.status, 200);
  assert.equal(dataDocs.documents.length, 1);

  // 6. GET /v1/kb/documents/:id
  const resDocDetail = await fetch(`http://127.0.0.1:${port}/v1/kb/documents/${dataIngestText.document.id}`);
  const dataDocDetail = await resDocDetail.json();
  assert.equal(resDocDetail.status, 200);
  assert.equal(dataDocDetail.document.id, dataIngestText.document.id);

  // 7. PUT /v1/kb/collections/:id (Rename collection)
  const resUpdateCol = await fetch(`http://127.0.0.1:${port}/v1/kb/collections/${dataCreateCol.collection.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "已更名专栏", description: "全新描述" }),
  });
  const dataUpdateCol = await resUpdateCol.json();
  assert.equal(resUpdateCol.status, 200);
  assert.equal(dataUpdateCol.collection.name, "已更名专栏");

  // 8. DELETE /v1/kb/collections/col_default (Should fail with 400)
  const resDelDefault = await fetch(`http://127.0.0.1:${port}/v1/kb/collections/col_default`, {
    method: "DELETE",
  });
  assert.equal(resDelDefault.status, 400);

  // 9. POST /v1/kb/documents/:id/adopt (Adopt document and verify physical final.md)
  const docId = dataIngestText.document.id;
  const resAdopt = await fetch(`http://127.0.0.1:${port}/v1/kb/documents/${docId}/adopt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      engine: "docling",
      content: "# 采纳版本：示例文档权威指引\n\n经过团队对比，采纳 Docling 解析结果作为正式知识库文档。",
    }),
  });
  const dataAdopt = await resAdopt.json();
  assert.equal(resAdopt.status, 200);
  assert.equal(dataAdopt.ok, true);
  assert.equal(dataAdopt.document.adopted_engine, "docling");
  assert.ok(dataAdopt.document.accepted_at > 0);
  assert.ok(dataAdopt.document.final_content.includes("采纳版本"));

  // Verify physical file on disk exists!
  const finalFile = path.join(tmpDir, "files", docId, "final.md");
  assert.equal(fs.existsSync(finalFile), true);
  const savedContent = fs.readFileSync(finalFile, "utf8");
  assert.equal(savedContent, dataAdopt.document.final_content);

  // 10. POST /v1/kb/documents/agent-prompt (Generate cross-platform Agent prompt)
  const resPrompt = await fetch(`http://127.0.0.1:${port}/v1/kb/documents/agent-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doc_ids: [docId],
    }),
  });
  const dataPrompt = await resPrompt.json();
  assert.equal(resPrompt.status, 200);
  assert.equal(dataPrompt.ok, true);
  assert.ok(dataPrompt.promptText.includes("请基于以下已解析与校验的知识库素材进行分析与知识沉淀"));
  assert.ok(dataPrompt.promptText.includes("接口测试标题"));
  assert.ok(dataPrompt.promptText.includes("file:///"));
  assert.ok(dataPrompt.promptText.includes("final.md"));
  assert.equal(dataPrompt.items.length, 1);
  assert.equal(dataPrompt.items[0].id, docId);

  // 11. DELETE /v1/kb/collections/:id (Delete created collection)
  const resDelCol = await fetch(`http://127.0.0.1:${port}/v1/kb/collections/${dataCreateCol.collection.id}`, {
    method: "DELETE",
  });
  const dataDelCol = await resDelCol.json();
  assert.equal(resDelCol.status, 200);
  assert.equal(dataDelCol.ok, true);

  server.close();
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
