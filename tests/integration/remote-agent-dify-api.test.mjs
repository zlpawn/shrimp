import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRemoteAgentBindingStore } from "../../lib/remote-agent/infra/binding-store.mjs";
import { createRemoteAgentService } from "../../lib/remote-agent/application/service.mjs";
import { routeDifyCompatibleRequest } from "../../lib/remote-agent/http/routes.mjs";

test("dify compatible chat-messages streams reply", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-dify-"));
  const bindingStore = createRemoteAgentBindingStore({ dbPath: path.join(dir, "b.sqlite") });
  const service = createRemoteAgentService({
    bindingStore,
    sessionKanban: {
      async board() {
        return {
          sessions: [{
            id: "s1",
            client: "codex",
            title: "登录",
            workspacePath: "D:/AstrBot",
            status: "waiting_input",
            lastActivityAt: new Date().toISOString(),
          }],
          queue: [],
        };
      },
      async enqueue() {
        throw new Error("should not enqueue for list");
      },
    },
    token: "secret",
  });

  const server = http.createServer((req, res) => {
    routeDifyCompatibleRequest(req, res, new URL(req.url, "http://localhost").pathname, { service });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/dify/v1/chat-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      },
      body: JSON.stringify({
        query: "/agent list",
        user: "u1",
        response_mode: "streaming",
        conversation_id: "",
        inputs: {
          launcher_type: "private",
          launcher_id: "1",
          sender_id: "9",
          platform: "telegram",
        },
      }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/event-stream/);
    const body = await res.text();
    assert.match(body, /"event":"message"/);
    assert.match(body, /"event":"message_end"/);
    assert.match(body, /1\. Codex/);
  } finally {
    server.close();
    bindingStore.close();
  }
});
