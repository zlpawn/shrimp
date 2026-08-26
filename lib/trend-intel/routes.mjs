/**
 * REST API Routes for Trend Intelligence module.
 */

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
        reject(new Error("Payload too large"));
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
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Routes HTTP request to Trend Intelligence service methods.
 * 
 * Supports signatures:
 * - routeTrendIntelRequest(req, res, service)
 * - routeTrendIntelRequest(req, res, { service })
 * - routeTrendIntelRequest(req, res, reqPath, { service })
 * - routeTrendIntelRequest(req, res, context, reqPath, { service })
 * 
 * @param {object} req 
 * @param {object} res 
 * @param {...any} args 
 * @returns {Promise<boolean>} true if request was handled, false otherwise
 */
export async function routeTrendIntelRequest(req, res, ...args) {
  let service = null;
  let reqPath = null;

  for (const arg of args) {
    if (!arg) continue;
    if (typeof arg === "string") {
      reqPath = arg;
    } else if (typeof arg === "object") {
      if (typeof arg.crawlOnce === "function") {
        service = arg;
      } else if (arg.service && typeof arg.service.crawlOnce === "function") {
        service = arg.service;
      }
    }
  }

  const rawUrl = req.url || reqPath || "";
  const urlObj = new URL(rawUrl, "http://127.0.0.1");
  const pathOnly = reqPath ? String(reqPath).split("?")[0] : urlObj.pathname;
  const searchParams = urlObj.searchParams;
  const method = req.method || "GET";

  if (!pathOnly.startsWith("/v1/trend-intel")) {
    return false;
  }

  try {
    if (!service) {
      throw new Error("TrendIntelService is required to handle route");
    }

    // GET /v1/trend-intel/config
    if (pathOnly === "/v1/trend-intel/config" && method === "GET") {
      sendJson(res, 200, service.getConfig());
      return true;
    }

    // PUT /v1/trend-intel/config or POST /v1/trend-intel/config
    if (pathOnly === "/v1/trend-intel/config" && (method === "PUT" || method === "POST")) {
      const body = await readJson(req);
      const updated = service.updateConfig(body);
      sendJson(res, 200, updated);
      return true;
    }

    // POST /v1/trend-intel/crawl
    if (pathOnly === "/v1/trend-intel/crawl" && method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const result = await service.crawlOnce(body);
      sendJson(res, 200, result);
      return true;
    }

    // POST /v1/trend-intel/generate-brief or POST /v1/trend-intel/refresh
    if ((pathOnly === "/v1/trend-intel/generate-brief" || pathOnly === "/v1/trend-intel/refresh") && method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const result = await service.generateBriefOnce(body);
      sendJson(res, 200, result);
      return true;
    }

    // GET /v1/trend-intel/brief
    if (pathOnly === "/v1/trend-intel/brief" && method === "GET") {
      const date = searchParams.get("date") || null;
      const brief = service.getBrief(date);
      if (!brief) {
        sendJson(res, 404, {
          error: {
            type: "not_found",
            message: date ? `Brief not found for date ${date}` : "No brief available"
          }
        });
        return true;
      }
      sendJson(res, 200, brief);
      return true;
    }

    // GET /v1/trend-intel/events
    if (pathOnly === "/v1/trend-intel/events" && method === "GET") {
      const query = {};
      if (searchParams.has("limit")) query.limit = Number(searchParams.get("limit"));
      if (searchParams.has("state")) query.state = searchParams.get("state");
      if (searchParams.has("trend_state")) query.trend_state = searchParams.get("trend_state");
      if (searchParams.has("min_score")) query.min_score = Number(searchParams.get("min_score"));
      if (searchParams.has("min_world_score")) query.min_world_score = Number(searchParams.get("min_world_score"));
      if (searchParams.has("min_creator_score")) query.min_creator_score = Number(searchParams.get("min_creator_score"));
      if (searchParams.has("matched_topic")) query.matched_topic = searchParams.get("matched_topic");
      if (searchParams.has("order_by")) query.order_by = searchParams.get("order_by");

      const events = service.getEvents(query);
      sendJson(res, 200, { events, total: events.length });
      return true;
    }

    // GET /v1/trend-intel/events/:id/history
    const historyMatch = pathOnly.match(/^\/v1\/trend-intel\/events\/([^/]+)\/history$/);
    if (historyMatch && method === "GET") {
      const eventId = decodeURIComponent(historyMatch[1]);
      const history = service.getSingleEventHistory(eventId);
      if (!history) {
        sendJson(res, 404, {
          error: {
            type: "not_found",
            message: `Event not found: ${eventId}`
          }
        });
        return true;
      }
      sendJson(res, 200, history);
      return true;
    }

    // GET /v1/trend-intel/raw-items
    if (pathOnly === "/v1/trend-intel/raw-items" && method === "GET") {
      const query = {};
      if (searchParams.has("platform")) query.platform = searchParams.get("platform");
      if (searchParams.has("since")) query.since = searchParams.get("since");
      if (searchParams.has("limit")) query.limit = Number(searchParams.get("limit"));

      const items = service.getRawItems(query);
      sendJson(res, 200, { items, total: items.length });
      return true;
    }

    // Unknown subpath under /v1/trend-intel
    sendJson(res, 404, {
      error: {
        type: "not_found",
        message: `Unknown trend intel route: ${pathOnly}`
      }
    });
    return true;
  } catch (err) {
    const isClientError = /invalid|required|payload/i.test(err?.message || "");
    sendJson(res, isClientError ? 400 : 500, {
      error: {
        type: isClientError ? "invalid_request" : "internal_error",
        message: err?.message || "Trend intel error"
      }
    });
    return true;
  }
}
