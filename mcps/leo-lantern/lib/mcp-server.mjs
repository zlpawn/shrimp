import http from "node:http";
import readline from "node:readline";
import { LanternServer } from "./server.mjs";
import {
  COMMAND_TYPES,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_BRIDGE_HOST,
  normalizeProtocolError,
  protocolError,
} from "./protocol.mjs";

function definedParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

function isLanternHealth(value) {
  return value?.ok === true && value?.bridge === true && value?.service === "leo-lantern";
}

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
    name: "browser_start_task",
    description: "Start or reuse the active Agent task. Defaults to an independent background window.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        color: { type: "string", description: "Tab group color" },
        sameWindow: { type: "boolean", description: "Keep task in the current window" },
        focus: { type: "boolean", description: "Focus the task window" },
      },
    },
  },
  {
    name: "browser_claim_tab",
    description: "Claim an explicit tab ID into the active Agent task group.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Exact Chrome tab ID to claim" },
        focus: { type: "boolean", description: "Focus the claimed tab" },
        sameWindow: { type: "boolean", description: "Override task window strategy for this claim" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_end_task",
    description: "End the active Agent task. Optionally dissolve the Agent-owned group.",
    inputSchema: {
      type: "object",
      properties: {
        closeGroup: { type: "boolean", description: "Dissolve the Agent task group" },
      },
    },
  },
  {
    name: "browser_new_tab",
    description: "Navigate the claimed task tab, or create the first/forced task tab.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open (e.g. https://example.com)" },
        force: { type: "boolean", description: "Create an additional tab instead of reusing claimed tab" },
        focus: { type: "boolean", description: "Focus the tab/window" },
      },
    },
  },
  {
    name: "browser_goto",
    description: "Navigate the claimed task tab, or a task-owned tab ID.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target URL" },
        tabId: { type: "number", description: "Optional task-owned tab ID" },
        focus: { type: "boolean", description: "Focus the tab/window" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_wait",
    description: "Wait until the active task tab contains text or a selector match.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Visible text to wait for" },
        selector: { type: "string", description: "CSS selector to wait for" },
        timeoutMs: { type: "number", description: "Timeout in milliseconds" },
        tabId: { type: "number", description: "Optional task-owned tab ID" },
      },
    },
  },
  {
    name: "browser_content",
    description: "Read a compact title/URL/body-text summary from the active task tab.",
    inputSchema: {
      type: "object",
      properties: {
        maxChars: { type: "number", description: "Maximum body text characters" },
        tabId: { type: "number", description: "Optional task-owned tab ID" },
      },
    },
  },
  {
    name: "browser_press",
    description: "Dispatch a keyboard event to the task page or a selected element.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key name such as Enter or Escape" },
        selector: { type: "string", description: "Optional target selector" },
        tabId: { type: "number", description: "Optional task-owned tab ID" },
      },
      required: ["key"],
    },
  },
  {
    name: "browser_reload",
    description: "Reload the active task tab, optionally bypassing cache.",
    inputSchema: {
      type: "object",
      properties: {
        bypassCache: { type: "boolean", description: "Bypass browser cache" },
        tabId: { type: "number", description: "Optional task-owned tab ID" },
      },
    },
  },
  {
    name: "browser_net_start",
    description: "Start CDP request capture for the active task tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional task-owned tab ID" },
      },
    },
  },
  {
    name: "browser_net_get",
    description: "Read captured task-tab requests without stopping capture.",
    inputSchema: {
      type: "object",
      properties: {
        grep: { type: "string", description: "Case-insensitive URL/method/status filter" },
        tabId: { type: "number", description: "Optional task-owned tab ID" },
      },
    },
  },
  {
    name: "browser_net_stop",
    description: "Stop task-tab request capture and return final requests.",
    inputSchema: {
      type: "object",
      properties: {
        grep: { type: "string", description: "Case-insensitive URL/method/status filter" },
        tabId: { type: "number", description: "Optional task-owned tab ID" },
      },
    },
  },
  {
    name: "browser_state",
    description: "Return a bounded stable-target snapshot of interactive elements in the task tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional specific task-owned tab ID" },
      },
    },
  },
  {
    name: "browser_find",
    description: "Find task-tab elements by CSS or semantic target and allocate stable refs.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "object",
          description: "Discriminated target: ref, CSS, or semantic",
        },
        tabId: { type: "number", description: "Optional specific task-owned tab ID" },
      },
      required: ["target"],
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
    this.enableStdio = options.stdio !== false;
    this.rl = null;
    this.remoteUnavailable = false;
  }

  isBridgeOnline() {
    return Boolean(this.bridge?.server);
  }

  async start() {
    if (this.ownBridge) {
      try {
        await this.bridge.start();
        this.remoteBridge = false;
      } catch (err) {
        // If another local process already bound the port, forward commands to remote bridge
        if (err.code === "EADDRINUSE") {
          try {
            const health = await this.requestRemoteBridge("/health", "GET");
            this.remoteBridge = isLanternHealth(health);
            this.remoteUnavailable = !this.remoteBridge;
          } catch {
            this.remoteBridge = false;
            this.remoteUnavailable = true;
          }
        } else {
          throw err;
        }
      }
    } else {
      this.remoteBridge = false;
    }
    if (this.enableStdio) this.setupStdio();
  }

  async requestRemoteBridge(path, method = "GET", data = null) {
    return new Promise((resolve, reject) => {
      const postData = data ? JSON.stringify(data) : null;
      const req = http.request(
        {
          hostname: this.host,
          port: this.port,
          path,
          method,
          agent: false,
          headers: {
            "Content-Type": "application/json",
            Connection: "close",
            ...(postData ? { "Content-Length": Buffer.byteLength(postData) } : {}),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              const parsed = body ? JSON.parse(body) : {};
              if (res.statusCode >= 400) {
                reject(protocolError(parsed.error || {
                  code: "bridge_unavailable",
                  message: `HTTP ${res.statusCode}`,
                }));
              } else {
                resolve(parsed);
              }
            } catch (err) {
              reject(new Error(`Failed to parse bridge response: ${body}`));
            }
          });
        }
      );

      req.on("error", (err) => {
        if (err.code === "ECONNREFUSED") {
          reject(
            protocolError({
              code: "bridge_unavailable",
              message: `Could not connect to Leo Lantern at http://${this.host}:${this.port}. Is the bridge server running?`,
            })
          );
        } else {
          reject(err);
        }
      });

      if (postData) req.write(postData);
      req.end();
    });
  }

  async dispatch(type, params = {}, timeoutMs) {
    if (this.remoteUnavailable) {
      throw protocolError({
        code: "bridge_unavailable",
        message: `Port ${this.port} is occupied by a service that is not Leo Lantern`,
      });
    }
    if (this.remoteBridge) {
      const resp = await this.requestRemoteBridge(
        "/cmd",
        "POST",
        definedParams({ type, params, timeoutMs })
      );
      return resp.result !== undefined ? resp.result : resp;
    }
    return await this.bridge.dispatch(type, params, timeoutMs);
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
        const failure = { ok: false, error: normalizeProtocolError(err) };
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(failure) }],
            structuredContent: failure,
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
        if (this.remoteBridge) {
          try {
            const remote = await this.requestRemoteBridge("/health", "GET");
            return {
              bridgeOnline: isLanternHealth(remote),
              extensionOnline: Boolean(remote.extensionOnline),
              port: this.port,
            };
          } catch {
            return {
              bridgeOnline: false,
              extensionOnline: false,
              port: this.port,
            };
          }
        }
        const bridgeOnline = this.isBridgeOnline();
        return {
          bridgeOnline,
          extensionOnline: bridgeOnline && this.bridge.isExtensionOnline(),
          port: this.port,
        };
      }

      case "browser_doctor": {
        if (this.remoteBridge) {
          try {
            return await this.requestRemoteBridge("/doctor", "GET");
          } catch (err) {
            return {
              bridge: { online: false, port: this.port, error: err.message },
              extension: { online: false },
              task: null,
            };
          }
        }
        const bridgeOnline = this.isBridgeOnline();
        return {
          bridge: {
            online: bridgeOnline,
            port: this.port,
            extensionOnline: bridgeOnline && this.bridge.isExtensionOnline(),
            pendingCommands: this.bridge.pendingCommands.size,
          },
          extension: this.bridge.extension,
          task: this.bridge.taskSummary || null,
        };
      }

      case "browser_start_task": {
        return await this.dispatch(COMMAND_TYPES.TASK_START, {
          ...definedParams({
            title: args.title,
            color: args.color,
            sameWindow: args.sameWindow,
            focus: args.focus,
          }),
        });
      }

      case "browser_claim_tab": {
        if (args.tabId === undefined || args.tabId === null) {
          throw new Error("Argument 'tabId' is required for browser_claim_tab");
        }
        return await this.dispatch(COMMAND_TYPES.TABS_CLAIM, definedParams({
          tabId: args.tabId,
          focus: args.focus,
          sameWindow: args.sameWindow,
        }));
      }

      case "browser_end_task": {
        return await this.dispatch(COMMAND_TYPES.TASK_END, {
          ...definedParams({ closeGroup: args.closeGroup }),
        });
      }

      case "browser_open_tabs": {
        return await this.dispatch(COMMAND_TYPES.TABS_LIST, args);
      }

      case "browser_new_tab": {
        return await this.dispatch(COMMAND_TYPES.TABS_NEW, definedParams({
          url: args.url || "about:blank",
          force: args.force,
          focus: args.focus,
        }));
      }

      case "browser_goto": {
        if (!args.url) throw new Error("Argument 'url' is required");
        return await this.dispatch(COMMAND_TYPES.TABS_GOTO, definedParams({
          ...args,
          focus: args.focus,
        }));
      }

      case "browser_wait": {
        if (!args.text && !args.selector) {
          throw new Error("Either 'text' or 'selector' is required for browser_wait");
        }
        const timeoutMs = args.timeoutMs !== undefined ? Number(args.timeoutMs) : undefined;
        return await this.dispatch(
          COMMAND_TYPES.DOM_WAIT,
          definedParams({ ...args, timeoutMs }),
          timeoutMs !== undefined ? timeoutMs + 2_000 : undefined
        );
      }

      case "browser_content": {
        return await this.dispatch(COMMAND_TYPES.DOM_CONTENT, args);
      }

      case "browser_press": {
        if (!args.key) throw new Error("Argument 'key' is required for browser_press");
        return await this.dispatch(COMMAND_TYPES.DOM_PRESS, args);
      }

      case "browser_reload": {
        return await this.dispatch(COMMAND_TYPES.TABS_RELOAD, {
          ...definedParams({ bypassCache: args.bypassCache, tabId: args.tabId }),
        });
      }

      case "browser_net_start": {
        return await this.dispatch(COMMAND_TYPES.CDP_NET_START, {
          tabId: args.tabId,
        });
      }

      case "browser_net_get": {
        return await this.dispatch(COMMAND_TYPES.CDP_NET_GET, {
          grep: args.grep,
          tabId: args.tabId,
        });
      }

      case "browser_net_stop": {
        return await this.dispatch(COMMAND_TYPES.CDP_NET_STOP, {
          grep: args.grep,
          tabId: args.tabId,
        });
      }

      case "browser_state": {
        return await this.dispatch(COMMAND_TYPES.DOM_STATE, args);
      }

      case "browser_find": {
        if (!args.target) throw new Error("Argument 'target' is required for browser_find");
        return await this.dispatch(COMMAND_TYPES.DOM_FIND, args);
      }

      case "browser_click": {
        if (!args.text && !args.selector) {
          throw new Error("Either 'text' or 'selector' must be provided for browser_click");
        }
        return await this.dispatch(COMMAND_TYPES.DOM_CLICK, args);
      }

      case "browser_fill": {
        if (!args.selector || args.value === undefined) {
          throw new Error("Both 'selector' and 'value' are required for browser_fill");
        }
        return await this.dispatch(COMMAND_TYPES.DOM_FILL, args);
      }

      case "browser_snapshot": {
        return await this.dispatch(COMMAND_TYPES.DOM_SNAPSHOT, args);
      }

      case "browser_eval": {
        if (!args.script) throw new Error("Argument 'script' is required for browser_eval");
        return await this.dispatch(COMMAND_TYPES.PAGE_EVAL, args);
      }

      case "browser_screenshot": {
        return await this.dispatch(COMMAND_TYPES.CDP_SCREENSHOT, args);
      }

      case "browser_cookies": {
        if (!args.domain) throw new Error("Argument 'domain' is required for browser_cookies");
        return await this.dispatch(COMMAND_TYPES.COOKIES_EXPORT, args);
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
