import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRemoteAgentBindingStore } from "../../lib/remote-agent/infra/binding-store.mjs";
import { createRemoteAgentService } from "../../lib/remote-agent/application/service.mjs";
import { routeRemoteAgentRequest } from "../../lib/remote-agent/http/routes.mjs";

function setupKanban(sessions) {
  const queue = [];
  return {
    async board() {
      return { sessions, queue: [...queue] };
    },
    async enqueue({ sessionId, message }) {
      const item = {
        id: `task-${queue.length + 1}`,
        sessionId,
        message,
        status: "pending",
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

test("remote-agent API health auth and message path", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-api-"));
  const bindingStore = createRemoteAgentBindingStore({ dbPath: path.join(dir, "bind.sqlite") });
  const service = createRemoteAgentService({
    bindingStore,
    sessionKanban: setupKanban([
      {
        id: "s1",
        client: "codex",
        title: "登录",
        workspacePath: "D:/AstrBot",
        status: "waiting_input",
        lastActivityAt: new Date().toISOString(),
      },
    ]),
    token: "secret",
  });

  const server = http.createServer((req, res) => {
    routeRemoteAgentRequest(req, res, new URL(req.url, "http://localhost").pathname, { service });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const health = await fetch(`http://127.0.0.1:${port}/v1/remote-agent/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.service, "remote-agent");

    const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/remote-agent/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "telegram",
        chatType: "private",
        chatId: "1",
        userId: "9",
        text: "/agent list",
      }),
    });
    assert.equal(unauthorized.status, 401);

    const listed = await fetch(`http://127.0.0.1:${port}/v1/remote-agent/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      },
      body: JSON.stringify({
        platform: "telegram",
        chatType: "private",
        chatId: "1",
        userId: "9",
        text: "/agent list",
      }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal(listed.status, 200);
    assert.equal(listed.body.ok, true);
    assert.match(listed.body.reply, /1\. Codex/);
  } finally {
    server.close();
    bindingStore.close();
  }
});
