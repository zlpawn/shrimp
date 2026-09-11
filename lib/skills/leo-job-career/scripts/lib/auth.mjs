import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "./config.mjs";

export function parseCookieHeader(rawHeader) {
  if (!rawHeader || typeof rawHeader !== "string") {
    return { valid: false, cookies: new Map(), cookie_names: [], cookie_count: 0, error: "Empty or invalid cookie header" };
  }

  const trimmed = rawHeader.trim();
  if (!trimmed || !trimmed.includes("=")) {
    return { valid: false, cookies: new Map(), cookie_names: [], cookie_count: 0, error: "Missing key-value cookie pairs" };
  }

  const cookies = new Map();
  const pairs = trimmed.split(";");

  for (const pair of pairs) {
    const item = pair.trim();
    if (!item) continue;
    const eqIdx = item.indexOf("=");
    if (eqIdx === -1) continue;
    const key = item.slice(0, eqIdx).trim();
    const val = item.slice(eqIdx + 1).trim();
    if (key) {
      cookies.set(key, val);
    }
  }

  const cookie_names = Array.from(cookies.keys());
  if (cookie_names.length === 0) {
    return { valid: false, cookies: new Map(), cookie_names: [], cookie_count: 0, error: "No valid cookies found" };
  }

  return {
    valid: true,
    cookies,
    cookie_names,
    cookie_count: cookie_names.length,
  };
}

export function parseNetscapeCookies(rawNetscape) {
  if (!rawNetscape || typeof rawNetscape !== "string") {
    return { valid: false, cookies: new Map(), cookie_names: [], cookie_count: 0, error: "Empty netscape content" };
  }

  const cookies = new Map();
  const lines = rawNetscape.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length >= 7) {
      const name = parts[5].trim();
      const val = parts[6].trim();
      if (name) {
        cookies.set(name, val);
      }
    }
  }

  const cookie_names = Array.from(cookies.keys());
  if (cookie_names.length === 0) {
    return { valid: false, cookies: new Map(), cookie_names: [], cookie_count: 0, error: "No valid netscape cookie lines found" };
  }

  return {
    valid: true,
    cookies,
    cookie_names,
    cookie_count: cookie_names.length,
  };
}

export function atomicWriteSecretFile(targetFile, content, mode = 0o600) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const tmpFile = targetFile + ".tmp." + Date.now() + "." + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmpFile, content, { encoding: "utf8", mode });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(tmpFile, mode);
    } catch {}
  }
  fs.renameSync(tmpFile, targetFile);
}

export function loadAuthState(options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  if (!fs.existsSync(paths.authStateFile)) {
    return {
      schema_version: 1,
      domain: "zhipin.com",
      source: "none",
      status: "missing",
      imported_at: null,
      last_verified_at: null,
      cookie_count: 0,
      cookie_names: [],
    };
  }

  try {
    return JSON.parse(fs.readFileSync(paths.authStateFile, "utf8"));
  } catch {
    return {
      schema_version: 1,
      domain: "zhipin.com",
      source: "none",
      status: "corrupt",
      imported_at: null,
      last_verified_at: null,
      cookie_count: 0,
      cookie_names: [],
    };
  }
}

export function saveAuthState(state, options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  atomicWriteSecretFile(paths.authStateFile, JSON.stringify(state, null, 2), 0o600);
}

export function loadRawCookieHeader(options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  if (fs.existsSync(paths.cookieHeaderFile)) {
    return fs.readFileSync(paths.cookieHeaderFile, "utf8").trim();
  }
  return null;
}

export function importCookieHeader(rawHeader, options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  ensureRuntimeDirectories(paths);

  const parsed = parseCookieHeader(rawHeader);
  if (!parsed.valid) {
    return { ok: false, error: parsed.error };
  }

  // Re-format canonical cookie header string
  const canonicalParts = [];
  for (const [k, v] of parsed.cookies.entries()) {
    canonicalParts.push(`${k}=${v}`);
  }
  const canonicalHeader = canonicalParts.join("; ");

  atomicWriteSecretFile(paths.cookieHeaderFile, canonicalHeader, 0o600);

  const state = {
    schema_version: 1,
    domain: "zhipin.com",
    source: options.source || "manual_header",
    status: "imported",
    imported_at: new Date().toISOString(),
    last_verified_at: null,
    cookie_count: parsed.cookie_count,
    cookie_names: parsed.cookie_names,
  };

  saveAuthState(state, { paths });

  return {
    ok: true,
    status: "imported",
    cookie_count: parsed.cookie_count,
    cookie_names: parsed.cookie_names,
    imported_at: state.imported_at,
  };
}

export function importFromClipboard(options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  if (process.platform !== "darwin") {
    return { ok: false, error: "Clipboard import is only natively supported on macOS via pbpaste" };
  }

  let raw = "";
  try {
    raw = execSync("pbpaste", { encoding: "utf8", maxBuffer: 1024 * 1024 });
  } catch (err) {
    return { ok: false, error: "Failed to read clipboard: " + err.message };
  }

  if (!raw || !raw.trim()) {
    return { ok: false, error: "Clipboard is empty" };
  }

  const res = importCookieHeader(raw, { paths, source: "browser_extension_clipboard" });
  if (!res.ok) {
    return res;
  }

  if (options.clearClipboard !== false) {
    try {
      execSync("pbcopy < /dev/null", { stdio: "ignore" });
    } catch {}
  }

  return res;
}

export function importFromFile(filePath, options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: "File does not exist: " + filePath };
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.includes("# Netscape HTTP Cookie File")) {
    const parsed = parseNetscapeCookies(raw);
    if (!parsed.valid) {
      return { ok: false, error: parsed.error };
    }
    const pairs = [];
    for (const [k, v] of parsed.cookies.entries()) {
      pairs.push(`${k}=${v}`);
    }
    return importCookieHeader(pairs.join("; "), { paths, source: "file_netscape" });
  }

  return importCookieHeader(raw, { paths, source: "file_header" });
}
