/**
 * Bounded market HTTP client with streaming byte limits.
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

import { DreamSkinError } from "../domain/errors.mjs";
import { joinMarketAssetUrl } from "./schema.mjs";

/**
 * Create a Node.js binary request adapter.
 * Supports an injected proxy agent via the `agent` option.
 */
export function createNodeBinaryRequest({ agent } = {}) {
  return async function requestBinary(url, { timeoutMs = 10000, maxBytes, allowedRedirect } = {}) {
    return downloadWithLimits(url, { timeoutMs, maxBytes, allowedRedirect, agent, maxRedirects: 3 });
  };
}

function downloadWithLimits(targetUrl, { timeoutMs, maxBytes, allowedRedirect, agent, maxRedirects, redirects = 0 }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      settle(reject, new DreamSkinError("market_unavailable", `invalid URL: ${targetUrl}`));
      return;
    }

    const lib = parsed.protocol === "https:" ? https : http;

    let settled = false;
    const settle = (fn, ...args) => {
      if (settled) return;
      settled = true;
      fn(...args);
    };

    const req = lib.get(parsed, { agent, timeout: timeoutMs }, (res) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.destroy();
        if (redirects >= maxRedirects) {
          settle(reject, new DreamSkinError("market_unavailable", `too many redirects`));
          return;
        }
        const redirectUrl = new URL(res.headers.location, parsed).href;
        // Check redirect policy
        if (allowedRedirect && !allowedRedirect(parsed, new URL(redirectUrl))) {
          settle(reject, new DreamSkinError("market_unavailable", `redirect not allowed: ${redirectUrl}`));
          return;
        }
        downloadWithLimits(redirectUrl, { timeoutMs, maxBytes, allowedRedirect, agent, maxRedirects, redirects: redirects + 1 })
          .then((v) => settle(resolve, v), (e) => settle(reject, e));
        return;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy();
        settle(reject, new DreamSkinError("market_unavailable", `HTTP ${res.statusCode}: ${res.statusMessage || res.statusCode}`));
        return;
      }

      // Check content-length if provided
      const contentLength = parseInt(res.headers["content-length"] || "0", 10);
      if (contentLength > 0 && maxBytes && contentLength > maxBytes) {
        res.destroy();
        settle(reject, new DreamSkinError("market_unavailable", `content exceeds ${maxBytes} byte limit`));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      let resolved = false;

      res.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (maxBytes && totalBytes > maxBytes) {
          if (!resolved) {
            resolved = true;
            res.destroy();
            settle(reject, new DreamSkinError("market_unavailable", `download exceeds ${maxBytes} byte limit`));
          }
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        if (resolved) return;
        resolved = true;
        const bytes = Buffer.concat(chunks);
        if (bytes.length === 0) {
          settle(reject, new DreamSkinError("market_unavailable", `download is empty`));
          return;
        }
        resolve({
          bytes,
          finalUrl: targetUrl,
          status: res.statusCode,
          headers: res.headers,
        });
      });

      res.on("error", (error) => {
        if (!resolved) {
          resolved = true;
          settle(reject, new DreamSkinError("market_unavailable", error.message));
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      settle(reject, new DreamSkinError("market_unavailable", `request timed out after ${timeoutMs}ms`));
    });

    req.on("error", (error) => {
      settle(reject, new DreamSkinError("market_unavailable", error.message));
    });
  });
}

/**
 * Market client that fetches index, themes, images, and previews
 * through an injected request adapter.
 */
export function createMarketClient({ requestBinary, indexUrl, rawBaseUrl, timeoutMs = 10000 }) {
  // Parse base URL once
  const baseUrl = new URL(rawBaseUrl);

  function allowedRedirect(from, to) {
    // Allow HTTP -> HTTPS upgrade or same-protocol, same-origin
    if (from.origin === to.origin) return true;
    if (from.protocol === "http:" && to.protocol === "https:" && from.host === to.host) return true;
    return false;
  }

  async function fetchIndexBytes() {
    return requestBinary(indexUrl, {
      timeoutMs,
      maxBytes: 1024 * 1024,
      allowedRedirect,
    });
  }

  async function fetchThemeBytes(entry) {
    const themeUrl = joinMarketAssetUrl(rawBaseUrl, entry.theme);
    return requestBinary(themeUrl, {
      timeoutMs,
      maxBytes: 256 * 1024,
      allowedRedirect,
    }).then((r) => r.bytes);
  }

  async function fetchImageBytes(entry) {
    const imageUrl = joinMarketAssetUrl(rawBaseUrl, entry.image);
    return requestBinary(imageUrl, {
      timeoutMs,
      maxBytes: 16 * 1024 * 1024,
      allowedRedirect,
    }).then((r) => r.bytes);
  }

  async function fetchPreviewBytes(entry) {
    const previewUrl = joinMarketAssetUrl(rawBaseUrl, entry.preview);
    return requestBinary(previewUrl, {
      timeoutMs,
      maxBytes: 16 * 1024 * 1024,
      allowedRedirect,
    }).then((r) => r.bytes);
  }

  return { fetchIndexBytes, fetchThemeBytes, fetchImageBytes, fetchPreviewBytes };
}