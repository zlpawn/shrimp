/**
 * Runtime CDP client: pure target rules + dependency-injected transport.
 * Importing this module must never open sockets or spawn processes.
 */

import WebSocket from "ws";
import { DreamSkinError } from "../domain/errors.mjs";

// --- Pure URL/target rules ---

export function parseInitialRoute(pageUrl) {
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

export function isLoopbackWebSocketUrl(wsUrl) {
  if (typeof wsUrl !== "string" || !wsUrl) return false;
  let u;
  try {
    u = new URL(wsUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) return false;
  if (u.port) {
    const port = Number(u.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  }
  if (u.username || u.password) return false;
  return true;
}

export function isInjectableCodexPage(target) {
  if (!target || target.type !== "page") return false;
  const wsUrl = target.webSocketDebuggerUrl;
  if (!isLoopbackWebSocketUrl(wsUrl)) return false;
  const title = (target.title || "").toLowerCase();
  const pageUrl = (target.url || "").toLowerCase();
  const hasCodexTitle = title.includes("codex");
  const hasDesktopTitle = hasCodexTitle || title === "chatgpt";
  const isCodexLike =
    (hasDesktopTitle && (
      pageUrl.startsWith("app://-/") ||
      pageUrl.startsWith("https://chatgpt.com")
    ));
  if (!isCodexLike) return false;
  const route = parseInitialRoute(target.url);
  if (route) {
    const r = route.toLowerCase();
    if (r === "/avatar-overlay") return false;
    if (r.startsWith("/chatgpt/quick-chat")) return false;
  }
  return true;
}

export function rankCodexTargets(targets) {
  return targets
    .filter(isInjectableCodexPage)
    .sort((a, b) => {
      const aMain = isMainSurface(a) ? 0 : 1;
      const bMain = isMainSurface(b) ? 0 : 1;
      return aMain - bMain;
    });
}

function isMainSurface(target) {
  const route = parseInitialRoute(target.url);
  if (!route) return true;
  const r = route.toLowerCase();
  return r !== "/avatar-overlay" && !r.startsWith("/chatgpt/quick-chat");
}

export function buildCdpCommand(id, method, params = {}) {
  return JSON.stringify({ id, method, params });
}

export function parseCdpMessage(data) {
  try {
    const parsed = JSON.parse(data.toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

// --- Target client (HTTP /json) ---

export function createTargetClient({ requestJson, sleep, clock = () => Date.now() }) {
  async function listTargets(debugPort, { timeoutMs = 3000 } = {}) {
    if (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535) {
      throw new DreamSkinError("invalid_request", `invalid debug port: ${debugPort}`);
    }
    const url = `http://127.0.0.1:${debugPort}/json`;
    const data = await requestJson(url, { timeoutMs });
    if (!Array.isArray(data)) {
      throw new DreamSkinError("market_unavailable", "CDP target list is not an array");
    }
    return data;
  }

  async function waitForDebugEndpoint(debugPort, { maxWaitMs = 15000 } = {}) {
    const deadline = clock() + maxWaitMs;
    let lastError = null;
    while (clock() < deadline) {
      try {
        const targets = await listTargets(debugPort, { timeoutMs: 2000 });
        const injectable = rankCodexTargets(targets);
        if (injectable.length > 0) return injectable;
      } catch (err) {
        lastError = err;
      }
      if (sleep) await sleep(500);
    }
    throw new DreamSkinError(
      "market_unavailable",
      `CDP endpoint on port ${debugPort} did not become available within ${maxWaitMs}ms`,
    );
  }

  async function pickPrimaryTarget(debugPort) {
    const targets = await listTargets(debugPort);
    const ranked = rankCodexTargets(targets);
    if (ranked.length === 0) {
      throw new DreamSkinError("market_unavailable", "no injectable Codex page target found");
    }
    return ranked[0];
  }

  return { listTargets, waitForDebugEndpoint, pickPrimaryTarget };
}

// --- CDP session (WebSocket) ---

export function createCdpSession({ createWebSocket = (url) => new WebSocket(url), wsUrl, commandTimeoutMs = 15000 }) {
  const session = {
    ws: null,
    _nextId: 1,
    _pending: new Map(),
    _eventHandlers: new Map(),
    _enabled: false,
  };

  async function connect() {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = createWebSocket(wsUrl);
      } catch (err) {
        reject(err);
        return;
      }
      ws.on("open", () => resolve());
      ws.on("error", reject);
      ws.on("message", (data) => {
        const message = parseCdpMessage(data);
        if (!message) return;
        if (message.id != null) {
          const pending = session._pending.get(message.id);
          if (pending) {
            session._pending.delete(message.id);
            if (message.error) {
              pending.reject(new DreamSkinError("market_unavailable", `CDP error ${message.error.code}: ${message.error.message}`));
            } else {
              pending.resolve(message.result);
            }
          }
        } else if (message.method) {
          const handlers = session._eventHandlers.get(message.method);
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
      });
      ws.on("close", () => {
        for (const { reject } of session._pending.values()) {
          reject(new DreamSkinError("market_unavailable", "CDP WebSocket closed"));
        }
        session._pending.clear();
      });
      session.ws = ws;
    });
  }

  async function _ensureEnabled() {
    if (session._enabled) return;
    await send("Runtime.enable", {});
    session._enabled = true;
  }

  function send(method, params = {}) {
    if (!session.ws || session.ws.readyState !== 1) {
      return Promise.reject(new DreamSkinError("market_unavailable", "CDP session is not connected"));
    }
    const id = session._nextId++;
    return new Promise((resolve, reject) => {
      session._pending.set(id, { resolve, reject });
      session.ws.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) {
          session._pending.delete(id);
          reject(new DreamSkinError("market_unavailable", `failed to send CDP command ${method}: ${error.message}`));
        }
      });
      setTimeout(() => {
        if (session._pending.has(id)) {
          session._pending.delete(id);
          reject(new DreamSkinError("market_unavailable", `CDP command ${method} timed out`));
        }
      }, commandTimeoutMs);
    });
  }

  async function enableRuntime() {
    await _ensureEnabled();
  }

  async function evaluate(expression, options = {}) {
    await _ensureEnabled();
    return send("Runtime.evaluate", {
      expression,
      awaitPromise: Boolean(options.awaitPromise),
      allowUnsafeEvalBlockedByCSP: true,
      returnByValue: true,
    });
  }

  async function addScriptToNewDocuments(source) {
    await _ensureEnabled();
    return send("Page.addScriptToEvaluateOnNewDocument", { source });
  }

  async function removeScriptFromNewDocuments(identifier) {
    if (!identifier || typeof identifier !== "string") {
      throw new DreamSkinError("invalid_request", "new-document script identifier is required");
    }
    return send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  }

  function on(event, handler) {
    if (!session._eventHandlers.has(event)) {
      session._eventHandlers.set(event, new Set());
    }
    session._eventHandlers.get(event).add(handler);
  }

  function close() {
    if (session.ws) {
      session.ws.close();
      session.ws = null;
    }
  }

  return {
    connect,
    send,
    enableRuntime,
    evaluate,
    addScriptToNewDocuments,
    removeScriptFromNewDocuments,
    on,
    close,
  };
}
