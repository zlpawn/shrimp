import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStartCascadeRequest,
  buildSendUserCascadeMessageRequest,
  buildCascadeConfig,
  buildRequestedModelAlias,
  toFileUri,
  createLocalHostBackend,
} from "../../lib/remote-session/index.mjs";

test("buildStartCascadeRequest uses cascade client source and workspace uri", () => {
  const body = buildStartCascadeRequest({
    cascadeId: "c1",
    workspacePath: "d:\\agent-transfer",
  });
  assert.equal(body.cascadeId, "c1");
  assert.equal(body.source, "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT");
  assert.equal(body.trajectoryType, "CORTEX_TRAJECTORY_TYPE_CASCADE");
  assert.equal(body.workspaceUris[0], "file:///d:/agent-transfer");
});

test("toFileUri normalizes windows paths", () => {
  assert.equal(toFileUri("d:/agent-transfer"), "file:///d:/agent-transfer");
  assert.equal(toFileUri("file:///d:/agent-transfer"), "file:///d:/agent-transfer");
});

test("buildSendUserCascadeMessageRequest includes text chunk and model config", () => {
  const body = buildSendUserCascadeMessageRequest({
    cascadeId: "c1",
    prompt: "hello",
    requestedModel: buildRequestedModelAlias("AUTO"),
  });
  assert.equal(body.cascadeId, "c1");
  assert.equal(body.items[0].chunk.case, "text");
  assert.equal(body.items[0].chunk.value, "hello");
  assert.equal(body.cascadeConfig.plannerConfig.requestedModel.choice.case, "alias");
  assert.equal(body.cascadeConfig.plannerConfig.requestedModel.choice.value, "AUTO");
});

test("local host experimental createConversation uses StartCascade", async () => {
  const calls = [];
  const host = createLocalHostBackend({
    probe: async () => ({ running: true, supported: false, reason: "partial" }),
    listProjectsImpl: () => [
      { id: "p1", name: "demo", path: "d:/agent-transfer" },
    ],
    discoverEndpointImpl: () => ({
      url: "https://127.0.0.1:12683/",
      port: 12683,
      csrfToken: "x",
      source: "test",
    }),
    discoverConnectImpl: async () => ({
      ok: true,
      reason: "ok",
      baseUrl: "https://127.0.0.1:12683",
      csrfToken: "csrf",
      endpoint: { url: "https://127.0.0.1:12683/" },
    }),
    connectClientFactory: () => ({
      async getAllCascadeTrajectories() {
        return { trajectorySummaries: {} };
      },
      async startCascade(body) {
        calls.push(["start", body]);
        return { cascadeId: body.cascadeId };
      },
      async sendUserCascadeMessage(body) {
        calls.push(["send", body]);
        return {};
      },
      async getCascadeTrajectory(id) {
        return {
          status: "CASCADE_RUN_STATUS_IDLE",
          trajectory: {
            cascadeId: id,
            steps: [
              {
                type: "CORTEX_STEP_TYPE_USER_INPUT",
                userInput: {
                  userResponse: "hello",
                  items: [{ text: "hello" }],
                },
              },
              {
                type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
                plannerResponse: { response: "hi" },
              },
            ],
          },
        };
      },
    }),
    logger: { warn() {}, log() {} },
  });

  await host.attach();
  const created = await host.createConversation("p1", { cascadeId: "fixed-id" });
  assert.equal(created.conversationId, "fixed-id");
  assert.equal(calls[0][0], "start");
  assert.equal(calls[0][1].source, "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT");
  assert.equal(calls[0][1].workspaceUris[0], "file:///d:/agent-transfer");

  const dispatched = await host.dispatchPrompt({
    conversationId: "fixed-id",
    prompt: "hello",
    controllerPeerId: "a",
  });
  assert.equal(calls[1][0], "send");
  assert.equal(calls[1][1].items[0].chunk.value, "hello");
  assert.ok(dispatched.events.some((e) => e.type === "assistant_text"));
});

test("buildCascadeConfig defaults to conversational planner", () => {
  const cfg = buildCascadeConfig();
  assert.equal(cfg.plannerConfig.plannerTypeConfig.case, "conversational");
  assert.equal(cfg.plannerConfig.plannerTypeConfig.value.agenticMode, true);
});
