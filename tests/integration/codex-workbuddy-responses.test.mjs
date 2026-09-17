import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TEST_PORT = 18798;
const mockPort1 = 18796;
const mockPort2 = 18797;

function readBody(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

test("codex client routes /v1/responses through workbuddy native responses", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "gateway-codex-wb-test-"));
  const node1Hits = [];
  const node2Hits = [];
  const mockWorkbuddyResponse = async (req, res, body, instance) => {
    if (body?.stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("data: " + JSON.stringify({
        id: "chatcmpl-wb-1",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { reasoning_content: "DeepSeek thinking step..." } }],
      }) + "\n\n");
      res.write("data: " + JSON.stringify({
        id: "chatcmpl-wb-2",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content: "Streaming from WorkBuddy to Codex!" } }],
      }) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl-wb-nonstream",
      object: "chat.completion",
      model: body?.model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: instance === 2 ? "Failover answer from WorkBuddy Node 2!" : "Non-streaming answer for Codex from WorkBuddy!",
        },
      }],
    }));
  };

  const mockNode1 = http.createServer(async (req, res) => {
    const bodyStr = await readBody(req);
    const body = bodyStr ? JSON.parse(bodyStr) : null;
    node1Hits.push({ url: req.url, body });

    if (body?.stream) {
      return mockWorkbuddyResponse(req, res, body, 1);
    }

    if (req.url?.includes("/v1/responses")) {
      await mockWorkbuddyResponse(req, res, body, 1);
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl-codex-wb-1",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Non-streaming answer for Codex from WorkBuddy!",
          },
        },
      ],
    }));
  });

  const mockNode2 = http.createServer(async (req, res) => {
    const bodyStr = await readBody(req);
    const body = bodyStr ? JSON.parse(bodyStr) : null;
    node2Hits.push({ url: req.url, body });

    if (body?.stream) {
      return mockWorkbuddyResponse(req, res, body, 2);
    }

    if (req.url?.includes("/v1/responses")) {
      return mockWorkbuddyResponse(req, res, body, 2);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl-codex-wb-2",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Failover answer from WorkBuddy Node 2!",
          },
        },
      ],
    }));
  });

  await new Promise((r) => mockNode1.listen(mockPort1, "127.0.0.1", r));
  await new Promise((r) => mockNode2.listen(mockPort2, "127.0.0.1", r));
  t.after(() => {
    mockNode1.close();
    mockNode2.close();
  });

  const config = {
    port: TEST_PORT,
    bind: "127.0.0.1",
    clients: {
      codex: {
        name: "Codex",
        protocol: "openai",
        endpoints: [
          {
            id: "ep-codex-wb-1",
            name: "WorkBuddy Node 1",
            type: "workbuddy",
            base_url: `http://127.0.0.1:${mockPort1}/v1`,
            auth: "none",
            models: ["deepseek-v4.1-flash"],
          },
          {
            id: "ep-codex-wb-2",
            name: "WorkBuddy Node 2",
            type: "workbuddy",
            base_url: `http://127.0.0.1:${mockPort2}/v1`,
            auth: "none",
            models: ["deepseek-v4.1-flash"],
          },
        ],
      },
    },
  };

  const configPath = path.join(tempDir, "gateway.config.json");
  const secretsPath = path.join(tempDir, "gateway.secrets.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await writeFile(secretsPath, JSON.stringify({ api_keys: {} }, null, 2));

  const gateway = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      GATEWAY_PORT: String(TEST_PORT),
      GATEWAY_CONFIG_FILE: configPath,
      GATEWAY_SECRETS_FILE: secretsPath,
      GATEWAY_NO_OPEN: "1",
      CLAUDE_3P_SYNC_DISABLED: "1",
      CLAUDE_CODE_SYNC_DISABLED: "1",
      CODEX_WRITE_MODEL_CATALOG_DISABLED: "1",
      LOG_FILE: path.join(tempDir, "gateway.log"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  gateway.stderr.on("data", (chunk) => process.stderr.write("[gateway] " + chunk));

  t.after(async () => {
    gateway.kill();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const startAt = Date.now();
  while (Date.now() - startAt < 10000) {
    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  // 1. Non-streaming test: POST /codex/v1/responses
  const nonStreamRes = await fetch(`http://127.0.0.1:${TEST_PORT}/codex/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer dummy",
    },
    body: JSON.stringify({
      model: "deepseek-v4.1-flash",
      input: [{ role: "user", content: [{ type: "input_text", text: "Hello Codex non-stream" }] }],
    }),
  });

  assert.equal(nonStreamRes.status, 200);
  const nonStreamData = await nonStreamRes.json();
  assert.equal(nonStreamData.status, "completed");
  assert.equal(nonStreamData.output_text, "Non-streaming answer for Codex from WorkBuddy!");

  // Verify that WorkBuddy receives translated Chat Completions request
  const hit1 = node1Hits[0] || node2Hits[0];
  assert.ok(hit1);
  assert.ok(hit1.url.includes("/v1/chat/completions"));
  assert.equal(hit1.body.model, "deepseek-v4.1-flash");
  assert.equal(hit1.body.messages[0].role, "system");
  assert.equal(hit1.body.messages[1].content[0].text, "Hello Codex non-stream");

  // 2. Streaming test: POST /codex/v1/responses with stream: true
  // Verify reasoning_content -> reasoningDelta, content -> text.delta
  const streamRes = await fetch(`http://127.0.0.1:${TEST_PORT}/codex/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer dummy",
    },
    body: JSON.stringify({
      model: "deepseek-v4.1-flash",
      stream: true,
      input: [{ role: "user", content: [{ type: "input_text", text: "Hello Codex stream" }] }],
    }),
  });

  assert.equal(streamRes.status, 200);
  const sseText = await streamRes.text();
  assert.match(sseText, /DeepSeek thinking step\.\.\./);
  assert.match(sseText, /Streaming from WorkBuddy to Codex!/);
  assert.match(sseText, /response\.completed/);

  assert.equal(node1Hits.length, 1);
});
