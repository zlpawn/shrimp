import { RemoteAgentError } from "../domain/errors.mjs";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function errorBody(error) {
  const type = error?.type || (/required|Invalid JSON|Payload too large|chatType/.test(error?.message || "")
    ? "invalid_request"
    : "internal_error");
  const message = error?.message || "Remote agent error";
  const reply = error?.reply || message;
  return {
    ok: false,
    error: { type, message },
    reply,
  };
}

export async function routeRemoteAgentRequest(req, res, reqPath, { service } = {}) {
  try {
    if (!service) throw new Error("service is required");
    const method = req.method || "GET";
    const pathOnly = String(reqPath || "").split("?")[0];

    if (pathOnly === "/v1/remote-agent/health" && method === "GET") {
      return sendJson(res, 200, { ok: true, service: "remote-agent" });
    }

    if (pathOnly === "/v1/remote-agent/message" && method === "POST") {
      const body = await readJson(req);
      const result = await service.handleMessage(body, {
        authorization: req.headers?.authorization || "",
      });
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, {
      ok: false,
      error: { type: "not_found", message: "Unknown remote-agent route: " + pathOnly },
      reply: "未知的远程会话投递接口。",
    });
  } catch (error) {
    if (error instanceof RemoteAgentError) {
      return sendJson(res, error.status || 400, errorBody(error));
    }
    const validation = /required|Invalid JSON|Payload too large|chatType/.test(error?.message || "");
    return sendJson(res, validation ? 400 : 500, errorBody({
      type: validation ? "invalid_request" : "internal_error",
      message: error?.message || "Remote agent error",
      reply: error?.message || "远程会话投递失败。",
    }));
  }
}
