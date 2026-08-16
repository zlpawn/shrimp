import { McpManagementError, MCP_MANAGEMENT_ERROR_STATUS } from "../domain/errors.mjs";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJson(req, { maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new McpManagementError("invalid_request", "payload too large"));
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
        reject(new McpManagementError("invalid_request", "invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export function sendMcpManagementError(res, error) {
  const code = error?.code || "storage_error";
  const status = MCP_MANAGEMENT_ERROR_STATUS[code] || 500;
  sendJson(res, status, {
    error: {
      type: code,
      message: error?.message || "MCP Management error",
      details: error?.details,
    },
  });
}

export async function routeMcpManagementRequest(req, res, _context, reqPath, { service }) {
  try {
    if (!service) throw new Error("service is required");
    const pathOnly = String(reqPath || "").split("?")[0];
    const method = req.method || "GET";

    if (pathOnly === "/v1/mcp-management/state" && method === "GET") {
      return sendJson(res, 200, await service.state());
    }
    if (pathOnly === "/v1/mcp-management/scan" && method === "GET") {
      return sendJson(res, 200, await service.scan());
    }
    if (pathOnly === "/v1/mcp-management/servers" && method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.upsertServer(body || {}));
    }
    const serverMatch = pathOnly.match(/^\/v1\/mcp-management\/servers\/([^/]+)$/);
    if (serverMatch && method === "DELETE") {
      return sendJson(res, 200, await service.deleteServer(decodeURIComponent(serverMatch[1])));
    }
    const serverPreviewMatch = pathOnly.match(/^\/v1\/mcp-management\/servers\/([^/]+)\/preview$/);
    if (serverPreviewMatch && method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.preview({ ...(body || {}), serverName: decodeURIComponent(serverPreviewMatch[1]) }));
    }
    const serverApplyMatch = pathOnly.match(/^\/v1\/mcp-management\/servers\/([^/]+)\/apply$/);
    if (serverApplyMatch && method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.apply({ ...(body || {}), serverName: decodeURIComponent(serverApplyMatch[1]) }));
    }
    if (pathOnly === "/v1/mcp-management/preview" && method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.preview(body || {}));
    }
    if (pathOnly === "/v1/mcp-management/apply" && method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.apply(body || {}));
    }
    if (pathOnly === "/v1/mcp-management/client-path" && method === "PUT") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.setClientPath(body || {}));
    }
    return sendJson(res, 404, {
      error: { type: "not_found", message: "Unknown MCP Management route: " + pathOnly },
    });
  } catch (error) {
    sendMcpManagementError(res, error);
  }
}

