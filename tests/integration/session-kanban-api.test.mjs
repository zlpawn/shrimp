import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSessionKanbanStore } from "../../lib/session-kanban/infra/sqlite-store.mjs";
import { createSessionKanbanService } from "../../lib/session-kanban/application/service.mjs";
import { routeSessionKanbanRequest } from "../../lib/session-kanban/http/routes.mjs";

test("session kanban API queues and dispatches an idle session", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-api-"));
  const store = createSessionKanbanStore({ dbPath: path.join(dir, "queue.sqlite") });
  const dispatched = [];
  const service = createSessionKanbanService({
    store,
    readers: [{ list: async () => [{
      client: "claude",
      id: "s1",
      dispatchTarget: "s1",
      title: "Old session",
      workspacePath: "D:/repo",
      lastActivityAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }] }],
    dispatchers: [{
      client: "claude",
      canDispatch: () => true,
      dispatch: async (session, message) => { dispatched.push({ session, message }); return { command: "fake" }; },
    }],
  });

  const server = http.createServer((req, res) => {
    routeSessionKanbanRequest(req, res, new URL(req.url, "http://localhost").pathname, { service });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const queued = await fetch(`http://127.0.0.1:${port}/v1/session-kanban/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", message: "Continue" }),
    }).then(r => r.json());
    assert.equal(queued.status, "pending");

    const dispatch = await fetch(`http://127.0.0.1:${port}/v1/session-kanban/dispatch`, { method: "POST" }).then(r => r.json());
    assert.equal(dispatch.dispatched, 1);
    assert.equal(dispatched.length, 1);
  } finally {
    server.close();
    store.close();
  }
});
