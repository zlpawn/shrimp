import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("custom client display_name decoupling and route slug isolation live E2E", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "gateway-client-slug-e2e-"));
  const configPath = path.join(tempDir, "gateway.config.json");
  const secretsPath = path.join(tempDir, "gateway.secrets.json");

  let upstreamHits = 0;
  const upstream = http.createServer(async (req, res) => {
    upstreamHits += 1;
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl_mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "mock-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Hello from mock upstream" },
          finish_reason: "stop",
        }],
      }));
    });
  });

  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = upstream.address().port;

  const initialConfig = {
    server: { host: "127.0.0.1", port: 8799 },
    clients: {
      code: { endpoints: [] },
      desktop: { endpoints: [] },
      codex: {
        endpoints: [{
          id: "ep_codex_base",
          name: "base-upstream",
          type: "openai-chat",
          base_url: `http://127.0.0.1:${upstreamPort}/chat/completions`,
          api_key: "sk-upstream-secret",
          models: ["mock-model"],
        }],
      },
      deeptutor: { endpoints: [] },
    },
  };

  await writeFile(configPath, JSON.stringify(initialConfig, null, 2));
  await writeFile(secretsPath, JSON.stringify({ api_keys: { ep_codex_base: "sk-upstream-secret" } }, null, 2));

  const gatewayPort = 8799;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      GATEWAY_HOST: "127.0.0.1",
      GATEWAY_PORT: String(gatewayPort),
      GATEWAY_CONFIG_FILE: configPath,
      GATEWAY_SECRETS_FILE: secretsPath,
      GATEWAY_NO_OPEN: "1",
      CLAUDE_3P_SYNC_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(async () => {
    if (child.exitCode == null && child.signalCode == null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await new Promise((resolve) => upstream.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  });

  // Wait for gateway health
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Gateway exited early with code ${child.exitCode}`);
    }
    try {
      const healthRes = await fetch(`http://127.0.0.1:${gatewayPort}/health`);
      if (healthRes.ok) break;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  // 1. Verify built-in client protection against rename and remove
  const renameBuiltinRes = await fetch(`http://127.0.0.1:${gatewayPort}/v1/config/rename-client`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: "codex", displayName: "New Codex Name" }),
  });
  assert.equal(renameBuiltinRes.status, 400);
  const renameBuiltinBody = await renameBuiltinRes.json();
  assert.match(renameBuiltinBody.error, /built-in/i);

  const removeBuiltinRes = await fetch(`http://127.0.0.1:${gatewayPort}/v1/config/remove-client`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: "codex" }),
  });
  assert.equal(removeBuiltinRes.status, 400);
  const removeBuiltinBody = await removeBuiltinRes.json();
  assert.match(removeBuiltinBody.error, /built-in/i);

  // 2. Add custom client with slug "my-agent" and displayName "My Custom Agent" copying from codex
  const addClientRes = await fetch(`http://127.0.0.1:${gatewayPort}/v1/config/add-client`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client: "my-agent",
      displayName: "My Custom Agent",
      copyFrom: "codex",
      mode: "replace",
      protocol: "openai",
    }),
  });
  assert.equal(addClientRes.status, 200);
  const addClientBody = await addClientRes.json();
  assert.equal(addClientBody.success, true);
  assert.equal(addClientBody.client, "my-agent");
  assert.equal(addClientBody.display_name, "My Custom Agent");

  // Verify GET /v1/config returns custom client with display_name
  const configRes = await fetch(`http://127.0.0.1:${gatewayPort}/v1/config`);
  assert.equal(configRes.status, 200);
  const configBody = await configRes.json();
  assert.ok(configBody.clients["my-agent"]);
  assert.equal(configBody.clients["my-agent"].display_name, "My Custom Agent");
  assert.equal(configBody.clients["my-agent"].protocol, "openai");

  // 3. Verify route URL uses slug "my-agent" (http://127.0.0.1:port/my-agent/chat/completions)
  const chatRes = await fetch(`http://127.0.0.1:${gatewayPort}/my-agent/chat/completions`, {
    method: "POST",
    headers: {
      authorization: "Bearer dummy-key",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mock-model",
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  const chatBodyText = await chatRes.text();
  assert.equal(chatRes.status, 200, `chatRes failed: ${chatRes.status} ${chatBodyText}`);
  const chatBody = JSON.parse(chatBodyText);
  assert.equal(chatBody.choices[0].message.content, "Hello from mock upstream");
  assert.equal(upstreamHits, 1);

  // 4. Rename custom client to "Renamed Agent Pro"
  const renameCustomRes = await fetch(`http://127.0.0.1:${gatewayPort}/v1/config/rename-client`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: "my-agent", displayName: "Renamed Agent Pro" }),
  });
  assert.equal(renameCustomRes.status, 200);
  const renameCustomBody = await renameCustomRes.json();
  assert.equal(renameCustomBody.display_name, "Renamed Agent Pro");

  // Verify config updated
  const updatedConfigRes = await fetch(`http://127.0.0.1:${gatewayPort}/v1/config`);
  const updatedConfigBody = await updatedConfigRes.json();
  assert.equal(updatedConfigBody.clients["my-agent"].display_name, "Renamed Agent Pro");

  // Verify route slug remains unchanged and functional
  const chatAfterRenameRes = await fetch(`http://127.0.0.1:${gatewayPort}/my-agent/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: "Bearer dummy-key",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mock-model",
      messages: [{ role: "user", content: "hello again" }],
    }),
  });
  assert.equal(chatAfterRenameRes.status, 200);
  const chatAfterRenameBody = await chatAfterRenameRes.json();
  assert.equal(chatAfterRenameBody.choices[0].message.content, "Hello from mock upstream");
  assert.equal(upstreamHits, 2);

  // 5. Remove custom client
  const removeRes = await fetch(`http://127.0.0.1:${gatewayPort}/v1/config/remove-client`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: "my-agent" }),
  });
  assert.equal(removeRes.status, 200);

  const finalConfigRes = await fetch(`http://127.0.0.1:${gatewayPort}/v1/config`);
  const finalConfigBody = await finalConfigRes.json();
  assert.equal(finalConfigBody.clients["my-agent"], undefined);
});
