import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

let cachedSystemProxy = undefined;
let cachedAt = 0;
const CACHE_TTL_MS = 15_000;

export function normalizeProxyString(raw) {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || /^(direct|none|off|false)$/i.test(trimmed)) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function parseScutilProxyOutput(text = "") {
  const getVal = (key) => {
    const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m");
    const m = re.exec(text);
    return m ? m[1].trim() : "";
  };

  if (getVal("HTTPSEnable") === "1") {
    const host = getVal("HTTPSProxy");
    const port = getVal("HTTPSPort");
    if (host && port) return `http://${host}:${port}`;
  }
  if (getVal("HTTPEnable") === "1") {
    const host = getVal("HTTPProxy");
    const port = getVal("HTTPPort");
    if (host && port) return `http://${host}:${port}`;
  }
  if (getVal("SOCKSEnable") === "1") {
    const host = getVal("SOCKSProxy");
    const port = getVal("SOCKSPort");
    if (host && port) return `socks5://${host}:${port}`;
  }
  return "";
}

export function parseWindowsRegProxyOutput(text = "") {
  const enableMatch = /ProxyEnable\s+REG_DWORD\s+(0x[0-9a-fA-F]+|\d+)/i.exec(text);
  if (!enableMatch) return "";
  const enabled = Number(enableMatch[1]);
  if (!enabled) return "";

  const serverMatch = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(text);
  if (!serverMatch) return "";
  const raw = serverMatch[1].trim();
  if (!raw) return "";

  if (raw.includes("=")) {
    const entries = Object.fromEntries(
      raw
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const idx = pair.indexOf("=");
          return idx > 0 ? [pair.slice(0, idx).toLowerCase(), pair.slice(idx + 1)] : ["", ""];
        }),
    );
    const chosen = entries.https || entries.http || entries.socks;
    if (!chosen) return "";
    if (entries.socks && chosen === entries.socks && !chosen.includes("://")) {
      return `socks5://${chosen}`;
    }
    return normalizeProxyString(chosen);
  }
  return normalizeProxyString(raw);
}

export function detectSystemProxy({
  platform = process.platform,
  execFileSyncImpl = execFileSync,
  useCache = true,
} = {}) {
  const now = Date.now();
  if (useCache && cachedSystemProxy !== undefined && now - cachedAt < CACHE_TTL_MS) {
    return cachedSystemProxy;
  }
  let detected = "";
  try {
    if (platform === "darwin") {
      const out = execFileSyncImpl("scutil", ["--proxy"], {
        encoding: "utf8",
        timeout: 2000,
        windowsHide: true,
      });
      detected = parseScutilProxyOutput(out);
    } else if (platform === "win32") {
      const out = execFileSyncImpl(
        "reg",
        ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
        { encoding: "utf8", timeout: 2000, windowsHide: true },
      );
      detected = parseWindowsRegProxyOutput(out);
    }
  } catch {
    detected = "";
  }
  if (useCache) {
    cachedSystemProxy = detected;
    cachedAt = now;
  }
  return detected;
}

/**
 * Resolve user's local proxy configuration (env vars -> OS system proxy).
 * Intentionally does NOT read Shrimp's gateway.config.json proxy.
 */
export function resolveUserLocalProxy({
  env = process.env,
  systemProxyDetector = detectSystemProxy,
  useCache = false,
} = {}) {
  const envVal =
    env?.HTTPS_PROXY ||
    env?.https_proxy ||
    env?.HTTP_PROXY ||
    env?.http_proxy ||
    env?.ALL_PROXY ||
    env?.all_proxy ||
    "";
  if (envVal && String(envVal).trim()) {
    return { url: normalizeProxyString(envVal), source: "env" };
  }
  const sysVal = systemProxyDetector ? systemProxyDetector({ useCache }) : "";
  if (sysVal) {
    return { url: normalizeProxyString(sysVal), source: "system" };
  }
  return { url: "", source: "direct" };
}

export function createSystemProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;
  const protocol = new URL(proxyUrl).protocol.toLowerCase();
  if (protocol.startsWith("socks")) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new HttpsProxyAgent(proxyUrl);
}

export function fetchBufferViaSystemProxy(
  targetUrl,
  {
    headers = {},
    timeoutMs = 30_000,
    maxRedirects = 5,
    maxBytes = 80 * 1024 * 1024,
    proxyUrl: explicitProxyUrl,
  } = {},
) {
  const resolvedProxy = explicitProxyUrl !== undefined
    ? { url: normalizeProxyString(explicitProxyUrl), source: "explicit" }
    : resolveUserLocalProxy();
  const agent = resolvedProxy.url ? createSystemProxyAgent(resolvedProxy.url) : undefined;

  return new Promise((resolve, reject) => {
    function requestUrl(currentUrl, redirectsLeft) {
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch (err) {
        reject(err);
        return;
      }
      const isHttps = parsed.protocol === "https:";
      const transport = isHttps ? https : http;
      const req = transport.request(
        parsed,
        {
          method: "GET",
          agent: isHttps || parsed.protocol === "http:" ? agent : undefined,
          headers: {
            "User-Agent": "Shrimp-OFM-Updater/1.0",
            Accept: "*/*",
            ...headers,
          },
          timeout: timeoutMs,
        },
        (res) => {
          const status = res.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) {
              reject(new Error(`Too many redirects fetching ${targetUrl}`));
              return;
            }
            const nextUrl = new URL(res.headers.location, parsed).toString();
            requestUrl(nextUrl, redirectsLeft - 1);
            return;
          }
          const chunks = [];
          let total = 0;
          res.on("data", (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
              req.destroy(new Error(`Response exceeded maxBytes (${maxBytes})`));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            resolve({
              status,
              ok: status >= 200 && status < 300,
              headers: res.headers,
              buffer,
              proxy: resolvedProxy,
            });
          });
        },
      );
      req.on("timeout", () => {
        req.destroy(new Error(`Request timed out after ${timeoutMs}ms (${currentUrl})`));
      });
      req.on("error", reject);
      req.end();
    }

    requestUrl(targetUrl, maxRedirects);
  });
}

export async function fetchJsonViaSystemProxy(targetUrl, options = {}) {
  const res = await fetchBufferViaSystemProxy(targetUrl, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = res.buffer.toString("utf8");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = data?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(`HTTP ${res.status} from ${targetUrl}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  if (data === null) {
    throw new Error(`Invalid JSON from ${targetUrl}`);
  }
  return { data, proxy: res.proxy, headers: res.headers };
}
