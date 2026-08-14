import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { NatTraversalError } from "../domain/errors.mjs";

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
      };
    } catch (error) {
      return {
        enabled: true,
        configured: true,
        reachable: false,
        url: target.url,
        message: error.message || String(error),
      };
    }
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
    // Map /v1/nat-traversal/frps-dashboard/<rest> onto dashboard origin.
    // Note: URL hash (#/...) is browser-only and must not be sent upstream.
    const rest = suffixPath.startsWith("/") ? suffixPath : `/${suffixPath}`;
    let dest;
    if (rest === "/" || rest === "") {
      // Prefer configured pathname (usually /static/) and drop hash.
      dest = new URL(base.pathname || "/", base.origin);
    } else if (rest.startsWith("/static/") || rest === "/static") {
      dest = new URL(rest, base.origin);
    } else {
      // Keep dashboard assets under the configured base path when possible.
      const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
      dest = new URL(rest.replace(/^\//, ""), `${base.origin}${basePath}`);
    }

    const auth = getAuth?.() || {};
    const headers = { ...sanitizeRequestHeaders(req.headers) };
    const hasAuth = Boolean(auth.username || auth.password);
    if (!hasAuth) {
      throw new NatTraversalError(
        "dashboard_unauthorized",
        "Dashboard 用户名/密码尚未保存。请在表单填写后先点“保存配置”，再打开。",
      );
    }
    const token = Buffer.from(
      `${auth.username || ""}:${auth.password || ""}`,
      "utf8",
    ).toString("base64");
    headers.authorization = `Basic ${token}`;
    headers.host = dest.host;


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
          const outHeaders = { ...upRes.headers };
          // Avoid forcing auth prompt loop to browser when we already injected creds.
          delete outHeaders["www-authenticate"];
          res.writeHead(upRes.statusCode || 502, outHeaders);
          upRes.pipe(res);
          upRes.on("end", resolve);
        },
      );
      upstream.on("timeout", () => {
        upstream.destroy(new Error("dashboard upstream timeout"));
      });
      upstream.on("error", (error) => {
        logger?.warn?.(`[nat-traversal] dashboard proxy error: ${error.message}`);
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

  return { status, proxy };
}

function sanitizeRequestHeaders(headers = {}) {
  const skip = new Set([
    "host",
    "connection",
    "content-length",
    "authorization",
    "cookie",
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
    const headers = {};
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
