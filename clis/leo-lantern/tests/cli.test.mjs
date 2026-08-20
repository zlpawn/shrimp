import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseCliArgs, executeCommand } from "../lib/cli.mjs";
import { LanternServer } from "../lib/server.mjs";

const TEST_PORT = 8788;

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = JSON.stringify(data);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
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

test("CLI: parseCliArgs parses commands, flags, and positionals", () => {
  const parsed1 = parseCliArgs(["click", "--text", "Sign In", "--tabId", "42"]);
  assert.equal(parsed1.command, "click");
  assert.equal(parsed1.params.text, "Sign In");
  assert.equal(parsed1.params.tabId, "42");

  const parsed2 = parseCliArgs(["goto", "https://google.com"]);
  assert.equal(parsed2.command, "goto");
  assert.deepEqual(parsed2.positional, ["https://google.com"]);

  const parsed3 = parseCliArgs(["help"]);
  assert.equal(parsed3.command, "help");
});

test("CLI: executeCommand help, health, and doctor on 8788", async () => {
  const helpResult = await executeCommand("help");
  assert.ok(helpResult.help.includes("Usage: leo-lantern"));
  assert.ok(helpResult.help.includes("screenshot"));
  assert.ok(helpResult.help.includes("cookies"));

  const bridge = new LanternServer({ port: TEST_PORT });
  await bridge.start();
  try {
    const healthResult = await executeCommand("health", {}, [], { port: TEST_PORT });
    assert.equal(healthResult.ok, true);
    assert.equal(healthResult.bridge, true);
    assert.equal(healthResult.port, TEST_PORT);

    const doctorResult = await executeCommand("doctor", {}, [], { port: TEST_PORT });
    assert.equal(doctorResult.ok, true);
    assert.equal(doctorResult.bridge.port, TEST_PORT);
  } finally {
    await bridge.stop();
  }
});

test("CLI: click command posts to /cmd on 8788", async () => {
  const bridge = new LanternServer({ port: TEST_PORT });
  await bridge.start();
  try {
    await postJson(`http://127.0.0.1:${TEST_PORT}/ext/hello`, { id: "cli-ext" });
    const pollPromise = getJson(`http://127.0.0.1:${TEST_PORT}/ext/poll?waitMs=5000`);
    const clickPromise = executeCommand("click", { text: "登录" }, [], { port: TEST_PORT });
    const poll = await pollPromise;
    assert.equal(poll.body.cmd.type, "dom.click");
    await postJson(`http://127.0.0.1:${TEST_PORT}/ext/result`, {
      id: poll.body.cmd.id,
      ok: true,
      result: { clicked: true, tag: "button", text: "登录" },
    });
    const click = await clickPromise;
    assert.equal(click.ok, true);
    assert.equal(click.result.clicked, true);
  } finally {
    await bridge.stop();
  }
});
