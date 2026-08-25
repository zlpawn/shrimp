import test from "node:test";
import assert from "node:assert/strict";
import { LanternMcpServer, MCP_TOOLS } from "../lib/mcp-server.mjs";
import { LanternServer } from "../lib/server.mjs";
import http from "node:http";
import { LanternServer as CliLanternServer } from "../../../clis/leo-lantern/lib/server.mjs";
import {
  COMMAND_TYPES as CliCommandTypes,
  DEFAULT_BRIDGE_PORT as CliDefaultPort,
} from "../../../clis/leo-lantern/lib/protocol.mjs";
import { COMMAND_TYPES, DEFAULT_BRIDGE_PORT } from "../lib/protocol.mjs";

const REQUIRED_TOOLS = [
  "browser_health",
  "browser_doctor",
  "browser_start_task",
  "browser_claim_tab",
  "browser_end_task",
  "browser_open_tabs",
  "browser_new_tab",
  "browser_wait",
  "browser_content",
  "browser_press",
  "browser_reload",
  "browser_net_start",
  "browser_net_get",
  "browser_net_stop",
  "browser_goto",
  "browser_state",
  "browser_find",
  "browser_click",
  "browser_fill",
  "browser_snapshot",
  "browser_eval",
  "browser_screenshot",
  "browser_cookies",
];

async function withMcp(fn) {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  const mcp = new LanternMcpServer({ bridge, port: bridge.port });
  try {
    return await fn(mcp, bridge);
  } finally {
    await mcp.stop();
    await bridge.stop();
  }
}

test("MCP: tools/list returns standard browser tools including task isolation", async () => {
  await withMcp(async (mcp) => {
    const listRes = await mcp.handleJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    assert.equal(listRes.id, 1);
    assert.ok(Array.isArray(listRes.result.tools));
    const toolNames = listRes.result.tools.map((t) => t.name);
    assert.equal(toolNames.length, REQUIRED_TOOLS.length);
    for (const name of REQUIRED_TOOLS) {
      assert.ok(toolNames.includes(name), `missing tool ${name}`);
    }
    assert.equal(MCP_TOOLS.length, REQUIRED_TOOLS.length);
  });
});

test("MCP: initialize and ping methods", async () => {
  await withMcp(async (mcp) => {
    const initRes = await mcp.handleJsonRpc({
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: {},
    });
    assert.equal(initRes.id, "init-1");
    assert.equal(initRes.result.serverInfo.name, "leo-lantern");
    assert.equal(initRes.result.protocolVersion, "2024-11-05");

    const pingRes = await mcp.handleJsonRpc({
      jsonrpc: "2.0",
      id: "ping-1",
      method: "ping",
    });
    assert.deepEqual(pingRes.result, {});
  });
});

test("MCP: tools/call browser_health and browser_doctor", async () => {
  await withMcp(async (mcp) => {
    const healthRes = await mcp.handleJsonRpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "browser_health",
        arguments: {},
      },
    });
    assert.equal(healthRes.id, 2);
    const parsedHealth = JSON.parse(healthRes.result.content[0].text);
    assert.equal(parsedHealth.bridgeOnline, true);
    assert.equal(parsedHealth.port, mcp.port);

    const doctorRes = await mcp.handleJsonRpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "browser_doctor",
        arguments: {},
      },
    });
    const parsedDoctor = JSON.parse(doctorRes.result.content[0].text);
    assert.equal(parsedDoctor.bridge.port, mcp.port);
  });
});


test("MCP: browser_health is false when occupied by a non-bridge server", async () => {
  const blocker = http.createServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not a bridge" }));
  });
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const occupiedPort = blocker.address().port;
  const mcp = new LanternMcpServer({ port: occupiedPort, stdio: false });
  try {
    await mcp.start();
    const healthRes = await mcp.handleJsonRpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "browser_health",
        arguments: {},
      },
    });
    const parsedHealth = JSON.parse(healthRes.result.content[0].text);
    assert.equal(parsedHealth.bridgeOnline, false);
    assert.equal(parsedHealth.port, mcp.port);
  } finally {
    await mcp.stop();
    await new Promise((resolve, reject) => {
      blocker.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("MCP: generic ok health response is not accepted as Lantern identity", async () => {
  const blocker = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const mcp = new LanternMcpServer({ port: blocker.address().port, stdio: false });
  try {
    await mcp.start();
    const health = await mcp.callTool("browser_health", {});
    assert.equal(health.bridgeOnline, false);
    await assert.rejects(
      () => mcp.callTool("browser_open_tabs", {}),
      (err) => err.lanternError?.code === "bridge_unavailable"
    );
  } finally {
    await mcp.stop();
    await new Promise((resolve, reject) => blocker.close((err) => (err ? reject(err) : resolve())));
  }
});

test("MCP: omitted optional booleans stay omitted and explicit false is preserved", async () => {
  const calls = [];
  const bridge = {
    server: {},
    pendingCommands: new Map(),
    extension: null,
    taskSummary: null,
    isExtensionOnline: () => true,
    dispatch: async (type, params, timeoutMs) => {
      calls.push({ type, params, timeoutMs });
      return { ok: true };
    },
  };
  const mcp = new LanternMcpServer({ bridge, stdio: false });
  await mcp.callTool("browser_start_task", { title: "omit" });
  await mcp.callTool("browser_start_task", { title: "false", sameWindow: false, focus: false });
  await mcp.callTool("browser_reload", {});
  await mcp.callTool("browser_claim_tab", { tabId: 9 });
  await mcp.callTool("browser_end_task", {});
  await mcp.callTool("browser_new_tab", { url: "https://example.com" });
  await mcp.callTool("browser_goto", { url: "https://example.com/next" });

  assert.deepEqual(calls[0].params, { title: "omit" });
  assert.deepEqual(calls[1].params, { title: "false", sameWindow: false, focus: false });
  assert.deepEqual(calls[2].params, {});
  assert.deepEqual(calls[3].params, { tabId: 9 });
  assert.deepEqual(calls[4].params, {});
  assert.deepEqual(calls[5].params, { url: "https://example.com" });
  assert.deepEqual(calls[6].params, { url: "https://example.com/next" });
});

test("MCP: browser_wait gives the Bridge a two-second transport allowance", async () => {
  const calls = [];
  const bridge = {
    server: {},
    pendingCommands: new Map(),
    extension: null,
    taskSummary: null,
    isExtensionOnline: () => true,
    dispatch: async (type, params, timeoutMs) => {
      calls.push({ type, params, timeoutMs });
      return { waited: true };
    },
  };
  const mcp = new LanternMcpServer({ bridge, stdio: false });
  await mcp.callTool("browser_wait", { text: "Ready", timeoutMs: 30_000 });
  assert.deepEqual(calls[0], {
    type: "dom.wait",
    params: { text: "Ready", timeoutMs: 30_000 },
    timeoutMs: 32_000,
  });
});

test("MCP: structured Lantern failure uses isError text and structuredContent", async () => {
  const payload = {
    code: "tab_outside_task",
    message: "outside",
    candidates: [{ tabId: 2 }],
  };
  const bridge = {
    server: {},
    pendingCommands: new Map(),
    extension: null,
    taskSummary: null,
    isExtensionOnline: () => true,
    dispatch: async () => {
      const error = new Error(payload.message);
      error.lanternError = payload;
      throw error;
    },
  };
  const mcp = new LanternMcpServer({ bridge, stdio: false });
  const response = await mcp.handleJsonRpc({
    jsonrpc: "2.0",
    id: 99,
    method: "tools/call",
    params: { name: "browser_open_tabs", arguments: {} },
  });

  assert.equal(response.result.isError, true);
  assert.deepEqual(response.result.structuredContent, { ok: false, error: payload });
  assert.deepEqual(JSON.parse(response.result.content[0].text), { ok: false, error: payload });
});

test("MCP: delegates to remote bridge when bridge port is already running a live bridge", async () => {
  const liveBridge = new LanternServer({ port: 0 });
  await liveBridge.start();
  const mcp = new LanternMcpServer({ port: liveBridge.port, stdio: false });
  try {
    await mcp.start();
    const healthRes = await mcp.handleJsonRpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "browser_health",
        arguments: {},
      },
    });
    const parsedHealth = JSON.parse(healthRes.result.content[0].text);
    assert.equal(parsedHealth.bridgeOnline, true);
    assert.equal(parsedHealth.port, liveBridge.port);
  } finally {
    await mcp.stop();
    await liveBridge.stop();
  }
});


test("MCP and CLI share one LanternServer implementation", () => {
  assert.equal(LanternServer, CliLanternServer);
  assert.equal(DEFAULT_BRIDGE_PORT, CliDefaultPort);
  assert.equal(COMMAND_TYPES.DOM_CLICK, CliCommandTypes.DOM_CLICK);
});

test("MCP: browser_start_task / claim / end_task map to bridge commands", async () => {
  await withMcp(async (mcp, bridge) => {
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: bridge.port,
          path: "/ext/hello",
          method: "POST",
          agent: false,
          headers: { "Content-Type": "application/json", Connection: "close" },
        },
        (res) => {
          res.resume();
          res.on("end", resolve);
        }
      );
      req.on("error", reject);
      req.write(JSON.stringify({ id: "mcp-task-ext" }));
      req.end();
    });

    const pollStart = new Promise((resolve, reject) => {
      http.get(
        `http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`,
        { agent: false, headers: { Connection: "close" } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve(JSON.parse(body)));
        }
      ).on("error", reject);
    });
    const startCall = mcp.handleJsonRpc({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "browser_start_task", arguments: { title: "mcp-task" } },
    });
    const startCmd = await pollStart;
    assert.equal(startCmd.cmd.type, "task.start");
    assert.equal(startCmd.cmd.params.title, "mcp-task");

    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: bridge.port,
          path: "/ext/result",
          method: "POST",
          agent: false,
          headers: { "Content-Type": "application/json", Connection: "close" },
        },
        (res) => {
          res.resume();
          res.on("end", resolve);
        }
      );
      req.on("error", reject);
      req.write(
        JSON.stringify({
          id: startCmd.cmd.id,
          ok: true,
          result: { started: true, task: { taskId: "task_mcp", title: "mcp-task" } },
        })
      );
      req.end();
    });
    const startRes = await startCall;
    assert.equal(startRes.id, 10);

    const doctorRes = await mcp.handleJsonRpc({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "browser_doctor", arguments: {} },
    });
    const doctor = JSON.parse(doctorRes.result.content[0].text);
    assert.equal(doctor.task.taskId, "task_mcp");
  });
});

test("MCP: browser_wait and network tools map to bridge commands", async () => {
  await withMcp(async (mcp, bridge) => {
    const mapping = [
      ["browser_state", { tabId: 9 }, "dom.state", { tabId: 9 }],
      [
        "browser_find",
        { target: { kind: "semantic", role: "button", name: "Sign in" }, tabId: 9 },
        "dom.find",
        { target: { kind: "semantic", role: "button", name: "Sign in" }, tabId: 9 },
      ],
      ["browser_wait", { text: "Ready", timeoutMs: 12 }, "dom.wait", { text: "Ready", timeoutMs: 12 }],
      ["browser_content", { maxChars: 8 }, "dom.content", { maxChars: 8 }],
      ["browser_press", { key: "Enter" }, "dom.press", { key: "Enter" }],
      ["browser_reload", { bypassCache: true }, "tabs.reload", { bypassCache: true }],
      ["browser_net_start", {}, "cdp.net-start", {}],
      ["browser_net_get", { grep: "api" }, "cdp.net-get", { grep: "api" }],
      ["browser_net_stop", { grep: "deploy" }, "cdp.net-stop", { grep: "deploy" }],
    ];
    await new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port: bridge.port, path: "/ext/hello", method: "POST", agent: false, headers: { "Content-Type": "application/json", Connection: "close" } }, (res) => { res.resume(); res.on("end", resolve); });
      req.on("error", reject); req.end(JSON.stringify({ id: "mcp-page-drive" }));
    });
    for (const [tool, args, expectedType, expectedParams] of mapping) {
      const pollPromise = new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=5000`, { agent: false, headers: { Connection: "close" } }, (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve(JSON.parse(body)));
        }).on("error", reject);
      });
      const call = mcp.handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } });
      const poll = await pollPromise;
      assert.equal(poll.cmd.type, expectedType);
      assert.deepEqual(poll.cmd.params, expectedParams);
      await new Promise((resolve, reject) => {
        const req = http.request({ hostname: "127.0.0.1", port: bridge.port, path: "/ext/result", method: "POST", agent: false, headers: { "Content-Type": "application/json", Connection: "close" } }, (res) => { res.resume(); res.on("end", resolve); });
        req.on("error", reject); req.end(JSON.stringify({ id: poll.cmd.id, ok: true, result: { ok: true } }));
      });
      await call;
    }
  });
});
