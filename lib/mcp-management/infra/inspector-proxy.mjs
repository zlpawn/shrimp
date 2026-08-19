import http from "node:http";
import { URL } from "node:url";

const PROXY_PREFIX = "/v1/mcp-management/inspector-proxy";

function sanitizeRequestHeaders(headers = {}) {
  const skip = new Set([
    "host",
    "connection",
    "content-length",
    "accept-encoding",
  ]);
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (skip.has(String(key).toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function sanitizeResponseHeaders(headers = {}) {
  const skip = new Set([
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
  ]);
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (skip.has(String(key).toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function rewriteHtmlBody(body, serverName) {
  const basePrefix = `${PROXY_PREFIX}/${encodeURIComponent(serverName)}/`;
  let out = body;

  // 1. Inject or replace <base href="...">
  if (/<base\s+href=/i.test(out)) {
    out = out.replace(/<base\s+href=["'][^"']*["']\s*\/?>/i, `<base href="${basePrefix}">`);
  } else if (/<head([^>]*)>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${basePrefix}">`);
  }

  // 2. Rewrite common absolute root asset and api paths in script/links
  out = out.replaceAll('"/assets/', `"${basePrefix}assets/`);
  out = out.replaceAll("'/assets/", `'${basePrefix}assets/`);
  out = out.replaceAll('"/sse"', `"${basePrefix}sse"`);
  out = out.replaceAll("'/sse'", `'${basePrefix}sse'`);
  out = out.replaceAll('"/message"', `"${basePrefix}message"`);
  out = out.replaceAll("'/message'", `'${basePrefix}message'`);

  return out;
}

export function createInspectorProxy({
  inspectorManager,
  logger = console,
} = {}) {
  if (!inspectorManager) throw new Error("inspectorManager is required");

  async function handle(req, res, serverName, subPath = "/") {
    const name = String(serverName || "").trim();
    const instance = inspectorManager.getInstance(name);

    if (!instance || !instance.port) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>MCP Inspector 未启动</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
            .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
            h2 { margin-top: 0; font-size: 20px; color: #f8fafc; }
            p { font-size: 14px; color: #94a3b8; line-height: 1.6; }
            code { background: #0f172a; padding: 2px 6px; border-radius: 4px; color: #38bdf8; font-family: monospace; }
            .btn { display: inline-block; margin-top: 16px; background: #3b82f6; color: #fff; padding: 8px 18px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500; }
            .btn:hover { background: #2563eb; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>🔍 MCP Inspector 未启动</h2>
            <p>MCP 服务 <code>${escapeHtml(name)}</code> 的 Inspector 调试实例当前未在运行或已关闭。</p>
            <p>请返回网关管理面板「MCP 枢纽」，点击该 MCP 卡片上的 <strong>「🔍 启动 Inspector 调试」</strong> 按钮重新拉起。</p>
            <a href="/config#mcp-management" class="btn">返回 MCP 枢纽</a>
          </div>
        </body>
        </html>
      `);
      return;
    }

    // Check if redirect is needed for trailing slash on entry
    const normalizedSubPath = !subPath || subPath === "" ? "/" : subPath;
    if (normalizedSubPath === "/" && !req.url.split("?")[0].endsWith("/")) {
      const query = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
      res.writeHead(302, { Location: `${PROXY_PREFIX}/${encodeURIComponent(name)}/${query}` });
      res.end();
      return;
    }

    const query = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
    const upstreamUrl = `http://127.0.0.1:${instance.port}${normalizedSubPath}${query}`;

    async function attemptProxy(retriesLeft = 8) {
      return new Promise((resolve, reject) => {
        const upstreamReq = http.request(
          upstreamUrl,
          {
            method: req.method || "GET",
            headers: {
              ...sanitizeRequestHeaders(req.headers),
              host: `127.0.0.1:${instance.port}`,
            },
            timeout: 60000,
          },
          (upstreamRes) => {
            const contentType = upstreamRes.headers["content-type"] || "";
            const isHtml = contentType.includes("text/html");
            const isSse = contentType.includes("text/event-stream");

            const responseHeaders = sanitizeResponseHeaders(upstreamRes.headers);

            if (isSse) {
              responseHeaders["content-type"] = "text/event-stream";
              responseHeaders["cache-control"] = "no-cache";
              responseHeaders["connection"] = "keep-alive";
              res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
              if (typeof res.flushHeaders === "function") res.flushHeaders();

              upstreamRes.pipe(res);
              upstreamRes.on("end", resolve);
              upstreamRes.on("error", (err) => {
                logger.warn(`[mcp-inspector-proxy] SSE upstream error for ${name}:`, err.message);
                resolve();
              });
              return;
            }

            if (isHtml) {
              const chunks = [];
              upstreamRes.on("data", (chunk) => chunks.push(chunk));
              upstreamRes.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf8");
                const rewritten = rewriteHtmlBody(body, name);
                const rewrittenBuf = Buffer.from(rewritten, "utf8");

                responseHeaders["content-type"] = "text/html; charset=utf-8";
                responseHeaders["content-length"] = String(rewrittenBuf.length);

                res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
                res.end(rewrittenBuf);
                resolve();
              });
              upstreamRes.on("error", reject);
              return;
            }

            res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
            upstreamRes.pipe(res);
            upstreamRes.on("end", resolve);
            upstreamRes.on("error", reject);
          }
        );

        upstreamReq.on("error", async (err) => {
          if (err.code === "ECONNREFUSED" && retriesLeft > 0) {
            await new Promise((r) => setTimeout(r, 400));
            try {
              await attemptProxy(retriesLeft - 1);
              resolve();
            } catch (e) {
              reject(e);
            }
            return;
          }

          logger.warn(`[mcp-inspector-proxy] Proxy error to upstream for ${name}:`, err.message);
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "inspector_unavailable", message: err.message }));
          }
          resolve();
        });

        if (req.method === "GET" || req.method === "HEAD") {
          upstreamReq.end();
        } else {
          req.pipe(upstreamReq);
        }
      });
    }

    return await attemptProxy();
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  return {
    handle,
    PROXY_PREFIX,
  };
}
