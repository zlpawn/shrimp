import test from "node:test";
import assert from "node:assert/strict";

import {
  trajectoryEventsSince,
  pollTrajectoryEvents,
  createLocalHostBackend,
} from "../../lib/remote-session/index.mjs";

test("trajectoryEventsSince filters by cursor", () => {
  const events = trajectoryEventsSince(
    {
      events: [
        { seq: 1, type: "user_text", text: "a" },
        { seq: 2, type: "assistant_text", text: "b" },
        { seq: 3, type: "assistant_text", text: "c" },
      ],
    },
    1,
  );
  assert.deepEqual(
    events.map((e) => e.seq),
    [2, 3],
  );
});

test("pollTrajectoryEvents yields incremental events and can stop", async () => {
  let calls = 0;
  const client = {
    async getCascadeTrajectory(id) {
      calls += 1;
      assert.equal(id, "c1");
      if (calls === 1) {
        return {
          status: "CASCADE_RUN_STATUS_RUNNING",
          trajectory: {
            cascadeId: "c1",
            steps: [
              {
                type: "CORTEX_STEP_TYPE_USER_INPUT",
                userInput: { userResponse: "hi", items: [{ text: "hi" }] },
              },
            ],
          },
        };
      }
      return {
        status: "CASCADE_RUN_STATUS_IDLE",
        trajectory: {
          cascadeId: "c1",
          steps: [
            {
              type: "CORTEX_STEP_TYPE_USER_INPUT",
              userInput: { userResponse: "hi", items: [{ text: "hi" }] },
            },
            {
              type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
              plannerResponse: { response: "hello" },
            },
          ],
        },
      };
    },
  };

  const seen = [];
  for await (const event of pollTrajectoryEvents({
    client,
    conversationId: "c1",
    cursor: 0,
    intervalMs: 1,
    timeoutMs: 1000,
    sleep: async () => {},
  })) {
    seen.push(event);
  }
  assert.ok(seen.some((e) => e.type === "user_text"));
  assert.ok(seen.some((e) => e.type === "assistant_text" && e.text === "hello"));
  assert.ok(calls >= 2);
});

test("local host subscribeEvents polls trajectory updates", async () => {
  let n = 0;
  const host = createLocalHostBackend({
    probe: async () => ({ running: true, supported: false, reason: "partial" }),
    listProjectsImpl: () => [{ id: "p1", name: "demo", path: "d:/agent-transfer" }],
    discoverEndpointImpl: () => ({
      url: "https://127.0.0.1:6506/",
      port: 6506,
      csrfToken: "x",
      source: "test",
    }),
    discoverConnectImpl: async () => ({
      ok: true,
      reason: "ok",
      baseUrl: "https://127.0.0.1:6506",
      csrfToken: "csrf",
      endpoint: { url: "https://127.0.0.1:6506/" },
    }),
    connectClientFactory: () => ({
      async getAllCascadeTrajectories() {
        return { trajectorySummaries: {} };
      },
      async getCascadeTrajectory() {
        n += 1;
        if (n === 1) {
          return {
            status: "CASCADE_RUN_STATUS_RUNNING",
            trajectory: {
              cascadeId: "c-live",
              steps: [
                {
                  type: "CORTEX_STEP_TYPE_USER_INPUT",
                  userInput: {
                    userResponse: "ping",
                    items: [{ text: "ping" }],
                  },
                },
              ],
            },
          };
        }
        return {
          status: "CASCADE_RUN_STATUS_IDLE",
          trajectory: {
            cascadeId: "c-live",
            steps: [
              {
                type: "CORTEX_STEP_TYPE_USER_INPUT",
                userInput: {
                  userResponse: "ping",
                  items: [{ text: "ping" }],
                },
              },
              {
                type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
                plannerResponse: { response: "pong" },
              },
            ],
          },
        };
      },
    }),
    logger: { warn() {}, log() {} },
  });

  await host.attach();
  assert.ok(host.capabilities().includes("subscribeEvents"));
  const events = [];
  for await (const event of await host.subscribeEvents({
    conversationId: "c-live",
    cursor: 0,
    intervalMs: 1,
    timeoutMs: 1000,
  })) {
    events.push(event);
  }
  assert.ok(events.some((e) => e.type === "assistant_text" && e.text === "pong"));
});

test("pollTrajectoryEvents re-emits in-place assistant text updates", async () => {
  let calls = 0;
  const client = {
    async getCascadeTrajectory() {
      calls += 1;
      if (calls === 1) {
        return {
          status: "CASCADE_RUN_STATUS_RUNNING",
          trajectory: {
            cascadeId: "c1",
            steps: [
              {
                type: "CORTEX_STEP_TYPE_USER_INPUT",
                userInput: { userResponse: "hi", items: [{ text: "hi" }] },
              },
              {
                type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
                plannerResponse: { response: "" },
              },
            ],
          },
        };
      }
      return {
        status: "CASCADE_RUN_STATUS_IDLE",
        trajectory: {
          cascadeId: "c1",
          steps: [
            {
              type: "CORTEX_STEP_TYPE_USER_INPUT",
              userInput: { userResponse: "hi", items: [{ text: "hi" }] },
            },
            {
              type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
              plannerResponse: { response: "hello later" },
            },
          ],
        },
      };
    },
  };
  const seen = [];
  for await (const event of pollTrajectoryEvents({
    client,
    conversationId: "c1",
    cursor: 0,
    intervalMs: 1,
    timeoutMs: 1000,
    sleep: async () => {},
  })) {
    seen.push(event);
  }
  const assistants = seen.filter((e) => e.type === "assistant_text");
  assert.ok(assistants.some((e) => e.text === ""));
  assert.ok(assistants.some((e) => e.text === "hello later" && e.updated));
});

