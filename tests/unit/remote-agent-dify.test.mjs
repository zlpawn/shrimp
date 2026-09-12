import test from "node:test";
import assert from "node:assert/strict";

import {
  createDifySseStream,
  mapDifyChatRequest,
  buildDifySseEvents,
  encodeSse,
} from "../../lib/remote-agent/adapters/dify.mjs";

test("mapDifyChatRequest maps LangBot variables into envelope", () => {
  const mapped = mapDifyChatRequest({
    query: "/agent list",
    user: "u1",
    conversation_id: "",
    response_mode: "streaming",
    inputs: {
      launcher_type: "group",
      launcher_id: "tg-group-1",
      sender_id: "sender-9",
      platform: "telegram",
    },
  }, { authorization: "Bearer secret" });

  assert.equal(mapped.envelope.platform, "telegram");
  assert.equal(mapped.envelope.chatType, "group");
  assert.equal(mapped.envelope.chatId, "tg-group-1");
  assert.equal(mapped.envelope.userId, "sender-9");
  assert.equal(mapped.envelope.text, "/agent list");
});

test("buildDifySseEvents emits message and message_end", () => {
  const events = buildDifySseEvents({
    reply: "可用会话：\n1. Codex | D:\\a | 登录",
    taskId: null,
    sessionId: null,
    bindingKey: "telegram:private:1",
  }, { conversationId: "conv_1", user: "u1" });
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "message");
  assert.equal(events[0].conversation_id, "conv_1");
  assert.equal(events[1].event, "message_end");
  assert.match(encodeSse(events), /^data: /);
});

test("dify SSE stream waits for settled task and streams timeout notice", async () => {
  let calls = 0;
  let currentTime = 0;
  const stream = createDifySseStream({
    initialResult: {
      ok: true,
      reply: "已加入队列，当前排在第 1 位。",
      taskId: "task-1",
      sessionId: "s1",
      bindingKey: "telegram:private:1",
    },
    conversationId: "conv_1",
    user: "u1",
    getTask: async () => {
      calls += 1;
      return { status: "dispatching" };
    },
    pollIntervalMs: 1,
    maxWaitMs: 5,
    now: () => {
      currentTime += 10;
      return currentTime;
    },
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(String(chunk));
  const body = chunks.join("");
  assert.match(body, /已加入队列/);
  assert.match(body, /任务仍在运行/);
  assert.ok(calls >= 1);
});

test("dify SSE stream reports canceled tasks as canceled", async () => {
  const stream = createDifySseStream({
    initialResult: { taskId: "task-1", bindingKey: "b" },
    getTask: async () => ({ status: "canceled", id: "task-1" }),
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(String(chunk));
  const body = chunks.join("");
  assert.match(body, /任务已取消/);
  assert.doesNotMatch(body, /已派发完成/);
});

test("dify SSE stream finishes after task settles", async () => {
  const stream = createDifySseStream({
    initialResult: {
      ok: true,
      reply: "已加入队列，当前排在第 1 位。",
      taskId: "task-1",
      sessionId: "s1",
      bindingKey: "telegram:private:1",
    },
    conversationId: "conv_1",
    user: "u1",
    getTask: async () => ({
      status: "dispatched",
      id: "task-1",
      sessionId: "s1",
      client: "codex",
      title: "login fix",
      workspacePath: "D:/repo",
      message: "fix login",
    }),
    pollIntervalMs: 1,
    maxWaitMs: 100,
    now: () => 0,
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(String(chunk));
  const body = chunks.join("");
  assert.match(body, /已派发完成/);
  assert.doesNotMatch(body, /任务仍在运行/);
});
