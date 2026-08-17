import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  QUEUE_STATUSES,
  SESSION_KANBAN_STATUSES,
  createSessionKanbanStore,
} from "../../lib/session-kanban/infra/sqlite-store.mjs";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-kanban-"));
  return {
    dir,
    store: createSessionKanbanStore({
      dbPath: path.join(dir, "kanban.sqlite"),
    }),
  };
}

test("exports state contracts", () => {
  assert.deepEqual(SESSION_KANBAN_STATUSES, [
    "idle",
    "queued",
    "running",
    "waiting_input",
    "completed",
    "error",
  ]);
  assert.deepEqual(QUEUE_STATUSES, [
    "pending",
    "scheduled",
    "waiting_quota",
    "dispatching",
    "dispatched",
    "failed",
    "canceled",
  ]);
});

test("enqueue persists and lists queue messages", async () => {
  const { store } = tempStore();
  const item = await store.enqueue({
    sessionId: "codex_thread_1",
    message: "Run the checks",
  });

  assert.equal(item.status, "pending");
  assert.equal(item.sessionId, "codex_thread_1");
  assert.equal(item.message, "Run the checks");
  assert.ok(item.id);

  const rows = await store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, item.id);
});

test("claim marks one item dispatching and rejects double claims", async () => {
  const { store } = tempStore();
  const item = await store.enqueue({ sessionId: "claude_1", message: "Continue" });

  const claimed = await store.claimForDispatch(item.id);
  assert.equal(claimed.status, "dispatching");

  await assert.rejects(
    () => store.claimForDispatch(item.id),
    /already claimed/,
  );
});

test("dispatch outcome updates the queue row", async () => {
  const { store } = tempStore();
  const item = await store.enqueue({ sessionId: "agy_1", message: "Ship it" });
  await store.claimForDispatch(item.id);

  const dispatched = await store.markDispatched(item.id, {
    command: "agy --print",
    exitCode: 0,
  });
  assert.equal(dispatched.status, "dispatched");

  const retry = await store.enqueue({ sessionId: "agy_1", message: "Retry" });
  await store.claimForDispatch(retry.id);
  const failed = await store.markFailed(retry.id, "CLI exited with 1");
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "CLI exited with 1");
});

test("cancel and retry transition terminal rows", async () => {
  const { store } = tempStore();
  const item = await store.enqueue({ sessionId: "codex_2", message: "Stop" });
  const canceled = await store.cancel(item.id);
  assert.equal(canceled.status, "canceled");

  const retry = await store.retry(canceled.id);
  assert.equal(retry.status, "pending");
  assert.equal(retry.attempts, 1);
});
