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
