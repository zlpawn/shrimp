#!/usr/bin/env node
import { LanternMcpServer } from "./lib/mcp-server.mjs";

const server = new LanternMcpServer();
server.start().catch((err) => {
  process.stderr.write(`Failed to start Leo Lantern MCP Server: ${err.message}
`);
  process.exit(1);
});
