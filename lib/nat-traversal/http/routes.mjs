import { NatTraversalError, NAT_TRAVERSAL_ERROR_STATUS } from "../domain/errors.mjs";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function sendNatTraversalError(res, error) {
  const code = error?.code || "storage_error";
  const status = NAT_TRAVERSAL_ERROR_STATUS[code] || 500;
  sendJson(res, status, {
    error: {
      type: code,
      message: error?.message || "NAT Traversal error",
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
        reject(new NatTraversalError("invalid_request", "payload too large"));
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
        reject(new NatTraversalError("invalid_request", "invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export async function routeNatTraversalRequest(req, res, _context, reqPath, { service }) {
  try {
    const pathOnly = reqPath.split("?")[0];
    const method = req.method || "GET";

    if (pathOnly === "/v1/nat-traversal/capabilities" && method === "GET") {
      return sendJson(res, 200, await service.capabilities());
    }
    if (pathOnly === "/v1/nat-traversal/status" && method === "GET") {
      return sendJson(res, 200, await service.status());
    }
    if (pathOnly === "/v1/nat-traversal/config" && method === "GET") {
      return sendJson(res, 200, await service.getPublicConfig());
    }
    if (pathOnly === "/v1/nat-traversal/config" && method === "PUT") {
      const body = await readJson(req);
      const { secrets, ...configPatch } = body || {};
      const view = await service.updateConfig(configPatch, secrets || {});
      return sendJson(res, 200, view);
    }
    if (pathOnly === "/v1/nat-traversal/start" && method === "POST") {
      return sendJson(res, 200, await service.start());
    }
    if (pathOnly === "/v1/nat-traversal/stop" && method === "POST") {
      return sendJson(res, 200, await service.stop());
    }
    if (pathOnly === "/v1/nat-traversal/restart" && method === "POST") {
      return sendJson(res, 200, await service.restart());
    }
    if (pathOnly === "/v1/nat-traversal/peers" && method === "GET") {
      return sendJson(res, 200, { peers: await service.listPeers() });
    }
    if (pathOnly === "/v1/nat-traversal/peers" && method === "PUT") {
      const body = await readJson(req);
      const peer = await service.upsertPeer(body?.peer || body);
      return sendJson(res, 200, { peer });
    }
    if (pathOnly.startsWith("/v1/nat-traversal/peers/") && method === "DELETE") {
      const peerId = decodeURIComponent(pathOnly.slice("/v1/nat-traversal/peers/".length));
      return sendJson(res, 200, await service.deletePeer(peerId));
    }
    if (pathOnly === "/v1/nat-traversal/test-link" && method === "POST") {
      const body = await readJson(req);
      const peerId = body?.peerId || body?.id;
      return sendJson(res, 200, await service.testLink(peerId));
    }
    if (pathOnly === "/v1/nat-traversal/discover-frpc" && method === "GET") {
      return sendJson(res, 200, await service.discoverLocalFrpc());
    }
    if (pathOnly === "/v1/nat-traversal/import-frpc" && method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.importLocalFrpc(body || {}));
    }
    if (pathOnly === "/v1/nat-traversal/frps-dashboard/status" && method === "GET") {
      return sendJson(res, 200, await service.dashboardStatus());
    }
    if (pathOnly === "/v1/nat-traversal/frps-dashboard" || pathOnly.startsWith("/v1/nat-traversal/frps-dashboard/")) {
      const suffix = pathOnly === "/v1/nat-traversal/frps-dashboard"
        ? "/"
        : pathOnly.slice("/v1/nat-traversal/frps-dashboard".length) || "/";
      await service.proxyDashboard(req, res, suffix);
      return;
    }

    sendJson(res, 404, {
      error: { type: "not_found", message: `Unknown NAT Traversal route: ${pathOnly}` },
    });
  } catch (error) {
    sendNatTraversalError(res, error);
  }
}
