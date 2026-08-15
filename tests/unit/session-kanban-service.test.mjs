import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSessionKanbanStore } from "../../lib/session-kanban/infra/sqlite-store.mjs";
import { createSessionKanbanService } from "../../lib/session-kanban/application/service.mjs";

function setup({ sessions = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-service-"));
  const store = createSessionKanbanStore({ dbPath: path.join(dir, "queue.sqlite") });
  const calls = [];
  const service = createSessionKanbanService({
    store,
    readers: [{ list: async () => sessions }],
    dispatchers: [{
      client: "claude",
      canDispatch: session => session.client === "claude",
      dispatch: async (session, message) => {
        calls.push({ session, message });
        return { command: "claude --print" };
      },
    }],
  });
  return { service, store, calls };
}

const idleClaude = {
  client: "claude",
  id: "claude-1",
  dispatchTarget: "claude-1",
  title: "Idle",
  workspacePath: "D:/repo",
  lastActivityAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
};

test("board annotates sessions with queue state", async () => {
  const { service } = setup({ sessions: [idleClaude] });
  await service.enqueue({ sessionId: "claude-1", message: "Continue" });
  const board = await service.board();
  assert.equal(board.sessions[0].status, "queued");
  assert.equal(board.sessions[0].queuedCount, 1);
});

test("dispatchReady skips running sessions and dispatches idle sessions", async () => {
  const running = { ...idleClaude, id: "claude-running", dispatchTarget: "claude-running", lastActivityAt: new Date().toISOString() };
  const { service, calls } = setup({ sessions: [idleClaude, running] });
  await service.enqueue({ sessionId: "claude-1", message: "Continue" });
  await service.enqueue({ sessionId: "claude-running", message: "Wait" });
  const result = await service.dispatchReady();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].session.id, "claude-1");
  assert.equal(result.dispatched, 1);
  assert.equal(result.waiting, 1);
});

test("failed dispatch remains visible and retryable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-service-"));
  const store = createSessionKanbanStore({ dbPath: path.join(dir, "q.sqlite") });
  const service = createSessionKanbanService({
    store,
    readers: [{ list: async () => [idleClaude] }],
    dispatchers: [{
      client: "claude",
      canDispatch: () => true,
      dispatch: async () => { throw new Error("CLI unavailable"); },
    }],
  });
  const item = await service.enqueue({ sessionId: "claude-1", message: "Continue" });
  await service.dispatchReady();
  const rows = await store.list();
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].error, "CLI unavailable");
  const retried = await service.retry(item.id);
  assert.equal(retried.status, "pending");
});
