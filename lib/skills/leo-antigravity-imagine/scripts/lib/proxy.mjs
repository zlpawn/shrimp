import fs from "node:fs";
import path from "node:path";
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

export function resolveProxyUrl(opts = {}) {
  return resolveProxyInfo(opts).url;
}

export function isBypassedHost(hostname = "") {
  const clean = String(hostname).trim().toLowerCase().replace(/^\[|\]$/g, "");
  return clean === "localhost" || clean === "127.0.0.1" || clean === "::1" || clean.endsWith(".localhost");
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
          const uBuf = Buffer.from(username || "", "utf8");
          const pBuf = Buffer.from(password || "", "utf8");
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

async function createTunneledTlsSocketOnce({
  host,
  port = 443,
  proxyUrl = "",
  alpnProtocols = undefined,
  timeoutMs = 20000,
} = {}) {
  const tlsOpts = {
    servername: host,
    ...(alpnProtocols ? { ALPNProtocols: alpnProtocols } : {}),
  };

  if (!proxyUrl || isBypassedHost(host)) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, ...tlsOpts }, () => resolve(socket));
      socket.once("error", reject);
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`TLS connect timeout to ${host}:${port}`)));
    });
  }

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

    const tlsSocket = tls.connect({ socket: rawSocket, ...tlsOpts }, () => {
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

export async function createTunneledTlsSocket(opts = {}) {
  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await createTunneledTlsSocketOnce(opts);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || "");
      const retryable =
        /before secure TLS connection|ECONNRESET|ETIMEDOUT|socket hang up|CONNECT/i.test(msg);
      if (!retryable || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr;
}

export async function requestWithProxy(
  rawUrl,
  { method = "GET", headers = {}, body = null, proxyUrl = "", timeoutMs = 60000 } = {},
) {
  const urlObj = new URL(rawUrl);
  const isHttps = urlObj.protocol === "https:";
  const targetPort = Number(urlObj.port) || (isHttps ? 443 : 80);
  const payloadBuf =
    body == null
      ? null
      : Buffer.isBuffer(body)
        ? body
        : typeof body === "string" || body instanceof URLSearchParams
          ? Buffer.from(String(body), "utf8")
          : Buffer.from(JSON.stringify(body), "utf8");

  const headerBag = { ...headers };
  if (headerBag.Connection == null && headerBag.connection == null) {
    headerBag.Connection = "close";
  }
  if (payloadBuf && headerBag["Content-Length"] == null && headerBag["content-length"] == null) {
    headerBag["Content-Length"] = payloadBuf.length;
  }

  let preconnectedTls = null;
  if (isHttps && proxyUrl && !isBypassedHost(urlObj.hostname)) {
    preconnectedTls = await createTunneledTlsSocket({
      host: urlObj.hostname,
      port: targetPort,
      proxyUrl,
      timeoutMs: Math.min(timeoutMs, 20000),
    });
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
      ...(preconnectedTls ? { createConnection: () => preconnectedTls, agent: false } : { agent: false }),
    };

    const cleanupPreconnected = () => {
      if (preconnectedTls && !preconnectedTls.destroyed) {
        try { preconnectedTls.destroy(); } catch {}
      }
    };

    const req = transport.request(reqOpts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        cleanupPreconnected();
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          statusText: res.statusMessage || "",
          headers: res.headers,
          buffer,
          async text() {
            return buffer.toString("utf8");
          },
          async json() {
            return JSON.parse(buffer.toString("utf8"));
          },
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

export function detectMimeFromBufferOrExt(buf, filePath = "") {
  if (buf && buf.length >= 4) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "image/webp";
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

export async function toImagePart(imgInput, { proxyUrl = "" } = {}) {
  const raw = String(imgInput || "").trim();
  if (!raw) throw new Error("参考图片路径为空");

  const dataMatch = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(raw);
  if (dataMatch) {
    const mimeType = dataMatch[1] || "image/png";
    const data = dataMatch[2]
      ? dataMatch[3]
      : Buffer.from(decodeURIComponent(dataMatch[3]), "utf8").toString("base64");
    return { inlineData: { mimeType, data } };
  }

  if (/^https?:\/\//i.test(raw)) {
    const res = await requestWithProxy(raw, { method: "GET", proxyUrl, timeoutMs: 60000 });
    if (!res.ok) {
      throw new Error(`下载参考图片失败 (${res.status}): ${raw}`);
    }
    const contentType = String(res.headers?.["content-type"] || "").split(";")[0].trim();
    const mimeType = contentType.startsWith("image/")
      ? contentType
      : detectMimeFromBufferOrExt(res.buffer, new URL(raw).pathname);
    return { inlineData: { mimeType, data: res.buffer.toString("base64") } };
  }

  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(`参考图片未找到: ${resolved}`);
  }
  const buf = fs.readFileSync(resolved);
  const mimeType = detectMimeFromBufferOrExt(buf, resolved);
  return { inlineData: { mimeType, data: buf.toString("base64") } };
}
