import test from "node:test";
import assert from "node:assert/strict";

import { RemoteAgentError } from "../../lib/remote-agent/domain/errors.mjs";
import { normalizeEnvelope } from "../../lib/remote-agent/domain/envelope.mjs";
import { parseCommand } from "../../lib/remote-agent/domain/commands.mjs";
import {
  formatHelp,
  formatSessionList,
  formatBindSuccess,
  formatQueued,
  formatStatus,
  formatUnbound,
  formatUnknown,
  formatCompletion,
  formatFailure,
} from "../../lib/remote-agent/domain/replies.mjs";
import { buildCompletionEvent } from "../../lib/remote-agent/domain/completion-events.mjs";

test("normalizeEnvelope builds private and group binding keys", () => {
  assert.equal(
    normalizeEnvelope({
      platform: "telegram",
      chatType: "private",
      chatId: "1",
      userId: "9",
      text: "/agent list",
    }).bindingKey,
    "telegram:private:1",
  );
  assert.equal(
    normalizeEnvelope({
      platform: "telegram",
      chatType: "group",
      chatId: "1",
      userId: "9",
      text: "hi",
    }).bindingKey,
    "telegram:group:1:user:9",
  );
});

test("normalizeEnvelope rejects invalid chatType and missing fields", () => {
  assert.throws(
    () => normalizeEnvelope({ platform: "telegram", chatType: "channel", chatId: "1", userId: "9", text: "x" }),
    (error) => error instanceof RemoteAgentError && error.type === "invalid_request",
  );
  assert.throws(
    () => normalizeEnvelope({ platform: "", chatType: "private", chatId: "1", userId: "9", text: "x" }),
    (error) => error instanceof RemoteAgentError && error.type === "invalid_request",
  );
});

test("normalizeEnvelope treats blank text as help intent text", () => {
  const envelope = normalizeEnvelope({
    platform: "telegram",
    chatType: "private",
    chatId: "1",
    userId: "9",
    text: "   ",
  });
  assert.equal(envelope.text, "/agent help");
});

test("parseCommand recognizes use targets and ordinary dispatch text", () => {
  assert.deepEqual(parseCommand("/agent use 2"), { type: "use", raw: "/agent use 2", target: "2" });
  assert.deepEqual(parseCommand("/agent use codex-abc"), {
    type: "use",
    raw: "/agent use codex-abc",
    target: "codex-abc",
  });
  assert.deepEqual(parseCommand("继续修登录"), { type: "dispatch", raw: "继续修登录" });
  assert.deepEqual(parseCommand("/agent"), { type: "help", raw: "/agent" });
  assert.deepEqual(parseCommand("/agent foo"), { type: "unknown", raw: "/agent foo", target: "foo" });
});

test("formatSessionList uses stable numbered plain text", () => {
  const text = formatSessionList([
    { client: "codex", workspacePath: "D:/a", title: "登录" },
  ]);
  assert.match(text, /^可用会话：/);
  assert.match(text, /1\. Codex \| D:\\a \| 登录/);
  assert.match(text, /用法：\/agent use 1/);
});

test("reply helpers cover bind queue status and unbound cases", () => {
  assert.match(formatHelp(), /\/agent list/);
  assert.match(
    formatBindSuccess({ client: "codex", workspacePath: "D:/a", title: "登录" }),
    /已绑定当前聊天到/,
  );
  assert.match(
    formatQueued({ client: "codex", workspacePath: "D:/a", title: "登录" }, 1),
    /已加入队列，当前排在第 1 位/,
  );
  assert.match(
    formatStatus(
      { client: "codex", workspacePath: "D:/a", title: "登录", sessionId: "s1" },
      { status: "pending", id: "t1" },
    ),
    /当前绑定/,
  );
  assert.match(formatUnbound(), /尚未绑定会话/);
  assert.match(formatUnknown("foo"), /未知命令/);
});


test("formatCompletion returns bounded plain-text success reply", () => {
  const reply = formatCompletion({
    id: "task-1",
    status: "dispatched",
    message: "继续修登录问题",
    client: "codex",
    title: "login fix",
    workspacePath: "D:/repo",
  }, { panelUrl: "http://127.0.0.1:8787/#session-kanban" });
  assert.match(reply, /已派发完成/);
  assert.match(reply, /task-1/);
  assert.match(reply, /session-kanban/);
  assert.ok(reply.length < 500);
});

test("formatFailure truncates error text", () => {
  const reply = formatFailure({
    id: "task-2",
    status: "failed",
    client: "claude",
    title: "refactor",
    workspacePath: "D:/shrimp",
    error: "x".repeat(300),
  });
  assert.match(reply, /任务失败/);
  assert.ok(reply.length < 500);
});

test("buildCompletionEvent wraps reply for webhook adapters", () => {
  const event = buildCompletionEvent({
    id: "task-1",
    status: "failed",
    sessionId: "s1",
    bindingKey: "telegram:private:123",
    platform: "telegram",
    chatType: "private",
    chatId: "123",
    userId: "789",
    replyToMessageId: "42",
  }, { reply: "任务失败：CLI unavailable" });
  assert.equal(event.type, "remote_agent.task_failed");
  assert.equal(event.reply, "任务失败：CLI unavailable");
  assert.equal(event.chatId, "123");
  assert.equal(event.taskId, "task-1");
});
