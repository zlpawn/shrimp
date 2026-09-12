import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRemoteAgentBindingStore } from "../../lib/remote-agent/infra/binding-store.mjs";
import { createRemoteAgentService } from "../../lib/remote-agent/application/service.mjs";
import { RemoteAgentError } from "../../lib/remote-agent/domain/errors.mjs";

function setupKanban(sessions) {
  const queue = [];
  return {
    async board() {
      return { sessions, queue: [...queue] };
    },
    async enqueue(input) {
      const item = {
        id: `task-${queue.length + 1}`,
        sessionId: input.sessionId,
        message: input.message,
        status: "pending",
        source: input.source || "",
        bindingKey: input.bindingKey || "",
        platform: input.platform || "",
        chatType: input.chatType || "",
        chatId: input.chatId || "",
        userId: input.userId || "",
        replyToMessageId: input.replyToMessageId || "",
        notifyStatus: input.source === "remote-agent" ? "pending" : "none",
        createdAt: new Date().toISOString(),
      };
      queue.unshift(item);
      return item;
    },
    async listQueue() {
      return [...queue];
    },
  };
}

function setupService(sessions, token = "secret") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-service-"));
  const bindingStore = createRemoteAgentBindingStore({ dbPath: path.join(dir, "b.sqlite") });
  const sessionKanban = setupKanban(sessions);
  const service = createRemoteAgentService({
    bindingStore,
    sessionKanban,
    token,
  });
  return { service, bindingStore, sessionKanban };
}

const sessions = [
  {
    id: "s1",
    client: "codex",
    title: "登录",
    workspacePath: "D:/AstrBot",
    status: "waiting_input",
    lastActivityAt: "2026-09-09T12:00:00.000Z",
  },
  {
    id: "s2",
    client: "claude",
    title: "重构",
    workspacePath: "D:/shrimp",
    status: "completed",
    lastActivityAt: "2026-09-09T11:00:00.000Z",
  },
];

test("rejects unauthorized token", async () => {
  const { service } = setupService(sessions);
  await assert.rejects(
    () => service.handleMessage(
      { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent list" },
      { authorization: "Bearer wrong" },
    ),
    (error) => error instanceof RemoteAgentError && error.type === "unauthorized",
  );
});

test("list use and dispatch happy path", async () => {
  const { service } = setupService(sessions);
  const auth = { authorization: "Bearer secret" };
  const listed = await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent list" },
    auth,
  );
  assert.equal(listed.ok, true);
  assert.match(listed.reply, /1\. Codex/);

  const bound = await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent use 1" },
    auth,
  );
  assert.match(bound.reply, /已绑定当前聊天到/);
  assert.equal(bound.sessionId, "s1");

  const queued = await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "继续修登录" },
    auth,
  );
  assert.equal(queued.ok, true);
  assert.equal(queued.taskId, "task-1");
  assert.equal(queued.sessionId, "s1");
  assert.match(queued.reply, /已加入队列，当前排在第 1 位/);
});

test("dispatch without binding returns conflict with Chinese reply", async () => {
  const { service } = setupService(sessions);
  await assert.rejects(
    () => service.handleMessage(
      { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "直接干活" },
      { authorization: "Bearer secret" },
    ),
    (error) => error instanceof RemoteAgentError
      && error.type === "conflict"
      && /尚未绑定会话/.test(error.reply),
  );
});

test("use with missing index returns not_found", async () => {
  const { service } = setupService(sessions);
  const auth = { authorization: "Bearer secret" };
  await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent list" },
    auth,
  );
  await assert.rejects(
    () => service.handleMessage(
      { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent use 9" },
      auth,
    ),
    (error) => error instanceof RemoteAgentError && error.type === "not_found",
  );
});


test("dispatch enqueue carries remote-agent delivery metadata", async () => {
  const { service, sessionKanban } = setupService(sessions);
  const auth = { authorization: "Bearer secret" };
  await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent list" },
    auth,
  );
  await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent use 1" },
    auth,
  );
  await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "继续修登录问题", replyToMessageId: "42" },
    auth,
  );
  const queued = (await sessionKanban.listQueue())[0];
  assert.equal(queued.source, "remote-agent");
  assert.equal(queued.bindingKey, "telegram:private:1");
  assert.equal(queued.platform, "telegram");
  assert.equal(queued.chatType, "private");
  assert.equal(queued.chatId, "1");
  assert.equal(queued.userId, "9");
  assert.equal(queued.replyToMessageId, "42");
  assert.equal(queued.notifyStatus, "pending");
});

test("dangerous dispatch requires confirmation then confirm enqueues", async () => {
  const { service, sessionKanban } = setupService(sessions);
  const auth = { authorization: "Bearer secret" };
  await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent list" },
    auth,
  );
  await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent use 1" },
    auth,
  );
  const challenged = await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "git push origin main" },
    auth,
  );
  assert.match(challenged.reply, /确认码:/);
  assert.deepEqual(challenged.actions, ["confirmation_required"]);
  assert.equal((await sessionKanban.listQueue()).length, 0);
  const token = challenged.reply.match(/确认码:\s*(\S+)/)?.[1];
  assert.ok(token);
  const confirmed = await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: `/agent confirm ${token}` },
    auth,
  );
  assert.match(confirmed.reply, /已确认并加入队列/);
  assert.equal((await sessionKanban.listQueue()).length, 1);
});

test("open policy skips confirmation for dangerous text", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-service-"));
  const bindingStore = createRemoteAgentBindingStore({ dbPath: path.join(dir, "b.sqlite") });
  const sessionKanban = setupKanban(sessions);
  const service = createRemoteAgentService({
    bindingStore,
    sessionKanban,
    token: "secret",
    policyMode: "open",
  });
  const auth = { authorization: "Bearer secret" };
  await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent list" },
    auth,
  );
  await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent use 1" },
    auth,
  );
  const result = await service.handleMessage(
    { platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "git push origin main" },
    auth,
  );
  assert.match(result.reply, /已加入队列/);
  assert.equal((await sessionKanban.listQueue()).length, 1);
});
