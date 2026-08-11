import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function reservePort() {
  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise((resolve, reject) => {
    reservation.close((error) => error ? reject(error) : resolve());
  });
  return port;
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
      // The isolated gateway is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Gateway health check timed out.");
}

async function readBody(request) {
  let raw = "";
  request.setEncoding("utf8");
  for await (const chunk of request) raw += chunk;
  return raw;
}

function anthropicSuccess(model) {
  return {
    id: "msg_multi_key",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: "OK" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 1 },
  };
}

function openAIChatSuccess(model) {
  return {
    id: "chatcmpl_multi_key",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: "OK" },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  };
}

async function startRoutingFixture(t, {
  endpoint,
  secrets,
  respond,
}) {
  const requests = [];
  const upstream = http.createServer(async (request, response) => {
    const body = JSON.parse(await readBody(request) || "{}");
    const apiKey = request.headers["x-api-key"]
      || String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    requests.push({
      apiKey,
      authorization: request.headers.authorization || "",
      xApiKey: request.headers["x-api-key"] || "",
      body,
    });
    await respond({ request, response, apiKey, body, requests });
  });
  const upstreamPort = await listen(upstream);

  const gatewayPort = await reservePort();
  const tempDir = await mkdtemp(path.join(tmpdir(), "gateway-multi-key-routing-"));
  const configPath = path.join(tempDir, "gateway.config.json");
  const secretsPath = path.join(tempDir, "gateway.secrets.json");
  const logPath = path.join(tempDir, "gateway.log");
  const configuredEndpoint = {
    id: endpoint.id,
    name: endpoint.name || endpoint.id,
    type: endpoint.type,
    base_url: `http://127.0.0.1:${upstreamPort}`,
    models: [endpoint.model],
    model_mapping: {},
    ...endpoint,
  };

  await writeFile(configPath, JSON.stringify({
    server: { host: "127.0.0.1", port: gatewayPort },
    clients: {
      code: { endpoints: [configuredEndpoint] },
      codex: { endpoints: [] },
      deeptutor: { endpoints: [] },
      desktop: { endpoints: [] },
    },
  }));
  await writeFile(secretsPath, JSON.stringify({ api_keys: secrets }));

  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      GATEWAY_CONFIG_FILE: configPath,
      GATEWAY_SECRETS_FILE: secretsPath,
      GATEWAY_PORT: String(gatewayPort),
      GATEWAY_NO_OPEN: "1",
      CLAUDE_3P_SYNC_DISABLED: "1",
      CLAUDE_CODE_SYNC_DISABLED: "1",
      CODEX_WRITE_MODEL_CATALOG_DISABLED: "1",
      CODEX_MODELS_LIVE_DISABLED: "1",
      UPSTREAM_RETRY_BACKOFF_MS: "1",
      LOG_FILE: logPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(async () => {
    if (child.exitCode == null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await new Promise((resolve) => upstream.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  });

  await waitForHealth(gatewayPort, child);

  return {
    requests,
    logPath,
    async request() {
      return fetch(`http://127.0.0.1:${gatewayPort}/code/v1/messages`, {
        method: "POST",
        headers: {
          authorization: "Bearer all",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: `anthropic.gateway.${endpoint.id}.${endpoint.model}`,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply OK." }],
        }),
      });
    },
    async send() {
      const response = await this.request();
      const raw = await response.text();
      assert.equal(response.status, 200, raw);
      return JSON.parse(raw);
    },
  };
}

test("Anthropic failover uses the next credential after a 503", async (t) => {
  const fixture = await startRoutingFixture(t, {
    endpoint: {
      id: "ep_anthropic_failover",
      type: "anthropic",
      auth: "x-api-key",
      model: "anthropic-failover-model",
      api_keys: [{ id: "cred_a" }, { id: "cred_b" }],
      key_strategy: "failover",
    },
    secrets: {
      "ep_anthropic_failover::cred_a": "anthropic-key-a",
      "ep_anthropic_failover::cred_b": "anthropic-key-b",
    },
    respond: async ({ response, apiKey, body }) => {
      response.setHeader("content-type", "application/json");
      if (apiKey === "anthropic-key-a") {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: { message: "overloaded" } }));
        return;
      }
      response.end(JSON.stringify(anthropicSuccess(body.model)));
    },
  });

  const result = await fixture.send();
  assert.equal(result.content[0].text, "OK");
  assert.deepEqual(
    fixture.requests.map((request) => request.apiKey),
    ["anthropic-key-a", "anthropic-key-b"],
  );
});

test("OpenAI failover uses the next credential after a 429", async (t) => {
  const fixture = await startRoutingFixture(t, {
    endpoint: {
      id: "ep_openai_failover",
      type: "openai-chat",
      model: "openai-failover-model",
      api_keys: [{ id: "cred_a" }, { id: "cred_b" }],
      key_strategy: "failover",
    },
    secrets: {
      "ep_openai_failover::cred_a": "openai-key-a",
      "ep_openai_failover::cred_b": "openai-key-b",
    },
    respond: async ({ response, apiKey, body }) => {
      response.setHeader("content-type", "application/json");
      if (apiKey === "openai-key-a") {
        response.statusCode = 429;
        response.end(JSON.stringify({ error: { message: "rate limited" } }));
        return;
      }
      response.end(JSON.stringify(openAIChatSuccess(body.model)));
    },
  });

  const result = await fixture.send();
  assert.equal(result.content[0].text, "OK");
  assert.deepEqual(
    fixture.requests.map((request) => request.apiKey),
    ["openai-key-a", "openai-key-b"],
  );
});

test("failover tries at most three credentials when every key fails", async (t) => {
  const fixture = await startRoutingFixture(t, {
    endpoint: {
      id: "ep_bounded_failover",
      type: "openai-chat",
      model: "bounded-failover-model",
      api_keys: [
        { id: "cred_a" },
        { id: "cred_b" },
        { id: "cred_c" },
        { id: "cred_d" },
      ],
      key_strategy: "failover",
    },
    secrets: {
      "ep_bounded_failover::cred_a": "bounded-key-a",
      "ep_bounded_failover::cred_b": "bounded-key-b",
      "ep_bounded_failover::cred_c": "bounded-key-c",
      "ep_bounded_failover::cred_d": "bounded-key-d",
    },
    respond: async ({ response }) => {
      response.statusCode = 503;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: { message: "still overloaded" } }));
    },
  });

  const response = await fixture.request();
  assert.equal(response.status, 503);
  assert.deepEqual(
    fixture.requests.map((request) => request.apiKey),
    ["bounded-key-a", "bounded-key-b", "bounded-key-c"],
  );
});

test("round-robin selects a different configured credential for consecutive requests", async (t) => {
  const fixture = await startRoutingFixture(t, {
    endpoint: {
      id: "ep_round_robin",
      type: "openai-chat",
      model: "round-robin-model",
      api_keys: [{ id: "cred_a" }, { id: "cred_b" }],
      key_strategy: "round-robin",
    },
    secrets: {
      "ep_round_robin::cred_a": "round-robin-key-a",
      "ep_round_robin::cred_b": "round-robin-key-b",
    },
    respond: async ({ response, body }) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(openAIChatSuccess(body.model)));
    },
  });

  await fixture.send();
  await fixture.send();
  assert.deepEqual(
    fixture.requests.map((request) => request.apiKey),
    ["round-robin-key-a", "round-robin-key-b"],
  );
});

test("random uses one configured credential without writing raw keys to logs", async (t) => {
  const fixture = await startRoutingFixture(t, {
    endpoint: {
      id: "ep_random",
      type: "openai-chat",
      model: "random-model",
      api_keys: [{ id: "cred_a" }, { id: "cred_b" }],
      key_strategy: "random",
    },
    secrets: {
      "ep_random::cred_a": "random-key-a",
      "ep_random::cred_b": "random-key-b",
    },
    respond: async ({ response, body }) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(openAIChatSuccess(body.model)));
    },
  });

  await fixture.send();
  assert.equal(fixture.requests.length, 1);
  assert.ok(
    ["random-key-a", "random-key-b"].includes(fixture.requests[0].apiKey),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const logs = await readFile(fixture.logPath, "utf8");
  assert.doesNotMatch(logs, /random-key-a|random-key-b/);
});

test("legacy single-key endpoints retry the same configured key", async (t) => {
  const fixture = await startRoutingFixture(t, {
    endpoint: {
      id: "ep_legacy",
      type: "openai-chat",
      model: "legacy-model",
    },
    secrets: {
      ep_legacy: "legacy-key",
    },
    respond: async ({ response, body, requests }) => {
      response.setHeader("content-type", "application/json");
      if (requests.length === 1) {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: { message: "overloaded" } }));
        return;
      }
      response.end(JSON.stringify(openAIChatSuccess(body.model)));
    },
  });

  const result = await fixture.send();
  assert.equal(result.content[0].text, "OK");
  assert.deepEqual(
    fixture.requests.map((request) => request.apiKey),
    ["legacy-key", "legacy-key"],
  );
});
