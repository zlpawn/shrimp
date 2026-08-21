import { RemoteSessionError, REMOTE_SESSION_ERROR_STATUS } from "../domain/errors.mjs";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function sendRemoteSessionError(res, error) {
  const code = error?.code || "storage_error";
  const status = REMOTE_SESSION_ERROR_STATUS[code] || 500;
  sendJson(res, status, {
    error: {
      type: code,
      message: error?.message || "Remote Session error",
      details: error?.details,
    },
  });
}

function readJson(req, { maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new RemoteSessionError("invalid_request", "payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new RemoteSessionError("invalid_request", "invalid JSON body"));
      }
    });
    req.on("error", (error) => {
      reject(new RemoteSessionError("invalid_request", error.message || String(error)));
    });
  });
}

function getQuery(reqPath, req = null) {
  const full = String(req?.url || reqPath || "");
  const idx = full.indexOf("?");
  if (idx < 0) return new URLSearchParams();
  return new URLSearchParams(full.slice(idx + 1));
}

function pathOnlyOf(reqPath, req = null) {
  const full = String(reqPath || req?.url || "");
  return full.split("?")[0];
}

async function writeSse(res, service, sessionId, cursor, options = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  let closed = false;
  res.on?.("close", () => {
    closed = true;
  });
  try {
    for await (const event of service.subscribe({
      sessionId,
      cursor,
      includeHostEvents: Boolean(options.includeHostEvents),
    })) {
      if (closed || res.destroyed) break;
      res.write("id: " + event.seq + "\n");
      res.write("event: session_event\n");
      res.write("data: " + JSON.stringify(event) + "\n\n");
    }
  } finally {
    if (!res.destroyed) res.end();
  }
}

export async function routeRemoteSessionRequest(req, res, _context, reqPath, { service }) {
  try {
    const pathOnly = pathOnlyOf(reqPath, req);
    const method = req.method || "GET";
    const query = getQuery(reqPath, req);

    if (pathOnly === "/v1/remote-session/capabilities" && method === "GET") {
      const status = await service.status();
      return sendJson(res, 200, {
        enabled: Boolean(status.enabled),
        natTraversalEnabled: Boolean(status.natTraversalEnabled),
        features: {
          localHost: true,
          peerProxy: true,
          approvals: true,
          eventStream: true,
        },
      });
    }

    if (pathOnly === "/v1/remote-session/status" && method === "GET") {
      return sendJson(res, 200, await service.status());
    }

    if (pathOnly === "/v1/remote-session/config" && method === "GET") {
      return sendJson(res, 200, await service.getPublicConfig());
    }

    if (pathOnly === "/v1/remote-session/config" && method === "PUT") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.updateConfig(body || {}));
    }

    if (pathOnly === "/v1/remote-session/peers" && method === "GET") {
      return sendJson(res, 200, { peers: await service.listPeers() });
    }

    if (pathOnly === "/v1/remote-session/peers" && method === "PUT") {
      const body = await readJson(req);
      const peer = await service.upsertPeer(body?.peer || body);
      return sendJson(res, 200, { peer });
    }

    if (pathOnly.startsWith("/v1/remote-session/peers/") && method === "DELETE") {
      const peerId = decodeURIComponent(pathOnly.slice("/v1/remote-session/peers/".length));
      return sendJson(res, 200, await service.deletePeer(peerId));
    }

    if (pathOnly === "/v1/remote-session/projects" && method === "GET") {
      const peerId = query.get("peerId");
      if (!peerId) {
        return sendJson(res, 200, { projects: [] });
      }
      return sendJson(res, 200, { projects: await service.listProjects(peerId) });
    }

    if (pathOnly === "/v1/remote-session/conversations" && method === "GET") {
      const peerId = query.get("peerId");
      if (!peerId) {
        return sendJson(res, 200, { conversations: [] });
      }
      const limit = Number(query.get("limit") || 20);
      return sendJson(res, 200, {
        conversations: await service.listConversations(peerId, { limit }),
      });
    }

    if (pathOnly === "/v1/remote-session/models" && method === "GET") {
      const peerId = query.get("peerId");
      if (!peerId) {
        return sendJson(res, 200, { models: [] });
      }
      return sendJson(res, 200, {
        models: await service.listAvailableModels(peerId),
      });
    }

    const conversationInspectMatch = pathOnly.match(
      /^\/v1\/remote-session\/conversations\/([^/]+)$/,
    );
    if (conversationInspectMatch && method === "GET") {
      const conversationId = decodeURIComponent(conversationInspectMatch[1]);
      const peerId = query.get("peerId") || "local-host";
      return sendJson(res, 200, {
        ok: true,
        conversation: await service.inspectConversation(peerId, conversationId),
      });
    }

    if (pathOnly === "/v1/remote-session/sessions" && method === "POST") {
      const body = await readJson(req);
      const session = await service.openSession({
        peerId: body?.peerId || "local-host",
        projectId: body?.projectId,
        conversationId: body?.conversationId,
        controllerPeerId: body?.controllerPeerId || "controller",
        model: body?.model,
        modelAlias: body?.modelAlias,
        cascadeConfig: body?.cascadeConfig,
      });
      return sendJson(res, 200, { session });
    }

    const sessionMatch = pathOnly.match(/^\/v1\/remote-session\/sessions\/([^/]+)(.*)$/);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const rest = sessionMatch[2] || "";

      if (rest === "" && method === "GET") {
        return sendJson(res, 200, { session: await service.getSession(sessionId) });
      }

      if (rest === "/prompt" && method === "POST") {
        const body = await readJson(req);
        const result = await service.dispatchPrompt({
          sessionId,
          prompt: body?.prompt,
          controllerPeerId: body?.controllerPeerId || "controller",
          model: body?.model,
          modelAlias: body?.modelAlias,
          cascadeConfig: body?.cascadeConfig,
        });
        return sendJson(res, 200, result);
      }

      const approvalMatch = rest.match(/^\/approvals?\/([^/]+)$/);
      if ((approvalMatch || rest === "/approval") && method === "POST") {
        const body = await readJson(req);
        const approvalId = approvalMatch ? decodeURIComponent(approvalMatch[1]) : body?.approvalId;
        const result = await service.decideApproval({
          sessionId,
          approvalId,
          decision: body?.decision,
          controllerPeerId: body?.controllerPeerId || "controller",
        });
        return sendJson(res, 200, result);
      }

      if (rest === "/events" && method === "GET") {
        const cursor = Number(query.get("cursor") || 0);
        return sendJson(res, 200, await service.listEvents({ sessionId, cursor }));
      }

      if ((rest === "/stream" || rest === "/events/stream") && method === "GET") {
        const cursor = Number(query.get("cursor") || 0);
        const includeHostEvents = query.get("includeHostEvents") === "true";
        await writeSse(res, service, sessionId, cursor, { includeHostEvents });
        return;
      }

      if (rest === "/disconnect" && method === "POST") {
        return sendJson(res, 200, { session: await service.markDisconnected({ sessionId }) });
      }

      if (rest === "/resume" && method === "POST") {
        const body = await readJson(req);
        const result = await service.resumeSession({
          sessionId,
          controllerPeerId: body?.controllerPeerId || "controller",
          cursor: Number(body?.cursor || 0),
        });
        return sendJson(res, 200, result);
      }

      if (rest === "/end" && method === "POST") {
        const body = await readJson(req);
        const session = await service.endSession({
          sessionId,
          controllerPeerId: body?.controllerPeerId || "controller",
        });
        return sendJson(res, 200, { session });
      }
    }

    sendJson(res, 404, {
      error: { type: "not_found", message: "Unknown Remote Session route: " + pathOnly },
    });
  } catch (error) {
    sendRemoteSessionError(res, error);
  }
}
