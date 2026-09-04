import { CommandAppsError, COMMAND_APPS_ERROR_STATUS } from "../domain/errors.mjs";

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
        reject(new CommandAppsError("invalid_request", "Payload too large"));
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
        reject(new CommandAppsError("invalid_request", "Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export function sendCommandAppsError(res, error) {
  if (error instanceof CommandAppsError) {
    sendJson(res, COMMAND_APPS_ERROR_STATUS[error.code] || 500, {
      error: { type: error.code, message: error.message, details: error.details },
    });
    return;
  }
  sendJson(res, 500, {
    error: { type: "internal_error", message: error?.message || "Command Apps error" },
  });
}

export async function routeCommandAppsRequest(req, res, _context, reqPath, { service }) {
  try {
    if (!service) throw new Error("service is required");
    const pathOnly = String(reqPath || "").split("?")[0];
    const method = req.method || "GET";
    const launchMatch = pathOnly.match(/^\/v1\/command-apps\/apps\/([^/]+)\/launch$/);
    const restartMatch = pathOnly.match(/^\/v1\/command-apps\/apps\/([^/]+)\/restart$/);
    const stopMatch = pathOnly.match(/^\/v1\/command-apps\/apps\/([^/]+)\/stop$/);
    const discoverMatch = pathOnly.match(/^\/v1\/command-apps\/apps\/([^/]+)\/discover$/);
    const configMatch = pathOnly.match(/^\/v1\/command-apps\/apps\/([^/]+)\/config$/);
    const appMatch = pathOnly.match(/^\/v1\/command-apps\/apps\/([^/]+)$/);
    const isControlPlaneRoute = pathOnly === "/v1/command-apps/hindsight/control-plane";
    const isHindsightToolRoute = pathOnly === "/v1/command-apps/hindsight/tool";
    const isHindsightInstallRoute = pathOnly === "/v1/command-apps/hindsight/install";
    const isHindsightUpdateRoute = pathOnly === "/v1/command-apps/hindsight/update";

    if (pathOnly === "/v1/command-apps/status" && method === "GET") {
      return sendJson(res, 200, await service.getStatus("antigravity"));
    }
    if (pathOnly === "/v1/command-apps/apps" && method === "GET") {
      return sendJson(res, 200, { apps: await service.listApps() });
    }
    if (pathOnly === "/v1/command-apps/discover" && method === "GET") {
      await service.discover("antigravity");
      return sendJson(res, 200, await service.getStatus("antigravity"));
    }
    if (discoverMatch && (method === "GET" || method === "POST")) {
      const appId = decodeURIComponent(discoverMatch[1]);
      await service.discover(appId);
      return sendJson(res, 200, await service.getStatus(appId));
    }
    if ((launchMatch || restartMatch) && method === "POST") {
      const appId = decodeURIComponent((launchMatch || restartMatch)[1]);
      await readJson(req);
      return sendJson(res, 200, await service.launch(appId));
    }
    if (isControlPlaneRoute && method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.openHindsightControlPlane(body || {}));
    }
    if (isHindsightToolRoute && method === "GET") {
      return sendJson(res, 200, await service.getHindsightToolStatus());
    }
    if (isHindsightInstallRoute && method === "POST") {
      await readJson(req);
      return sendJson(res, 200, await service.installHindsightTool());
    }
    if (isHindsightUpdateRoute && method === "POST") {
      await readJson(req);
      return sendJson(res, 200, await service.updateHindsightTool());
    }
    if (stopMatch && method === "POST") {
      await readJson(req);
      return sendJson(res, 200, await service.stop(decodeURIComponent(stopMatch[1])));
    }
    if (configMatch && method === "PUT") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.updateConfig(
        decodeURIComponent(configMatch[1]),
        body || {},
      ));
    }
    if (appMatch && method === "GET") {
      return sendJson(res, 200, await service.getStatus(decodeURIComponent(appMatch[1])));
    }
    return sendJson(res, 404, {
      error: { type: "not_found", message: `Unknown Command Apps route: ${pathOnly}` },
    });
  } catch (error) {
    sendCommandAppsError(res, error);
  }
}
