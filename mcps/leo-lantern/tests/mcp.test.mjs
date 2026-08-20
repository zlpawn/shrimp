import test from "node:test";
import assert from "node:assert/strict";
import { LanternMcpServer, MCP_TOOLS } from "../lib/mcp-server.mjs";
import { LanternServer } from "../lib/server.mjs";

const TEST_PORT = 8788;
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
  const bridge = new LanternServer({ port: TEST_PORT });
  const mcp = new LanternMcpServer({ bridge, port: TEST_PORT });
  await bridge.start();
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
    assert.equal(parsedHealth.port, TEST_PORT);

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
    assert.equal(parsedDoctor.bridge.port, TEST_PORT);
  });
});
