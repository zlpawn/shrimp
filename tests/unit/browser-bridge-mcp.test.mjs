import test from "node:test";
import assert from "node:assert/strict";
import { BrowserMcpServer, MCP_TOOLS } from "../../lib/browser-bridge/mcp-server.mjs";
import { BridgeServer } from "../../lib/browser-bridge/server.mjs";

test("MCP: tools/list returns standard browser tools", async () => {
  const bridge = new BridgeServer({ port: 19533 });
  const mcp = new BrowserMcpServer({ bridge, port: 19533 });

  const listRes = await mcp.handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });

  assert.equal(listRes.id, 1);
  assert.ok(Array.isArray(listRes.result.tools));
  const toolNames = listRes.result.tools.map((t) => t.name);
  assert.ok(toolNames.includes("browser_click"));
  assert.ok(toolNames.includes("browser_screenshot"));
  assert.ok(toolNames.includes("browser_snapshot"));
  assert.ok(toolNames.includes("browser_cookies"));
});

test("MCP: initialize and ping methods", async () => {
  const bridge = new BridgeServer({ port: 19534 });
  const mcp = new BrowserMcpServer({ bridge, port: 19534 });

  const initRes = await mcp.handleJsonRpc({
    jsonrpc: "2.0",
    id: "init-1",
    method: "initialize",
    params: {},
  });
  assert.equal(initRes.id, "init-1");
  assert.equal(initRes.result.serverInfo.name, "shrimp-browser-bridge");

  const pingRes = await mcp.handleJsonRpc({
    jsonrpc: "2.0",
    id: "ping-1",
    method: "ping",
  });
  assert.deepEqual(pingRes.result, {});
});

test("MCP: tools/call browser_health", async () => {
  const bridge = new BridgeServer({ port: 19535 });
  const mcp = new BrowserMcpServer({ bridge, port: 19535 });

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
  assert.ok(healthRes.result.content);
  const parsedText = JSON.parse(healthRes.result.content[0].text);
  assert.equal(parsedText.bridgeOnline, true);
});
