import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { BridgeServer } from "../../lib/browser-bridge/server.mjs";

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
        headers: {
          "Content-Type": "application/json",
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
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on("error", reject);
  });
}

test("BridgeServer: start, health, hello, and stop", async () => {
  const bridge = new BridgeServer({ port: 19530 });
  await bridge.start();

  try {
    const health1 = await getJson("http://127.0.0.1:19530/health");
    assert.equal(health1.status, 200);
    assert.equal(health1.body.bridge, true);
    assert.equal(health1.body.extensionOnline, false);

    // Extension registers
    const hello = await postJson("http://127.0.0.1:19530/ext/hello", {
      id: "test-ext-id",
      name: "Test Extension",
    });
    assert.equal(hello.status, 200);
    assert.equal(hello.body.ok, true);

    const health2 = await getJson("http://127.0.0.1:19530/health");
    assert.equal(health2.body.extensionOnline, true);
  } finally {
    await bridge.stop();
  }
});

test("BridgeServer: command dispatch, long-poll and result resolution", async () => {
  const bridge = new BridgeServer({ port: 19531 });
  await bridge.start();

  try {
    // Register extension
    await postJson("http://127.0.0.1:19531/ext/hello", { id: "ext-1" });

    // Extension starts long-polling in background
    const pollPromise = getJson("http://127.0.0.1:19531/ext/poll?waitMs=5000");

    // Client dispatches command
    const dispatchPromise = bridge.dispatch("dom.click", { text: "Submit" }, 5000);

    // Poll receives the command
    const pollRes = await pollPromise;
    assert.equal(pollRes.status, 200);
    assert.ok(pollRes.body.cmd);
    assert.equal(pollRes.body.cmd.type, "dom.click");
    assert.equal(pollRes.body.cmd.params.text, "Submit");

    const cmdId = pollRes.body.cmd.id;

    // Extension completes command
    await postJson("http://127.0.0.1:19531/ext/result", {
      id: cmdId,
      ok: true,
      result: { clicked: true },
    });

    const result = await dispatchPromise;
    assert.deepEqual(result, { clicked: true });
  } finally {
    await bridge.stop();
  }
});
