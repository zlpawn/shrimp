import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import http from "node:http";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(port, maxTries = 30) {
  for (let i = 0; i < maxTries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  return false;
}

test("KB E2E Integration: Gateway runs on port 8788 with full KB API and zero regression", { timeout: 60_000 }, async () => {
  const testPort = 8788;
  const serverPath = path.resolve("server.js");

  const serverProc = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(testPort),
      GATEWAY_PORT: String(testPort),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  serverProc.stdout.on("data", (c) => (serverOutput += c.toString()));
  serverProc.stderr.on("data", (c) => (serverOutput += c.toString()));

  try {
    const ready = await waitForServer(testPort);
    assert.equal(ready, true, `Server failed to start on port ${testPort}. Logs:\n${serverOutput}`);

    // 1. Verify Historical Function: Home page / Desktop UI loads
    const homeRes = await fetch(`http://127.0.0.1:${testPort}/`);
    assert.equal(homeRes.status, 200);
    const homeHtml = await homeRes.text();
    assert.equal(homeHtml.includes("知识库 (Knowledge Base)"), true, "Home page includes KB nav item");
    assert.equal(homeHtml.includes("section-knowledge-base"), true, "Home page includes KB section");

    // 2. Verify Historical Function: Health check endpoint
    const healthRes = await fetch(`http://127.0.0.1:${testPort}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.ok, true);
    assert.equal(healthData.service, "shrimp");

    // 3. KB: GET /v1/kb/tools/status
    const toolsRes = await fetch(`http://127.0.0.1:${testPort}/v1/kb/tools/status`);
    assert.equal(toolsRes.status, 200);
    const toolsData = await toolsRes.json();
    assert.equal("markitdown" in toolsData.tools, true);
    assert.equal("docling" in toolsData.tools, true);

    // 4. KB: GET /v1/kb/collections
    const colRes = await fetch(`http://127.0.0.1:${testPort}/v1/kb/collections`);
    assert.equal(colRes.status, 200);
    const colData = await colRes.json();
    assert.equal(Array.isArray(colData.collections), true);
    assert.equal(colData.collections.length >= 1, true);

    // 5. KB: POST /v1/kb/collections
    const createColRes = await fetch(`http://127.0.0.1:${testPort}/v1/kb/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "集成测试知识库", description: "用于8788端口联调" }),
    });
    assert.equal(createColRes.status, 200);
    const createdColData = await createColRes.json();
    const colId = createdColData.collection.id;

    // 6. KB: POST /v1/kb/ingest/text
    const ingestRes = await fetch(`http://127.0.0.1:${testPort}/v1/kb/ingest/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "# 集成测试文档\n这是通过8788端口提交的纯文本内容，用于验证双引擎处理流程与数据库持久化。",
        title: "8788端到端联调文档",
        collection_id: colId,
      }),
    });
    assert.equal(ingestRes.status, 200);
    const ingestData = await ingestRes.json();
    const docId = ingestData.document.id;
    assert.equal(ingestData.document.title, "8788端到端联调文档");

    // 7. KB: GET /v1/kb/documents?collection_id=...
    const docsRes = await fetch(`http://127.0.0.1:${testPort}/v1/kb/documents?collection_id=${colId}`);
    assert.equal(docsRes.status, 200);
    const docsData = await docsRes.json();
    assert.equal(docsData.documents.length, 1);
    assert.equal(docsData.documents[0].id, docId);

    // 8. KB: GET /v1/kb/documents/:id
    const docDetailRes = await fetch(`http://127.0.0.1:${testPort}/v1/kb/documents/${docId}`);
    assert.equal(docDetailRes.status, 200);
    const docDetailData = await docDetailRes.json();
    assert.equal(docDetailData.document.id, docId);
    assert.equal(docDetailData.document.collection_id, colId);
    assert.equal(docDetailData.document.title, "8788端到端联调文档");

    // 9. KB: Search documents
    const searchRes = await fetch(`http://127.0.0.1:${testPort}/v1/kb/documents?q=集成测试`);
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.equal(searchData.documents.length >= 1, true);

    // 10. Clean up: DELETE document and collection
    const delDocRes = await fetch(`http://127.0.0.1:${testPort}/v1/kb/documents/${docId}`, { method: "DELETE" });
    assert.equal(delDocRes.status, 200);

    const delColRes = await fetch(`http://127.0.0.1:${testPort}/v1/kb/collections/${colId}`, { method: "DELETE" });
    assert.equal(delColRes.status, 200);

  } finally {
    if (process.platform === "win32" && serverProc.pid) {
      try {
        spawn("taskkill.exe", ["/F", "/T", "/PID", String(serverProc.pid)], { stdio: "ignore" });
      } catch {
        serverProc.kill("SIGKILL");
      }
    } else {
      serverProc.kill("SIGINT");
      await sleep(500);
      if (!serverProc.killed) serverProc.kill("SIGKILL");
    }
  }
});
