import readline from "node:readline";
import { LanternServer } from "./server.mjs";
import { COMMAND_TYPES, DEFAULT_BRIDGE_PORT } from "./protocol.mjs";

export const MCP_TOOLS = [
  {
    name: "browser_health",
    description: "Check whether Leo Lantern and the Chrome extension are connected and online.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "browser_doctor",
    description: "Get detailed diagnostic information for Leo Lantern and the Chrome extension.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "browser_open_tabs",
    description: "List all open browser tabs in the user's real Chrome browser.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "browser_new_tab",
    description: "Open a new tab with the specified URL in the user's Chrome browser.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open (e.g. https://example.com)" },
      },
    },
  },
  {
    name: "browser_goto",
    description: "Navigate an existing or active browser tab to a URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target URL" },
        tabId: { type: "number", description: "Optional specific tab ID (defaults to active tab)" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_click",
    description: "Click an interactive element in the browser tab by visible text or CSS selector.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Visible text of the button, link, or element to click" },
        selector: { type: "string", description: "CSS selector of the element to click" },
        tabId: { type: "number", description: "Optional specific tab ID" },
      },
    },
  },
  {
    name: "browser_fill",
    description: "Fill a form input, textarea, or contenteditable field with a given value.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the input field" },
        value: { type: "string", description: "Text value to fill into the input" },
        tabId: { type: "number", description: "Optional specific tab ID" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "browser_snapshot",
    description: "Extract a lightweight hierarchical list of interactive elements (buttons, inputs, links, headings) from the page.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional specific tab ID" },
      },
    },
  },
  {
    name: "browser_eval",
    description: "Execute arbitrary JavaScript expression in the web page context and return the result.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code or expression to evaluate" },
        tabId: { type: "number", description: "Optional specific tab ID" },
      },
      required: ["script"],
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture a screenshot of the current or specified browser tab without stealing window focus.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional specific tab ID" },
        fullPage: { type: "boolean", description: "Whether to capture the entire scrollable page" },
      },
    },
  },
  {
    name: "browser_cookies",
    description: "Extract decrypted cookies for a given domain from the user's real Chrome profile.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Target domain (e.g. bilibili.com or github.com)" },
      },
      required: ["domain"],
    },
  },
];

export class LanternMcpServer {
  constructor(options = {}) {
    this.port = options.port || Number(process.env.LEO_LANTERN_PORT || DEFAULT_BRIDGE_PORT);
    this.host = options.host || "127.0.0.1";
    this.bridge = options.bridge || new LanternServer({ port: this.port, host: this.host });
    this.ownBridge = !options.bridge;
    this.rl = null;
  }

  async start() {
    if (this.ownBridge) {
      try {
        await this.bridge.start();
      } catch (err) {
        // If port is already in use (e.g. another bridge or gateway instance), that's fine
        if (err.code !== "EADDRINUSE") {
          throw err;
        }
      }
    }
    this.setupStdio();
  }

  setupStdio() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const message = JSON.parse(trimmed);
        const response = await this.handleJsonRpc(message);
        if (response) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      } catch (err) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: `Parse error: ${err.message}` },
          }) + "\n"
        );
      }
    });
  }

  async handleJsonRpc(msg) {
    const { id, method, params } = msg;

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "leo-lantern",
            version: "1.0.0",
          },
        },
      };
    }

    if (method === "notifications/initialized" || method === "initialized") {
      return null;
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: MCP_TOOLS },
      };
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments || {};
      try {
        const result = await this.callTool(toolName, args);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
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
            content: [{ type: "text", text: `Error: ${err.message}` }],
          },
        };
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  async callTool(name, args = {}) {
    switch (name) {
      case "browser_health": {
        return {
          bridgeOnline: true,
          extensionOnline: this.bridge.isExtensionOnline(),
          port: this.port,
        };
      }

      case "browser_doctor": {
        return {
          bridge: {
            port: this.port,
            extensionOnline: this.bridge.isExtensionOnline(),
            pendingCommands: this.bridge.pendingCommands.size,
          },
          extension: this.bridge.extension,
        };
      }

      case "browser_open_tabs": {
        return await this.bridge.dispatch(COMMAND_TYPES.TABS_LIST, args);
      }

      case "browser_new_tab": {
        return await this.bridge.dispatch(COMMAND_TYPES.TABS_NEW, { url: args.url || "about:blank" });
      }

      case "browser_goto": {
        if (!args.url) throw new Error("Argument 'url' is required");
        return await this.bridge.dispatch(COMMAND_TYPES.TABS_GOTO, args);
      }

      case "browser_click": {
        if (!args.text && !args.selector) {
          throw new Error("Either 'text' or 'selector' must be provided for browser_click");
        }
        return await this.bridge.dispatch(COMMAND_TYPES.DOM_CLICK, args);
      }

      case "browser_fill": {
        if (!args.selector || args.value === undefined) {
          throw new Error("Both 'selector' and 'value' are required for browser_fill");
        }
        return await this.bridge.dispatch(COMMAND_TYPES.DOM_FILL, args);
      }

      case "browser_snapshot": {
        return await this.bridge.dispatch(COMMAND_TYPES.DOM_SNAPSHOT, args);
      }

      case "browser_eval": {
        if (!args.script) throw new Error("Argument 'script' is required for browser_eval");
        return await this.bridge.dispatch(COMMAND_TYPES.PAGE_EVAL, args);
      }

      case "browser_screenshot": {
        return await this.bridge.dispatch(COMMAND_TYPES.CDP_SCREENSHOT, args);
      }

      case "browser_cookies": {
        if (!args.domain) throw new Error("Argument 'domain' is required for browser_cookies");
        return await this.bridge.dispatch(COMMAND_TYPES.COOKIES_EXPORT, args);
      }

      default:
        throw new Error(`Unknown tool name: ${name}`);
    }
  }

  async stop() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.ownBridge && this.bridge) {
      await this.bridge.stop();
    }
  }
}
