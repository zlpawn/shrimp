import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createFakeHostBackend,
  createMemoryEventLog,
  createRemoteSessionService,
  routeRemoteSessionRequest,
} from "../../lib/remote-session/index.mjs";
import {
  createOfficialRemoteLinkService,
  createOfficialRemoteLinkSqliteStore,
  routeOfficialRemoteLinkRequest,
} from "../../lib/remote-session/official-links/index.mjs";

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

test("official Antigravity remote links persist through HTTP routes", async () => {
  const store = createOfficialRemoteLinkSqliteStore({ dbPath: path.join(os.tmpdir(), "official-links-api.sqlite") });
  const service = createOfficialRemoteLinkService({ store, fetchImpl: async () => ({ status: 200, headers: new Map() }) });
  const createRes = makeRes();
  await routeOfficialRemoteLinkRequest(
    makeReq("POST", "/v1/remote-session/official-links", {
      name: "工作台",
      url: "https://antigravity.google.com/r/demo-v2?p=c%2Fdemo",
    }),
    createRes,
    {},
    "/v1/remote-session/official-links",
    { service },
  );
  assert.equal(createRes.statusCode, 200);
  const link = JSON.parse(createRes.body).link;
  assert.equal(link.kind, "antigravity");
  store.close();
});

test("lists and inspects conversations via HTTP", async () => {
  const service = makeService();
  // create one fake conversation by opening a session
  const opened = await call(service, "POST", "/v1/remote-session/sessions", {
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "a",
  });
  assert.equal(opened.res.statusCode, 200);
  const conversationId = opened.json.session.hostConversationId;

  const listed = await call(
    service,
    "GET",
    "/v1/remote-session/conversations?peerId=local-host&limit=10",
  );
  assert.equal(listed.res.statusCode, 200);
  assert.ok(Array.isArray(listed.json.conversations));
  assert.ok(
    listed.json.conversations.some((item) => item.conversationId === conversationId),
  );

  const inspected = await call(
    service,
    "GET",
    "/v1/remote-session/conversations/" + encodeURIComponent(conversationId) + "?peerId=local-host",
  );
  assert.equal(inspected.res.statusCode, 200);
  assert.equal(inspected.json.conversation.id, conversationId);
});

test("session HTTP API forwards model fields and host event stream flag", async () => {
  const host = createFakeHostBackend({
    projects: [{ id: "p1", name: "demo" }],
  });
  const forwarded = [];
  const wrappedHost = new Proxy(host, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "createConversation") {
        return async (...args) => {
          forwarded.push(["create", ...args]);
          return value.apply(target, args);
        };
      }
      if (prop === "dispatchPrompt") {
        return async (...args) => {
          forwarded.push(["dispatch", ...args]);
          return value.apply(target, args);
        };
      }
      if (prop === "subscribeEvents") {
        return async (...args) => {
          forwarded.push(["subscribe", ...args]);
          return value.apply(target, args);
        };
      }
      return value;
    },
  });

  let stored = { enabled: true };
  const service = createRemoteSessionService({
    configStore: {
      get: () => stored,
      save: (next) => {
        stored = next;
      },
    },
    natTraversal: makeNatTraversal({ enabled: true }),
    hostBackendFactory: async () => wrappedHost,
    eventLogFactory: createMemoryEventLog,
  });

  const opened = await call(service, "POST", "/v1/remote-session/sessions", {
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "a",
    model: "MODEL_PLACEHOLDER_M298",
  });
  assert.equal(opened.res.statusCode, 200);
  assert.equal(forwarded[0][0], "create");
  assert.equal(forwarded[0][2].model, "MODEL_PLACEHOLDER_M298");

  const sessionId = opened.json.session.id;
  const prompted = await call(
    service,
    "POST",
    "/v1/remote-session/sessions/" + sessionId + "/prompt",
    {
      prompt: "hello",
      controllerPeerId: "a",
      model: "MODEL_PLACEHOLDER_M298",
    },
  );
  assert.equal(prompted.res.statusCode, 200);
  assert.equal(forwarded[1][0], "dispatch");
  assert.equal(forwarded[1][1].model, "MODEL_PLACEHOLDER_M298");
});

