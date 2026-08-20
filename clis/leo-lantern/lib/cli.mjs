import http from "node:http";
import fs from "node:fs/promises";
import { DEFAULT_BRIDGE_PORT, DEFAULT_BRIDGE_HOST, COMMAND_TYPES } from "./protocol.mjs";
import { LanternServer } from "./server.mjs";

export function parseCliArgs(args = []) {
  const command = args[0] || "help";
  const params = {};
  const positional = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        params[key] = next;
        i++;
      } else {
        params[key] = true;
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
              reject(new Error(parsed.error?.message || parsed.error || `HTTP ${res.statusCode}`));
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
          new Error(
            `Could not connect to Leo Lantern at http://${host}:${port}. Is leo-lantern or the MCP server running?`
          )
        );
      } else {
        reject(err);
      }
    });

    if (postData) req.write(postData);
    req.end();
  });
}

export async function executeCommand(command, params = {}, positional = [], options = {}) {
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

    case "new-tab": {
      const url = params.url || positional[0] || "about:blank";
      return await requestBridge("/cmd", "POST", { type: COMMAND_TYPES.TABS_NEW, params: { ...params, url } }, options);
    }

    case "goto": {
      const url = params.url || positional[0];
      if (!url) throw new Error("Missing URL for 'goto'");
      return await requestBridge("/cmd", "POST", { type: COMMAND_TYPES.TABS_GOTO, params: { ...params, url } }, options);
    }

    case "close-tab": {
      const tabId = Number(params.tabId || positional[0]);
      if (!tabId) throw new Error("Missing tabId for 'close-tab'");
      return await requestBridge("/cmd", "POST", { type: COMMAND_TYPES.TABS_CLOSE, params: { tabId } }, options);
    }

    case "click": {
      const text = params.text || positional[0];
      const selector = params.selector || params.sel;
      if (!text && !selector) throw new Error("Either --text or --selector is required for 'click'");
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
      if (!selector) throw new Error("--selector is required for 'fill'");
      if (value === undefined) throw new Error("--val or value is required for 'fill'");
      return await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.DOM_FILL, params: { ...params, selector, value: String(value) } },
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
      const fullPage = params.fullPage === true || params.fullPage === "true" || params.fullPage === "1";
      const res = await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.CDP_SCREENSHOT, params: { ...params, fullPage } },
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

    case "cookies": {
      const domain = params.domain || positional[0];
      if (!domain) throw new Error("--domain is required for 'cookies'");
      return await requestBridge("/cmd", "POST", { type: COMMAND_TYPES.COOKIES_EXPORT, params: { domain } }, options);
    }

    case "server":
    case "start-server": {
      const server = new LanternServer(options);
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
  tabs                           List open browser tabs
  new-tab <url>                  Open a new tab
  goto <url> [--tabId ID]        Navigate active or specified tab
  close-tab <tabId>              Close specified tab
  click [--text T] [--sel S]     Click element by text or selector
  fill --sel S --val V           Fill text into form input
  snapshot [--tabId ID]          Get interactive DOM elements tree
  eval <script>                  Evaluate JavaScript in page context
  screenshot [--out FILE]        Capture tab screenshot
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
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    if (!options.noExit) {
      process.exit(1);
    }
    throw err;
  }
}
