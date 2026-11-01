import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { serveOnce, login, pickSession } from "../scripts/sites/leetcode-com/cookie.mjs";
import { freePort, isListening } from "./helpers.mjs";

const COOKIES = [
  { name: "csrftoken", value: "csrf-1", domain: "leetcode.com" },
  { name: "LEETCODE_SESSION", value: "sess-1", domain: ".leetcode.com" },
  { name: "_ga", value: "x", domain: ".leetcode.com" },
];
const SESSION = { LEETCODE_SESSION: "sess-1", csrftoken: "csrf-1" };

// 按扩展的真实协议模拟：轮询领任务，执行后回传结果
async function fakeExtension(port, reply) {
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ext/poll?waitMs=1000`);
      const { cmd } = await res.json();
      if (cmd) {
        await fetch(`http://127.0.0.1:${port}/ext/result`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: cmd.id, ...reply }),
        });
        return cmd;
      }
    } catch {
      // 临时桥接服务还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("fake extension never received a command");
}

test("没有桥接服务时临时扮演桥接服务，拿到 cookie 后关闭端口", async () => {
  const port = await freePort();
  const pending = login({ port, timeoutMs: 5000 });
  const cmd = await fakeExtension(port, { ok: true, result: { cookies: COOKIES, count: 3 } });
  assert.deepEqual(await pending, SESSION);
  assert.equal(cmd.type, "cookies.export");
  assert.deepEqual(cmd.params, { domain: "leetcode.com" });
  assert.equal(await isListening(port), false);
});

test("端口上已有桥接服务时借用它的 /cmd", async () => {
  const port = await freePort();
  let received;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") return res.end(JSON.stringify({ ok: true, bridge: true }));
    let body = "";
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    res.end(JSON.stringify({ ok: true, result: { cookies: COOKIES, count: 3 } }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    assert.deepEqual(await login({ port, timeoutMs: 1000 }), SESSION);
    assert.equal(received.type, "cookies.export");
    assert.deepEqual(received.params, { domain: "leetcode.com" });
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test("等不到扩展时超时报错，并关闭端口", async () => {
  const port = await freePort();
  await assert.rejects(serveOnce(port, 200), { code: "extension_timeout" });
  assert.equal(await isListening(port), false);
});

test("端口被非桥接程序占用时报 port_busy", async () => {
  const port = await freePort();
  const server = http.createServer((req, res) => {
    res.statusCode = 404;
    res.end("nope");
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    await assert.rejects(login({ port, timeoutMs: 500 }), { code: "port_busy" });
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test("扩展执行失败时报 extension_error", async () => {
  const port = await freePort();
  const rejected = assert.rejects(serveOnce(port, 5000), { code: "extension_error" });
  await fakeExtension(port, { ok: false, error: { message: "boom" } });
  await rejected;
});

test("没有 LEETCODE_SESSION 时提示先在 Chrome 登录", () => {
  assert.throws(() => pickSession([{ name: "csrftoken", value: "c" }]), { code: "not_logged_in" });
});
