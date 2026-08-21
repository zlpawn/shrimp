import test from "node:test";
import assert from "node:assert/strict";

import {
  RemoteSessionError,
  createFakeHostBackend,
  createMemoryEventLog,
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
      if (
        !peers.some((peer) => peer.id === peerId) &&
        peerId !== "local-host" &&
        peerId !== "fake-host"
      ) {
        const err = new Error("peer '" + peerId + "' not found");
        err.code = "peer_not_found";
        throw err;
      }
      return {
        peerId,
        provider: "frpc",
        status: "online",
        endpoint: peers.find((peer) => peer.id === peerId)?.services?.gatewayApi || "",
      };
    },
    async openService(peerId, service) {
      const peer = peers.find((item) => item.id === peerId);
      if (!peer) {
        const err = new Error("peer '" + peerId + "' not found");
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
        endpoint: peer.services?.gatewayApi || "",
      };
    },
  };
}

function makeService({
  host,
  enabled = true,
  natEnabled = true,
  peers = [],
} = {}) {
  let stored = { enabled };
  const fakeHost =
    host ||
    createFakeHostBackend({
      projects: [{ id: "p1", name: "demo", path: "/tmp/demo" }],
    });
  const service = createRemoteSessionService({
    configStore: {
      get: () => stored,
      save: (next) => {
        stored = next;
      },
    },
    natTraversal: makeNatTraversal({ enabled: natEnabled, peers }),
    hostBackendFactory: async () => fakeHost,
    eventLogFactory: createMemoryEventLog,
    clock: () => 1700000000000,
  });
  return { service, getStored: () => stored, host: fakeHost };
}

test("openSession attaches host backend and creates conversation", async () => {
  const { service } = makeService();
  await service.updateConfig({ enabled: true });
  const session = await service.openSession({
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "controller-a",
  });
  assert.equal(session.state, "ready");
  assert.ok(session.hostConversationId);
  assert.equal(session.controllerPeerId, "controller-a");
});

test("dispatchPrompt emits events and can require approval", async () => {
  const { service } = makeService({
    host: createFakeHostBackend({
      projects: [{ id: "p1", name: "demo" }],
      scriptedTurns: [
        {
          events: [
            { type: "assistant_text", text: "editing" },
            { type: "approval_required", approvalId: "ap1", summary: "run rm" },
          ],
        },
      ],
    }),
  });
  await service.updateConfig({ enabled: true });
  const session = await service.openSession({
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "a",
  });
  const result = await service.dispatchPrompt({
    sessionId: session.id,
    prompt: "delete temp",
    controllerPeerId: "a",
  });
  assert.equal(result.session.state, "awaiting_approval");
  const listed = await service.listEvents({ sessionId: session.id, cursor: 0 });
  assert.ok(listed.events.some((event) => event.type === "approval_required"));
});

test("non-controller cannot decide approval", async () => {
  const { service } = makeService({
    host: createFakeHostBackend({
      projects: [{ id: "p1", name: "demo" }],
      scriptedTurns: [
        {
          events: [{ type: "approval_required", approvalId: "ap1", summary: "run rm" }],
        },
      ],
    }),
  });
  await service.updateConfig({ enabled: true });
  const session = await service.openSession({
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "a",
  });
  await service.dispatchPrompt({
    sessionId: session.id,
    prompt: "delete temp",
    controllerPeerId: "a",
  });
  await assert.rejects(
    () =>
      service.decideApproval({
        sessionId: session.id,
        approvalId: "ap1",
        decision: "allow",
        controllerPeerId: "b",
      }),
    (error) => error instanceof RemoteSessionError && error.code === "not_controller",
  );
});

test("resume after disconnect continues from cursor", async () => {
  const { service } = makeService();
  await service.updateConfig({ enabled: true });
  const session = await service.openSession({
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "a",
  });
  await service.dispatchPrompt({
    sessionId: session.id,
    prompt: "hello",
    controllerPeerId: "a",
  });
  const before = await service.listEvents({ sessionId: session.id, cursor: 0 });
  assert.ok(before.events.length >= 2);
  await service.markDisconnected({ sessionId: session.id });
  const status = await service.status();
  assert.equal(status.sessions[0].state, "disconnected");
  const resumed = await service.resumeSession({
    sessionId: session.id,
    controllerPeerId: "a",
    cursor: before.events[0].seq,
  });
  assert.equal(resumed.session.state, "ready");
  assert.ok(resumed.events.length >= 1);
  assert.equal(resumed.events[0].seq, before.events[1].seq);
});

test("live local host session can dispatch with explicit model and stream host events", async () => {
  const calls = [];
  const host = {
    id: "local-host",
    capabilities() {
      return ["attach", "createConversation", "dispatchPrompt", "subscribeEvents"];
    },
    async attach() {
      calls.push(["attach"]);
      return { transport: "local-connect-readonly" };
    },
    async listProjects() {
      return [{ id: "p-live", name: "live", path: "d:/agent-transfer" }];
    },
    async listConversations() {
      return [];
    },
    async getConversation() {
      return null;
    },
    async createConversation(projectId, options = {}) {
      calls.push(["create", projectId, options]);
      return { conversationId: "cascade-live" };
    },
    async dispatchPrompt({ conversationId, prompt, model }) {
      calls.push(["dispatch", conversationId, prompt, model]);
      return {
        turnId: "turn-live",
        events: [
          { type: "user_text", text: prompt },
          { type: "assistant_text", text: "12" },
        ],
      };
    },
    async subscribeEvents({ conversationId, cursor = 0 }) {
      calls.push(["subscribe", conversationId, cursor]);
      async function* iterator() {
        yield { seq: cursor + 1, type: "assistant_text", text: "12" };
        yield { seq: cursor + 2, type: "turn_completed" };
      }
      return iterator();
    },
  };
  const { service } = makeService({ host });
  await service.updateConfig({ enabled: true });
  const session = await service.openSession({
    peerId: "local-host",
    projectId: "p-live",
    controllerPeerId: "a",
    model: "MODEL_PLACEHOLDER_M298",
  });
  assert.equal(session.hostConversationId, "cascade-live");
  assert.deepEqual(calls[1], [
    "create",
    "p-live",
    { model: "MODEL_PLACEHOLDER_M298" },
  ]);

  const dispatched = await service.dispatchPrompt({
    sessionId: session.id,
    prompt: "只回答数字：6+6=?",
    controllerPeerId: "a",
    model: "MODEL_PLACEHOLDER_M298",
  });
  assert.equal(dispatched.turnId, "turn-live");
  assert.deepEqual(calls[2], [
    "dispatch",
    "cascade-live",
    "只回答数字：6+6=?",
    "MODEL_PLACEHOLDER_M298",
  ]);

  const streamed = [];
  for await (const event of service.subscribe({
    sessionId: session.id,
    cursor: 0,
    includeHostEvents: true,
  })) {
    streamed.push(event);
    if (streamed.length >= 4) break;
  }
  assert.ok(streamed.some((event) => event.hostEvent?.text === "12"));
  assert.ok(calls.some((call) => call[0] === "subscribe"));
});

test("SSH subscribeEvents keeps polling remote trajectory events", async () => {
  const calls = [];
  const { createSshHostBackend } = await import(
    "../../lib/remote-session/host-attach/ssh-host.mjs"
  );
  const host = createSshHostBackend({
    peer: {
      id: "ssh-peer",
      transport: { host: "example.test", port: 22 },
      auth: { ssh: { username: "tester" } },
    },
    logger: { warn() {}, log() {} },
    runRemoteNodeScriptImpl: async (script, options) => {
      calls.push({ script, options });
      const step = {
        type: calls.length === 1
          ? "CORTEX_STEP_TYPE_PLANNER_RESPONSE"
          : "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: { response: "hello" },
      };
      return JSON.stringify({
        status: calls.length === 1
          ? "CASCADE_RUN_STATUS_RUNNING"
          : "CASCADE_RUN_STATUS_IDLE",
        trajectory: { cascadeId: "cascade-ssh", steps: [step] },
      });
    },
  });

  const seen = [];
  for await (const event of await host.subscribeEvents({
    conversationId: "cascade-ssh",
    cursor: 0,
    intervalMs: 1,
    timeoutMs: 10,
  })) {
    seen.push(event);
  }

  assert.ok(seen.some((event) => event.type === "assistant_text"));
  assert.ok(calls.length >= 2, "SSH subscription should poll trajectory more than once");
});

test("buildCascadeConfig includes declarative planner mixins", async () => {
  const { buildCascadeConfig } = await import(
    "../../lib/remote-session/host-attach/language-server-connect.mjs"
  );
  const config = buildCascadeConfig({
    requestedModel: { model: "MODEL_PLACEHOLDER_M298" },
  });
  assert.equal(config.plannerConfig.declarativeMixinConfig.promptSections.length > 0, true);
  assert.ok(config.plannerConfig.planModel);
});

test("enabling remote session requires nat traversal", async () => {
  const { service } = makeService({ natEnabled: false, enabled: false });
  await assert.rejects(
    () => service.updateConfig({ enabled: true }),
    (error) => error instanceof RemoteSessionError && error.code === "dependency_disabled",
  );
});
