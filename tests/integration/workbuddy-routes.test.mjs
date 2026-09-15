import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TEST_PORT = 8791;

function readBody(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

test("workbuddy endpoint protocol forwarding and status API", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "gateway-wb-test-"));
  const requests = [];

  // Mock WorkBuddy upstream server (OpenAI compatible)
  const mockWorkbuddyPort = 7899;
  const mockWorkbuddy = http.createServer(async (req, res) => {
    const bodyStr = await readBody(req);
    const body = bodyStr ? JSON.parse(bodyStr) : null;
    requests.push({ url: req.url, method: req.method, headers: req.headers, body });

    res.setHeader("Content-Type", "application/json");

    if (req.url === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.url?.includes("/v2/plugin/auth/state")) {
      res.writeHead(200);
      res.end(JSON.stringify({
        code: 0,
        msg: "OK",
        data: {
          state: "mock-state-123",
          authUrl: "https://mock.workbuddy.ai/login?state=mock-state-123"
        }
      }));
      return;
    }

    if (req.url === "/v1/models") {
      res.writeHead(200);
      res.end(JSON.stringify({
        data: [
          { id: "deepseek-r1", name: "DeepSeek R1" },
          { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet" }
        ]
      }));
      return;
    }

    if (req.url === "/v1/chat/completions") {
      if (body?.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ id: "chunk-1", object: "chat.completion.chunk", choices: [{ delta: { role: "assistant", reasoning_content: "Thinking in stream..." } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: "chunk-2", object: "chat.completion.chunk", choices: [{ delta: { content: "Streaming text from WorkBuddy" } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        id: "chatcmpl-wb-123",
        object: "chat.completion",
        created: 1700000000,
        model: body?.model || "deepseek-r1",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello from WorkBuddy upstream!",
              reasoning_content: "WorkBuddy internal thinking step...",
            },
            finish_reason: "stop",
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise((resolve) => mockWorkbuddy.listen(mockWorkbuddyPort, "127.0.0.1", resolve));
  t.after(() => mockWorkbuddy.close());

  // Prepare gateway config with workbuddy endpoint
  const config = {
    port: TEST_PORT,
    bind: "127.0.0.1",
    clients: {
      code: {
        name: "Claude Code",
        protocol: "anthropic",
        endpoints: [
          {
            id: "ep-wb-code",
            name: "WorkBuddy Agent Pool",
            type: "workbuddy",
            base_url: `http://127.0.0.1:${mockWorkbuddyPort}/v1`,
            auth: "none",
            models: ["deepseek-r1", "claude-3-7-sonnet"],
            capabilities: { reasoning: true, tools: true },
          }
        ]
      },
      desktop: {
        name: "Desktop Client",
        protocol: "openai",
        endpoints: [
          {
            id: "ep-wb-desktop",
            name: "WorkBuddy Agent Pool",
            type: "workbuddy",
            base_url: `http://127.0.0.1:${mockWorkbuddyPort}/v1`,
            auth: "none",
            models: ["deepseek-r1"],
          }
        ]
      }
    }
  };

  const configPath = path.join(tempDir, "gateway.config.json");
  const secretsPath = path.join(tempDir, "gateway.secrets.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await writeFile(secretsPath, JSON.stringify({ api_keys: {} }, null, 2));

  // Spawn gateway
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

  t.after(async () => {
    gateway.kill("SIGTERM");
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  // Wait for gateway to be ready
  const startAt = Date.now();
  while (Date.now() - startAt < 10000) {
    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  // 1. Verify GET /v1/workbuddy/status API
  const statusRes = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/workbuddy/status`);
  assert.equal(statusRes.status, 200);
  const statusData = await statusRes.json();
  assert.equal(statusData.success, true);
  assert.equal(typeof statusData.installed, "boolean");

  // 2. Test Anthropic protocol messages forwarding through /code/v1/messages
  const anthropicRes = await fetch(`http://127.0.0.1:${TEST_PORT}/code/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "dummy-client-key",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "deepseek-r1",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hi there!" }],
    }),
  });

  if (anthropicRes.status !== 200) {
    console.error("Anthropic route failed:", anthropicRes.status, await anthropicRes.text());
  }
  assert.equal(anthropicRes.status, 200);
  const anthropicData = await anthropicRes.json();
  assert.equal(anthropicData.type, "message");
  assert.equal(anthropicData.role, "assistant");
  // Check that choices content was converted to content blocks
  const textBlock = anthropicData.content.find((b) => b.type === "text");
  assert.ok(textBlock);
  assert.equal(textBlock.text, "Hello from WorkBuddy upstream!");
  // Check that reasoning_content was converted to thinking block
  const thinkingBlock = anthropicData.content.find((b) => b.type === "thinking");
  assert.ok(thinkingBlock);
  assert.equal(thinkingBlock.thinking, "WorkBuddy internal thinking step...");

  // 3. Test OpenAI protocol chat completions forwarding through /desktop/v1/chat/completions
  const openaiRes = await fetch(`http://127.0.0.1:${TEST_PORT}/desktop/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test",
    },
    body: JSON.stringify({
      model: "deepseek-r1",
      messages: [{ role: "user", content: "Hello OpenAI format" }],
    }),
  });

  if (openaiRes.status !== 200) {
    console.error("OpenAI route failed:", openaiRes.status, await openaiRes.text());
  }
  assert.equal(openaiRes.status, 200);
  const openaiData = await openaiRes.json();
  assert.equal(openaiData.choices[0].message.content, "Hello from WorkBuddy upstream!");

  // 4. Test Anthropic streaming messages with thinking delta through /code/v1/messages
  const anthropicStreamRes = await fetch(`http://127.0.0.1:${TEST_PORT}/code/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "dummy-client-key",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "deepseek-r1",
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "user", content: "Stream me!" }],
    }),
  });

  assert.equal(anthropicStreamRes.status, 200);
  const sseBody = await anthropicStreamRes.text();
  assert.match(sseBody, /thinking_delta/);
  assert.match(sseBody, /Thinking in stream\.\.\./);
  assert.match(sseBody, /text_delta/);
  assert.match(sseBody, /Streaming text from WorkBuddy/);

  // 5. Test OpenAI streaming completions through /desktop/v1/chat/completions
  const openaiStreamRes = await fetch(`http://127.0.0.1:${TEST_PORT}/desktop/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test",
    },
    body: JSON.stringify({
      model: "deepseek-r1",
      stream: true,
      messages: [{ role: "user", content: "Stream OpenAI format" }],
    }),
  });

  assert.equal(openaiStreamRes.status, 200);
  const openaiSseBody = await openaiStreamRes.text();
  assert.match(openaiSseBody, /Thinking in stream\.\.\./);
  assert.match(openaiSseBody, /Streaming text from WorkBuddy/);
  assert.match(openaiSseBody, /\[DONE\]/);

  // 6. Test POST /v1/workbuddy/login route returns auth_url
  const loginRes = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/workbuddy/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: `http://127.0.0.1:${mockWorkbuddyPort}`,
      openBrowser: false,
    }),
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.equal(loginData.success, true);
  assert.equal(loginData.state, "mock-state-123");
  assert.equal(loginData.auth_url, "https://mock.workbuddy.ai/login?state=mock-state-123");
});
