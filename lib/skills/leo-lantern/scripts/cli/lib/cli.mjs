import http from "node:http";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BRIDGE_PORT,
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_START_TIMEOUT_MS,
  DEFAULT_IDLE_EXIT_MIN,
  DEFAULT_VISIT_TIMEOUT_MS,
  VISIT_TRANSPORT_ALLOWANCE_MS,
  COMMAND_TYPES,
  normalizeProtocolError,
  protocolError,
  wrapEvalScript,
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
  "idle",
  "stable",
  "help",
  "doctor",
  "health",
  "server",
  "no-exit",
  "noexit",
  "open-if-missing",
  "blur",
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
  ["idle-ms", "idleMs"],
  ["idlems", "idleMs"],
  ["idleMs", "idleMs"],
  ["stable-ms", "stableMs"],
  ["stablems", "stableMs"],
  ["stableMs", "stableMs"],
  ["idle-exit-min", "idleExitMin"],
  ["idleExitMin", "idleExitMin"],
  ["open-if-missing", "openIfMissing"],
  ["openIfMissing", "openIfMissing"],
]);

const CLI_ENTRY = fileURLToPath(new URL("../index.mjs", import.meta.url));

export function normalizeCliParams(params = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(params)) {
    let normalizedValue = value;
    if (key === "target") {
      try {
        normalizedValue = typeof value === "string" ? JSON.parse(value) : value;
      } catch {
        throw new Error("--target must be a JSON object");
      }
    }
    normalized[PARAM_ALIASES.get(key) || key] = normalizedValue;
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

function bridgeAddress(options = {}) {
  return {
    port: options.port || Number(process.env.LEO_LANTERN_PORT || DEFAULT_BRIDGE_PORT),
    host: options.host || process.env.LEO_LANTERN_HOST || DEFAULT_BRIDGE_HOST,
  };
}

async function lanternHealth(options) {
  try {
    const health = await requestBridge("/health", "GET", null, { ...options, requestTimeoutMs: 2000 });
    return health?.service === "leo-lantern" ? health : null;
  } catch {
    return null;
  }
}

/** Returns the bridge's health, starting it in the background and waiting for the extension if needed. */
export async function ensureBridge(options = {}) {
  let health = await lanternHealth(options);
  const started = !health;
  let bridgeExited = false;
  if (started) {
    const { port, host } = bridgeAddress(options);
    const bridge = spawn(process.execPath, [CLI_ENTRY, "server", "--port", String(port), "--host", host], {
      detached: true,
      stdio: "ignore",
      cwd: path.dirname(CLI_ENTRY),
    });
    bridge.once("exit", () => (bridgeExited = true));
    bridge.unref();
  }

  const deadline = Date.now() + (options.startTimeoutMs ?? DEFAULT_BRIDGE_START_TIMEOUT_MS);
  while (!health?.extensionOnline && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    health = await lanternHealth(options);
    if (!health && bridgeExited) break; // It could not listen, and no other bridge took the port.
  }
  if (!health) {
    const { port, host } = bridgeAddress(options);
    throw protocolError({
      code: "bridge_unavailable",
      message: `Could not start Leo Lantern on http://${host}:${port}; the port may be held by another service`,
    });
  }
  return { ...health, started };
}

async function requestBridge(path, method = "GET", data = null, options = {}) {
  const { port, host } = bridgeAddress(options);

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
      if (err.code === "ECONNREFUSED" && path === "/cmd" && options.autoStart !== false) {
        resolve(
          ensureBridge(options).then(() => requestBridge(path, method, data, { ...options, autoStart: false }))
        );
      } else if (err.code === "ECONNREFUSED") {
        reject(
          protocolError({
            code: "bridge_unavailable",
            message: `Could not connect to Leo Lantern at http://${host}:${port}. Start the bridge server with: leo-lantern server --port ${port} (or node scripts/cli/index.mjs server --port ${port})`,
          })
        );
      } else {
        reject(err);
      }
    });

    if (options.requestTimeoutMs) {
      req.setTimeout(options.requestTimeoutMs, () => req.destroy(new Error("Bridge request timed out")));
    }
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * Opens url in a background window so the site can set its cookies, reads them, and closes the
 * window. Returns { cookies, finalUrl, loginRequired, ... }; cookieUrl reads for another url.
 */
export async function visitForCookies(url, options = {}) {
  const timeoutMs = options.visitTimeoutMs ?? DEFAULT_VISIT_TIMEOUT_MS;
  const params = { url, timeoutMs, ...(options.cookieUrl ? { cookieUrl: options.cookieUrl } : {}) };
  const command = { type: COMMAND_TYPES.COOKIES_VISIT, params, timeoutMs: timeoutMs + VISIT_TRANSPORT_ALLOWANCE_MS };
  try {
    return (await requestBridge("/cmd", "POST", command, options)).result;
  } catch (err) {
    if (!/Unsupported task type/.test(err.message)) throw err;
    throw protocolError({
      code: "extension_outdated",
      message: "The Chrome extension is too old to open pages for cookies. Reload it in chrome://extensions and retry.",
    });
  }
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

    case "start": {
      const port = params.port !== undefined ? Number(params.port) : options.port;
      return await ensureBridge({ ...options, port });
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
      const hasRef = params.ref !== undefined;
      const hasTarget = Boolean(params.target) || hasRef;
      const text = params.text || (!hasTarget ? positional[0] : undefined);
      const selector = params.selector || params.sel;
      if (!hasTarget && !text && !selector) throw new Error("A target is required for 'click'");
      const target = params.target || (hasRef ? { kind: "ref", ref: Number(params.ref), generation: params.generation } : undefined);
      const res = await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.DOM_CLICK,
          params: definedParams(target ? { tabId: params.tabId, target } : { tabId: params.tabId, text, selector }),
        },
        options
      );
      if (res && res.clicked === false) {
        return {
          ok: false,
          clicked: false,
          reason: res.reason || res.code || "ambiguous_match",
          matches_n: res.matches_n,
          error: res.error || res.message,
        };
      }
      return res;
    }

    case "fill": {
      const hasRef = params.ref !== undefined;
      const selector = params.selector || params.sel;
      const target = params.target || (hasRef ? { kind: "ref", ref: Number(params.ref), generation: params.generation } : undefined);
      const value = params.val !== undefined ? params.val : params.value !== undefined ? params.value : positional[0];
      if (!selector && !target) throw new Error("A target is required for 'fill'");
      if (value === undefined) throw new Error("--val or value is required for 'fill'");
      const blur = params.blur ? true : undefined;
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.DOM_FILL,
          params: definedParams(target ? { tabId: params.tabId, target, value: String(value), blur } : { tabId: params.tabId, selector, value: String(value), blur }),
        },
        options
      );
    }

    case "ext-reload": {
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.EXT_RELOAD,
          params: definedParams({ tabId: params.tabId }),
        },
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
      const selector = params.selector || params.sel;
      const text = params.text || positional[0];
      const target =
        params.target ||
        (selector ? { kind: "css", selector } : text ? { kind: "semantic", text, match: "contains" } : undefined);
      if (!target) throw new Error("A target is required for 'find' (--text, --sel, or --target)");
      return await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.DOM_FIND, params: definedParams({ target, tabId: params.tabId }) },
        options
      );
    }

    case "wait": {
      const timeoutMs = params.timeoutMs !== undefined ? Number(params.timeoutMs) : undefined;
      const idle = params.idle || params.stable ? true : undefined;
      const idleMs = params.idleMs !== undefined ? Number(params.idleMs) : params.stableMs !== undefined ? Number(params.stableMs) : undefined;
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.DOM_WAIT,
          params: definedParams({
            text: params.text || positional[0],
            selector: params.selector || params.sel,
            idle,
            idleMs,
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
      let script = params.script;
      if (!script && (params.file || params.f)) {
        const filePath = path.resolve(params.file || params.f);
        if (!syncFs.existsSync(filePath)) {
          throw new Error(`Eval script file not found: ${filePath}`);
        }
        script = syncFs.readFileSync(filePath, "utf8");
      }
      if (!script) {
        script = positional.join(" ");
      }
      if (!script) throw new Error("Script argument required for 'eval'");
      const wrappedScript = wrapEvalScript(script);
      const res = await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.PAGE_EVAL, params: { ...params, script: wrappedScript } },
        options
      );
      const evalResult = res.result?.evalResult !== undefined ? res.result.evalResult : null;
      return {
        ok: true,
        evalResult,
        hasResult: res.result?.hasResult ?? (evalResult !== null || res.result?.evalResult !== undefined),
        resultType: res.result?.resultType ?? (evalResult === null ? "null" : typeof evalResult),
        task: res.result?.task,
      };
    }

    
    case "upload": {
      const selector = params.selector || params.sel || "input[type='file']";
      const named = params.files
        ? String(params.files).split(",").map((file) => file.trim()).filter(Boolean)
        : params.file
        ? [String(params.file)]
        : positional;
      if (named.length === 0) {
        throw new Error("File path(s) required for 'upload'");
      }
      // Chrome resolves relative paths against its own working directory, not the caller's.
      const fileList = named.map((file) => path.resolve(file));
      return await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.CDP_UPLOAD,
          params: definedParams({
            tabId: params.tabId,
            selector,
            files: fileList,
          }),
        },
        options
      );
    }

    case "screenshot": {
      const fullPage = params.fullPage !== undefined ? asBool(params.fullPage) : undefined;
      const res = await requestBridge(
        "/cmd",
        "POST",
        {
          type: COMMAND_TYPES.CDP_SCREENSHOT,
          params: definedParams({
            tabId: params.tabId,
            fullPage,
            selector: params.selector || params.sel,
            ref: params.ref !== undefined ? Number(params.ref) : undefined,
          }),
        },
        options
      );
      const outPath = params.out || params.output;
      if (outPath && res.result?.data) {
        const buf = Buffer.from(res.result.data, "base64");
        await fs.writeFile(outPath, buf);
        return { ok: true, savedTo: outPath, sizeBytes: buf.length, clipped: Boolean(res.result.clipped) };
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
      const url = params.url;
      const domain = params.domain || positional[0] || (url && new URL(url).hostname);
      if (!domain) throw new Error("--domain or --url is required for 'cookies'");
      let res = await requestBridge(
        "/cmd",
        "POST",
        { type: COMMAND_TYPES.COOKIES_EXPORT, params: { domain, ...(url ? { url } : {}) } },
        options
      );
      let cookies = res.result?.cookies || res.cookies || [];
      if (asBool(params.openIfMissing) && !cookies.length) {
        const visit = await visitForCookies(url || `https://${domain}/`, options);
        if (visit.loginRequired) {
          throw protocolError({
            code: "login_required",
            message: `${visit.finalUrl} requires a login. Sign in with Chrome, then retry.`,
          });
        }
        res = { ok: true, result: visit };
        cookies = visit.cookies || [];
      }
      const format = String(params.format || "json").toLowerCase();
      const outPath = params.out || params.output;

      if (format === "txt" || format === "netscape") {
        const lines = [
          "# Netscape HTTP Cookie File",
          "# https://curl.haxx.se/rfc/cookie_spec.html",
          "# This file was generated by leo-lantern",
          "",
        ];
        for (const c of cookies) {
          const dom = String(c.domain || domain || "");
          const flag = dom.startsWith(".") ? "TRUE" : "FALSE";
          const p = String(c.path || "/");
          const secure = c.secure ? "TRUE" : "FALSE";
          const expires = Math.floor(Number(c.expires ?? c.expirationDate) || 0);
          const name = String(c.name || "");
          const value = String(c.value ?? "");
          if (dom && name) {
            lines.push([dom, flag, p, secure, expires, name, value].join("\t"));
          }
        }
        const netscapeText = lines.join("\n") + "\n";
        if (outPath) {
          await fs.writeFile(outPath, netscapeText, "utf-8");
          return { ok: true, savedTo: outPath, format: "netscape", count: cookies.length };
        }
        return { rawText: netscapeText, ok: true, count: cookies.length };
      }

      if (outPath) {
        await fs.writeFile(outPath, JSON.stringify(res, null, 2), "utf-8");
        return { ok: true, savedTo: outPath, format: "json", count: cookies.length };
      }

      return res;
    }

    case "server":
    case "start-server": {
      const idleExitMin = Number(params.idleExitMin ?? process.env.LEO_LANTERN_IDLE_EXIT_MIN ?? DEFAULT_IDLE_EXIT_MIN);
      const server = new LanternServer({
        ...options,
        host: params.host ?? options.host,
        port: params.port !== undefined ? Number(params.port) : options.port,
        idleExitMs: idleExitMin > 0 ? idleExitMin * 60_000 : 0,
        onIdle: () => server.stop().finally(() => process.exit(0)),
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
  start [--port N]               Start the bridge if needed and wait for the extension
  health                         Check bridge and extension status
  doctor                         Diagnostic report
  start-task [--title T] [--same-window] Start or reuse Agent task (default: dedicated window, sameWindow=false)
  claim --tabId ID               Claim explicit tab into Agent task group
  end-task [--close-group]       End active Agent task
  tabs                           List open browser tabs
  new-tab <url> [--force]        Navigate claimed tab (or create first/forced tab)
  goto <url> [--tabId ID]        Navigate claimed or task-owned tab
  close-tab <tabId>              Close specified tab
  click [--text T | --sel S | --ref N] Click element by text, selector, or ref
  fill [--sel S | --ref N] --val V Fill text into form input
  wait [--text T | --sel S | --idle] Wait for task page content or idle stability
  content [--max-chars N]        Read compact task page content
  press <key> [--sel S]          Dispatch a key event
  reload [--bypass-cache]        Reload claimed task tab
  state [--tabId ID]             Get interactive DOM elements with refs and generation
  snapshot [--tabId ID]          Get interactive DOM elements tree (alias for state)
  find [--sel S | --text T]      Find matching elements with allocated refs
  eval <script>                  Evaluate JavaScript in isolated IIFE scope
  upload <files...> [--sel S]    Set files on a file input (or --files "a.png,b.png")
  screenshot [--sel S | --ref N] [--out FILE] Capture tab or element screenshot
  net-start / net-get / net-stop Capture task tab XHR/fetch APIs
  cookies --domain DOMAIN | --url URL [--open-if-missing] [--format txt|json] [--out FILE] Extract cookies for a domain, or those a URL would send; --open-if-missing opens the site in a background window when there are none, and fails if it asks for a login
  server [--port N] [--idle-exit-min N] Run the bridge in the foreground (exits after 10 idle minutes; 0 keeps it up)

Commands that talk to the browser start the bridge automatically when it is not running.
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
    } else if (result.rawText) {
      process.stdout.write(result.rawText);
    } else if (!result.server) {
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
