import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

async function stopChild(child) {
  if (child.exitCode != null || child.signalCode != null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Gateway exited before health check: ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Waiting for gateway to listen
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Gateway health check timed out.");
}

async function startGateway(t, config, extraEnv = {}) {
  const reservation = http.createServer();
  const gatewayPort = await listen(reservation);
  await closeServer(reservation);

  const tempDir = await mkdtemp(path.join(tmpdir(), "codex-shield-integration-"));
  const configPath = path.join(tempDir, "gateway.config.json");
  const authPath = path.join(tempDir, "auth.json");

  const validJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QiLCJleHAiOjk5OTk5OTk5OTl9.signature";
  await writeFile(
    authPath,
    JSON.stringify({
      tokens: { access_token: validJwt },
      account_id: "test_account",
    }),
  );

  const resolvedConfig = typeof config === "function" ? await config(tempDir, authPath) : config;
  await writeFile(
    configPath,
    JSON.stringify({
      server: { host: "127.0.0.1", port: gatewayPort, proxy: { enabled: false } },
      ...resolvedConfig,
    }),
  );

  const gateway = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      GATEWAY_CONFIG_FILE: configPath,
      GATEWAY_NO_OPEN: "1",
      GATEWAY_PORT: String(gatewayPort),
      CLAUDE_3P_SYNC_DISABLED: "1",
      CODEX_HOME: tempDir,
      OFFICIAL_CODEX_PROXY_DISABLED: "1",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      all_proxy: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(async () => {
    await stopChild(gateway);
    await rm(tempDir, { recursive: true, force: true });
  });

  await waitForHealth(gatewayPort, gateway);
  return { gatewayPort, tempDir, authPath };
}

function codexPost(port, body, headers = {}) {
  return fetch(`http://127.0.0.1:${port}/codex/v1/responses`, {
    method: "POST",
    headers: {
      authorization: "Bearer dummy",
      "content-type": "application/json",
      originator: "Codex Desktop",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("Codex 429 Rate Limit Shield intercepts streaming 429 into 200 OK SSE events", async (t) => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          detail: {
            clears_in: 14400,
            message: "Usage limit exceeded",
          },
        }),
      );
    });
  });

  const upstreamPort = await listen(upstream);
  t.after(() => closeServer(upstream));

  const { gatewayPort } = await startGateway(t, (tempDir, authPath) => ({
    clients: {
      codex: {
        rate_limit_shield: { enabled: true },
        endpoints: [
          {
            name: "official-mock",
            type: "codex-subscription",
            proxy: "",
            base_url: `http://127.0.0.1:${upstreamPort}/backend-api/codex/responses`,
            auth_path: authPath,
            models: ["gpt-5.6-sol"],
          },
        ],
      },
    },
  }), { CODEX_OFFICIAL_URL: `http://127.0.0.1:${upstreamPort}/backend-api/codex/responses` });

  const res = await codexPost(gatewayPort, {
    model: "gpt-5.6-sol",
    input: "Hello world",
    stream: true,
  });

  if (res.status !== 200) {
    console.error("Test 1 received error:", res.status, await res.text());
  }
  assert.equal(res.status, 200, "Should convert 429 to 200 OK to keep send button enabled");
  assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));

  const text = await res.text();
  assert.ok(text.includes("event: response.created"));
  assert.ok(text.includes("event: response.output_text.delta"));
  assert.ok(text.includes("event: response.completed"));
  assert.ok(text.includes("官方模型当前配额已耗尽"));
  assert.ok(text.includes("约 4 小时后"));
  assert.ok(text.includes("输入框已为您保持可用"));
});

test("Codex 429 Rate Limit Shield handles non-stream title requests as 200 OK fallback", async (t) => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          detail: {
            clears_in: 7200,
            message: "Usage limit exceeded",
          },
        }),
      );
    });
  });

  const upstreamPort = await listen(upstream);
  t.after(() => closeServer(upstream));

  const { gatewayPort } = await startGateway(t, (tempDir, authPath) => ({
    clients: {
      codex: {
        rate_limit_shield: { enabled: true },
        endpoints: [
          {
            name: "official-mock",
            type: "codex-subscription",
            proxy: "",
            base_url: `http://127.0.0.1:${upstreamPort}/backend-api/codex/responses`,
            auth_path: authPath,
            models: ["gpt-5.6-luna"],
          },
        ],
      },
    },
  }), { CODEX_OFFICIAL_URL: `http://127.0.0.1:${upstreamPort}/backend-api/codex/responses` });

  const res = await codexPost(gatewayPort, {
    model: "gpt-5.6-luna",
    input: [{ text: "Generate a concise title for thread" }],
    stream: false,
  });

  assert.equal(res.status, 200, "Should return 200 OK for background title requests");
  assert.ok(res.headers.get("content-type")?.includes("application/json"));

  const json = await res.json();
  assert.equal(json.status, "completed");
  assert.equal(json.output[0].content[0].text, "新对话");
});

test("Codex Rate Limit Shield preserves 429 when explicitly disabled", async (t) => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          detail: {
            clears_in: 3600,
            message: "Usage limit exceeded",
          },
        }),
      );
    });
  });

  const upstreamPort = await listen(upstream);
  t.after(() => closeServer(upstream));

  const { gatewayPort } = await startGateway(t, (tempDir, authPath) => ({
    clients: {
      codex: {
        rate_limit_shield: { enabled: false },
        endpoints: [
          {
            name: "official-mock",
            type: "codex-subscription",
            proxy: "",
            base_url: `http://127.0.0.1:${upstreamPort}/backend-api/codex/responses`,
            auth_path: authPath,
            models: ["gpt-5.6-sol"],
          },
        ],
      },
    },
  }), { CODEX_OFFICIAL_URL: `http://127.0.0.1:${upstreamPort}/backend-api/codex/responses` });

  const res = await codexPost(gatewayPort, {
    model: "gpt-5.6-sol",
    input: "Hello world",
    stream: true,
  });

  assert.equal(res.status, 429, "Should preserve 429 when shield is disabled");
});
