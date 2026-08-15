function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", chunk => {
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
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

export async function routeSessionKanbanRequest(req, res, reqPath, { service } = {}) {
  try {
    if (!service) throw new Error("service is required");
    const method = req.method || "GET";
    const pathOnly = String(reqPath || "").split("?")[0];

    if (pathOnly === "/v1/session-kanban/board" && method === "GET") {
      return sendJson(res, 200, await service.board());
    }
    if (pathOnly === "/v1/session-kanban/queue" && method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, await service.enqueue(body));
    }
    if (pathOnly === "/v1/session-kanban/dispatch" && method === "POST") {
      await readJson(req);
      return sendJson(res, 200, await service.dispatchReady());
    }

    const action = pathOnly.match(/^\/v1\/session-kanban\/queue\/([^/]+)\/(cancel|retry)$/);
    if (action && method === "POST") {
      await readJson(req);
      const id = decodeURIComponent(action[1]);
      const result = action[2] === "cancel" ? await service.cancel(id) : await service.retry(id);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, {
      error: { type: "not_found", message: "Unknown session kanban route: " + pathOnly },
    });
  } catch (error) {
    const validation = /required|Invalid JSON|Payload too large/.test(error?.message || "");
    sendJson(res, validation ? 400 : 500, {
      error: { type: validation ? "invalid_request" : "internal_error", message: error?.message || "Session kanban error" },
    });
  }
}
