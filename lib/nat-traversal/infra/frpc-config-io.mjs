import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function stripQuotes(value) {
  const text = String(value ?? "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function parseScalar(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return stripQuotes(text);
}

/**
 * Minimal frpc config parser for the common generated/hand-written subset:
 * - key = value
 * - [auth]
 * - [[proxies]]
 * Supports both TOML-ish and classic INI (server_addr / local_ip).
 */
export function parseFrpcConfigText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const result = {
    serverAddr: "",
    serverPort: 7000,
    token: "",
    logLevel: "info",
    proxies: [],
  };

  let section = "root";
  let currentProxy = null;

  const flushProxy = () => {
    if (!currentProxy) return;
    if (currentProxy.name || currentProxy.localPort || currentProxy.remotePort) {
      result.proxies.push({
        name: currentProxy.name || `proxy-${result.proxies.length + 1}`,
        type: currentProxy.type || "tcp",
        localIp: currentProxy.localIp || "127.0.0.1",
        localPort: Number(currentProxy.localPort || 0),
        remotePort: Number(currentProxy.remotePort || 0),
      });
    }
    currentProxy = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const tableMatch = line.match(/^\[\[([^\]]+)\]\]$/);
    if (tableMatch) {
      flushProxy();
      section = tableMatch[1].trim().toLowerCase();
      if (section === "proxies") currentProxy = {};
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      flushProxy();
      section = sectionMatch[1].trim().toLowerCase();
      currentProxy = null;
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = parseScalar(kv[2]);
    const norm = key.replace(/_/g, "").toLowerCase();

    if (section === "proxies" && currentProxy) {
      if (norm === "name") currentProxy.name = String(value);
      else if (norm === "type") currentProxy.type = String(value);
      else if (norm === "localip") currentProxy.localIp = String(value);
      else if (norm === "localport") currentProxy.localPort = Number(value);
      else if (norm === "remoteport") currentProxy.remotePort = Number(value);
      continue;
    }

    if (section === "auth" || section === "root" || section === "common") {
      if (norm === "serveraddr") result.serverAddr = String(value);
      else if (norm === "serverport") result.serverPort = Number(value) || 7000;
      else if (norm === "token" || norm === "authtoken") result.token = String(value);
      else if (norm === "loglevel" || norm === "log.level") result.logLevel = String(value || "info");
    }
  }

  flushProxy();
  return result;
}

export function listFrpcCandidatePaths({
  homeDir = os.homedir(),
  env = process.env,
  whichBin = defaultWhichBin,
} = {}) {
  const candidates = [];
  const push = (p) => {
    const full = path.resolve(String(p || ""));
    if (full && !candidates.includes(full)) candidates.push(full);
  };

  // Explicit env overrides first.
  if (env.FRPC_CONFIG) push(env.FRPC_CONFIG);
  if (env.FRP_CONFIG) push(env.FRP_CONFIG);

  // Common local layouts.
  push(path.join(homeDir, "frp", "frpc.toml"));
  push(path.join(homeDir, "frp", "frpc.ini"));
  push(path.join(homeDir, ".frp", "frpc.toml"));
  push(path.join(homeDir, ".frp", "frpc.ini"));
  push(path.join(homeDir, ".config", "frp", "frpc.toml"));
  push("/opt/homebrew/etc/frp/frpc.toml");
  push("/usr/local/etc/frp/frpc.toml");
  push("/etc/frp/frpc.toml");

  // Sibling of frpc binary (Homebrew / local unpack).
  const bin = whichBin("frpc");
  if (bin) {
    const dir = path.dirname(bin);
    push(path.join(dir, "frpc.toml"));
    push(path.join(dir, "frpc.ini"));
    push(path.join(dir, "..", "etc", "frp", "frpc.toml"));
  }

  return candidates;
}

export function discoverFrpcConfigs(options = {}) {
  const candidates = listFrpcCandidatePaths(options);
  const found = [];
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
      const text = fs.readFileSync(filePath, "utf8");
      const parsed = parseFrpcConfigText(text);
      found.push({
        path: filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs,
        bytes: Buffer.byteLength(text),
        parsed: {
          serverAddr: parsed.serverAddr,
          serverPort: parsed.serverPort,
          logLevel: parsed.logLevel,
          proxyCount: parsed.proxies.length,
          hasToken: Boolean(parsed.token),
        },
        // full parse kept for import path
        _full: parsed,
      });
    } catch {
      // ignore unreadable candidates
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.map(({ _full, ...rest }) => rest);
}

export function readFrpcConfigFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrpcConfigText(text);
  return { path: path.resolve(filePath), text, parsed };
}

export function inferDashboardUrl(serverAddr, dashboardPort = 7500) {
  const host = String(serverAddr || "").trim();
  if (!host) return "";
  // if user already put scheme, keep host part only
  try {
    if (host.includes("://")) {
      const u = new URL(host);
      return `http://${u.hostname}:${dashboardPort}/static/#/`;
    }
  } catch {
    // fall through
  }
  return `http://${host}:${dashboardPort}/static/#/`;
}

function defaultWhichBin(name) {
  const pathEnv = String(process.env.PATH || "");
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  for (const candidate of [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ]) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return "";
}
