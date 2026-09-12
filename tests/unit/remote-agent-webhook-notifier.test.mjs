import test from "node:test";
import assert from "node:assert/strict";

import { createWebhookNotifier } from "../../lib/remote-agent/infra/webhook-notifier.mjs";

test("webhook notifier posts bearer-authenticated completion event", async () => {
  const calls = [];
  const notifier = createWebhookNotifier({
    webhookUrl: "http://127.0.0.1:9999/hooks/shrimp",
    token: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "ok" };
    },
  });
  const result = await notifier.notify({
    type: "remote_agent.task_dispatched",
    taskId: "task-1",
    reply: "已派发完成",
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "http://127.0.0.1:9999/hooks/shrimp");
  assert.match(calls[0].init.headers.Authorization, /Bearer secret/);
  assert.match(calls[0].init.body, /task-1/);
});

test("webhook notifier no-ops when url is empty", async () => {
  const notifier = createWebhookNotifier({ webhookUrl: "", token: "secret" });
  const result = await notifier.notify({ type: "remote_agent.task_dispatched", taskId: "task-1" });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("webhook notifier returns structured failure without throwing", async () => {
  const notifier = createWebhookNotifier({
    webhookUrl: "http://127.0.0.1:9999/hooks/shrimp",
    token: "secret",
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => "boom" }),
  });
  const result = await notifier.notify({ type: "remote_agent.task_failed", taskId: "task-2" });
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 500/);
});
