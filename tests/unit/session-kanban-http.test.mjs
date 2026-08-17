import test from "node:test";
import assert from "node:assert/strict";

import { routeSessionKanbanRequest } from "../../lib/session-kanban/http/routes.mjs";

function res() {
  return {
    statusCode: 0,
    body: null,
    writeHead(status) { this.statusCode = status; },
    end(value) { this.body = JSON.parse(value); },
  };
}

function req(method = "GET", body) {
  return {
    method,
    on(event, listener) {
      if (event === "data") listener(Buffer.from(body ? JSON.stringify(body) : ""));
      if (event === "end") listener();
    },
  };
}

test("routes board requests", async () => {
  const response = res();
  const service = { board: async () => ({ sessions: [], queue: [] }) };
  await routeSessionKanbanRequest(req(), response, "/v1/session-kanban/board", { service });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { sessions: [], queue: [] });
});

test("routes queue actions", async () => {
  const response = res();
  const service = {
    enqueue: async input => ({ ...input, status: "pending" }),
  };
  await routeSessionKanbanRequest(req("POST", { sessionId: "s1", message: "Hi" }), response, "/v1/session-kanban/queue", { service });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "pending");
});

test("returns validation errors as 400", async () => {
  const response = res();
  const service = { enqueue: async () => { throw new Error("message is required"); } };
  await routeSessionKanbanRequest(req("POST", {}), response, "/v1/session-kanban/queue", { service });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.message, "message is required");
});

test("routes cancel retry and dispatch", async () => {
  const response = res();
  const service = {
    cancel: async id => ({ id, status: "canceled" }),
    retry: async (id, body) => ({ id, status: "pending", immediate: body?.immediate }),
    dispatchReady: async () => ({ dispatched: 0, waiting: 0 }),
    updateSchedule: async (id, body) => ({ id, status: "scheduled", scheduledAtMs: body.scheduledAtMs }),
  };

  await routeSessionKanbanRequest(req("POST", {}), res(), "/v1/session-kanban/nope", { service });
  await routeSessionKanbanRequest(req("POST", {}), response, "/v1/session-kanban/dispatch", { service });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { dispatched: 0, waiting: 0 });

  const schedRes = res();
  await routeSessionKanbanRequest(req("PATCH", { scheduledAtMs: 12345 }), schedRes, "/v1/session-kanban/queue/q1/schedule", { service });
  assert.equal(schedRes.statusCode, 200);
  assert.equal(schedRes.body.scheduledAtMs, 12345);
});

test("routes paths config get, update and reset", async () => {
  const mockPaths = { codex: { id: "codex", fields: [{ key: "stateFile", value: "C:/test.db" }] } };
  const service = {
    getPathsConfig: async () => mockPaths,
    setPathsConfig: async body => ({ ...mockPaths, ...body }),
    resetPathsConfig: async () => mockPaths,
  };

  const getRes = res();
  await routeSessionKanbanRequest(req("GET"), getRes, "/v1/session-kanban/paths", { service });
  assert.equal(getRes.statusCode, 200);
  assert.deepEqual(getRes.body, mockPaths);

  const putRes = res();
  await routeSessionKanbanRequest(req("PUT", { codex: { id: "codex" } }), putRes, "/v1/session-kanban/paths", { service });
  assert.equal(putRes.statusCode, 200);

  const resetRes = res();
  await routeSessionKanbanRequest(req("POST", {}), resetRes, "/v1/session-kanban/paths/reset", { service });
  assert.equal(resetRes.statusCode, 200);
});

test("routes session transcript requests", async () => {
  const mockTranscript = { sessionId: "s1", client: "antigravity", messages: [{ id: "m1", role: "user", content: "Hi" }] };
  const service = {
    getTranscript: async id => (id === "s1" ? mockTranscript : null),
  };

  const response = res();
  await routeSessionKanbanRequest(req("GET"), response, "/v1/session-kanban/sessions/s1/transcript", { service });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, mockTranscript);
});
