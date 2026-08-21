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
  "browser_goto",
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


test("MCP: browser_health is false when bridge port is already in use", async () => {
  const blocker = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, bridge: true }));
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
