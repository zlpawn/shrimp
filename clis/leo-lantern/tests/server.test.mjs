import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { LanternServer } from "../lib/server.mjs";

const TEST_PORT = 8788;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

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

async function withBridge(fn) {
  const bridge = new LanternServer({ port: TEST_PORT });
  await bridge.start();
  try {
    return await fn(bridge);
  } finally {
    await bridge.stop();
  }
}

test("LanternServer: start, health, hello, doctor, and stop", async () => {
  await withBridge(async () => {
    const health1 = await getJson(`${BASE}/health`);
    assert.equal(health1.status, 200);
    assert.equal(health1.body.ok, true);
    assert.equal(health1.body.bridge, true);
    assert.equal(health1.body.port, TEST_PORT);
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
    assert.equal(doctor.body.bridge.port, TEST_PORT);
    assert.equal(doctor.body.extension.online, true);
    assert.equal(doctor.body.extension.info.id, "test-ext-id");
  });
});

test("LanternServer: command dispatch, long-poll and result resolution", async () => {
  await withBridge(async (bridge) => {
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
  await withBridge(async () => {
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
  await withBridge(async (bridge) => {
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
  await withBridge(async () => {
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
