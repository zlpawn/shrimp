import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRemoteAgentBindingStore } from "../../lib/remote-agent/infra/binding-store.mjs";

test("binding store round-trips chat bindings and list snapshots", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-bind-"));
  const store = createRemoteAgentBindingStore({ dbPath: path.join(dir, "t.sqlite") });
  store.upsertBinding({
    bindingKey: "telegram:private:1",
    platform: "telegram",
    chatType: "private",
    chatId: "1",
    userId: "",
    client: "codex",
    sessionId: "s1",
    workspacePath: "D:/repo",
    title: "登录",
    boundByUserId: "u1",
  });
  store.saveListSnapshot("telegram:private:1", [
    { id: "s1", client: "codex", title: "登录", workspacePath: "D:/repo" },
  ]);
  const binding = store.getBinding("telegram:private:1");
  assert.equal(binding.sessionId, "s1");
  assert.equal(store.getListSnapshot("telegram:private:1")[0].id, "s1");
  store.clearBinding("telegram:private:1");
  assert.equal(store.getBinding("telegram:private:1"), null);
});

test("list snapshots expire after maxAgeMs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-bind-"));
  const store = createRemoteAgentBindingStore({ dbPath: path.join(dir, "t.sqlite") });
  store.upsertBinding({
    bindingKey: "telegram:private:1",
    platform: "telegram",
    chatType: "private",
    chatId: "1",
    userId: "",
    client: "codex",
    sessionId: "s1",
    workspacePath: "D:/repo",
    title: "登录",
    boundByUserId: "u1",
  });
  store.saveListSnapshot(
    "telegram:private:1",
    [{ id: "s1", client: "codex", title: "登录", workspacePath: "D:/repo" }],
    1_000,
  );
  assert.deepEqual(
    store.getListSnapshot("telegram:private:1", { maxAgeMs: 600_000, nowMs: 700_000 }),
    [],
  );
});

test("pending confirmation round-trips and expires", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-bind-"));
  const store = createRemoteAgentBindingStore({ dbPath: path.join(dir, "t.sqlite") });
  store.upsertBinding({
    bindingKey: "telegram:private:1",
    platform: "telegram",
    chatType: "private",
    chatId: "1",
    userId: "",
    client: "codex",
    sessionId: "s1",
    workspacePath: "D:/repo",
    title: "登录",
    boundByUserId: "u1",
  });
  store.setPendingConfirmation("telegram:private:1", {
    token: "abc123",
    message: "git push",
    reason: "dangerous",
    expiresAtMs: Date.now() + 60_000,
  });
  const pending = store.getPendingConfirmation("telegram:private:1");
  assert.equal(pending.token, "abc123");
  assert.equal(pending.message, "git push");
  assert.equal(store.getPendingConfirmation("telegram:private:1", { nowMs: Date.now() + 120_000 }), null);
  store.clearPendingConfirmation("telegram:private:1");
  assert.equal(store.getPendingConfirmation("telegram:private:1"), null);
});
