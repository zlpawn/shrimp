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

test("board separates recent waiting from completed sessions", async () => {
  const recent = { ...idleClaude, lastActivityAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() };
  const old = { ...idleClaude, id: "claude-old", lastActivityAt: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString() };
  const running = { ...idleClaude, id: "claude-running", lastActivityAt: new Date().toISOString() };
  const { service } = setup({ sessions: [recent, old, running] });
  const board = await service.board();
  const byId = new Map(board.sessions.map(item => [item.id, item.status]));
  assert.equal(byId.get("claude-1"), "waiting_input");
  assert.equal(byId.get("claude-old"), "completed");
  assert.equal(byId.get("claude-running"), "running");
});

test("board hides sessions inactive for more than forty-eight hours", async () => {
  const old = { ...idleClaude, id: "claude-old", lastActivityAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() };
  const recent = { ...idleClaude, id: "claude-recent", lastActivityAt: new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString() };
  const { service } = setup({ sessions: [old, recent] });
  const board = await service.board();
  assert.equal(board.sessions.length, 1);
  assert.equal(board.sessions[0].id, "claude-recent");
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
