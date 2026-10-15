import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

/**
 * Recursively removes 'send' and 'tpp_send' from any 'blocked_features' arrays
 * found anywhere inside an object or array.
 */
export function sanitizeBlockedFeatures(data) {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) {
    return data.map(sanitizeBlockedFeatures);
  }
  const result = { ...data };
  if (Array.isArray(result.blocked_features)) {
    result.blocked_features = result.blocked_features.filter(
      (feature) => feature && feature.name !== "send" && feature.name !== "tpp_send"
    );
  }
  for (const [key, value] of Object.entries(result)) {
    if (value && typeof value === "object") {
      result[key] = sanitizeBlockedFeatures(value);
    }
  }
  return result;
}

/**
 * Sanitizes /wham/usage response data to ensure rate_limit.allowed is true,
 * preventing Codex Desktop's React UI from disabling the send button, while
 * updating the upsell notice to inform the user that official quota is exhausted
 * and they can seamlessly switch to gateway models.
 */
export function sanitizeWhamUsage(data) {
  if (!data || typeof data !== "object") return data;
  const result = { ...data };

  if (result.rate_limit && typeof result.rate_limit === "object") {
    result.rate_limit = {
      ...result.rate_limit,
      allowed: true,
    };
  }

  if (result.rate_limit_upsell && typeof result.rate_limit_upsell === "object") {
    result.rate_limit_upsell = {
      ...result.rate_limit_upsell,
      title: result.rate_limit_upsell.title || "官方模型当前配额已耗尽",
      description:
        "⚠️ 官方模型当前配额已耗尽。网关已自动为您解除输入框封锁，您可以直接在顶部切换至第三方/网关模型（如 GLM、DeepSeek 等）无缝继续使用。",
    };
  }

  return sanitizeBlockedFeatures(result);
}

/**
 * Decompresses an HTTP response buffer based on Content-Encoding header.
 */
export function decompressBuffer(buffer, contentEncoding = "") {
  if (!buffer || buffer.length === 0) return buffer;
  const encoding = String(contentEncoding || "").toLowerCase().trim();
  try {
    if (encoding === "gzip") return zlib.gunzipSync(buffer);
    if (encoding === "deflate") return zlib.inflateSync(buffer);
    if (encoding === "br") return zlib.brotliDecompressSync(buffer);
  } catch (err) {
    // If decompression fails, return raw buffer as fallback
  }
  return buffer;
}

/**
 * Maps incoming Codex desktop request URLs to ChatGPT backend API URLs.
 */
export function mapDesktopUrlToUpstream(urlPath = "/") {
  let targetPath = urlPath;
  if (urlPath.startsWith("/api/")) {
    targetPath = "/backend-api/" + urlPath.slice(5);
  } else if (urlPath.startsWith("/public/")) {
    targetPath = "/public-api/" + urlPath.slice(8);
  }
  return new URL(targetPath, "https://chatgpt.com");
}

/**
 * Creates the Desktop API Shield HTTP server.
 */
export function createDesktopApiShieldServer({
  getProxyAgent = () => null,
  logInfo = console.log,
  logError = console.error,
} = {}) {
  const server = http.createServer((req, res) => {
    // CORS Preflight support
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Credentials": "true",
      });
      res.end();
      return;
    }

    const reqUrl = req.url || "/";
    const targetUrl = mapDesktopUrlToUpstream(reqUrl);

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers["keep-alive"];
    delete headers["proxy-connection"];
    delete headers["transfer-encoding"];
    headers.host = "chatgpt.com";

    if (headers.origin) headers.origin = "https://chatgpt.com";
    if (headers.referer) headers.referer = "https://chatgpt.com/";

    const isUsage = reqUrl.startsWith("/api/wham/usage");
    const isConversation = reqUrl.startsWith("/api/conversation");
    const shouldInspectJson = isUsage || isConversation;

    const agent = getProxyAgent();

    const upstreamReq = https.request(
      targetUrl,
      {
        method: req.method,
        headers,
        agent: agent || void 0,
      },
      (upstreamRes) => {
        const contentType = String(upstreamRes.headers["content-type"] || "");
        const isJson = contentType.includes("application/json");

        if ((shouldInspectJson || isJson) && upstreamRes.statusCode >= 200 && upstreamRes.statusCode < 500) {
          const chunks = [];
          upstreamRes.on("data", (chunk) => chunks.push(chunk));
          upstreamRes.on("end", () => {
            const rawBuffer = Buffer.concat(chunks);
            const decompressed = decompressBuffer(rawBuffer, upstreamRes.headers["content-encoding"]);

            let jsonParsed = false;
            let finalBody = rawBuffer;

            try {
              const text = decompressed.toString("utf8");
              if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
                let data = JSON.parse(text);

                if (isUsage) {
                  data = sanitizeWhamUsage(data);
                  jsonParsed = true;
                } else {
                  data = sanitizeBlockedFeatures(data);
                  jsonParsed = true;
                }

                if (jsonParsed) {
                  const serialized = JSON.stringify(data);
                  finalBody = Buffer.from(serialized, "utf8");

                  const outHeaders = { ...upstreamRes.headers };
                  delete outHeaders["content-encoding"];
                  delete outHeaders["transfer-encoding"];
                  outHeaders["content-type"] = "application/json; charset=utf-8";
                  outHeaders["content-length"] = finalBody.length;
                  outHeaders["access-control-allow-origin"] = req.headers.origin || "*";
                  outHeaders["access-control-allow-credentials"] = "true";

                  res.writeHead(upstreamRes.statusCode, outHeaders);
                  res.end(finalBody);
                  return;
                }
              }
            } catch (err) {
              // JSON parse or manipulation error, fallback to sending unmodified buffer
            }

            // Fallback: send response as-is
            res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
            res.end(rawBuffer);
          });
          return;
        }

        // Direct stream for non-JSON or other paths
        const outHeaders = { ...upstreamRes.headers };
        outHeaders["access-control-allow-origin"] = req.headers.origin || "*";
        outHeaders["access-control-allow-credentials"] = "true";

        res.writeHead(upstreamRes.statusCode, outHeaders);
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.on("error", (err) => {
      logError(`[DesktopApiShield] Upstream error for ${reqUrl}: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Gateway upstream error: " + err.message }));
      }
    });

    req.on("aborted", () => {
      upstreamReq.destroy();
    });

    req.pipe(upstreamReq);
  });

  return server;
}

let activeShieldServer = null;

/**
 * Starts the Desktop API Shield server on the specified port (defaults to 8000).
 */
export function startDesktopApiShield({
  port = 8000,
  host = "127.0.0.1",
  getProxyAgent = () => null,
  logInfo = console.log,
  logError = console.error,
} = {}) {
  if (activeShieldServer) {
    return activeShieldServer;
  }

  const server = createDesktopApiShieldServer({
    getProxyAgent,
    logInfo,
    logError,
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      logError(
        `[DesktopApiShield] ⚠️ Port ${port} is already in use. Desktop API shield could not start on port ${port}.`
      );
    } else {
      logError(`[DesktopApiShield] Server error: ${err.message}`);
    }
  });

  server.listen(port, host, () => {
    logInfo(`[DesktopApiShield] 🛡️ Codex Desktop API Shield listening on http://${host}:${port}`);
  });

  activeShieldServer = server;
  return server;
}

/**
 * Stops the Desktop API Shield server.
 */
export function stopDesktopApiShield() {
  if (activeShieldServer) {
    try {
      activeShieldServer.close();
    } catch {}
    activeShieldServer = null;
  }
}
