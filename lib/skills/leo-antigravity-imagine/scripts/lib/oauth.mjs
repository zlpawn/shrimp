import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { loadSkillConfig, updateSkillAuth } from "./config.mjs";
import { requestWithProxy } from "./proxy.mjs";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
export const REDIRECT_PORT = 18789;
export const REDIRECT_PATH = "/callback";
export const TOKEN_REFRESH_SKEW_SECONDS = 900;
export const OAUTH_USER_AGENT = "shrimp/0.0.3 google-oauth";

export const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

const CLIENT_ID_RE = /[0-9]{6,}-[a-z0-9]{10,}\.(?:apps\.googleusercontent\.com|apps\.googleuser\.test)/g;
const SECRET_PREFIXES = [["GOC", "SPX-"].join(""), "FAKESEC-"];

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function defaultInstallCandidates(env = process.env, platform = process.platform) {
  const home = env?.USERPROFILE || env?.HOME || os.homedir();
  const localAppData = env?.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const programFiles = env?.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = env?.["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  if (platform === "win32") {
    return unique([
      path.join(localAppData, "Programs", "Antigravity"),
      path.join(localAppData, "Antigravity"),
      path.join(programFiles, "Antigravity"),
      path.join(programFilesX86, "Antigravity"),
    ]);
  }
  if (platform === "darwin") {
    return unique([
      "/Applications/Antigravity.app",
      path.join(home, "Applications", "Antigravity.app"),
    ]);
  }
  return unique([
    path.join(home, ".local", "share", "Antigravity"),
    path.join(home, "Antigravity"),
    "/opt/Antigravity",
    "/usr/share/Antigravity",
  ]);
}

export function extractCredentialsFromText(sourceText = "") {
  const source = String(sourceText || "");
  const ids = unique(source.match(CLIENT_ID_RE) || []);
  const secrets = [];
  const BODY_LEN = 28;

  for (const prefix of SECRET_PREFIXES) {
    let index = 0;
    while (index < source.length) {
      const start = source.indexOf(prefix, index);
      if (start < 0) break;
      let body = "";
      let cursor = start + prefix.length;
      while (cursor < source.length && body.length < BODY_LEN && /[A-Za-z0-9_-]/.test(source[cursor])) {
        if (SECRET_PREFIXES.some((p) => source.startsWith(p, cursor))) break;
        body += source[cursor];
        cursor += 1;
      }
      if (body.length >= 20 && body.length <= BODY_LEN) {
        secrets.push(prefix + body);
      }
      index = start + prefix.length;
    }
  }
  const uniqSecrets = unique(secrets);
  if (!ids.length || !uniqSecrets.length) return null;
  return {
    client_id: ids[0],
    client_secret: uniqSecrets[0],
  };
}

export function discoverClientCredentials({
  env = process.env,
  platform = process.platform,
  candidates = defaultInstallCandidates(env, platform),
} = {}) {
  for (const root of candidates) {
    if (!root || !dirExists(root)) continue;
    const scanFiles = unique([
      path.join(root, "Contents", "Resources", "bin", "language_server"),
      path.join(root, "Contents", "Resources", "app.asar"),
      path.join(root, "Contents", "MacOS", "Antigravity"),
      path.join(root, "resources", "bin", "language_server.exe"),
      path.join(root, "resources", "app.asar"),
      path.join(root, "Antigravity.exe"),
    ]).filter(fileExists);

    const allIds = [];
    const allSecrets = [];
    for (const f of scanFiles) {
      try {
        const text = fs.readFileSync(f).toString("latin1");
        const pair = extractCredentialsFromText(text);
        if (pair) return { ...pair, install_root: root };
        const ids = text.match(CLIENT_ID_RE) || [];
        allIds.push(...ids);
      } catch {
        // continue scanning
      }
      try {
        const text = fs.readFileSync(f).toString("latin1");
        const combined = `${allIds.join(" ")} ${text}`;
        const pair = extractCredentialsFromText(combined);
        if (pair) return { ...pair, install_root: root };
        void allSecrets;
      } catch {
        // continue scanning
      }
    }
  }
  return null;
}

async function postForm(url, params, { proxyUrl = "" } = {}) {
  const body = new URLSearchParams(params).toString();
  const res = await requestWithProxy(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": OAUTH_USER_AGENT,
      Accept: "application/json",
    },
    body,
    proxyUrl,
    timeoutMs: 30000,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.error_description || json?.error || text.slice(0, 200);
    throw new Error(`Google OAuth 请求失败 (${res.status}): ${msg}`);
  }
  return json || {};
}

function normalizeTokenResponse(raw) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: raw.access_token || "",
    refresh_token: raw.refresh_token || "",
    expires_at: raw.expires_in ? now + Number(raw.expires_in) : Number(raw.expires_at || 0),
  };
}

export async function refreshAccessToken({
  refreshToken,
  clientId,
  clientSecret,
  proxyUrl = "",
  tokenUrl = TOKEN_URL,
}) {
  const raw = await postForm(
    tokenUrl,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    },
    { proxyUrl },
  );
  return normalizeTokenResponse(raw);
}

export async function ensureFreshAuth({
  env = process.env,
  proxyUrl = "",
  tokenUrl = TOKEN_URL,
  skewSeconds = TOKEN_REFRESH_SKEW_SECONDS,
} = {}) {
  let cfg = loadSkillConfig(env);
  let auth = { ...cfg.auth };

  if (!auth.client_id || !auth.client_secret) {
    const discovered = discoverClientCredentials({ env });
    if (discovered) {
      cfg = updateSkillAuth(
        {
          client_id: auth.client_id || discovered.client_id,
          client_secret: auth.client_secret || discovered.client_secret,
        },
        env,
      );
      auth = { ...cfg.auth };
    }
  }

  if (!auth.client_id || !auth.client_secret) {
    throw new Error(
      "缺少 Antigravity OAuth client_id / client_secret。\n" +
        "请执行 `login` 自动从本机 Antigravity 提取并登录，或执行 `config import --from <antigravity.secrets.json>` 导入已有密钥。",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number(auth.expires_at || 0);
  if (auth.access_token && expiresAt - now > skewSeconds) {
    return auth;
  }

  if (!auth.refresh_token) {
    throw new Error(
      "Antigravity 尚未完成授权登录（缺少 refresh_token）。\n" +
        "请执行 `login` 打开浏览器完成 Google 授权，或执行 `config import --from <antigravity.secrets.json>` 导入已有密钥。",
    );
  }

  const refreshed = await refreshAccessToken({
    refreshToken: auth.refresh_token,
    clientId: auth.client_id,
    clientSecret: auth.client_secret,
    proxyUrl,
    tokenUrl,
  });

  const saved = updateSkillAuth(
    {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || auth.refresh_token,
      expires_at: refreshed.expires_at,
    },
    env,
  );
  return saved.auth;
}

export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const target = String(url || "");
  if (!target) return false;
  try {
    if (platform === "win32") {
      spawnImpl("rundll32", ["url.dll,FileProtocolHandler", target], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return true;
    }
    if (platform === "darwin") {
      spawnImpl("open", [target], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    spawnImpl("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

function waitForOAuthCallback({ port = REDIRECT_PORT, state, timeoutMs = 5 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        server.close();
      } catch {}
      fn(val);
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
        settle(reject, new Error(`Google OAuth 授权被拒绝: ${error}`));
        return;
      }
      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>State mismatch</h1>");
        settle(reject, new Error("OAuth state 校验不匹配"));
        return;
      }
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Missing code");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Antigravity Imagine 授权成功</h1><p>可以关闭此页面返回终端继续使用。</p>");
      settle(resolve, code);
    });

    server.on("error", (err) => settle(reject, err));
    server.listen(port, "127.0.0.1", () => {
      timer = setTimeout(() => {
        settle(reject, new Error(`等待浏览器 OAuth 回调超时 (${Math.round(timeoutMs / 1000)}s)`));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });
  });
}

export async function runInteractiveLogin({
  env = process.env,
  proxyUrl = "",
  port = REDIRECT_PORT,
  noBrowser = false,
  log = console.log,
} = {}) {
  let cfg = loadSkillConfig(env);
  let { client_id, client_secret } = cfg.auth;

  if (!client_id || !client_secret) {
    const discovered = discoverClientCredentials({ env });
    if (!discovered) {
      throw new Error(
        "未能从本机 Antigravity.app 自动提取 client_id / client_secret。\n" +
          "请先安装 Antigravity Desktop，或通过 `config set --client-id ... --client-secret ...` 手动设置后再执行 `login`。",
      );
    }
    client_id = discovered.client_id;
    client_secret = discovered.client_secret;
    log(`[leo-antigravity-imagine] 已从 ${discovered.install_root} 自动提取 OAuth 客户端凭据。`);
  }

  const redirectUri = `http://localhost:${port}${REDIRECT_PATH}`;
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const authUrl = `${AUTH_URL}?${new URLSearchParams({
    client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  }).toString()}`;

  const codePromise = waitForOAuthCallback({ port, state });
  log(`[leo-antigravity-imagine] 请在浏览器中完成 Google 账号授权:\n  ${authUrl}`);
  if (!noBrowser) {
    openBrowser(authUrl);
  }

  const code = await codePromise;
  const rawToken = await postForm(
    TOKEN_URL,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id,
      client_secret,
    },
    { proxyUrl },
  );
  const tok = normalizeTokenResponse(rawToken);

  let account_id = cfg.auth.account_id || "";
  try {
    const infoRes = await requestWithProxy(USERINFO_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        "User-Agent": OAUTH_USER_AGENT,
      },
      proxyUrl,
      timeoutMs: 20000,
    });
    if (infoRes.ok) {
      const info = await infoRes.json();
      account_id = info.email || info.id || account_id;
    }
  } catch {
    // non-fatal
  }

  return updateSkillAuth(
    {
      client_id,
      client_secret,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || cfg.auth.refresh_token || "",
      expires_at: tok.expires_at,
      account_id,
      project: "", // clear cached project on new login so loadCodeAssist re-resolves it
    },
    env,
  );
}
