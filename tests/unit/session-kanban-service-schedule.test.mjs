import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createSessionKanbanStore } from "../../lib/session-kanban/infra/sqlite-store.mjs";
import { createSessionKanbanService } from "../../lib/session-kanban/application/service.mjs";

test("service filters future scheduled items and dispatches when time arrives", async () => {
  const dbPath = path.join(os.tmpdir(), `test-service-sched-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const store = createSessionKanbanStore({ dbPath });

  let currentTime = Date.parse("2026-08-17T12:00:00Z");
  const reader = {
    list: async () => [{
      id: "sess-idle-1",
      client: "codex",
      title: "Test Session",
      lastActivityAt: new Date(currentTime - 200 * 1000).toISOString(),
      dispatchTarget: "sess-idle-1",
    }],
  };

  const dispatchedMessages = [];
  const dispatcher = {
    client: "codex",
    canDispatch: () => true,
    dispatch: async (session, msg) => {
      dispatchedMessages.push(msg);
      return { command: "codex resume", exitCode: 0 };
    },
  };

  const service = createSessionKanbanService({
    store,
    readers: [reader],
    dispatchers: [dispatcher],
    now: () => currentTime,
  });

  try {
    // 1. Immediate item
    await service.enqueue({ sessionId: "sess-idle-1", message: "Immediate Msg" });
    // 2. Future item (+1 hour)
    await service.enqueue({ sessionId: "sess-idle-1", message: "Future Msg", scheduledAtMs: currentTime + 3600 * 1000 });

    // First dispatch at 12:00 -> Only immediate item is dispatched
    const res1 = await service.dispatchReady();
    assert.equal(res1.dispatched, 1);
    assert.deepEqual(dispatchedMessages, ["Immediate Msg"]);

    // Advance time by 30 mins (12:30) -> Future item still not dispatched
    currentTime += 30 * 60 * 1000;
    const res2 = await service.dispatchReady();
    assert.equal(res2.dispatched, 0);

    // Advance time to 13:05 -> Future item is dispatched!
    currentTime += 35 * 60 * 1000;
    const res3 = await service.dispatchReady();
    assert.equal(res3.dispatched, 1);
    assert.deepEqual(dispatchedMessages, ["Immediate Msg", "Future Msg"]);
  } finally {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
  }
});

test("service catches rate limits and triggers cascade circuit breaker", async () => {
  const dbPath = path.join(os.tmpdir(), `test-service-sched-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const store = createSessionKanbanStore({ dbPath });

  const now = Date.parse("2026-08-17T12:00:00Z");
  const reader = {
    list: async () => [{
      id: "sess-quota-1",
      client: "claude",
      title: "Claude Session",
      lastActivityAt: new Date(now - 200 * 1000).toISOString(),
      dispatchTarget: "sess-quota-1",
    }],
  };

  const dispatcher = {
    client: "claude",
    canDispatch: () => true,
    dispatch: async () => {
      throw new Error("Claude 5-hour limit reached. Try again in 3 hours.");
    },
  };

  const service = createSessionKanbanService({
    store,
    readers: [reader],
    dispatchers: [dispatcher],
    now: () => now,
  });

  try {
    await service.enqueue({ sessionId: "sess-quota-1", message: "Task 1" });
    await service.enqueue({ sessionId: "sess-quota-1", message: "Task 2" });

    // Dispatch triggers rate limit
    await service.dispatchReady();

    const queue = store.list();
    const item1 = queue.find(i => i.message === "Task 1");
    const item2 = queue.find(i => i.message === "Task 2");

    assert.equal(item1.status, "waiting_quota");
    assert.equal(item1.vendorTag, "claude");
    assert.ok(item1.scheduledAtMs >= now + 3 * 3600 * 1000);

    assert.equal(item2.status, "waiting_quota");
    assert.equal(item2.vendorTag, "claude");
    assert.ok(item2.scheduledAtMs >= now + 3 * 3600 * 1000);
    assert.match(item2.error, /等待前置任务额度恢复/);
  } finally {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
  }
});
