import readline from "node:readline";

/**
 * Lightweight, zero-dependency, robust MCP stdio server implementation adhering to MCP 2024-11-05 JSON-RPC specification.
 */
export class McpStdioServer {
  constructor({ name, version, description, instructions }) {
    this.name = name || "database-hub";
    this.version = version || "1.0.0";
    this.description = description || "Multi-database MCP Server";
    this.instructions = instructions || "";
    this.tools = new Map();
  }

  registerTool({ name, description, inputSchema, handler }) {
    this.tools.set(name, {
      name,
      description,
      inputSchema: inputSchema || { type: "object", properties: {} },
      handler,
    });
  }

  async handleRequest(request) {
    const { id, method, params } = request;

    // 1. Initialize
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: this.name,
            version: this.version,
          },
          instructions: this.instructions,
        },
      };
    }

    // 2. Notifications initialized (no response needed for notifications)
    if (method === "notifications/initialized") {
      return null;
    }

    // 3. Ping
    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    // 4. Tools list
    if (method === "tools/list") {
      const toolList = Array.from(this.tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: toolList,
        },
      };
    }

    // 5. Tools call
    if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const tool = this.tools.get(toolName);

      if (!tool) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: Tool '${toolName}' not found. Available tools: [${Array.from(this.tools.keys()).join(", ")}]`,
              },
            ],
          },
        };
      }

      try {
        const output = await tool.handler(args);
        const textContent = typeof output === "string" ? output : JSON.stringify(output, null, 2);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: textContent,
              },
            ],
          },
        };
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: `Execution Error: ${err.message || String(err)}`,
              },
            ],
          },
        };
      }
    }

    // Unknown method
    if (id !== undefined && id !== null) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
    }

    return null;
  }

  start() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const json = JSON.parse(trimmed);
        const response = await this.handleRequest(json);
        if (response) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      } catch (err) {
        // Send JSON-RPC parse error
        const errResp = {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${err.message}`,
          },
        };
        process.stdout.write(JSON.stringify(errResp) + "\n");
      }
    });

    // Handle graceful exit
    const cleanup = () => {
      rl.close();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }
}
