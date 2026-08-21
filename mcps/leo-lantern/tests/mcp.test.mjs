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

test("MCP: tools/list returns 11 standard browser tools", async () => {
  await withMcp(async (mcp) => {
    const listRes = await mcp.handleJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    assert.equal(listRes.id, 1);
    assert.ok(Array.isArray(listRes.result.tools));
    const toolNames = listRes.result.tools.map((t) => t.name);
    assert.equal(toolNames.length, 11);
    for (const name of REQUIRED_TOOLS) {
      assert.ok(toolNames.includes(name), `missing tool ${name}`);
    }
    assert.equal(MCP_TOOLS.length, 11);
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
