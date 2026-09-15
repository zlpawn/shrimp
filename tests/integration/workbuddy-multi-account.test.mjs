import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TEST_PORT = 18795;
const mockPort1 = 17891;
const mockPort2 = 17892;

function readBody(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

test("workbuddy multi-account round-robin and 429 failover", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "gateway-wb-multi-test-"));
  const node1Hits = [];
  const node2Hits = [];
  let node1ShouldFailWith429 = false;

  const mockNode1 = http.createServer(async (req, res) => {
    const bodyStr = await readBody(req);
    const body = bodyStr ? JSON.parse(bodyStr) : null;
    node1Hits.push({ url: req.url, body });

    if (node1ShouldFailWith429) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit exceeded on Account 1", type: "requests" } }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl-wb-node-1",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "Response from Account 1" } }],
    }));
  });

  const mockNode2 = http.createServer(async (req, res) => {
    const bodyStr = await readBody(req);
    const body = bodyStr ? JSON.parse(bodyStr) : null;
    node2Hits.push({ url: req.url, body });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl-wb-node-2",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "Response from Account 2" } }],
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
      code: {
        name: "Claude Code",
        protocol: "anthropic",
        endpoints: [
          {
            id: "ep-wb-acc-1",
            name: "WorkBuddy 账号 1 (:17891)",
            type: "workbuddy",
            base_url: `http://127.0.0.1:${mockPort1}/v1`,
            auth: "none",
            models: ["deepseek-v4.1-flash"],
          },
          {
            id: "ep-wb-acc-2",
            name: "WorkBuddy 账号 2 (:17892)",
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

  t.after(async () => {
    gateway.kill("SIGTERM");
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

  // 1. Verify Round-Robin: send 2 requests, one goes to Node 1, one goes to Node 2
  const sendRequest = async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/code/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "dummy",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "deepseek-v4.1-flash",
        max_tokens: 100,
        messages: [{ role: "user", content: "test round-robin" }],
      }),
    });
    return res.json();
  };

  const res1 = await sendRequest();
  const res2 = await sendRequest();

  assert.equal(node1Hits.length, 1, "Node 1 should receive 1 request in round-robin");
  assert.equal(node2Hits.length, 1, "Node 2 should receive 1 request in round-robin");

  // 2. Verify 429 Failover: Node 1 fails with 429, gateway automatically retries on Node 2
  node1ShouldFailWith429 = true;
  const initialNode2Hits = node2Hits.length;

  const res3 = await sendRequest();
  const textBlock = res3.content.find((b) => b.type === "text");
  assert.ok(textBlock);
  assert.equal(textBlock.text, "Response from Account 2", "Should failover to Account 2 seamlessly");
  assert.equal(node2Hits.length, initialNode2Hits + 1, "Node 2 should have taken over the failed request");
});
