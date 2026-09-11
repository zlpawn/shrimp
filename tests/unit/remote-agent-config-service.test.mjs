import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRemoteAgentBindingStore } from "../../lib/remote-agent/infra/binding-store.mjs";
import { createRemoteAgentConfigService } from "../../lib/remote-agent/application/config-service.mjs";

test("config service reports endpoints and rotates token into secrets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-config-"));
  const secretsPath = path.join(dir, "gateway.secrets.json");
  fs.writeFileSync(secretsPath, JSON.stringify({ api_keys: {} }, null, 2));
  const bindingStore = createRemoteAgentBindingStore({ dbPath: path.join(dir, "b.sqlite") });
  bindingStore.upsertBinding({
    bindingKey: "telegram:private:1",
    platform: "telegram",
    chatType: "private",
    chatId: "1",
    userId: "",
    client: "codex",
    sessionId: "s1",
    workspacePath: "D:/a",
    title: "登录",
    boundByUserId: "u1",
  });

  let secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  const service = createRemoteAgentConfigService({
    bindingStore,
    sessionKanban: {
      async listQueue() {
        return [{ id: "t1", sessionId: "s1", message: "hi", status: "pending" }];
      },
    },
    secretsPath,
    getSecrets: () => secrets,
    setSecrets: (next) => {
      secrets = next;
      fs.writeFileSync(secretsPath, JSON.stringify(next, null, 2));
    },
    listenPort: 8787,
  });

  const before = await service.getStatus();
  assert.equal(before.endpoints.difyBaseUrl, "http://127.0.0.1:8787/dify/v1");
  assert.equal(before.bindings.length, 1);
  assert.equal(before.recentTasks.length, 1);

  const rotated = await service.rotateToken();
  assert.ok(rotated.token.length >= 32);
  assert.equal(secrets.remote_agent.token, rotated.token);

  await service.clearBinding("telegram:private:1");
  assert.equal(bindingStore.getBinding("telegram:private:1"), null);
});


test("config service persists webhook url into secrets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-config-"));
  const secretsPath = path.join(dir, "gateway.secrets.json");
  fs.writeFileSync(secretsPath, JSON.stringify({ api_keys: {} }, null, 2));
  const bindingStore = createRemoteAgentBindingStore({ dbPath: path.join(dir, "b.sqlite") });
  let secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  const service = createRemoteAgentConfigService({
    bindingStore,
    secretsPath,
    getSecrets: () => secrets,
    setSecrets: (next) => {
      secrets = next;
      fs.writeFileSync(secretsPath, JSON.stringify(next, null, 2));
    },
    listenPort: 8787,
  });
  const result = await service.setWebhookUrl("http://127.0.0.1:18080/hooks/shrimp");
  assert.equal(result.webhookUrl, "http://127.0.0.1:18080/hooks/shrimp");
  assert.equal(secrets.remote_agent.webhook_url, "http://127.0.0.1:18080/hooks/shrimp");
  const status = await service.getStatus();
  assert.equal(status.webhookConfigured, true);
  assert.equal(status.webhookUrl, "http://127.0.0.1:18080/hooks/shrimp");
});


test("config service persists policy mode into secrets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-config-"));
  const secretsPath = path.join(dir, "gateway.secrets.json");
  fs.writeFileSync(secretsPath, JSON.stringify({ api_keys: {} }, null, 2));
  const bindingStore = createRemoteAgentBindingStore({ dbPath: path.join(dir, "b.sqlite") });
  let secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  const service = createRemoteAgentConfigService({
    bindingStore,
    secretsPath,
    getSecrets: () => secrets,
    setSecrets: (next) => {
      secrets = next;
      fs.writeFileSync(secretsPath, JSON.stringify(next, null, 2));
    },
    listenPort: 8787,
  });
  const result = await service.setPolicyMode("confirm_all");
  assert.equal(result.policyMode, "confirm_all");
  assert.equal(secrets.remote_agent.policy_mode, "confirm_all");
  const status = await service.getStatus();
  assert.equal(status.policyMode, "confirm_all");
});

test("setPolicyMode notifies listener so gateway can rebuild service", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-config-"));
  const secretsPath = path.join(dir, "gateway.secrets.json");
  fs.writeFileSync(secretsPath, JSON.stringify({ api_keys: {} }, null, 2));
  const bindingStore = createRemoteAgentBindingStore({ dbPath: path.join(dir, "b.sqlite") });
  const changes = [];
  const service = createRemoteAgentConfigService({
    bindingStore,
    secretsPath,
    listenPort: 8787,
    onPolicyModeChanged: (mode) => changes.push(mode),
  });

  await service.setPolicyMode("open");

  assert.deepEqual(changes, ["open"]);
});
