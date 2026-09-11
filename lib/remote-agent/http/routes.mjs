import { RemoteAgentError } from "../domain/errors.mjs";
import { handleDifyChatMessages } from "../adapters/dify.mjs";

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

export async function routeRemoteAgentRequest(req, res, reqPath, { service, configService } = {}) {
  try {
    if (!service) throw new Error("service is required");
    const method = req.method || "GET";
    const pathOnly = String(reqPath || "").split("?")[0];

    if (pathOnly === "/v1/remote-agent/health" && method === "GET") {
      return sendJson(res, 200, { ok: true, service: "remote-agent" });
    }

    if (pathOnly === "/v1/remote-agent/status" && method === "GET") {
      if (!configService) throw new Error("configService is required");
      return sendJson(res, 200, await configService.getStatus());
    }

    if (pathOnly === "/v1/remote-agent/token/rotate" && method === "POST") {
      if (!configService) throw new Error("configService is required");
      await readJson(req);
      return sendJson(res, 200, await configService.rotateToken());
    }


    if (pathOnly === "/v1/remote-agent/policy" && method === "POST") {
      if (!configService) throw new Error("configService is required");
      const body = await readJson(req);
      return sendJson(res, 200, await configService.setPolicyMode(body?.policyMode || ""));
    }

    if (pathOnly === "/v1/remote-agent/webhook" && method === "POST") {
      if (!configService) throw new Error("configService is required");
      const body = await readJson(req);
      return sendJson(res, 200, await configService.setWebhookUrl(body?.webhookUrl || ""));
    }

    const unbindMatch = pathOnly.match(/^\/v1\/remote-agent\/bindings\/([^/]+)$/);
    if (unbindMatch && method === "DELETE") {
      if (!configService) throw new Error("configService is required");
      const bindingKey = decodeURIComponent(unbindMatch[1]);
      return sendJson(res, 200, await configService.clearBinding(bindingKey));
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

export async function routeDifyCompatibleRequest(req, res, reqPath, { service } = {}) {
  try {
    if (!service) throw new Error("service is required");
    const method = req.method || "GET";
    const pathOnly = String(reqPath || "").split("?")[0];

    if (pathOnly === "/dify/v1/chat-messages" && method === "POST") {
      const body = await readJson(req);
      const result = await handleDifyChatMessages(service, req, body);
      res.writeHead(result.status, {
        "Content-Type": result.contentType,
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      if (result.stream) {
        for await (const chunk of result.stream) {
          res.write(chunk);
        }
        res.end();
      } else {
        res.end(result.body);
      }
      return;
    }

    return sendJson(res, 404, {
      ok: false,
      error: { type: "not_found", message: "Unknown dify-compatible route: " + pathOnly },
      reply: "未知的 Dify 兼容接口。",
    });
  } catch (error) {
    if (error instanceof RemoteAgentError) {
      return sendJson(res, error.status || 400, errorBody(error));
    }
    const validation = /required|Invalid JSON|Payload too large|chatType|streaming/.test(error?.message || "");
    return sendJson(res, validation ? 400 : 500, errorBody({
      type: validation ? "invalid_request" : "internal_error",
      message: error?.message || "Dify compatible error",
      reply: error?.message || "Dify 兼容入口失败。",
    }));
  }
}
