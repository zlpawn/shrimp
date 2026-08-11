// CDP (Chrome DevTools Protocol) client over WebSocket.
// Talks to the Codex desktop app's remote debugging port to inject JS/CSS.

import WebSocket from "ws";
import http from "node:http";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Probe http://127.0.0.1:<port>/json for injectable Codex page targets.
async function listTargets(debugPort, { timeoutMs = 3000 } = {}) {
  const url = `http://127.0.0.1:${debugPort}/json`;
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const targets = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(targets.filter(isInjectableCodexPage));
        } catch (error) {
          reject(new Error(`failed to parse CDP target list: ${error.message}`));
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`CDP target list timed out on port ${debugPort}`));
    });
    req.on("error", reject);
  });
}

// Codex renderer pages use app://-/index.html or https://chatgpt.com URLs.
// Skip avatar-overlay and quick-chat prewarm targets.
// Mirrors CodexPlusPlus cdp.rs is_injectable_page_target + is_primary_codex_page_target.
function isInjectableCodexPage(target) {
  if (target.type !== "page") return false;
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl || typeof wsUrl !== "string") return false;
  let u;
  try {
    u = new URL(wsUrl);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTS.has(host)) return false;
  const port = Number(u.port);
  if (!Number.isInteger(port)) return false;
  const title = (target.title || "").toLowerCase();
  const pageUrl = (target.url || "").toLowerCase();
  const isCodexLike =
    title.includes("codex") ||
    pageUrl.startsWith("app://-/") ||
    (title === "chatgpt" && pageUrl.startsWith("https://chatgpt.com"));
  if (!isCodexLike) return false;
  const route = parseInitialRoute(target.url);
  if (route) {
    const r = route.toLowerCase();
    if (r === "/avatar-overlay") return false;
    if (r.startsWith("/chatgpt/quick-chat")) return false;
  }
  return true;
}

// Parse initialRoute query param from app://-/index.html URLs.
// CodexPlusPlus uses this to identify and skip overlay/prewarm targets.
function parseInitialRoute(pageUrl) {
  try {
    const u = new URL((pageUrl || "").trim());
    if (u.protocol !== "app:") return null;
    if (u.hostname !== "-") return null;
    if (u.pathname.toLowerCase() !== "/index.html") return null;
    return u.searchParams.get("initialRoute") || null;
  } catch {
    return null;
  }
}

// Wait for the CDP endpoint to become available after launching Codex.
// Polls /json until a valid Codex page target appears.
export async function waitForDebugEndpoint(debugPort, { maxWaitMs = 15000 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets(debugPort, { timeoutMs: 2000 });
      if (targets.length > 0) return targets;
    } catch {
      // endpoint not ready yet
    }
    await sleep(500);
  }
  throw new Error(
    `CDP endpoint on port ${debugPort} did not become available within ${maxWaitMs}ms`,
  );
}

// Pick the primary Codex page target (first page that is not an overlay/prewarm).
export async function pickPrimaryTarget(debugPort) {
  const targets = await listTargets(debugPort);
  if (targets.length === 0) {
    throw new Error("no injectable Codex page target found");
  }
  const ranked = targets.slice().sort((a, b) => {
    const aMain = isMainSurface(a) ? 0 : 1;
    const bMain = isMainSurface(b) ? 0 : 1;
    return aMain - bMain;
  });
  return ranked[0];
}

function isMainSurface(target) {
  const route = parseInitialRoute(target.url);
  if (!route) return true;
  const r = route.toLowerCase();
  return r !== "/avatar-overlay" && !r.startsWith("/chatgpt/quick-chat");
}

// A minimal CDP session: sends method+params, returns result, supports events.
export class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this._nextId = 1;
    this._pending = new Map();
    this._eventHandlers = new Map();
    this._enabled = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl, {
        handshakeTimeout: 5000,
        perMessageDeflate: false,
        maxPayload: 64 * 1024 * 1024,
      });
      ws.on("open", () => resolve());
      ws.on("error", reject);
      ws.on("message", (data) => this._onMessage(data));
      ws.on("close", () => {
        for (const { reject } of this._pending.values()) {
          reject(new Error("CDP WebSocket closed"));
        }
        this._pending.clear();
      });
      this.ws = ws;
    });
    // Note: Runtime.enable is called lazily in evaluate() / addScriptToNewDocuments()
    // to match CodexPlusPlus's install_bridge sequence (bridge.rs:196).
  }

  // Enable the Runtime domain before first use. CodexPlusPlus calls this
  // as the first command after connecting (bridge.rs:196).
  async _ensureEnabled() {
    if (this._enabled) return;
    await this.send("Runtime.enable", {});
    this._enabled = true;
  }

  _onMessage(data) {
    let message;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch {
      return;
    }
    if (message.id != null) {
      const pending = this._pending.get(message.id);
      if (pending) {
        this._pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(`CDP error ${message.error.code}: ${message.error.message}`),
          );
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.method) {
      const handlers = this._eventHandlers.get(message.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(message.params);
          } catch {
            // ignore handler errors
          }
        }
      }
    }
  }

  async send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("CDP session is not connected");
    }
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) {
          this._pending.delete(id);
          reject(new Error(`failed to send CDP command ${method}: ${error.message}`));
        }
      });
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`CDP command ${method} timed out`));
        }
      }, 15000);
    });
  }

  on(event, handler) {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event).add(handler);
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    await this._ensureEnabled();
    // allowUnsafeEvalBlockedByCSP is required because Codex sets a Content
    // Security Policy. Without this flag, Runtime.evaluate would be blocked.
    // CodexPlusPlus sets this in runtime_evaluate_params (bridge.rs:255).
    return this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      allowUnsafeEvalBlockedByCSP: true,
      returnByValue: true,
    });
  }

  async addScriptToNewDocuments(source) {
    await this._ensureEnabled();
    return this.send("Page.addScriptToEvaluateOnNewDocument", { source });
  }

  async close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export { listTargets, sleep };
