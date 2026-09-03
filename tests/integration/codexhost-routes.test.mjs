import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const GATEWAY_PORT = 8788;

test("codexhost managed-runtime routes are mounted behind local gateway auth on 8788", async (t) => {
  assert.equal(await isPortFree(GATEWAY_PORT), true, "port 8788 must be free before this test");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codexhost-routes-"));
  const codexHome = path.join(tempDir, ".codex");
  const configPath = path.join(tempDir, "gateway.config.json");
  await mkdir(codexHome, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    server: { host: "127.0.0.1", port: GATEWAY_PORT },
    clients: { codex: { endpoints: [] } },
  }));
  await writeFile(path.join(codexHome, "config.toml"), [
    'model_provider = "custom"',
    `model_catalog_json = ${JSON.stringify(path.join(codexHome, "models.json").replace(/\\/g, "/"))}`,
    `openai_base_url = "http://127.0.0.1:${GATEWAY_PORT}/codex/v1"`,
    "",
    "[model_providers.custom]",
    "name = \"Local AI Gateway\"",
    `base_url = "http://127.0.0.1:${GATEWAY_PORT}/codex/v1"`,
    'wire_api = "responses"',
    "",
  ].join("\n"));

  const gateway = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      GATEWAY_PORT: String(GATEWAY_PORT),
      GATEWAY_CONFIG_FILE: configPath,
      GATEWAY_API_KEY: "codexhost-route-test-key",
      CODEX_HOME: codexHome,
      GATEWAY_NO_OPEN: "1",
      CLAUDE_3P_SYNC_DISABLED: "1",
      CLAUDE_CODE_SYNC_DISABLED: "1",
      CODEX_WRITE_MODEL_CATALOG_DISABLED: "1",
      LOG_FILE: path.join(tempDir, "gateway.log"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  gateway.stdout.on("data", (chunk) => { output += chunk; });
  gateway.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    gateway.kill();
    await once(gateway, "exit").catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  });

  await waitForHealth(gateway);

  const unauthorized = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/cli-tools/codexhost/status`);
  assert.equal(unauthorized.status, 401);

  const statusResponse = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/cli-tools/codexhost/status`, {
    headers: { "x-gateway-client": "codex", Authorization: "Bearer codexhost-route-test-key" },
  });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.runtime.id, "codexhost");
  assert.equal(status.runtime.kind, "managedRuntime");
  assert.equal(status.gateway.port, GATEWAY_PORT);
  assert.equal(status.gateway.healthy, true);
  assert.equal(status.codexConfig.healthy, true);

  const stopResponse = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/cli-tools/codexhost/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-gateway-client": "codex", Authorization: "Bearer codexhost-route-test-key" },
    body: JSON.stringify({ confirmInterrupt: false }),
  });
  assert.equal(stopResponse.status, 409);
  const stop = await stopResponse.json();
  assert.equal(stop.error.type, "confirmation_required");
  assert.match(stop.error.message, /未完成任务/);
});

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function waitForHealth(gateway) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  gateway.kill();
  throw new Error(`gateway did not become healthy. Output:\n${output}`);
}
