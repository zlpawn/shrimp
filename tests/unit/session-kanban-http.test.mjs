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
    retry: async id => ({ id, status: "pending" }),
    dispatchReady: async () => ({ dispatched: 0, waiting: 0 }),
  };

  await routeSessionKanbanRequest(req("POST", {}), res(), "/v1/session-kanban/nope", { service });
  await routeSessionKanbanRequest(req("POST", {}), response, "/v1/session-kanban/dispatch", { service });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { dispatched: 0, waiting: 0 });
});
