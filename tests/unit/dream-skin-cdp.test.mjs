import assert from "node:assert/strict";
import test from "node:test";

import {
  parseInitialRoute,
  isLoopbackWebSocketUrl,
  isInjectableCodexPage,
  rankCodexTargets,
  buildCdpCommand,
  parseCdpMessage,
  createTargetClient,
  createCdpSession,
} from "../../lib/dream-skin/runtime/cdp-client.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

// --- Pure target rules ---

test("parseInitialRoute extracts app:// route", () => {
  assert.equal(parseInitialRoute("app://-/index.html?initialRoute=%2Fchat%2Fxyz"), "/chat/xyz");
  assert.equal(parseInitialRoute("app://-/index.html"), null);
  assert.equal(parseInitialRoute("https://chatgpt.com/"), null);
  assert.equal(parseInitialRoute("not-a-url"), null);
});

test("isLoopbackWebSocketUrl accepts loopback", () => {
  assert.ok(isLoopbackWebSocketUrl("ws://127.0.0.1:19222/devtools/page/1"));
  assert.ok(isLoopbackWebSocketUrl("ws://localhost:1/devtools/page/1"));
  assert.ok(isLoopbackWebSocketUrl("wss://[::1]:443/devtools"));
  assert.ok(!isLoopbackWebSocketUrl("ws://evil.com:1/x"));
  assert.ok(!isLoopbackWebSocketUrl("http://127.0.0.1:1/x"));
  assert.ok(!isLoopbackWebSocketUrl("ws://127.0.0.1:0/x"));
  assert.ok(!isLoopbackWebSocketUrl("ws://user:pass@127.0.0.1:1/x"));
  assert.ok(!isLoopbackWebSocketUrl(""));
});

test("isInjectableCodexPage filters targets", () => {
  const base = { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:19222/devtools/page/1" };
  assert.ok(isInjectableCodexPage({ ...base, title: "Codex", url: "app://-/index.html?initialRoute=%2F" }));
  assert.ok(isInjectableCodexPage({ ...base, title: "ChatGPT", url: "app://-/index.html?initialRoute=%2F" }));
  assert.ok(isInjectableCodexPage({ ...base, title: "Codex", url: "https://chatgpt.com/c/1" }));
  assert.ok(isInjectableCodexPage({ ...base, title: "ChatGPT", url: "https://chatgpt.com/" }));
  assert.ok(!isInjectableCodexPage({ ...base, title: "Codex", url: "https://example.com/" }));
  assert.ok(!isInjectableCodexPage({ ...base, title: "Unrelated Electron App", url: "app://-/index.html" }));
  assert.ok(!isInjectableCodexPage({ ...base, type: "service_worker", url: "app://-/" }));
  assert.ok(!isInjectableCodexPage({ ...base, url: "app://-/index.html?initialRoute=%2Favatar-overlay" }));
  assert.ok(!isInjectableCodexPage({ ...base, url: "app://-/index.html?initialRoute=%2Fchatgpt%2Fquick-chat" }));
  assert.ok(!isInjectableCodexPage({ ...base, webSocketDebuggerUrl: "ws://evil.com:1/x" }));
  assert.ok(!isInjectableCodexPage({ ...base, webSocketDebuggerUrl: "" }));
});

test("rankCodexTargets puts main surface first", () => {
  const main = { type: "page", title: "Codex", url: "app://-/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:1/x" };
  const overlay = { type: "page", title: "Codex", url: "app://-/index.html?initialRoute=%2Favatar-overlay", webSocketDebuggerUrl: "ws://127.0.0.1:1/y" };
  const quick = { type: "page", title: "Codex", url: "app://-/index.html?initialRoute=%2Fchatgpt%2Fquick-chat", webSocketDebuggerUrl: "ws://127.0.0.1:1/z" };
  const ranked = rankCodexTargets([quick, overlay, main]);
  assert.equal(ranked[0], main);
});

// --- Protocol helpers ---

test("buildCdpCommand and parseCdpMessage round-trip", () => {
  const raw = buildCdpCommand(7, "Runtime.evaluate", { expression: "1" });
  assert.equal(raw, JSON.stringify({ id: 7, method: "Runtime.evaluate", params: { expression: "1" } }));
  const msg = parseCdpMessage(Buffer.from(raw));
  assert.equal(msg.id, 7);
  assert.equal(msg.method, "Runtime.evaluate");
  assert.equal(parseCdpMessage(Buffer.from("not json")), null);
});

// --- Fake HTTP target client ---

test("target client lists targets via injected requestJson", async () => {
  const calls = [];
  const client = createTargetClient({
    requestJson: async (url, opts) => {
      calls.push({ url, opts });
      return [{ id: 1 }];
    },
    sleep: async () => {},
  });
  const targets = await client.listTargets(19222);
  assert.equal(calls[0].url, "http://127.0.0.1:19222/json");
  assert.equal(targets.length, 1);
});

test("target client validates ports", async () => {
  const client = createTargetClient({ requestJson: async () => [], sleep: async () => {} });
  await assert.rejects(client.listTargets(0), DreamSkinError);
  await assert.rejects(client.listTargets(70000), DreamSkinError);
});

test("waitForDebugEndpoint polls until injectable Codex target appears", async () => {
  let n = 0;
  let now = 0;
  const client = createTargetClient({
    requestJson: async () => {
      n++;
      if (n < 2) throw new Error("not ready");
      return [{ id: 1, type: "page", title: "Codex", url: "app://-/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:1/x" }];
    },
    sleep: async () => { now += 100; },
    clock: () => now,
  });
  const targets = await client.waitForDebugEndpoint(19222, { maxWaitMs: 500 });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].title, "Codex");
});

test("waitForDebugEndpoint ignores non-Codex targets", async () => {
  let calls = 0;
  let now = 0;
  const client = createTargetClient({
    requestJson: async () => {
      calls++;
      return [{ id: 1, type: "page", title: "Other App", url: "https://example.com", webSocketDebuggerUrl: "ws://127.0.0.1:1/x" }];
    },
    sleep: async () => { now += 100; },
    clock: () => now,
  });
  await assert.rejects(
    client.waitForDebugEndpoint(19222, { maxWaitMs: 300 }),
    /did not become available/,
  );
  assert.ok(calls > 0);
});

test("waitForDebugEndpoint throws on timeout", async () => {
  let now = 0;
  const client = createTargetClient({
    requestJson: async () => { throw new Error("down"); },
    sleep: async () => { now += 100; },
    clock: () => now,
  });
  await assert.rejects(
    client.waitForDebugEndpoint(19222, { maxWaitMs: 300 }),
    /did not become available/,
  );
});

// --- Fake WebSocket session ---

function makeFakeWs() {
  const handlers = {};
  const fake = {
    readyState: 0,
    sent: [],
    on(event, handler) { handlers[event] = handler; },
    send(data, cb) {
      fake.sent.push(JSON.parse(data));
      if (cb) cb(null);
    },
    close() { fake.readyState = 3; },
    _emit(event, data) { handlers[event]?.(data); },
    _setOpen() { fake.readyState = 1; handlers.open?.(); },
  };
  return fake;
}

test("cdp session correlates responses by id", async () => {
  const ws = makeFakeWs();
  const session = createCdpSession({
    createWebSocket: () => ws,
    wsUrl: "ws://127.0.0.1:19222/devtools/page/1",
    commandTimeoutMs: 1000,
  });
  const connecting = session.connect();
  ws._setOpen();
  await connecting;

  const p = session.send("Runtime.evaluate", { expression: "1" });
  assert.equal(ws.sent.length, 1);
  const id = ws.sent[0].id;
  ws._emit("message", Buffer.from(JSON.stringify({ id, result: { result: { value: 1 } } })));
  const result = await p;
  assert.equal(result.result.value, 1);
});

test("cdp session enables Runtime before evaluate", async () => {
  const ws = makeFakeWs();
  const session = createCdpSession({
    createWebSocket: () => ws,
    wsUrl: "ws://127.0.0.1:19222/devtools/page/1",
    commandTimeoutMs: 500,
  });
  const connecting = session.connect();
  ws._setOpen();
  await connecting;

  const p = session.evaluate("1 + 1");
  // First message should be Runtime.enable
  assert.equal(ws.sent[0].method, "Runtime.enable");
  const enableId = ws.sent[0].id;
  ws._emit("message", Buffer.from(JSON.stringify({ id: enableId, result: {} })));
  // Await a microtask/macrotask so the chained send happens after enable resolves
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ws.sent[1].method, "Runtime.evaluate");
  const evalId = ws.sent[1].id;
  ws._emit("message", Buffer.from(JSON.stringify({ id: evalId, result: { result: { value: 2 } } })));
  const result = await p;
  assert.equal(result.result.value, 2);
});

test("cdp session can remove a previously registered new-document script", async () => {
  const ws = makeFakeWs();
  const session = createCdpSession({ wsUrl: "ws://127.0.0.1:1/x", createWebSocket: () => ws });
  const connected = session.connect();
  ws.readyState = 1;
  ws._emit("open");
  await connected;

  const removal = session.removeScriptFromNewDocuments("script-1");
  assert.equal(ws.sent[0].method, "Page.removeScriptToEvaluateOnNewDocument");
  assert.deepEqual(ws.sent[0].params, { identifier: "script-1" });
  ws._emit("message", Buffer.from(JSON.stringify({ id: ws.sent[0].id, result: {} })));
  await removal;
  session.close();
});

test("cdp session rejects on CDP error", async () => {
  const ws = makeFakeWs();
  const session = createCdpSession({ createWebSocket: () => ws, wsUrl: "ws://127.0.0.1:1/x" });
  const connecting = session.connect();
  ws._setOpen();
  await connecting;
  const p = session.send("X", {});
  const id = ws.sent[0].id;
  ws._emit("message", Buffer.from(JSON.stringify({ id, error: { code: -32000, message: "boom" } })));
  await assert.rejects(p, /boom/);
});

test("cdp session close rejects pending", async () => {
  const ws = makeFakeWs();
  const session = createCdpSession({ createWebSocket: () => ws, wsUrl: "ws://127.0.0.1:1/x" });
  const connecting = session.connect();
  ws._setOpen();
  await connecting;
  const p = session.send("X", {});
  ws._emit("close");
  await assert.rejects(p, /closed/);
});

test("cdp session timeout deletes pending", async () => {
  const ws = makeFakeWs();
  const session = createCdpSession({
    createWebSocket: () => ws,
    wsUrl: "ws://127.0.0.1:1/x",
    commandTimeoutMs: 20,
  });
  const connecting = session.connect();
  ws._setOpen();
  await connecting;
  await assert.rejects(session.send("X", {}), /timed out/);
});

test("cdp session ignores malformed messages", async () => {
  const ws = makeFakeWs();
  const session = createCdpSession({ createWebSocket: () => ws, wsUrl: "ws://127.0.0.1:1/x" });
  const connecting = session.connect();
  ws._setOpen();
  await connecting;
  ws._emit("message", Buffer.from("{not json"));
  assert.ok(true);
});
