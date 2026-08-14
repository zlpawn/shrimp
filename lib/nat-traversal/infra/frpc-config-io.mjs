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
      else if (
        norm === "token" ||
        norm === "authtoken" ||
        key.toLowerCase() === "auth.token" ||
        norm === "authtoken"
      ) result.token = String(value);
      else if (
        norm === "loglevel" ||
        key.toLowerCase() === "log.level" ||
        norm === "loglevel"
      ) result.logLevel = String(value || "info");
    }
  }

  flushProxy();
  return result;
}

function pushUnique(list, value) {
  const full = path.resolve(String(value || ""));
  if (full && !list.includes(full)) list.push(full);
}

function looksLikeFrpDirName(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return false;
  if (n === "frp" || n === ".frp") return true;
  // frp_0.71.0 / frp_0.71.0_darwin_arm64 / frp-0.69.1-darwin-arm64 / frp_0.71.0_windows_amd64
  return /^frp[-_]?\d/.test(n) || /^frp[-_]?v?\d/.test(n);
}

function collectFrpcFilesInDir(dirPath, out, depth = 0) {
  if (depth > 2) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (
        lower === "frpc.toml" ||
        lower === "frpc.ini" ||
        lower === "frpc.yaml" ||
        lower === "frpc.yml" ||
        /^frpc.*\.(toml|ini|yaml|yml)$/.test(lower)
      ) {
        pushUnique(out, full);
      }
      continue;
    }
    if (entry.isDirectory() && !entry.name.startsWith(".") && depth < 2) {
      const lower = entry.name.toLowerCase();
      if (
        looksLikeFrpDirName(entry.name) ||
        lower === "conf" ||
        lower === "config"
      ) {
        collectFrpcFilesInDir(full, out, depth + 1);
      }
    }
  }
}

function listWindowsDriveRoots() {
  if (process.platform !== "win32") return [];
  const roots = [];
  for (let i = 65; i <= 90; i += 1) {
    const letter = String.fromCharCode(i);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch {
      // ignore
    }
  }
  return roots;
}

function scanRootsForFrpDirs(roots, out) {
  for (const root of roots) {
    // direct fixed paths on this root
    for (const rel of ["frp", "tools\\frp", "apps\\frp", "software\\frp", "ProgramData\\frp"]) {
      const dir = path.join(root, rel);
      collectFrpcFilesInDir(dir, out, 0);
      pushUnique(out, path.join(dir, "frpc.toml"));
      pushUnique(out, path.join(dir, "frpc.ini"));
    }
    // top-level versioned dirs: D:\frp_0.71.0_windows_amd64
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!looksLikeFrpDirName(entry.name)) continue;
        collectFrpcFilesInDir(path.join(root, entry.name), out, 0);
      }
    } catch {
      // ignore unreadable drives
    }
  }
}

export function listFrpcCandidatePaths({
  homeDir = os.homedir(),
  env = process.env,
  whichBin = defaultWhichBin,
  platform = process.platform,
} = {}) {
  const candidates = [];

  // Explicit env overrides first.
  if (env.FRPC_CONFIG) pushUnique(candidates, env.FRPC_CONFIG);
  if (env.FRP_CONFIG) pushUnique(candidates, env.FRP_CONFIG);

  // Common fixed layouts (POSIX + Windows user profile).
  for (const p of [
    path.join(homeDir, "frp", "frpc.toml"),
    path.join(homeDir, "frp", "frpc.ini"),
    path.join(homeDir, ".frp", "frpc.toml"),
    path.join(homeDir, ".frp", "frpc.ini"),
    path.join(homeDir, ".config", "frp", "frpc.toml"),
    path.join(homeDir, "AppData", "Roaming", "frp", "frpc.toml"),
    path.join(homeDir, "AppData", "Local", "frp", "frpc.toml"),
    "/opt/homebrew/etc/frp/frpc.toml",
    "/usr/local/etc/frp/frpc.toml",
    "/etc/frp/frpc.toml",
  ]) {
    pushUnique(candidates, p);
  }

  // Scan home top-level dirs named frp / frp_0.71.0 / frp_0.71.0_darwin_arm64 ...
  try {
    const homeEntries = fs.readdirSync(homeDir, { withFileTypes: true });
    for (const entry of homeEntries) {
      if (!entry.isDirectory()) continue;
      if (!looksLikeFrpDirName(entry.name)) continue;
      collectFrpcFilesInDir(path.join(homeDir, entry.name), candidates, 0);
    }
  } catch {
    // ignore home scan failures
  }

  // Downloads / Desktop shallow scan (macOS + Windows user folders).
  for (const base of [
    path.join(homeDir, "Downloads"),
    path.join(homeDir, "Desktop"),
    path.join(homeDir, "Documents"),
  ]) {
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!looksLikeFrpDirName(entry.name)) continue;
        collectFrpcFilesInDir(path.join(base, entry.name), candidates, 0);
      }
    } catch {
      // ignore
    }
  }

  // Windows: many installs live on D:/E: etc, not under the user profile.
  if (platform === "win32") {
    scanRootsForFrpDirs(listWindowsDriveRoots(), candidates);
  }

  // Sibling of frpc binary (Homebrew / local unpack / Windows portable).
  const bin = whichBin("frpc");
  if (bin) {
    const dir = path.dirname(bin);
    pushUnique(candidates, path.join(dir, "frpc.toml"));
    pushUnique(candidates, path.join(dir, "frpc.ini"));
    pushUnique(candidates, path.join(dir, "..", "etc", "frp", "frpc.toml"));
    collectFrpcFilesInDir(path.join(dir, ".."), candidates, 0);
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
  const exts =
    process.platform === "win32"
      ? (String(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean))
      : [""];
  const names = exts.map((ext) => (ext ? `${name}${ext.toLowerCase()}` : name));
  // also try original exact name
  if (!names.includes(name)) names.unshift(name);

  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const fileName of names) {
      const candidate = path.join(dir, fileName);
      try {
        fs.accessSync(candidate, fs.constants.F_OK);
        return candidate;
      } catch {
        // continue
      }
    }
  }
  for (const candidate of [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `C:\Windows\System32\${name}.exe`,
  ]) {
    try {
      fs.accessSync(candidate, fs.constants.F_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return "";
}
