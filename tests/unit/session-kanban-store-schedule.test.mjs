import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createSessionKanbanStore, QUEUE_STATUSES } from "../../lib/session-kanban/infra/sqlite-store.mjs";

test("store supports scheduled enqueue and statuses", () => {
  const dbPath = path.join(os.tmpdir(), `test-kanban-store-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const store = createSessionKanbanStore({ dbPath });

  try {
    assert.ok(QUEUE_STATUSES.includes("scheduled"));
    assert.ok(QUEUE_STATUSES.includes("waiting_quota"));

    const now = Date.now();
    const future = now + 3600 * 1000;

    // Immediate enqueue
    const item1 = store.enqueue({ sessionId: "sess-1", message: "Hello 1" });
    assert.equal(item1.status, "pending");
    assert.equal(item1.scheduledAtMs, 0);

    // Scheduled enqueue
    const item2 = store.enqueue({ sessionId: "sess-1", message: "Hello 2", scheduledAtMs: future });
    assert.equal(item2.status, "scheduled");
    assert.equal(item2.scheduledAtMs, future);

    // List includes scheduledAtMs
    const list = store.list();
    assert.equal(list.length, 2);

    // Update schedule
    const updated = store.updateSchedule(item2.id, { scheduledAtMs: 0 });
    assert.equal(updated.status, "pending");
    assert.equal(updated.scheduledAtMs, 0);

    const updatedFuture = store.updateSchedule(item1.id, { scheduledAtMs: future });
    assert.equal(updatedFuture.status, "scheduled");
    assert.equal(updatedFuture.scheduledAtMs, future);
  } finally {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
  }
});

test("store supports markWaitingQuota and cascade rescheduleSessionQueue", async () => {
  const dbPath = path.join(os.tmpdir(), `test-kanban-store-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const store = createSessionKanbanStore({ dbPath });

  try {
    const item1 = store.enqueue({ sessionId: "sess-10", message: "Msg 1" });
    const item2 = store.enqueue({ sessionId: "sess-10", message: "Msg 2" });
    const item3 = store.enqueue({ sessionId: "sess-20", message: "Msg 3" });

    // Claim item1
    await store.claimForDispatch(item1.id);

    const resumeTime = Date.now() + 5 * 3600 * 1000;
    // Mark item1 waiting_quota
    const waitingItem1 = store.markWaitingQuota(item1.id, {
      notBeforeMs: resumeTime,
      vendorTag: "volcengine",
      error: "[火山引擎] 超过周配额",
    });
    assert.equal(waitingItem1.status, "waiting_quota");
    assert.equal(waitingItem1.scheduledAtMs, resumeTime);
    assert.equal(waitingItem1.vendorTag, "volcengine");
    assert.equal(waitingItem1.error, "[火山引擎] 超过周配额");

    // Cascade reschedule for sess-10
    const count = store.rescheduleSessionQueue("sess-10", {
      notBeforeMs: resumeTime,
      vendorTag: "volcengine",
      errorMsg: "[火山引擎] 等待前置任务额度恢复",
    });
    assert.equal(count, 2);

    const list = store.list();
    const s10Items = list.filter(i => i.sessionId === "sess-10");
    for (const item of s10Items) {
      assert.equal(item.status, "waiting_quota");
      assert.equal(item.scheduledAtMs, resumeTime);
      assert.equal(item.vendorTag, "volcengine");
    }

    // sess-20 is unaffected
    const s20Item = list.find(i => i.sessionId === "sess-20");
    assert.equal(s20Item.status, "pending");

    // Retry waiting item resets schedule if immediate = true
    const retried = store.retry(item1.id, { immediate: true });
    assert.equal(retried.status, "pending");
    assert.equal(retried.scheduledAtMs, 0);
  } finally {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
  }
});
