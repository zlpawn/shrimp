import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_BRIDGE_PORT,
  DEFAULT_BRIDGE_HOST,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_POLL_TIMEOUT_MS,
} from "./protocol.mjs";

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error(`Invalid JSON payload: ${err.message}`));
      }
    });
    req.on("error", reject);
  });
}

export class BridgeServer {
  constructor(options = {}) {
    this.port = Number(options.port || process.env.BROWSER_BRIDGE_PORT || DEFAULT_BRIDGE_PORT);
    this.host = options.host || process.env.BROWSER_BRIDGE_HOST || DEFAULT_BRIDGE_HOST;
    this.server = null;
    this.extension = null;
    this.pendingCommands = new Map(); // id -> { resolve, reject, timer, cmd }
    this.commandQueue = []; // array of { id, type, params }
    this.waitingPolls = []; // array of { res, timer }
  }

  isExtensionOnline() {
    if (!this.extension || !this.extension.lastSeen) return false;
    return Date.now() - this.extension.lastSeen < 60_000;
  }

  async start() {
    if (this.server) return this.port;

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          res.end();
          return;
        }

        try {
          const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
          const pathname = url.pathname;

          if (req.method === "GET" && pathname === "/health") {
            const now = Date.now();
            const lastSeenMs = this.extension?.lastSeen ? now - this.extension.lastSeen : -1;
            return sendJson(res, 200, {
              ok: true,
              bridge: true,
              port: this.port,
              extensionOnline: this.isExtensionOnline(),
              lastSeenMs,
            });
          }

          if (req.method === "GET" && pathname === "/doctor") {
            const now = Date.now();
            return sendJson(res, 200, {
              ok: true,
              bridge: {
                online: true,
                port: this.port,
                host: this.host,
                pendingCommandsCount: this.pendingCommands.size,
                waitingPollsCount: this.waitingPolls.length,
              },
              extension: {
                online: this.isExtensionOnline(),
                info: this.extension,
                lastSeenAgoMs: this.extension?.lastSeen ? now - this.extension.lastSeen : null,
              },
            });
          }

          if (req.method === "POST" && pathname === "/cmd") {
            const body = await parseJsonBody(req);
            const { type, params = {}, timeoutMs } = body;
            if (!type) {
              return sendJson(res, 400, { ok: false, error: "Missing required parameter 'type'" });
            }
            try {
              const result = await this.dispatch(type, params, timeoutMs);
              return sendJson(res, 200, { ok: true, result });
            } catch (err) {
              return sendJson(res, 500, { ok: false, error: err.message });
            }
          }

          if (req.method === "POST" && pathname === "/ext/hello") {
            const body = await parseJsonBody(req);
            this.extension = {
              id: body.id || "unknown",
              name: body.name || "Chrome Extension",
              version: body.version || "1.0.0",
              capabilities: body.capabilities || ["cookies", "tabs", "dom", "cdp"],
              lastSeen: Date.now(),
            };
            return sendJson(res, 200, { ok: true, status: "registered" });
          }

          if (req.method === "POST" && pathname === "/ext/heartbeat") {
            if (this.extension) {
              this.extension.lastSeen = Date.now();
            } else {
              this.extension = { id: "unknown", lastSeen: Date.now() };
            }
            return sendJson(res, 200, { ok: true });
          }

          if (req.method === "GET" && (pathname === "/ext/poll" || pathname === "/v1/extension-tasks/claim")) {
            if (this.extension) {
              this.extension.lastSeen = Date.now();
            }

            // Check if there is already a queued command
            if (this.commandQueue.length > 0) {
              const cmd = this.commandQueue.shift();
              return sendJson(res, 200, { ok: true, cmd, tasks: [cmd] });
            }

            const waitMs = Math.min(
              Number(url.searchParams.get("waitMs")) || DEFAULT_POLL_TIMEOUT_MS,
              30_000
            );

            const pollEntry = { res, timer: null };
            pollEntry.timer = setTimeout(() => {
              const idx = this.waitingPolls.indexOf(pollEntry);
              if (idx !== -1) {
                this.waitingPolls.splice(idx, 1);
                sendJson(res, 200, { ok: true, cmd: null, tasks: [] });
              }
            }, waitMs);

            this.waitingPolls.push(pollEntry);
            return;
          }

          if (req.method === "POST" && (pathname === "/ext/result" || pathname.startsWith("/v1/extension-tasks/"))) {
            const body = await parseJsonBody(req);
            let cmdId = body.id || body.task_id;
            if (!cmdId && pathname.includes("/complete")) {
              const match = pathname.match(/\/v1\/extension-tasks\/([^/]+)\/complete/);
              if (match) cmdId = decodeURIComponent(match[1]);
            } else if (!cmdId && pathname.includes("/fail")) {
              const match = pathname.match(/\/v1\/extension-tasks\/([^/]+)\/fail/);
              if (match) cmdId = decodeURIComponent(match[1]);
            }

            if (this.extension) {
              this.extension.lastSeen = Date.now();
            }

            if (!cmdId || !this.pendingCommands.has(cmdId)) {
              return sendJson(res, 200, { ok: true, message: "No active pending command found for id" });
            }

            const pending = this.pendingCommands.get(cmdId);
            this.pendingCommands.delete(cmdId);
            clearTimeout(pending.timer);

            if (body.ok === false || body.error) {
              pending.reject(new Error(body.error?.message || body.error || "Command execution failed"));
            } else {
              pending.resolve(body.result !== undefined ? body.result : body);
            }
            return sendJson(res, 200, { ok: true });
          }

          return sendJson(res, 404, { ok: false, error: "Not Found" });
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: err.message });
        }
      });

      server.on("error", (err) => {
        reject(err);
      });

      server.listen(this.port, this.host, () => {
        this.server = server;
        resolve(this.port);
      });
    });
  }

  async dispatch(type, params = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    if (!this.isExtensionOnline() && this.waitingPolls.length === 0) {
      // If extension never registered or is stale, throw friendly error
      throw new Error("Chrome extension is offline. Please ensure the extension is loaded in Chrome.");
    }

    const id = `cmd_${randomUUID().slice(0, 8)}`;
    const cmd = { id, type, params, createdAt: Date.now() };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        const qIdx = this.commandQueue.findIndex((c) => c.id === id);
        if (qIdx !== -1) this.commandQueue.splice(qIdx, 1);
        reject(new Error(`Command '${type}' (${id}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingCommands.set(id, { resolve, reject, timer, cmd });

      // Deliver immediately to waiting long-poll if available
      if (this.waitingPolls.length > 0) {
        const pollEntry = this.waitingPolls.shift();
        clearTimeout(pollEntry.timer);
        sendJson(pollEntry.res, 200, { ok: true, cmd, tasks: [cmd] });
      } else {
        this.commandQueue.push(cmd);
      }
    });
  }

  async stop() {
    // Clear all pending commands
    for (const [id, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("BridgeServer stopped"));
    }
    this.pendingCommands.clear();
    this.commandQueue = [];

    // Clear all waiting polls
    for (const pollEntry of this.waitingPolls) {
      clearTimeout(pollEntry.timer);
      sendJson(pollEntry.res, 200, { ok: true, cmd: null, tasks: [] });
    }
    this.waitingPolls = [];

    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server.close((err) => {
          this.server = null;
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
}
