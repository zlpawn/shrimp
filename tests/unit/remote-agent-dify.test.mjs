import test from "node:test";
import assert from "node:assert/strict";

import {
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
