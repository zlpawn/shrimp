import http from "node:http";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

/**
 * Resolve effective proxy URL from proxy configuration and environment variables.
 * @param {object} [proxyConfig={}]
 * @param {object} [env=process.env]
 * @returns {string|null}
 */
export function resolveProxyUrl(proxyConfig = {}, env = process.env) {
  const mode = String(proxyConfig?.mode || "inherit").toLowerCase();

  if (mode === "direct") {
    return null;
  }

  if (mode === "custom") {
    const custom = proxyConfig?.custom_url ? String(proxyConfig.custom_url).trim() : "";
    return custom || null;
  }

  // "inherit" mode - read from standard environment variables
  return (
    env?.HTTPS_PROXY ||
    env?.HTTP_PROXY ||
    env?.https_proxy ||
    env?.http_proxy ||
    env?.ALL_PROXY ||
    env?.all_proxy ||
    null
  );
}

/**
 * Instantiate an HTTP/HTTPS or SOCKS proxy agent for a given proxy URL.
 * @param {string|null} proxyUrl
 * @returns {HttpsProxyAgent|SocksProxyAgent|null}
 */
export function createProxyAgent(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== "string") return null;
  const trimmed = proxyUrl.trim();
  if (!trimmed) return null;

  try {
    const protocol = new URL(trimmed).protocol.toLowerCase();
    if (
      protocol === "socks:" ||
      protocol === "socks4:" ||
      protocol === "socks4a:" ||
      protocol === "socks5:" ||
      protocol === "socks5h:"
    ) {
      return new SocksProxyAgent(trimmed);
    }
    if (protocol === "http:" || protocol === "https:") {
      return new HttpsProxyAgent(trimmed);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Convert a Node.js http.IncomingMessage into a Fetch-like Response object.
 * @param {http.IncomingMessage} res
 * @returns {object}
 */
function nodeResToFetchLike(res) {
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300,
    status: res.statusCode || 0,
    statusText: res.statusMessage || "",
    headers: res.headers || {},
    async text() {
      return new Promise((resolve, reject) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      });
    },
    async json() {
      const text = await this.text();
      return JSON.parse(text);
    }
  };
}

/**
 * Fetch a URL with proxy support, timeouts, and optional custom fetch injection.
 * @param {string} url
 * @param {object} [options={}]
 * @param {object} [proxyConfig={}]
 * @param {object} [env=process.env]
 * @returns {Promise<{ ok: boolean, status: number, statusText: string, text: () => Promise<string>, json: () => Promise<any> }>}
 */
export async function fetchWithProxy(url, options = {}, proxyConfig = {}, env = process.env) {
  const {
    fetchImpl,
    proxyUrl: explicitProxyUrl,
    timeout = 15000,
    headers = {},
    method = "GET",
    body = null,
    signal: userSignal
  } = options;

  // 1. If custom fetch implementation is provided, use it directly
  if (typeof fetchImpl === "function") {
    const controller = new AbortController();
    let timeoutId = null;
    if (timeout && timeout > 0) {
      timeoutId = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeout}ms`)), timeout);
    }
    if (userSignal) {
      userSignal.addEventListener("abort", () => controller.abort(userSignal.reason));
    }
    try {
      const res = await fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        ...options
      });
      return res;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // 2. Resolve proxy URL
  const effectiveProxyUrl = explicitProxyUrl !== undefined ? explicitProxyUrl : resolveProxyUrl(proxyConfig, env);

  // 3. Direct fetch if no proxy
  if (!effectiveProxyUrl) {
    const controller = new AbortController();
    let timeoutId = null;
    if (timeout && timeout > 0) {
      timeoutId = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeout}ms`)), timeout);
    }
    if (userSignal) {
      userSignal.addEventListener("abort", () => controller.abort(userSignal.reason));
    }
    try {
      return await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // 4. Proxied request via agent
  const agent = createProxyAgent(effectiveProxyUrl);
  const targetUrl = new URL(url);
  const transport = targetUrl.protocol === "http:" ? http : https;
  const headerBag = { ...headers };

  if (body != null && headerBag["Content-Length"] == null && headerBag["content-length"] == null) {
    const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : String(body);
    headerBag["Content-Length"] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;

    const req = transport.request(
      url,
      {
        method,
        headers: headerBag,
        agent
      },
      (res) => {
        if (timeoutId) clearTimeout(timeoutId);
        settled = true;
        resolve(nodeResToFetchLike(res));
      }
    );

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };

    if (timeout && timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          const err = new Error(`Request timeout after ${timeout}ms`);
          err.name = "TimeoutError";
          req.destroy(err);
          reject(err);
        }
      }, timeout);
    }

    const onAbort = () => {
      if (!settled) {
        settled = true;
        cleanup();
        const err = new Error("Request aborted");
        err.name = "AbortError";
        req.destroy(err);
        reject(err);
      }
    };

    if (userSignal) {
      if (userSignal.aborted) {
        onAbort();
        return;
      }
      userSignal.addEventListener("abort", onAbort, { once: true });
    }

    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });

    if (body != null) {
      req.write(typeof body === "string" || Buffer.isBuffer(body) ? body : String(body));
    }

    req.end();
  });
}
