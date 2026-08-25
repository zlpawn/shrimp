import http from "node:http";
import fs from "node:fs/promises";
import {
  DEFAULT_BRIDGE_PORT,
  DEFAULT_BRIDGE_HOST,
  COMMAND_TYPES,
  normalizeProtocolError,
  protocolError,
} from "./protocol.mjs";
import { LanternServer } from "./server.mjs";

const BOOLEAN_FLAGS = new Set([
  "same-window",
  "samewindow",
  "focus",
  "force",
  "close-group",
  "closegroup",
  "bypass-cache",
  "bypasscache",
  "full-page",
  "fullpage",
  "help",
  "doctor",
  "health",
  "server",
  "no-exit",
  "noexit",
]);

const PARAM_ALIASES = new Map([
  ["full-page", "fullPage"],
  ["fullpage", "fullPage"],
  ["fullPage", "fullPage"],
  ["bypass-cache", "bypassCache"],
  ["bypasscache", "bypassCache"],
  ["bypassCache", "bypassCache"],
  ["same-window", "sameWindow"],
  ["samewindow", "sameWindow"],
  ["sameWindow", "sameWindow"],
  ["close-group", "closeGroup"],
  ["closegroup", "closeGroup"],
  ["closeGroup", "closeGroup"],
  ["timeout-ms", "timeoutMs"],
  ["timeoutMs", "timeoutMs"],
]);

export function normalizeCliParams(params = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(params)) {
    normalized[PARAM_ALIASES.get(key) || key] = value;
  }
  return normalized;
}

function definedParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

export function parseCliArgs(args = []) {
  const command = args[0] || "help";
  const params = {};
  const positional = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      const eqIdx = raw.indexOf("=");
      if (eqIdx !== -1) {
        const key = raw.slice(0, eqIdx);
        const val = raw.slice(eqIdx + 1);
        params[key] = val;
      } else {
        const key = raw;
        const normalizedKey = key.toLowerCase().replace(/_/g, "-");
        if (BOOLEAN_FLAGS.has(normalizedKey)) {
          params[key] = true;
        } else {
          const next = args[i + 1];
          if (next !== undefined && !next.startsWith("--")) {
            params[key] = next;
            i++;
          } else {
            params[key] = true;
          }
        }
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, params, positional };
}

async function requestBridge(path, method = "GET", data = null, options = {}) {
  const port = options.port || Number(process.env.LEO_LANTERN_PORT || DEFAULT_BRIDGE_PORT);
  const host = options.host || process.env.LEO_LANTERN_HOST || DEFAULT_BRIDGE_HOST;

  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const req = http.request(
      {
        hostname: host,
        port,
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
            message: `Could not connect to Leo Lantern at http://${host}:${port}. Is leo-lantern or the MCP server running?`,
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

function asBool(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

export function formatCliError(error) {
  return { ok: false, error: normalizeProtocolError(error) };
}

export async function executeCommand(command, params = {}, positional = [], options = {}) {
  params = normalizeCliParams(params);
  switch (command) {
    case "health": {
      return await requestBridge("/health", "GET", null, options);
    }

    case "doctor": {
      return await requestBridge("/doctor", "GET", null, options);
    }

    case "tabs":
    case "open-tabs": {
      return await requestBridge("/cmd", "POST", { type: COMMAND_TYPES.TABS_LIST, params }, options);
    }

    case "start-task": {
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.TASK_START,
          params: definedParams({
            title: params.title || positional[0],
            color: params.color,
            sameWindow: params.sameWindow !== undefined ? asBool(params.sameWindow) : undefined,
            focus: params.focus !== undefined ? asBool(params.focus) : undefined,
          }),
        },
        options
      );
    }

    case "claim": {
      const tabId = params.tabId || positional[0];
      if (!tabId) throw new Error("--tabId is required for 'claim'");
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.TABS_CLAIM,
          params: definedParams({
            tabId,
            focus: params.focus !== undefined ? asBool(params.focus) : undefined,
            sameWindow: params.sameWindow !== undefined ? asBool(params.sameWindow) : undefined,
          }),
        },
        options
      );
    }

    case "end-task": {
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.TASK_END,
          params: definedParams({
            closeGroup: params.closeGroup !== undefined ? asBool(params.closeGroup) : undefined,
          }),
        },
        options
      );
    }

    case "new-tab": {
      const url = params.url || positional[0] || "about:blank";
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.TABS_NEW,
          params: definedParams({
            url,
            force: params.force !== undefined ? asBool(params.force) : undefined,
            focus: params.focus !== undefined ? asBool(params.focus) : undefined,
          }),
        },
        options
      );
    }

    case "goto": {
      const url = params.url || positional[0];
      if (!url) throw new Error("Missing URL for 'goto'");
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.TABS_GOTO,
          params: definedParams({
            tabId: params.tabId,
            url,
            focus: params.focus !== undefined ? asBool(params.focus) : undefined,
          }),
        },
        options
      );
    }

    case "close-tab": {
      const tabId = Number(params.tabId || positional[0]);
      if (!tabId) throw new Error("Missing tabId for 'close-tab'");
      return await requestBridge("/cmd", "POST", { type: COMMAND_TYPES.TABS_CLOSE, params: { tabId } }, options);
    }

    case "click": {
      const hasTarget = Boolean(params.target);
      const text = params.text || (!hasTarget ? positional[0] : undefined);
      const selector = params.selector || params.sel;
      if (!hasTarget && !text && !selector) throw new Error("A target is required for 'click'");
      return await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.DOM_CLICK, params: { ...params, text, selector } },
        options
      );
    }

    case "fill": {
      const selector = params.selector || params.sel;
      const value = params.val !== undefined ? params.val : params.value !== undefined ? params.value : positional[0];
      if (!selector && !params.target) throw new Error("A target is required for 'fill'");
      if (value === undefined) throw new Error("--val or value is required for 'fill'");
      return await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.DOM_FILL, params: { ...params, selector, value: String(value) } },
        options
      );
    }

    case "reload": {
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.TABS_RELOAD,
          params: definedParams({
            bypassCache: params.bypassCache !== undefined ? asBool(params.bypassCache) : undefined,
            tabId: params.tabId,
          }),
        },
        options
      );
    }

    case "state": {
      return await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.DOM_STATE, params: definedParams({ tabId: params.tabId }) },
        options
      );
    }

    case "find": {
      return await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.DOM_FIND, params: definedParams({ target: params.target, tabId: params.tabId }) },
        options
      );
    }

    case "wait": {
      const timeoutMs = params.timeoutMs !== undefined ? Number(params.timeoutMs) : undefined;
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.DOM_WAIT,
          params: definedParams({
            text: params.text || positional[0],
            selector: params.selector || params.sel,
            timeoutMs,
            tabId: params.tabId,
          }),
          ...(timeoutMs !== undefined ? { timeoutMs: timeoutMs + 2_000 } : {}),
        },
        options
      );
    }

    case "content": {
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.DOM_CONTENT,
          params: {
            maxChars: params.maxChars || params["max-chars"],
            tabId: params.tabId,
          },
        },
        options
      );
    }

    case "press": {
      const key = params.key || positional[0];
      if (!key) throw new Error("Key argument required for 'press'");
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.DOM_PRESS,
          params: {
            key,
            selector: params.selector || params.sel,
            tabId: params.tabId,
          },
        },
        options
      );
    }

    case "snapshot": {
      return await requestBridge("/cmd", "POST", { type: COMMAND_TYPES.DOM_SNAPSHOT, params }, options);
    }

    case "eval": {
      const script = params.script || positional.join(" ");
      if (!script) throw new Error("Script argument required for 'eval'");
      return await requestBridge("/cmd", "POST", { type: COMMAND_TYPES.PAGE_EVAL, params: { ...params, script } }, options);
    }

    case "screenshot": {
      const fullPage = params.fullPage !== undefined ? asBool(params.fullPage) : undefined;
      const res = await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.CDP_SCREENSHOT,
          params: definedParams({ tabId: params.tabId, fullPage }),
        },
        options
      );
      const outPath = params.out || params.output;
      if (outPath && res.result?.data) {
        const buf = Buffer.from(res.result.data, "base64");
        await fs.writeFile(outPath, buf);
        return { ok: true, savedTo: outPath, sizeBytes: buf.length };
      }
      return res;
    }

    case "net-start": {
      return await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.CDP_NET_START, params: { tabId: params.tabId } },
        options
      );
    }

    case "net-get": {
      return await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.CDP_NET_GET, params: { grep: params.grep, tabId: params.tabId } },
        options
      );
    }

    case "net-stop": {
      return await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.CDP_NET_STOP, params: { grep: params.grep, tabId: params.tabId } },
        options
      );
    }

    case "cookies": {
      const domain = params.domain || positional[0];
      if (!domain) throw new Error("--domain is required for 'cookies'");
      return await requestBridge("/cmd", "POST", { type: COMMAND_TYPES.COOKIES_EXPORT, params: { domain } }, options);
    }

    case "server":
    case "start-server": {
      const server = new LanternServer({
        ...options,
        host: params.host ?? options.host,
        port: params.port !== undefined ? Number(params.port) : options.port,
      });
      await server.start();
      console.log(`Leo Lantern server listening on http://${server.host}:${server.port}`);
      // Return server instance
      return { ok: true, server };
    }

    case "help":
    default: {
      return {
        ok: true,
        help: `
Usage: leo-lantern <command> [options]

Commands:
  health                         Check bridge and extension status
  doctor                         Diagnostic report
  start-task [--title T]         Start or reuse Agent task (background window)
  claim --tabId ID               Claim explicit tab into Agent task group
  end-task [--close-group]       End active Agent task
  tabs                           List open browser tabs
  new-tab <url> [--force]        Navigate claimed tab (or create first/forced tab)
  goto <url> [--tabId ID]        Navigate claimed or task-owned tab
  close-tab <tabId>              Close specified tab
  click [--text T] [--sel S]     Click element by text or selector
  fill --sel S --val V           Fill text into form input
  wait [--text T | --sel S]      Wait for task page content
  content [--max-chars N]        Read compact task page content
  press <key> [--sel S]          Dispatch a key event
  reload [--bypass-cache]        Reload claimed task tab
  snapshot [--tabId ID]          Get interactive DOM elements tree
  eval <script>                  Evaluate JavaScript in page context
  screenshot [--out FILE]        Capture tab screenshot
  net-start / net-get / net-stop Capture task tab XHR/fetch APIs
  cookies --domain DOMAIN        Extract cookies for domain
  server [--port N]              Start standalone Leo Lantern server
`.trim(),
      };
    }
  }
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  const { command, params, positional } = parseCliArgs(argv);
  try {
    const result = await executeCommand(command, params, positional, options);
    if (result.help) {
      console.log(result.help);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return result;
  } catch (err) {
    console.error(JSON.stringify(formatCliError(err), null, 2));
    if (!options.noExit) {
      process.exit(1);
    }
    throw err;
  }
}
