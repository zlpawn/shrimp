import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeHostBackend,
  createMemoryEventLog,
  createRemoteSessionService,
  routeRemoteSessionRequest,
} from "../../lib/remote-session/index.mjs";

function makeReq(method, reqPath, body) {
  const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  return {
    method,
    url: reqPath,
    headers: {},
    on(event, handler) {
      if (event === "data" && bodyBuf.length > 0) handler(bodyBuf);
      if (event === "end") setTimeout(handler, 0);
    },
    destroy() {},
  };
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    chunks: [],
    writeHead(status, headers) {
      this.statusCode = status;
      if (headers) this.headers = headers;
    },
    write(chunk) {
      this.chunks.push(String(chunk));
    },
    end(data) {
      if (data !== undefined) this.body = data;
    },
  };
}

function makeNatTraversal({ enabled = true } = {}) {
  return {
    async capabilities() {
      return { enabled };
    },
    async getPublicConfig() {
      return { enabled };
    },
    async listPeers() {
      return [];
    },
    async ensureLink(peerId) {
      return { peerId, provider: "frpc", status: "online", endpoint: "" };
    },
    async openService(peerId, service) {
      return { service, endpoint: "127.0.0.1:18788" };
    },
  };
}

function makeService() {
  let stored = { enabled: true };
  const host = createFakeHostBackend({
    projects: [{ id: "p1", name: "demo", path: "/tmp/demo" }],
    scriptedTurns: [
      {
        events: [
          { type: "assistant_text", text: "editing" },
          { type: "approval_required", approvalId: "ap1", summary: "run rm" },
        ],
      },
    ],
  });
  const service = createRemoteSessionService({
    configStore: {
      get: () => stored,
      save: (next) => {
        stored = next;
      },
    },
    natTraversal: makeNatTraversal({ enabled: true }),
    hostBackendFactory: async () => host,
    eventLogFactory: createMemoryEventLog,
  });
  return service;
}

async function call(service, method, reqPath, body) {
  const req = makeReq(method, reqPath, body);
  const res = makeRes();
  await routeRemoteSessionRequest(req, res, {}, reqPath, { service });
  // wait microtask for body end handlers if needed
  await new Promise((resolve) => setTimeout(resolve, 0));
  let json = null;
  if (res.body) {
    json = JSON.parse(String(res.body));
  }
  return { res, json };
}

test("POST sessions opens a fake-host remote session", async () => {
  const service = makeService();
  const { res, json } = await call(service, "POST", "/v1/remote-session/sessions", {
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "controller-a",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(json.session.state, "ready");
  assert.ok(json.session.hostConversationId);
});

test("prompt and approval routes work for controller", async () => {
  const service = makeService();
  const opened = await call(service, "POST", "/v1/remote-session/sessions", {
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "a",
  });
  const sessionId = opened.json.session.id;

  const prompted = await call(
    service,
    "POST",
    "/v1/remote-session/sessions/" + sessionId + "/prompt",
    { prompt: "delete temp", controllerPeerId: "a" },
  );
  assert.equal(prompted.res.statusCode, 200);
  assert.equal(prompted.json.session.state, "awaiting_approval");

  const events = await call(
    service,
    "GET",
    "/v1/remote-session/sessions/" + sessionId + "/events?cursor=0",
  );
  assert.equal(events.res.statusCode, 200);
  assert.ok(events.json.events.some((event) => event.type === "approval_required"));

  const approved = await call(
    service,
    "POST",
    "/v1/remote-session/sessions/" + sessionId + "/approvals/ap1",
    { decision: "allow", controllerPeerId: "a" },
  );
  assert.equal(approved.res.statusCode, 200);
  assert.equal(approved.json.session.state, "ready");
});

test("config enable requires nat traversal dependency", async () => {
  let stored = { enabled: false };
  const service = createRemoteSessionService({
    configStore: {
      get: () => stored,
      save: (next) => {
        stored = next;
      },
    },
    natTraversal: makeNatTraversal({ enabled: false }),
    hostBackendFactory: async () => createFakeHostBackend(),
    eventLogFactory: createMemoryEventLog,
  });
  const { res, json } = await call(service, "PUT", "/v1/remote-session/config", {
    enabled: true,
  });
  assert.equal(res.statusCode, 409);
  assert.equal(json.error.type, "dependency_disabled");
});

test("SSE event stream emits session events", async () => {
  const service = makeService();
  const opened = await call(service, "POST", "/v1/remote-session/sessions", {
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "a",
  });
  const sessionId = opened.json.session.id;
  await call(service, "POST", "/v1/remote-session/sessions/" + sessionId + "/prompt", {
    prompt: "hello",
    controllerPeerId: "a",
  });

  const req = makeReq("GET", "/v1/remote-session/sessions/" + sessionId + "/events/stream?cursor=0");
  const res = makeRes();
  await routeRemoteSessionRequest(
    req,
    res,
    {},
    "/v1/remote-session/sessions/" + sessionId + "/events/stream?cursor=0",
    { service },
  );
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["Content-Type"] || ""), /text\/event-stream/);
  const payload = res.chunks.join("");
  assert.match(payload, /event: session_event/);
  assert.match(payload, /approval_required|assistant_text|session_opened/);
});
