#!/usr/bin/env node
import { BrowserMcpServer } from "../lib/browser-bridge/mcp-server.mjs";

const server = new BrowserMcpServer();
server.start().catch((err) => {
  process.stderr.write(`Failed to start Browser MCP Server: ${err.message}\n`);
  process.exit(1);
});
