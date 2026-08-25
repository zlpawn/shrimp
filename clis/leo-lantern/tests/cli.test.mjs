import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseCliArgs, executeCommand, formatCliError, normalizeCliParams } from "../lib/cli.mjs";
import { LanternServer } from "../lib/server.mjs";

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

  // Boolean flags with positionals
  const parsed4 = parseCliArgs(["new-tab", "--force", "https://example.com"]);
  assert.equal(parsed4.command, "new-tab");
  assert.equal(parsed4.params.force, true);
  assert.deepEqual(parsed4.positional, ["https://example.com"]);

  const parsed5 = parseCliArgs(["claim", "--focus", "123"]);
  assert.equal(parsed5.command, "claim");
  assert.equal(parsed5.params.focus, true);
  assert.deepEqual(parsed5.positional, ["123"]);

  const parsed6 = parseCliArgs(["start-task", "--same-window", "My Task"]);
  assert.equal(parsed6.command, "start-task");
  assert.equal(parsed6.params["same-window"], true);
  assert.deepEqual(parsed6.positional, ["My Task"]);

  // Key=Value syntax
  const parsed7 = parseCliArgs(["goto", "--url=https://github.com", "--focus"]);
  assert.equal(parsed7.command, "goto");
  assert.equal(parsed7.params.url, "https://github.com");
  assert.equal(parsed7.params.focus, true);
});

test("CLI: canonicalizes documented kebab, camel, and lowercase aliases", () => {
  const cases = [
    [["screenshot", "--full-page"], { fullPage: true }],
    [["screenshot", "--fullPage"], { fullPage: true }],
    [["reload", "--bypass-cache"], { bypassCache: true }],
    [["reload", "--bypassCache"], { bypassCache: true }],
    [["reload", "--bypasscache"], { bypassCache: true }],
    [["start-task", "--same-window"], { sameWindow: true }],
    [["start-task", "--sameWindow"], { sameWindow: true }],
    [["start-task", "--samewindow"], { sameWindow: true }],
    [["end-task", "--close-group"], { closeGroup: true }],
    [["end-task", "--closeGroup"], { closeGroup: true }],
    [["end-task", "--closegroup"], { closeGroup: true }],
    [["wait", "--timeout-ms", "123"], { timeoutMs: "123" }],
    [["wait", "--timeoutMs", "123"], { timeoutMs: "123" }],
  ];

  for (const [argv, expected] of cases) {
    const parsed = parseCliArgs(argv);
    assert.deepEqual(normalizeCliParams(parsed.params), expected, argv.join(" "));
  }
});

test("CLI: screenshot full-page alias reaches the protocol as true", async () => {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  try {
    await postJson(`http://127.0.0.1:${bridge.port}/ext/hello`, { id: "cli-shot-ext" });
    const pollPromise = getJson(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`);
    const parsed = parseCliArgs(["screenshot", "--full-page"]);
    const callPromise = executeCommand(parsed.command, parsed.params, parsed.positional, { port: bridge.port });
    const poll = await pollPromise;
    assert.deepEqual(poll.body.cmd.params, { fullPage: true });
    await postJson(`http://127.0.0.1:${bridge.port}/ext/result`, {
      id: poll.body.cmd.id,
      ok: true,
      result: { data: "", fullPage: true },
    });
    await callPromise;
  } finally {
    await bridge.stop();
  }
});

test("CLI: omitted optional booleans stay omitted while explicit false is preserved", async () => {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  try {
    await postJson(`http://127.0.0.1:${bridge.port}/ext/hello`, { id: "cli-omitted-ext" });
    for (const [params, expected] of [
      [{ title: "omit" }, { title: "omit" }],
      [{ title: "false", sameWindow: "false", focus: "false" }, { title: "false", sameWindow: false, focus: false }],
    ]) {
      const pollPromise = getJson(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`);
      const callPromise = executeCommand("start-task", params, [], { port: bridge.port });
      const poll = await pollPromise;
      assert.deepEqual(poll.body.cmd.params, expected);
      await postJson(`http://127.0.0.1:${bridge.port}/ext/result`, {
        id: poll.body.cmd.id,
        ok: true,
        result: { started: true },
      });
      await callPromise;
    }
  } finally {
    await bridge.stop();
  }
});

test("CLI: new-tab and goto do not synthesize omitted force or focus flags", async () => {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  try {
    await postJson(`http://127.0.0.1:${bridge.port}/ext/hello`, { id: "cli-nav-omitted" });
    for (const [command, positional, expected] of [
      ["new-tab", ["https://example.com"], { url: "https://example.com" }],
      ["goto", ["https://example.com/next"], { url: "https://example.com/next" }],
    ]) {
      const pollPromise = getJson(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`);
      const callPromise = executeCommand(command, {}, positional, { port: bridge.port });
      const poll = await pollPromise;
      assert.deepEqual(poll.body.cmd.params, expected);
      await postJson(`http://127.0.0.1:${bridge.port}/ext/result`, {
        id: poll.body.cmd.id,
        ok: true,
        result: { ok: true },
      });
      await callPromise;
    }
  } finally {
    await bridge.stop();
  }
});

test("CLI: wait sends requested timeout plus transport allowance to the Bridge", async () => {
  let receivedBody;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      receivedBody = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result: { waited: true } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await executeCommand("wait", { text: "Ready", timeoutMs: "30000" }, [], {
      port: server.address().port,
    });
    assert.equal(receivedBody.params.timeoutMs, 30000);
    assert.equal(receivedBody.timeoutMs, 32000);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("CLI: server command uses parsed host and port parameters", async () => {
  const result = await executeCommand(
    "server",
    { host: "127.0.0.1", port: "0" },
    [],
    { host: "0.0.0.0", port: 1 }
  );
  try {
    assert.equal(result.server.host, "127.0.0.1");
    assert.notEqual(result.server.port, 1);
  } finally {
    await result.server.stop();
  }
});

test("CLI: structured Lantern errors retain code, message, and candidates", () => {
  const error = new Error("outside");
  error.lanternError = {
    code: "tab_outside_task",
    message: "outside",
    candidates: [{ tabId: 2 }],
  };
  assert.deepEqual(formatCliError(error), {
    ok: false,
    error: {
      code: "tab_outside_task",
      message: "outside",
      candidates: [{ tabId: 2 }],
    },
  });
});

test("CLI: executeCommand help, health, and doctor", async () => {
  const helpResult = await executeCommand("help");
  assert.ok(helpResult.help.includes("Usage: leo-lantern"));
  assert.ok(helpResult.help.includes("screenshot"));
  assert.ok(helpResult.help.includes("cookies"));

  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  try {
    const healthResult = await executeCommand("health", {}, [], { port: bridge.port });
    assert.equal(healthResult.ok, true);
    assert.equal(healthResult.bridge, true);
    assert.equal(healthResult.port, bridge.port);

    const doctorResult = await executeCommand("doctor", {}, [], { port: bridge.port });
    assert.equal(doctorResult.ok, true);
    assert.equal(doctorResult.bridge.port, bridge.port);
  } finally {
    await bridge.stop();
  }
});

test("CLI: click command posts to /cmd", async () => {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  try {
    await postJson(`http://127.0.0.1:${bridge.port}/ext/hello`, { id: "cli-ext" });
    const pollPromise = getJson(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`);
    const clickPromise = executeCommand("click", { text: "登录" }, [], { port: bridge.port });
    const poll = await pollPromise;
    assert.equal(poll.body.cmd.type, "dom.click");
    await postJson(`http://127.0.0.1:${bridge.port}/ext/result`, {
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

test("CLI: maps start-task/claim/end-task and force new-tab flags", async () => {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  try {
    await postJson(`http://127.0.0.1:${bridge.port}/ext/hello`, { id: "cli-task-ext" });

    const pollStart = getJson(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`);
    const startPromise = executeCommand(
      "start-task",
      { title: "deploy", "same-window": "false", focus: "0" },
      [],
      { port: bridge.port }
    );
    const startPoll = await pollStart;
    assert.equal(startPoll.body.cmd.type, "task.start");
    assert.equal(startPoll.body.cmd.params.title, "deploy");
    assert.equal(startPoll.body.cmd.params.sameWindow, false);
    await postJson(`http://127.0.0.1:${bridge.port}/ext/result`, {
      id: startPoll.body.cmd.id,
      ok: true,
      result: { started: true, task: { taskId: "task_1", title: "deploy" } },
    });
    const started = await startPromise;
    assert.equal(started.ok, true);

    const pollClaim = getJson(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`);
    const claimPromise = executeCommand("claim", { tabId: "99", focus: "1" }, [], { port: bridge.port });
    const claimPoll = await pollClaim;
    assert.equal(claimPoll.body.cmd.type, "tabs.claim");
    assert.equal(claimPoll.body.cmd.params.tabId, "99");
    assert.equal(claimPoll.body.cmd.params.focus, true);
    await postJson(`http://127.0.0.1:${bridge.port}/ext/result`, {
      id: claimPoll.body.cmd.id,
      ok: true,
      result: { claimed: true, task: { taskId: "task_1", claimedTabId: 99 } },
    });
    await claimPromise;

    const pollNew = getJson(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`);
    const newPromise = executeCommand(
      "new-tab",
      { force: "true", focus: "0" },
      ["https://example.com"],
      { port: bridge.port }
    );
    const newPoll = await pollNew;
    assert.equal(newPoll.body.cmd.type, "tabs.new");
    assert.equal(newPoll.body.cmd.params.url, "https://example.com");
    assert.equal(newPoll.body.cmd.params.force, true);
    await postJson(`http://127.0.0.1:${bridge.port}/ext/result`, {
      id: newPoll.body.cmd.id,
      ok: true,
      result: { id: 100, forced: true },
    });
    await newPromise;

    const pollEnd = getJson(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`);
    const endPromise = executeCommand("end-task", { "close-group": "1" }, [], { port: bridge.port });
    const endPoll = await pollEnd;
    assert.equal(endPoll.body.cmd.type, "task.end");
    assert.equal(endPoll.body.cmd.params.closeGroup, true);
    await postJson(`http://127.0.0.1:${bridge.port}/ext/result`, {
      id: endPoll.body.cmd.id,
      ok: true,
      result: { ended: true, task: null },
    });
    await endPromise;
  } finally {
    await bridge.stop();
  }
});

test("CLI: maps page-drive and network commands", async () => {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  const cases = [
    ["state", { tabId: "9" }, [], "dom.state", { tabId: "9" }],
    [
      "find",
      { target: { kind: "css", selector: "button.primary" }, tabId: "9" },
      [],
      "dom.find",
      { target: { kind: "css", selector: "button.primary" }, tabId: "9" },
    ],
    ["wait", { text: "Ready", "timeout-ms": "123", tabId: "9" }, [], "dom.wait", { text: "Ready", timeoutMs: 123, tabId: "9" }],
    ["content", { "max-chars": "55", tabId: "9" }, [], "dom.content", { maxChars: "55", tabId: "9" }],
    ["press", { selector: "#q" }, ["Enter"], "dom.press", { key: "Enter", selector: "#q" }],
    ["reload", { "bypass-cache": "1", tabId: "9" }, [], "tabs.reload", { bypassCache: true, tabId: "9" }],
    ["net-start", { tabId: "9" }, [], "cdp.net-start", { tabId: "9" }],
    ["net-get", { grep: "/api/", tabId: "9" }, [], "cdp.net-get", { grep: "/api/", tabId: "9" }],
    ["net-stop", { grep: "deploy", tabId: "9" }, [], "cdp.net-stop", { grep: "deploy", tabId: "9" }],
  ];
  try {
    await postJson(`http://127.0.0.1:${bridge.port}/ext/hello`, { id: "page-drive-ext" });
    for (const [command, params, positional, expectedType, expectedParams] of cases) {
      const pollPromise = getJson(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`);
      const callPromise = executeCommand(command, params, positional, { port: bridge.port });
      const poll = await pollPromise;
      assert.equal(poll.body.cmd.type, expectedType);
      assert.deepEqual(poll.body.cmd.params, expectedParams);
      await postJson(`http://127.0.0.1:${bridge.port}/ext/result`, {
        id: poll.body.cmd.id,
        ok: true,
        result: { ok: true },
      });
      await callPromise;
    }
  } finally {
    await bridge.stop();
  }
});
