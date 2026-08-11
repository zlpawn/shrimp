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

async function startSecretFixture(t) {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(tmpdir(), "gateway-secret-routes-"));
  const configPath = path.join(tempDir, "gateway.config.json");
  const secretsPath = path.join(tempDir, "gateway.secrets.json");

  await writeFile(configPath, JSON.stringify({
    server: { host: "127.0.0.1", port },
    clients: {
      code: { endpoints: [] },
      codex: { endpoints: [] },
      deeptutor: { endpoints: [] },
      desktop: {
        endpoints: [
          {
            id: "ep_single",
            name: "Single",
            type: "anthropic",
            base_url: "https://example.invalid",
            models: [],
          },
          {
            id: "ep_multi",
            name: "Multi",
            type: "anthropic",
            base_url: "https://example.invalid",
            models: [],
            api_keys: [{ id: "cred_a" }, { id: "cred_b" }],
            key_strategy: "failover",
          },
        ],
      },
    },
  }));
  await writeFile(secretsPath, JSON.stringify({
    api_keys: {
      ep_single: "sk-single",
      "ep_multi::cred_a": "sk-a-example-AAA",
      "ep_multi::cred_b": "sk-b-example-BBB",
    },
  }));

  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      GATEWAY_CONFIG_FILE: configPath,
      GATEWAY_SECRETS_FILE: secretsPath,
      GATEWAY_PORT: String(port),
      GATEWAY_NO_OPEN: "1",
      CLAUDE_3P_SYNC_DISABLED: "1",
      CLAUDE_CODE_SYNC_DISABLED: "1",
      CODEX_WRITE_MODEL_CATALOG_DISABLED: "1",
      CODEX_MODELS_LIVE_DISABLED: "1",
      LOG_FILE: path.join(tempDir, "gateway.log"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(async () => {
    if (child.exitCode == null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  await waitForHealth(port, child);
  const base = `http://127.0.0.1:${port}`;
  const reveal = (endpointId, credentialId) => {
    const query = new URLSearchParams({ id: endpointId });
    if (credentialId) query.set("credential_id", credentialId);
    return fetch(`${base}/v1/config/secret?${query}`, {
      headers: {
        "sec-fetch-site": "same-origin",
        "x-gateway-secret-intent": "reveal",
      },
    });
  };
  const preview = (endpointId) => {
    const query = new URLSearchParams({ id: endpointId });
    return fetch(`${base}/v1/config/secret-preview?${query}`, {
      headers: {
        "sec-fetch-site": "same-origin",
        "x-gateway-secret-intent": "reveal",
      },
    });
  };
  return { base, reveal, preview };
}

test("secret reveal keeps legacy endpoint behavior", async (t) => {
  const { reveal } = await startSecretFixture(t);
  const response = await reveal("ep_single");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { api_key: "sk-single" });
});

test("secret reveal returns only the requested credential", async (t) => {
  const { reveal } = await startSecretFixture(t);
  const response = await reveal("ep_multi", "cred_b");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    credential_id: "cred_b",
    api_key: "sk-b-example-BBB",
  });
});

test("secret reveal rejects a credential not declared by the endpoint", async (t) => {
  const { reveal } = await startSecretFixture(t);
  const response = await reveal("ep_multi", "cred_missing");

  assert.equal(response.status, 404);
});

test("secret reveal still requires explicit reveal intent", async (t) => {
  const { base } = await startSecretFixture(t);
  const response = await fetch(`${base}/v1/config/secret?id=ep_single`);

  assert.equal(response.status, 403);
});

test("secret preview masks every declared credential without returning values", async (t) => {
  const { preview } = await startSecretFixture(t);
  const response = await preview("ep_multi");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    credentials: [
      { id: "cred_a", configured: true, preview: "sk-a...AAA" },
      { id: "cred_b", configured: true, preview: "sk-b...BBB" },
    ],
  });
});

test("public config reports multi-key status but contains no secret values", async (t) => {
  const { base } = await startSecretFixture(t);
  const response = await fetch(`${base}/v1/config`, {
    headers: { "sec-fetch-site": "same-origin" },
  });
  const payload = await response.json();
  const endpoint = payload.clients.desktop.endpoints.find(
    (item) => item.id === "ep_multi",
  );

  assert.equal(endpoint.has_api_key, true);
  assert.deepEqual(endpoint.api_keys, [{ id: "cred_a" }, { id: "cred_b" }]);
  assert.equal(JSON.stringify(payload).includes("sk-a-example-AAA"), false);
});
