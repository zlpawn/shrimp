import {
  OfficialRemoteLinkError,
  OFFICIAL_REMOTE_LINK_ERROR_STATUS,
} from "../domain/errors.mjs";

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
        reject(new OfficialRemoteLinkError("invalid_request", "Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new OfficialRemoteLinkError("invalid_request", "Invalid JSON body"));
      }
    });
    req.on("error", (error) => reject(new OfficialRemoteLinkError("invalid_request", error.message)));
  });
}

export function sendOfficialRemoteLinkError(res, error) {
  if (error instanceof OfficialRemoteLinkError) {
    return sendJson(res, OFFICIAL_REMOTE_LINK_ERROR_STATUS[error.code] || 500, {
      error: { type: error.code, message: error.message, details: error.details },
    });
  }
  sendJson(res, 500, {
    error: { type: "internal_error", message: error?.message || "Official remote link error" },
  });
}

export async function routeOfficialRemoteLinkRequest(req, res, _context, reqPath, { service }) {
  try {
    if (!service) throw new Error("service is required");
    const pathOnly = String(reqPath || "").split("?")[0];
    const method = req.method || "GET";
    const linkMatch = pathOnly.match(/^\/v1\/remote-session\/official-links\/([^/]+)(\/frame-policy)?$/);

    if (pathOnly === "/v1/remote-session/official-links" && method === "GET") {
      return sendJson(res, 200, { links: await service.list() });
    }
    if (pathOnly === "/v1/remote-session/official-links" && method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, { link: await service.create(body || {}) });
    }
    if (linkMatch && !linkMatch[2] && method === "PUT") {
      const body = await readJson(req);
      return sendJson(res, 200, { link: await service.update(decodeURIComponent(linkMatch[1]), body || {}) });
    }
    if (linkMatch && !linkMatch[2] && method === "DELETE") {
      return sendJson(res, 200, await service.delete(decodeURIComponent(linkMatch[1])));
    }
    if (linkMatch?.[2] === "/frame-policy" && method === "GET") {
      return sendJson(res, 200, await service.checkFramePolicy(decodeURIComponent(linkMatch[1])));
    }
    return sendJson(res, 404, {
      error: { type: "not_found", message: "Unknown Official Remote Link route: " + pathOnly },
    });
  } catch (error) {
    sendOfficialRemoteLinkError(res, error);
  }
}
