import { NatTraversalError, NAT_TRAVERSAL_ERROR_STATUS } from "../domain/errors.mjs";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function sendNatTraversalError(res, error, req = null) {
  const code = error?.code || "storage_error";
  const status = NAT_TRAVERSAL_ERROR_STATUS[code] || 500;
  const message = error?.message || "NAT Traversal error";
  const accept = String(req?.headers?.accept || "");
  if (code === "dashboard_unauthorized" && accept.includes("text/html")) {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Dashboard Unauthorized</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 16px;line-height:1.6;color:#111}
code{background:#f4f4f5;padding:2px 6px;border-radius:6px}</style></head>
<body><h1>Dashboard 未授权</h1><p>${message.replace(/</g, "&lt;")}</p>
<p>如果 frps 开启了 Dashboard 鉴权，请回到管理台填写用户名/密码并保存后再打开；未开启鉴权可留空。</p>
<p><a href="/config#nat-traversal">返回内网穿透管理台</a></p></body></html>`);
    return;
  }
  sendJson(res, status, {
    error: {
      type: code,
      message,
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
    if (pathOnly === "/v1/nat-traversal/ensure-link" && method === "POST") {
      const body = await readJson(req);
      const peerId = body?.peerId || body?.id;
      return sendJson(res, 200, await service.ensureLink(peerId));
    }
    if (pathOnly === "/v1/nat-traversal/open-service" && method === "POST") {
      const body = await readJson(req);
      const peerId = body?.peerId || body?.id;
      const serviceName = body?.service || body?.serviceName;
      return sendJson(res, 200, await service.openService(peerId, serviceName));
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
    if (pathOnly === "/v1/nat-traversal/dashboard/proxies" && method === "GET") {
      return sendJson(res, 200, await service.fetchDashboardProxies());
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
    sendNatTraversalError(res, error, req);
  }
}
