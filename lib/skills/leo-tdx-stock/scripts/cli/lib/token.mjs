import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HKDF_INFO = "workbuddy-oauth-credentials-v1";

export function resolveSecretPaths({ homeDir = os.homedir(), env = process.env } = {}) {
  const root = String(env.SHRIMP_SECRETS_DIR || "").trim();
  const base = root ? root : path.join(homeDir, ".shrimp", "secrets");
  return { root: path.join(base, "tdx"), token: path.join(base, "tdx", "token") };
}

export function readToken({ homeDir = os.homedir(), env = process.env } = {}) {
  const injected = String(env.TDX_TOKEN || "").trim();
  if (injected) return injected;
  try {
    return fs.readFileSync(resolveSecretPaths({ homeDir, env }).token, "utf8").trim();
  } catch (error) {
    return "";
  }
}

export function saveToken(token, { homeDir = os.homedir(), env = process.env } = {}) {
  const normalized = String(token || "").trim();
  if (!normalized.startsWith("TDX-")) throw new Error("Invalid TDX token. Expected a TDX-... token.");
  const { root, token: file } = resolveSecretPaths({ homeDir, env });
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try { fs.chmodSync(parent, 0o700); } catch {}
    fs.chmodSync(root, 0o700);
  }
  fs.writeFileSync(file, normalized + "\n", { mode: 0o600 });
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
  return file;
}

export function candidateWorkBuddyRoots({ homeDir = os.homedir(), env = process.env } = {}) {
  const roots = [];
  const push = (value) => {
    if (!value) return;
    const resolved = path.resolve(String(value));
    if (!roots.includes(resolved)) roots.push(resolved);
  };
  push(env.WORKBUDDY_CONNECTORS_DIR);
  push(path.join(homeDir, ".workbuddy", "connectors"));
  if (env.APPDATA) push(path.join(env.APPDATA, "WorkBuddy", "connectors"));
  if (env.LOCALAPPDATA) push(path.join(env.LOCALAPPDATA, "WorkBuddy", "connectors"));
  return roots;
}

export function extractWorkBuddyToken({ homeDir = os.homedir(), env = process.env } = {}) {
  for (const root of candidateWorkBuddyRoots({ homeDir, env })) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name === "default") continue;
      const token = extractUserToken(path.join(root, entry.name), entry.name);
      if (token) return token;
    }
  }
  return "";
}

function extractUserToken(userDir, userId) {
  try {
    const master = fs.readFileSync(path.join(userDir, ".master.key"));
    if (master.length !== 32) return "";
    const state = JSON.parse(fs.readFileSync(path.join(userDir, "connector-states.v3.json"), "utf8"));
    const encryption = state?.encryption || {};
    const salt = Buffer.from(encryption.salt || "", "base64");
    const expectedCheck = crypto.createHash("sha256").update(Buffer.concat([master, salt])).digest().subarray(0, 16);
    if (encryption.keyCheck !== expectedCheck.toString("base64")) return "";

    const credential = state?.headerOverrides?.["tdx-connector"]?.Authorization;
    if (!credential) return "";
    const key = Buffer.from(crypto.hkdfSync(
      "sha256",
      Buffer.concat([master, Buffer.from(userId)]),
      salt,
      HKDF_INFO,
      32,
    ));
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(credential.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(`${userId}|connector-states:headerOverrides:tdx-connector|Authorization`));
    decipher.setAuthTag(Buffer.from(credential.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(credential.ct, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const token = plain.replace(/^Bearer /, "");
    return token.startsWith("TDX-") ? token : "";
  } catch {
    return "";
  }
}
