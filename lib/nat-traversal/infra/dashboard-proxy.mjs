import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { NatTraversalError } from "../domain/errors.mjs";

const PROXY_PREFIX = "/v1/nat-traversal/frps-dashboard";

export function createDashboardProxy({
  getTarget,
  getAuth,
  logger = console,
} = {}) {
  async function status() {
    const target = getTarget?.();
    if (!target?.enabled) {
      return { enabled: false, configured: false, reachable: false };
    }
    if (!target.url) {
      return { enabled: true, configured: false, reachable: false };
    }
    try {
      const result = await requestTarget(target.url, {
        method: "GET",
        auth: getAuth?.(),
        timeoutMs: 5000,
      });
      return {
        enabled: true,
        configured: true,
        reachable: result.statusCode > 0 && result.statusCode < 500,
        statusCode: result.statusCode,
        url: target.url,
        authConfigured: Boolean(
          getAuth?.()?.username || getAuth?.()?.password,
        ),
      };
    } catch (error) {
      return {
        enabled: true,
        configured: true,
        reachable: false,
        url: target.url,
        message: error.message || String(error),
        authConfigured: Boolean(
          getAuth?.()?.username || getAuth?.()?.password,
        ),
      };
    }
  }

  async function fetchProxies({ types = ["tcp", "udp", "http", "https", "stcp", "tcpmux"] } = {}) {
    const target = getTarget?.();
    if (!target?.enabled || !target?.url) {
      return { ok: false, proxies: [], message: "FRP Dashboard is not configured or disabled" };
    }
    const auth = getAuth?.() || {};
    let baseUrl;
    try {
      baseUrl = new URL(target.url);
    } catch {
      return { ok: false, proxies: [], message: "Invalid frpsDashboard url" };
    }
    const origin = baseUrl.origin;

    const results = [];
    for (const type of types) {
      try {
        const apiUrl = `${origin}/api/proxy/${type}`;
        const data = await requestJson(apiUrl, { auth, timeoutMs: 5000 });
        if (Array.isArray(data?.proxies)) {
          for (const item of data.proxies) {
            results.push({
              name: item.name || item.conf?.name || "",
              type: item.conf?.type || type,
              remotePort: item.conf?.remotePort || item.conf?.remote_port || item.port || 0,
              localIp: item.conf?.localIP || item.conf?.local_ip || "127.0.0.1",
              localPort: item.conf?.localPort || item.conf?.local_port || 0,
              status: item.status || "unknown",
              clientId: item.clientID || item.client_id || "",
              curConns: item.curConns || item.cur_conns || 0,
              todayTrafficIn: item.todayTrafficIn || 0,
              todayTrafficOut: item.todayTrafficOut || 0,
              lastStartTime: item.lastStartTime || "",
            });
          }
        }
      } catch {
        // Individual proxy type may fail if not supported; ignore.
      }
    }
    return {
      ok: true,
      serverHost: baseUrl.hostname,
      proxies: results,
    };
  }

  async function proxy(req, res, suffixPath = "/") {
    const target = getTarget?.();
    if (!target?.enabled) {
      throw new NatTraversalError("not_enabled", "frps dashboard is disabled");
    }
    if (!target.url) {
      throw new NatTraversalError(
        "invalid_config",
        "frpsDashboard.url is not configured",
      );
    }

    const base = new URL(target.url);
    // Hash fragments are browser-only; never send them upstream.
    const restRaw = suffixPath.startsWith("/") ? suffixPath : `/${suffixPath}`;
    const rest = restRaw.split("#")[0] || "/";
    // Canonicalize SPA entry to /static/ so frps relative ../api paths resolve.
    if (rest === "/" || rest === "") {
      const entry = buildDashboardProxyEntryPath(target.url);
      // strip hash for Location (browser keeps hash client-side if we include it, fine)
      res.writeHead(302, {
        Location: entry,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    const dest = mapProxyPathToUpstream(rest, base);

    const auth = getAuth?.() || {};
    const headers = { ...sanitizeRequestHeaders(req.headers) };
    // Auth is optional: only attach Basic credentials when configured.
    if (auth.username || auth.password) {
      headers.authorization = `Basic ${Buffer.from(
        `${auth.username || ""}:${auth.password || ""}`,
        "utf8",
      ).toString("base64")}`;
    }
    headers.host = dest.host;
    // Always fetch uncompressed bodies so rewrites and passthrough stay valid.
    headers["accept-encoding"] = "identity";

    await new Promise((resolve, reject) => {
      const lib = dest.protocol === "https:" ? https : http;
      const upstream = lib.request(
        {
          protocol: dest.protocol,
          hostname: dest.hostname,
          port: dest.port || (dest.protocol === "https:" ? 443 : 80),
          path: `${dest.pathname}${dest.search}`,
          method: req.method,
          headers,
          timeout: 15000,
        },
        (upRes) => {
          const contentType = String(upRes.headers["content-type"] || "");
          const shouldRewrite =
            contentType.includes("text/html") ||
            contentType.includes("javascript") ||
            contentType.includes("css");

          const outHeaders = sanitizeResponseHeaders(upRes.headers);
          // Avoid browser auth popups; we inject credentials server-side when present.
          delete outHeaders["www-authenticate"];

          if (!shouldRewrite) {
            res.writeHead(upRes.statusCode || 502, outHeaders);
            upRes.pipe(res);
            upRes.on("end", resolve);
            return;
          }

          const chunks = [];
          upRes.on("data", (c) => chunks.push(c));
          upRes.on("end", () => {
            try {
              const raw = Buffer.concat(chunks);
              // Defensive: if upstream ignored identity and returned gzip, fail clearly.
              if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
                reject(
                  new NatTraversalError(
                    "dashboard_unavailable",
                    "dashboard upstream returned gzip despite accept-encoding=identity",
                  ),
                );
                return;
              }
              let body = raw.toString("utf8");
              body = rewriteDashboardBody(body, contentType);
              const payload = Buffer.from(body, "utf8");
              outHeaders["content-length"] = String(payload.length);
              res.writeHead(upRes.statusCode || 502, outHeaders);
              res.end(payload);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      upstream.on("timeout", () => {
        upstream.destroy(new Error("dashboard upstream timeout"));
      });
      upstream.on("error", (error) => {
        logger?.warn?.(
          `[nat-traversal] dashboard proxy error: ${error.message}`,
        );
        reject(
          new NatTraversalError(
            "dashboard_unavailable",
            error.message || "dashboard proxy failed",
          ),
        );
      });
      if (req.method === "GET" || req.method === "HEAD") {
        upstream.end();
      } else {
        req.pipe(upstream);
      }
    });
  }

  return { status, proxy, fetchProxies };
}

/**
 * frps dashboard layout:
 * - UI assets under /static/
 * - JSON APIs under /api/
 * Proxy prefix: /v1/nat-traversal/frps-dashboard
 */
export function mapProxyPathToUpstream(restPath, baseUrl) {
  const rest = !restPath || restPath === "/" ? "/" : restPath;
  const origin = baseUrl.origin;

  // API must hit frps root /api, never under /static.
  if (rest === "/api" || rest.startsWith("/api/")) {
    return new URL(rest, origin);
  }

  // Explicit static paths.
  if (rest === "/static" || rest.startsWith("/static/")) {
    return new URL(rest, origin);
  }

  // Default entry: configured dashboard path (usually /static/ or /static/#/).
  if (rest === "/") {
    const pathname = baseUrl.pathname && baseUrl.pathname !== "/"
      ? baseUrl.pathname
      : "/static/";
    // If pathname is /static without trailing slash, keep as-is; browser/static servers often redirect.
    return new URL(pathname, origin);
  }

  // Other relative assets: prefer configured base directory.
  const basePath = baseUrl.pathname && baseUrl.pathname !== "/"
    ? (baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`)
    : "/static/";
  return new URL(rest.replace(/^\//, ""), `${origin}${basePath}`);
}

/**
 * Local proxy entry path that preserves frps relative API assumptions.
 * frps SPA calls `../api/serverinfo` from /static/, so open under /static/.
 * Example: http://host:7500/static/#/ -> /v1/nat-traversal/frps-dashboard/static/#/
 */
export function buildDashboardProxyEntryPath(targetUrl = "") {
  const raw = String(targetUrl || "").trim();
  let pathname = "/static/";
  let hash = "#/";
  if (raw) {
    try {
      const url = new URL(raw);
      pathname = url.pathname && url.pathname !== "/" ? url.pathname : "/static/";
      hash = url.hash || "";
    } catch {
      // keep defaults
    }
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname === "/static") pathname = "/static/";
  // Prefer directory form for SPA entry pages.
  if (!pathname.endsWith("/") && !/\.[a-zA-Z0-9]+$/.test(pathname)) {
    pathname = `${pathname}/`;
  }
  return `${PROXY_PREFIX}${pathname}${hash}`;
}

function rewriteDashboardBody(body, contentType) {
  let out = body;
  // Rewrite absolute root API/static refs so browser stays under gateway proxy prefix.
  out = out.replaceAll('"/api/', `"${PROXY_PREFIX}/api/`);
  out = out.replaceAll("'/api/", `'${PROXY_PREFIX}/api/`);
  out = out.replaceAll("`/api/", `\`${PROXY_PREFIX}/api/`);
  // frps SPA uses relative API paths from /static/: fetch("../api/serverinfo")
  out = out.replaceAll('"../api/', `"${PROXY_PREFIX}/api/`);
  out = out.replaceAll("'../api/", `'${PROXY_PREFIX}/api/`);
  out = out.replaceAll("`../api/", `\`${PROXY_PREFIX}/api/`);
  out = out.replaceAll("(../api/", `(${PROXY_PREFIX}/api/`);
  out = out.replaceAll('"/static/', `"${PROXY_PREFIX}/static/`);
  out = out.replaceAll("'/static/", `'${PROXY_PREFIX}/static/`);
  out = out.replaceAll("`/static/", `\`${PROXY_PREFIX}/static/`);
  out = out.replaceAll(")/api/", `)${PROXY_PREFIX}/api/`);
  out = out.replaceAll("(/api/", `(${PROXY_PREFIX}/api/`);

  if (contentType.includes("text/html")) {
    // Always pin SPA base under /static/ so relative imports and ../api stay correct.
    if (/base\s+href=/i.test(out)) {
      out = out.replace(
        /<base\s+href=["'][^"']*["']\s*\/?>/i,
        `<base href="${PROXY_PREFIX}/static/">`,
      );
    } else {
      out = out.replace(
        /<head([^>]*)>/i,
        `<head$1><base href="${PROXY_PREFIX}/static/">`,
      );
    }
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
    "proxy-connection",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "upgrade",
  ]);
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (skip.has(String(key).toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function sanitizeRequestHeaders(headers = {}) {
  const skip = new Set([
    "host",
    "connection",
    "content-length",
    "authorization",
    "cookie",
    "accept-encoding",
  ]);
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (skip.has(String(key).toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function requestTarget(urlString, { method = "GET", auth = {}, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (error) {
      reject(error);
      return;
    }
    const lib = url.protocol === "https:" ? https : http;
    const headers = {
      "accept-encoding": "identity",
    };
    if (auth.username || auth.password) {
      headers.authorization = `Basic ${Buffer.from(
        `${auth.username || ""}:${auth.password || ""}`,
        "utf8",
      ).toString("base64")}`;
    }
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve({ statusCode: res.statusCode || 0 });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function requestJson(urlString, { auth = {}, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (error) {
      reject(error);
      return;
    }
    const lib = url.protocol === "https:" ? https : http;
    const headers = {
      accept: "application/json",
      "accept-encoding": "identity",
    };
    if (auth.username || auth.password) {
      headers.authorization = `Basic ${Buffer.from(
        `${auth.username || ""}:${auth.password || ""}`,
        "utf8",
      ).toString("base64")}`;
    }
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw));
            } catch (err) {
              reject(new Error("Invalid JSON from dashboard: " + err.message));
            }
          } else {
            reject(new Error(`Dashboard HTTP ${res.statusCode}: ${raw.slice(0, 100)}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}
