import { CODEXHOST_ERROR_STATUS, CodexhostIntegrationError } from "./errors.mjs";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJson(req, { maxBytes = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new CodexhostIntegrationError("invalid_request", "Payload too large"));
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new CodexhostIntegrationError("invalid_request", "Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

export async function routeCodexhostRequest(req, res, reqPath, { service }) {
  try {
    if (!service) throw new Error("service is required");
    const pathOnly = String(reqPath || "").split("?")[0];
    const method = req.method || "GET";
    if (pathOnly === "/v1/cli-tools/codexhost/status" && method === "GET") {
      return sendJson(res, 200, await service.getStatus());
    }
    if (pathOnly === "/v1/cli-tools/codexhost/start" && method === "POST") {
      return sendJson(res, 200, await service.start(await readJson(req)));
    }
    if (pathOnly === "/v1/cli-tools/codexhost/stop" && method === "POST") {
      return sendJson(res, 200, await service.stop(await readJson(req)));
    }
    if (pathOnly === "/v1/cli-tools/codexhost/open-official" && method === "POST") {
      return sendJson(res, 200, await service.openOfficial(await readJson(req)));
    }
    return sendJson(res, 404, { error: { type: "not_found", message: `Unknown codexhost route: ${pathOnly}` } });
  } catch (error) {
    const status = error instanceof CodexhostIntegrationError ? (CODEXHOST_ERROR_STATUS[error.code] || 500) : 500;
    return sendJson(res, status, {
      error: {
        type: error?.code || "internal_error",
        message: error?.message || "codexhost integration error",
        details: error?.details || null,
      },
    });
  }
}
