import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";

let _cachedSystemProxy = undefined;

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
  if (!Number(enableMatch[1])) return "";

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
  if (useCache && _cachedSystemProxy !== undefined) return _cachedSystemProxy;
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
  if (useCache) _cachedSystemProxy = detected;
  return detected;
}

/**
 * Resolve effective proxy with priority:
 * --proxy / --no-proxy > config.proxy > env (HTTPS_PROXY/HTTP_PROXY/ALL_PROXY) > macOS scutil / Windows Registry
 */
export function resolveProxyInfo({
  cliProxy = "",
  noProxy = false,
  configProxy = "",
  env = process.env,
  systemProxyDetector = detectSystemProxy,
} = {}) {
  if (noProxy || /^(direct|none|off|false)$/i.test(String(cliProxy || "").trim())) {
    return { url: "", source: "disabled" };
  }
  if (cliProxy && String(cliProxy).trim()) {
    return { url: normalizeProxyString(cliProxy), source: "cli" };
  }
  if (configProxy && String(configProxy).trim()) {
    if (/^(direct|none|off|false)$/i.test(String(configProxy).trim())) {
      return { url: "", source: "config-disabled" };
    }
    return { url: normalizeProxyString(configProxy), source: "config" };
  }
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
  const sysVal = systemProxyDetector ? systemProxyDetector() : "";
  if (sysVal) {
    return { url: normalizeProxyString(sysVal), source: "system" };
  }
  return { url: "", source: "direct" };
}

export function isBypassedHost(hostname = "") {
  const clean = String(hostname).trim().toLowerCase().replace(/^\[|\]$/g, "");
  return clean === "localhost" || clean === "127.0.0.1" || clean === "::1" || clean.endsWith(".localhost");
}

export function appendLoopbackNoProxy(raw = "") {
  const items = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const host of ["127.0.0.1", "localhost", "::1"]) {
    if (!items.some((x) => x.toLowerCase() === host)) {
      items.push(host);
    }
  }
  return items.join(",");
}

/**
 * Inject resolved proxy variables into a subprocess env while ensuring loopback traffic bypasses proxy.
 */
export function buildProxyEnv(baseEnv = process.env, proxyInfo = null) {
  const env = { ...baseEnv };
  const resolved = proxyInfo || resolveProxyInfo({ env });
  const noProxyVal = appendLoopbackNoProxy(env.NO_PROXY || env.no_proxy || "");
  env.NO_PROXY = noProxyVal;
  env.no_proxy = noProxyVal;

  if (!resolved.url) {
    if (resolved.source === "disabled" || resolved.source === "config-disabled") {
      for (const k of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]) {
        delete env[k];
      }
    }
    return env;
  }

  const lower = resolved.url.toLowerCase();
  if (lower.startsWith("socks")) {
    env.ALL_PROXY = resolved.url;
    env.all_proxy = resolved.url;
  } else {
    env.HTTP_PROXY = resolved.url;
    env.http_proxy = resolved.url;
    env.HTTPS_PROXY = resolved.url;
    env.https_proxy = resolved.url;
  }
  return env;
}

function connectSocks5Tunnel({ proxyHost, proxyPort, username, password, targetHost, targetPort, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxyHost, port: proxyPort });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    const timer = setTimeout(() => fail(new Error("SOCKS5 proxy connection timeout")), timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    const readExact = (n) =>
      new Promise((res) => {
        const tryRead = () => {
          const chunk = socket.read(n);
          if (chunk) {
            socket.removeListener("readable", tryRead);
            res(chunk);
          }
        };
        socket.on("readable", tryRead);
        tryRead();
      });

    socket.once("error", fail);
    socket.once("connect", async () => {
      try {
        const hasAuth = Boolean(username);
        socket.write(hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
        const methodResp = await readExact(2);
        if (methodResp[0] !== 0x05) throw new Error("Invalid SOCKS5 greeting response");

        if (methodResp[1] === 0x02) {
          const uBuf = Buffer.from(decodeURIComponent(username || ""), "utf8");
          const pBuf = Buffer.from(decodeURIComponent(password || ""), "utf8");
          socket.write(Buffer.concat([Buffer.from([0x01, uBuf.length]), uBuf, Buffer.from([pBuf.length]), pBuf]));
          const authResp = await readExact(2);
          if (authResp[1] !== 0x00) throw new Error("SOCKS5 proxy authentication failed");
        } else if (methodResp[1] !== 0x00) {
          throw new Error(`SOCKS5 proxy unsupported auth method: ${methodResp[1]}`);
        }

        const hostBuf = Buffer.from(targetHost, "utf8");
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(targetPort, 0);
        socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf]));

        const head = await readExact(4);
        if (head[1] !== 0x00) throw new Error(`SOCKS5 CONNECT failed with code ${head[1]}`);
        const atyp = head[3];
        if (atyp === 0x01) {
          await readExact(4 + 2);
        } else if (atyp === 0x03) {
          const lenBuf = await readExact(1);
          await readExact(lenBuf[0] + 2);
        } else if (atyp === 0x04) {
          await readExact(16 + 2);
        }
        clearTimeout(timer);
        socket.removeListener("error", fail);
        settled = true;
        resolve(socket);
      } catch (err) {
        clearTimeout(timer);
        fail(err);
      }
    });
  });
}

function connectHttpTunnel({ proxyHost, proxyPort, username, password, targetHost, targetPort, useTlsProxy = false, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const headers = { Host: `${targetHost}:${targetPort}` };
    if (username) {
      const auth = Buffer.from(`${decodeURIComponent(username)}:${decodeURIComponent(password || "")}`).toString("base64");
      headers["Proxy-Authorization"] = `Basic ${auth}`;
    }
    const transport = useTlsProxy ? https : http;
    const req = transport.request({
      host: proxyHost,
      port: proxyPort,
      method: "CONNECT",
      path: `${targetHost}:${targetPort}`,
      headers,
      agent: false,
    });
    req.on("connect", (res, socket) => {
      req.setTimeout(0);
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`HTTP proxy CONNECT failed (${res.statusCode})`));
        return;
      }
      resolve(socket);
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("HTTP proxy CONNECT timeout"));
    });
    req.end();
  });
}

async function createTunneledTlsSocket({ host, port = 443, proxyUrl = "", timeoutMs = 20000 } = {}) {
  const parsed = new URL(proxyUrl);
  const proto = parsed.protocol.toLowerCase();
  const proxyHost = parsed.hostname;
  const proxyPort = Number(parsed.port) || (proto.startsWith("socks") ? 1080 : proto === "https:" ? 443 : 8080);

  let rawSocket;
  if (proto === "socks:" || proto === "socks5:" || proto === "socks5h:") {
    rawSocket = await connectSocks5Tunnel({
      proxyHost,
      proxyPort,
      username: parsed.username,
      password: parsed.password,
      targetHost: host,
      targetPort: port,
      timeoutMs,
    });
  } else if (proto === "http:" || proto === "https:") {
    rawSocket = await connectHttpTunnel({
      proxyHost,
      proxyPort,
      username: parsed.username,
      password: parsed.password,
      targetHost: host,
      targetPort: port,
      useTlsProxy: proto === "https:",
      timeoutMs,
    });
  } else {
    throw new Error(`不支持的代理协议: ${proto}`);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const hsTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { tlsSocket.destroy(); } catch {}
      try { rawSocket.destroy(); } catch {}
      reject(new Error(`TLS handshake timeout via proxy (${timeoutMs}ms) to ${host}:${port}`));
    }, timeoutMs);
    if (typeof hsTimer.unref === "function") hsTimer.unref();

    const tlsSocket = tls.connect({ socket: rawSocket, servername: host }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(hsTimer);
      resolve(tlsSocket);
    });
    tlsSocket.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(hsTimer);
      try { rawSocket.destroy(); } catch {}
      reject(err);
    });
    tlsSocket.once("close", () => {
      clearTimeout(hsTimer);
      if (!rawSocket.destroyed) {
        try { rawSocket.destroy(); } catch {}
      }
    });
  });
}

async function requestOnce(rawUrl, { method = "GET", headers = {}, body = null, proxyUrl = "", timeoutMs = 60000 } = {}) {
  const urlObj = new URL(rawUrl);
  const isHttps = urlObj.protocol === "https:";
  const targetPort = Number(urlObj.port) || (isHttps ? 443 : 80);
  const payloadBuf =
    body == null
      ? null
      : Buffer.isBuffer(body)
        ? body
        : typeof body === "string"
          ? Buffer.from(body, "utf8")
          : Buffer.from(JSON.stringify(body), "utf8");

  const headerBag = { ...headers };
  if (headerBag.Connection == null && headerBag.connection == null) {
    headerBag.Connection = "close";
  }
  if (payloadBuf && headerBag["Content-Length"] == null && headerBag["content-length"] == null) {
    headerBag["Content-Length"] = payloadBuf.length;
  }

  const useProxy = Boolean(proxyUrl) && !isBypassedHost(urlObj.hostname);

  // Plain HTTP via HTTP proxy uses absolute-form request target
  if (!isHttps && useProxy && /^https?:/i.test(proxyUrl)) {
    const pUrl = new URL(proxyUrl);
    const pTransport = pUrl.protocol === "https:" ? https : http;
    const pPort = Number(pUrl.port) || (pUrl.protocol === "https:" ? 443 : 8080);
    if (pUrl.username && !headerBag["Proxy-Authorization"]) {
      const auth = Buffer.from(`${decodeURIComponent(pUrl.username)}:${decodeURIComponent(pUrl.password || "")}`).toString("base64");
      headerBag["Proxy-Authorization"] = `Basic ${auth}`;
    }
    headerBag.Host = urlObj.host;
    return new Promise((resolve, reject) => {
      const req = pTransport.request(
        {
          host: pUrl.hostname,
          port: pPort,
          method,
          path: urlObj.toString(),
          headers: headerBag,
          agent: false,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode || 0,
              headers: res.headers,
              buffer,
              text: () => buffer.toString("utf8"),
              json: () => JSON.parse(buffer.toString("utf8")),
            });
          });
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timeout after ${timeoutMs}ms: ${rawUrl}`)));
      if (payloadBuf) req.write(payloadBuf);
      req.end();
    });
  }

  let preconnectedSocket = null;
  if (useProxy) {
    if (isHttps) {
      preconnectedSocket = await createTunneledTlsSocket({
        host: urlObj.hostname,
        port: targetPort,
        proxyUrl,
        timeoutMs: Math.min(timeoutMs, 20000),
      });
    } else if (/^socks/i.test(proxyUrl)) {
      const pUrl = new URL(proxyUrl);
      preconnectedSocket = await connectSocks5Tunnel({
        proxyHost: pUrl.hostname,
        proxyPort: Number(pUrl.port) || 1080,
        username: pUrl.username,
        password: pUrl.password,
        targetHost: urlObj.hostname,
        targetPort,
        timeoutMs: Math.min(timeoutMs, 20000),
      });
    }
  }

  return new Promise((resolve, reject) => {
    const transport = isHttps ? https : http;
    const reqOpts = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: targetPort,
      path: `${urlObj.pathname}${urlObj.search}`,
      method,
      headers: headerBag,
      ...(preconnectedSocket ? { createConnection: () => preconnectedSocket, agent: false } : { agent: false }),
    };

    const cleanup = () => {
      if (preconnectedSocket && !preconnectedSocket.destroyed) {
        try { preconnectedSocket.destroy(); } catch {}
      }
    };

    const req = transport.request(reqOpts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        cleanup();
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          headers: res.headers,
          buffer,
          text: () => buffer.toString("utf8"),
          json: () => JSON.parse(buffer.toString("utf8")),
        });
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms: ${rawUrl}`));
    });
    if (payloadBuf) req.write(payloadBuf);
    req.end();
  });
}

/**
 * HTTP/HTTPS request with automatic proxy inheritance and redirect following (up to maxRedirects).
 */
export async function requestWithProxy(
  rawUrl,
  { method = "GET", headers = {}, body = null, proxyUrl = "", timeoutMs = 60000, maxRedirects = 8, maxAttempts = 3 } = {},
) {
  let currentUrl = rawUrl;
  let currentMethod = method;
  let currentBody = body;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        res = await requestOnce(currentUrl, {
          method: currentMethod,
          headers,
          body: currentBody,
          proxyUrl,
          timeoutMs,
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err?.code || "");
        const retryable = /ECONNRESET|ETIMEDOUT|socket hang up|CONNECT|TLS handshake timeout|EPIPE/i.test(msg);
        if (!retryable || attempt === maxAttempts) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    if (lastErr) throw lastErr;

    const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
    const location = res.headers?.location;
    if (!isRedirect || !location) {
      return res;
    }
    currentUrl = new URL(location, currentUrl).toString();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === "POST")) {
      currentMethod = "GET";
      currentBody = null;
    }
  }
  throw new Error(`重定向次数超过上限 (${maxRedirects}): ${rawUrl}`);
}
