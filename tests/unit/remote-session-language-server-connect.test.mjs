import test from "node:test";
import assert from "node:assert/strict";

import {
  createLanguageServerConnectClient,
  summarizeTrajectoryList,
  summarizeTrajectoryDetail,
  createLocalHostBackend,
} from "../../lib/remote-session/index.mjs";

test("summarizeTrajectoryList maps cascade summaries", () => {
  const items = summarizeTrajectoryList({
    trajectorySummaries: {
      "21335b56-743a-4e24-8066-43540024eb37": {
        summary: "Inquiring About AI Identity",
        stepCount: 3,
        trajectoryId: "e4e80710-9f18-48c1-980a-4d6cdc8428cb",
        status: "CASCADE_RUN_STATUS_IDLE",
        createdTime: "2026-08-15T02:17:17Z",
        lastModifiedTime: "2026-08-15T02:17:30Z",
      },
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].conversationId, "21335b56-743a-4e24-8066-43540024eb37");
  assert.equal(items[0].title, "Inquiring About AI Identity");
  assert.equal(items[0].source, "language-server-connect");
});

test("summarizeTrajectoryDetail maps steps to events", () => {
  const detail = summarizeTrajectoryDetail(
    {
      status: "CASCADE_RUN_STATUS_IDLE",
      numTotalSteps: 2,
      trajectory: {
        cascadeId: "c1",
        trajectoryId: "t1",
        steps: [
          {
            type: "CORTEX_STEP_TYPE_USER_INPUT",
            status: "CORTEX_STEP_STATUS_DONE",
            metadata: { source: "CORTEX_STEP_SOURCE_USER_EXPLICIT" },
            userInput: {
              userResponse: "hello",
              items: [{ text: "hello" }],
            },
          },
          {
            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
            status: "CORTEX_STEP_STATUS_DONE",
            metadata: { source: "MODEL" },
            plannerResponse: { response: "hi there", modifiedResponse: "hi there" },
          },
        ],
      },
    },
    { cascadeId: "c1" },
  );
  assert.equal(detail.mode, "live_readonly");
  assert.equal(detail.events[0].type, "user_text");
  assert.equal(detail.events[0].text, "hello");
  assert.equal(detail.events[1].type, "assistant_text");
  assert.equal(detail.events[1].text, "hi there");
});

test("language server connect client posts Connect-JSON", async () => {
  const calls = [];
  const client = createLanguageServerConnectClient({
    baseUrl: "https://127.0.0.1:9608",
    csrfToken: "csrf-test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        async text() {
          return JSON.stringify({ trajectorySummaries: {} });
        },
      };
    },
  });
  const data = await client.getAllCascadeTrajectories();
  assert.deepEqual(data, { trajectorySummaries: {} });
  assert.equal(
    calls[0].url,
    "https://127.0.0.1:9608/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories",
  );
  assert.equal(calls[0].init.headers["connect-protocol-version"], "1");
  assert.equal(calls[0].init.headers["x-codeium-csrf-token"], "csrf-test");
});

test("local host prefers live connect list/inspect when available", async () => {
  const host = createLocalHostBackend({
    probe: async () => ({
      running: true,
      supported: false,
      reason: "process_found_but_attach_surface_unconfirmed",
    }),
    listProjectsImpl: () => [{ id: "p1", name: "demo", path: "/tmp/demo" }],
    discoverEndpointImpl: () => ({
      url: "https://127.0.0.1:9608/",
      port: 9608,
      csrfToken: "old",
      source: "test",
    }),
    discoverConnectImpl: async () => ({
      ok: true,
      reason: "ok",
      baseUrl: "https://127.0.0.1:9608",
      csrfToken: "csrf-live",
      endpoint: { url: "https://127.0.0.1:9608/" },
    }),
    connectClientFactory: () => ({
      async getAllCascadeTrajectories() {
        return {
          trajectorySummaries: {
            "c-live": {
              summary: "Live Conversation",
              stepCount: 1,
              trajectoryId: "t-live",
              status: "CASCADE_RUN_STATUS_IDLE",
              lastModifiedTime: "2026-08-15T03:00:00Z",
            },
          },
        };
      },
      async getCascadeTrajectory(id) {
        assert.equal(id, "c-live");
        return {
          status: "CASCADE_RUN_STATUS_IDLE",
          numTotalSteps: 1,
          trajectory: {
            cascadeId: "c-live",
            trajectoryId: "t-live",
            steps: [
              {
                type: "CORTEX_STEP_TYPE_USER_INPUT",
                metadata: { source: "CORTEX_STEP_SOURCE_USER_EXPLICIT" },
                userInput: {
                  userResponse: "from live rpc",
                  items: [{ text: "from live rpc" }],
                },
              },
            ],
          },
        };
      },
    }),
    listConversationsImpl: () => {
      throw new Error("filesystem list should not be required");
    },
    getConversationImpl: () => {
      throw new Error("filesystem get should not be required");
    },
    logger: { warn() {}, log() {} },
  });

  const attached = await host.attach();
  assert.equal(attached.transport, "local-connect-readonly");
  assert.equal(attached.support.liveConnect, true);

  const list = await host.listConversations({ limit: 5 });
  assert.equal(list[0].id, "c-live");
  assert.equal(list[0].source, "language-server-connect");

  const detail = await host.getConversation("c-live");
  assert.equal(detail.mode, "live_readonly");
  assert.equal(detail.events[0].text, "from live rpc");
});
