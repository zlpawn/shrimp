import test from "node:test";
import assert from "node:assert/strict";

import {
  createFakeHostBackend,
  createMemoryEventLog,
  createPeerClient,
  createRemoteSessionService,
} from "../../lib/remote-session/index.mjs";

function makeNatTraversal({ enabled = true, peers = [] } = {}) {
  return {
    async capabilities() {
      return { enabled };
    },
    async getPublicConfig() {
      return { enabled, peers };
    },
    async listPeers() {
      return peers;
    },
    async ensureLink(peerId) {
      const peer = peers.find((item) => item.id === peerId);
      if (!peer) {
        const err = new Error("peer not found: " + peerId);
        err.code = "peer_not_found";
        throw err;
      }
      return {
        peerId,
        provider: "frpc",
        status: "online",
        endpoint: peer.services?.gatewayApi || "",
      };
    },
    async openService(peerId, service) {
      const peer = peers.find((item) => item.id === peerId);
      if (!peer) {
        const err = new Error("peer not found: " + peerId);
        err.code = "peer_not_found";
        throw err;
      }
      if (service !== "gateway-api") {
        const err = new Error("unsupported service: " + service);
        err.code = "unsupported_feature";
        throw err;
      }
      return {
        service,
        endpoint: peer.services?.gatewayApi || "127.0.0.1:18788",
      };
    },
  };
}

test("peer client lists projects from host gateway endpoint", async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/v1\/remote-session\/host\/projects$/);
    return new Response(JSON.stringify({ projects: [{ id: "p1", name: "demo" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = createPeerClient({
    baseUrl: "http://127.0.0.1:18788",
    fetchImpl,
  });
  const data = await client.listProjects();
  assert.equal(data.projects[0].id, "p1");
});

test("service openSession over peer uses ensureLink/openService and peer host APIs", async () => {
  const calls = [];
  const hostState = {
    conversationId: "c_peer_1",
    events: [],
  };

  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    const method = init.method || "GET";
    calls.push({ href, method, body: init.body || "" });

    if (href.endsWith("/v1/remote-session/host/attach") && method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (href.endsWith("/v1/remote-session/host/projects") && method === "GET") {
      return new Response(JSON.stringify({ projects: [{ id: "p1", name: "demo" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (href.endsWith("/v1/remote-session/host/conversations") && method === "POST") {
      return new Response(
        JSON.stringify({ conversationId: hostState.conversationId, sessionId: "host_rs_1" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (href.includes("/v1/remote-session/host/conversations/") && href.endsWith("/prompt") && method === "POST") {
      hostState.events = [
        {
          type: "assistant_text",
          text: "peer editing",
          conversationId: hostState.conversationId,
          seq: 1,
        },
        {
          type: "turn_completed",
          conversationId: hostState.conversationId,
          seq: 2,
        },
      ];
      return new Response(
        JSON.stringify({
          turnId: "t_peer_1",
          events: hostState.events,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: { message: "unexpected " + href } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };

  let stored = { enabled: true };
  const service = createRemoteSessionService({
    configStore: {
      get: () => stored,
      save: (next) => {
        stored = next;
      },
    },
    natTraversal: makeNatTraversal({
      enabled: true,
      peers: [
        {
          id: "home",
          displayName: "Home",
          services: { gatewayApi: "127.0.0.1:18788" },
        },
      ],
    }),
    eventLogFactory: createMemoryEventLog,
    fetchImpl,
  });

  const session = await service.openSession({
    peerId: "home",
    projectId: "p1",
    controllerPeerId: "controller-a",
  });
  assert.equal(session.hostPeerId, "home");
  assert.equal(session.hostConversationId, "c_peer_1");

  const result = await service.dispatchPrompt({
    sessionId: session.id,
    prompt: "edit over peer",
    controllerPeerId: "controller-a",
  });
  assert.equal(result.turnId, "t_peer_1");
  assert.ok(result.events.some((event) => event.type === "assistant_text"));

  assert.ok(calls.some((call) => call.href.includes("/host/conversations") && call.method === "POST"));
  assert.ok(calls.some((call) => call.href.includes("/prompt") && call.method === "POST"));
});
