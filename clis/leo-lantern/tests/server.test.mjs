import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { LanternServer } from "../lib/server.mjs";

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = JSON.stringify(data);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        agent: false,
        headers: {
          "Content-Type": "application/json",
          Connection: "close",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false, headers: { Connection: "close" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on("error", reject);
  });
}

function baseUrl(bridge) {
  return `http://127.0.0.1:${bridge.port}`;
}

async function withBridge(fn) {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  try {
    return await fn(bridge, baseUrl(bridge));
  } finally {
    await bridge.stop();
  }
}

test("LanternServer: start, health, hello, doctor, and stop", async () => {
  await withBridge(async (bridge, BASE) => {
    const health1 = await getJson(`${BASE}/health`);
    assert.equal(health1.status, 200);
    assert.equal(health1.body.ok, true);
    assert.equal(health1.body.bridge, true);
    assert.equal(health1.body.service, "leo-lantern");
    assert.equal(health1.body.port, bridge.port);
    assert.equal(health1.body.extensionOnline, false);

    const hello = await postJson(`${BASE}/ext/hello`, {
      id: "test-ext-id",
      name: "Leo cookie.txt Locally",
      version: "1.2.0",
      capabilities: ["cookies", "tabs", "dom", "cdp"],
    });
    assert.equal(hello.status, 200);
    assert.equal(hello.body.ok, true);

    const health2 = await getJson(`${BASE}/health`);
    assert.equal(health2.body.extensionOnline, true);

    const doctor = await getJson(`${BASE}/doctor`);
    assert.equal(doctor.status, 200);
    assert.equal(doctor.body.ok, true);
    assert.equal(doctor.body.bridge.port, bridge.port);
    assert.equal(doctor.body.extension.online, true);
    assert.equal(doctor.body.extension.info.id, "test-ext-id");
  });
});

test("LanternServer: extension failure preserves structured error through POST /cmd", async () => {
  await withBridge(async (_bridge, BASE) => {
    await postJson(`${BASE}/ext/hello`, { id: "ext-error" });
    const pollPromise = getJson(`${BASE}/ext/poll?waitMs=5000`);
    const cmdPromise = postJson(`${BASE}/cmd`, {
      type: "tabs.goto",
      params: { tabId: 9, url: "https://example.com" },
      timeoutMs: 5000,
    });
    const poll = await pollPromise;
    await postJson(`${BASE}/ext/result`, {
      id: poll.body.cmd.id,
      ok: false,
      error: {
        code: "tab_outside_task",
        message: "Tab 9 is outside the active task",
        candidates: [{ tabId: 10 }],
      },
    });

    const response = await cmdPromise;
    assert.equal(response.status, 422);
    assert.deepEqual(response.body, {
      ok: false,
      error: {
        code: "tab_outside_task",
        message: "Tab 9 is outside the active task",
        candidates: [{ tabId: 10 }],
      },
    });
  });
});

test("LanternServer: command dispatch, long-poll and result resolution", async () => {
  await withBridge(async (bridge, BASE) => {
    await postJson(`${BASE}/ext/hello`, { id: "ext-1" });

    const pollPromise = getJson(`${BASE}/ext/poll?waitMs=5000`);
    const dispatchPromise = bridge.dispatchCommand("dom.click", { text: "Submit" }, 5000);

    const pollRes = await pollPromise;
    assert.equal(pollRes.status, 200);
    assert.ok(pollRes.body.cmd);
    assert.equal(pollRes.body.cmd.type, "dom.click");
    assert.equal(pollRes.body.cmd.params.text, "Submit");

    const cmdId = pollRes.body.cmd.id;
    await postJson(`${BASE}/ext/result`, {
      id: cmdId,
      ok: true,
      result: { clicked: true },
    });

    const result = await dispatchPromise;
    assert.deepEqual(result, { clicked: true });
  });
});

test("LanternServer: POST /cmd waits for extension result", async () => {
  await withBridge(async (_bridge, BASE) => {
    await postJson(`${BASE}/ext/hello`, { id: "ext-cmd" });

    const pollPromise = getJson(`${BASE}/ext/poll?waitMs=5000`);
    const cmdPromise = postJson(`${BASE}/cmd`, {
      type: "dom.click",
      params: { text: "登录", selector: "#login-btn" },
      timeoutMs: 5000,
    });

    const pollRes = await pollPromise;
    assert.equal(pollRes.body.cmd.type, "dom.click");
    await postJson(`${BASE}/ext/result`, {
      id: pollRes.body.cmd.id,
      ok: true,
      result: { clicked: true, tag: "button", text: "登录" },
    });

    const cmdRes = await cmdPromise;
    assert.equal(cmdRes.status, 200);
    assert.equal(cmdRes.body.ok, true);
    assert.equal(cmdRes.body.result.clicked, true);
  });
});

test("LanternServer: command timeout TTL cleans pending commands", async () => {
  await withBridge(async (bridge, BASE) => {
    await postJson(`${BASE}/ext/hello`, { id: "ext-timeout" });
    await assert.rejects(
      () => bridge.dispatchCommand("dom.click", { text: "missing" }, 50),
      /timed out after 50ms/
    );
    const doctor = await getJson(`${BASE}/doctor`);
    assert.equal(doctor.body.bridge.pendingCommandsCount, 0);
  });
});

test("LanternServer: heartbeat updates lastSeen", async () => {
  await withBridge(async (_bridge, BASE) => {
    await postJson(`${BASE}/ext/hello`, { id: "ext-hb", name: "Leo cookie.txt Locally" });
    const before = await getJson(`${BASE}/health`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const hb = await postJson(`${BASE}/ext/heartbeat`, { id: "ext-hb" });
    assert.equal(hb.body.ok, true);
    const after = await getJson(`${BASE}/health`);
    assert.equal(after.body.extensionOnline, true);
    assert.ok(after.body.lastSeenMs >= 0);
    assert.ok(after.body.lastSeenMs <= before.body.lastSeenMs + 1000);
  });
});

test("LanternServer: heartbeat restores and clears the cached task summary", async () => {
  await withBridge(async (_bridge, BASE) => {
    await postJson(`${BASE}/ext/hello`, { id: "ext-hb-task" });
    await postJson(`${BASE}/ext/heartbeat`, {
      id: "ext-hb-task",
      task: {
        taskId: "task_from_heartbeat",
        title: "active after restart",
        sameWindow: false,
        windowId: 12,
        groupId: 13,
        claimedTabId: 14,
        updatedAt: 15,
      },
    });

    let doctor = await getJson(`${BASE}/doctor`);
    assert.equal(doctor.body.task.taskId, "task_from_heartbeat");
    assert.equal(doctor.body.task.claimedTabId, 14);

    await postJson(`${BASE}/ext/heartbeat`, { id: "ext-hb-task", task: null });
    doctor = await getJson(`${BASE}/doctor`);
    assert.equal(doctor.body.task, null);
  });
});

test("LanternServer: does not advertise CORS for browser pages", async () => {
  await withBridge(async (_bridge, BASE) => {
    const headers = await new Promise((resolve, reject) => {
      const req = http.get(`${BASE}/health`, { agent: false, headers: { Connection: "close" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.headers));
      });
      req.on("error", reject);
    });
    assert.equal(headers["access-control-allow-origin"], undefined);
    assert.equal(headers["access-control-allow-methods"], undefined);
    assert.equal(headers["access-control-allow-headers"], undefined);

    const options = await new Promise((resolve, reject) => {
      const req = http.request(
        `${BASE}/cmd`,
        {
          method: "OPTIONS",
          agent: false,
          headers: {
            Origin: "https://evil.example",
            "Access-Control-Request-Method": "POST",
            Connection: "close",
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }
      );
      req.on("error", reject);
      req.end();
    });
    assert.notEqual(options.status, 204);
    assert.equal(options.headers["access-control-allow-origin"], undefined);
  });
});

test("LanternServer: caches task summary from hello and result for doctor", async () => {
  await withBridge(async (bridge, BASE) => {
    await postJson(`${BASE}/ext/hello`, {
      id: "ext-task",
      task: {
        taskId: "task_hello",
        title: "from-hello",
        color: "blue",
        groupId: null,
        windowId: 11,
        claimedTabId: null,
        sameWindow: false,
        updatedAt: 1,
      },
    });
    let doctor = await getJson(`${BASE}/doctor`);
    assert.equal(doctor.body.task.taskId, "task_hello");
    assert.equal(doctor.body.task.title, "from-hello");

    const pollPromise = getJson(`${BASE}/ext/poll?waitMs=5000`);
    const dispatchPromise = bridge.dispatchCommand("task.start", { title: "from-result" }, 5000);
    const pollRes = await pollPromise;
    await postJson(`${BASE}/ext/result`, {
      id: pollRes.body.cmd.id,
      ok: true,
      result: {
        started: true,
        task: {
          taskId: "task_result",
          title: "from-result",
          color: "green",
          groupId: 3,
          windowId: 11,
          claimedTabId: 9,
          sameWindow: false,
          updatedAt: 2,
        },
      },
    });
    const result = await dispatchPromise;
    assert.equal(result.task.taskId, "task_result");

    doctor = await getJson(`${BASE}/doctor`);
    assert.equal(doctor.body.task.taskId, "task_result");
    assert.equal(doctor.body.task.claimedTabId, 9);
    assert.equal(bridge.taskSummary.title, "from-result");
  });
});

test("LanternServer: POST /v1/extension-tasks/claim acts as poll endpoint", async () => {
  await withBridge(async (bridge, BASE) => {
    await postJson(`${BASE}/ext/hello`, { id: "ext-claim-post" });

    const pollPromise = postJson(`${BASE}/v1/extension-tasks/claim`, {
      extension_id: "ext-claim-post",
      capabilities: ["cookies", "tabs"],
    });

    const dispatchPromise = bridge.dispatchCommand("dom.click", { text: "OK" }, 5000);
    const pollRes = await pollPromise;
    assert.equal(pollRes.status, 200);
    assert.ok(pollRes.body.cmd);
    assert.equal(pollRes.body.cmd.type, "dom.click");

    await postJson(`${BASE}/ext/result`, {
      id: pollRes.body.cmd.id,
      ok: true,
      result: { clicked: true },
    });
    const result = await dispatchPromise;
    assert.deepEqual(result, { clicked: true });
  });
});

test("LanternServer: aborted long-poll connection cleans up and subsequent command goes to active poll", async () => {
  await withBridge(async (bridge, BASE) => {
    await postJson(`${BASE}/ext/hello`, { id: "ext-abort-test" });

    // Start a poll request and immediately abort/destroy it
    const req = http.get(`${BASE}/ext/poll?waitMs=10000`, { agent: false });
    req.on("error", () => {});
    await new Promise((r) => setTimeout(r, 20));
    req.destroy();
    await new Promise((r) => setTimeout(r, 20));

    // Active new poll
    const activePollPromise = getJson(`${BASE}/ext/poll?waitMs=5000`);
    const dispatchPromise = bridge.dispatchCommand("dom.content", { maxChars: 100 }, 5000);

    const activePoll = await activePollPromise;
    assert.equal(activePoll.status, 200);
    assert.equal(activePoll.body.cmd.type, "dom.content");

    await postJson(`${BASE}/ext/result`, {
      id: activePoll.body.cmd.id,
      ok: true,
      result: { title: "Test", text: "Hello" },
    });

    const result = await dispatchPromise;
    assert.equal(result.title, "Test");
  });
});
