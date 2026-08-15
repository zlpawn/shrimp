import fs from "node:fs";
import https from "node:https";
import path from "node:path";

function request(url, {
  method = "GET",
  headers = {},
  body = null,
  timeoutMs = 2000,
} = {}) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = https.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method,
          headers,
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            const text = buf.toString("utf8");
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 400,
              status: res.statusCode,
              headers: res.headers,
              body: text,
              bodyPreview: text.slice(0, 400),
            });
          });
        },
      );
      req.on("error", (error) => resolve({ ok: false, status: 0, message: error.message, body: "", bodyPreview: "" }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, status: 0, message: "timeout", body: "", bodyPreview: "" });
      });
      if (body) req.write(body);
      req.end();
    } catch (error) {
      resolve({ ok: false, status: 0, message: error.message || String(error), body: "", bodyPreview: "" });
    }
  });
}

function extractAppConfig(html) {
  const m = String(html || "").match(/window\.__APP_CONFIG__\s*=\s*(\{.*?\});/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return { raw: m[1] };
  }
}

function extractAssets(html) {
  const assets = [];
  for (const m of String(html || "").matchAll(/(?:src|href)=["']([^"']+\.(?:js|css|json|map))["']/g)) {
    assets.push(m[1]);
  }
  return [...new Set(assets)];
}

const baseUrl = "https://127.0.0.1:9608";
const home = await request(baseUrl + "/");
const appConfig = extractAppConfig(home.body || "");
const csrf = appConfig?.csrfToken || "";
const assets = extractAssets(home.body || "");

const headersNoAuth = {
  accept: "application/json, text/plain, */*",
};
const headersCsrf = {
  ...headersNoAuth,
  "x-csrf-token": csrf,
  "x-xsrf-token": csrf,
  cookie: "csrf_token=" + csrf,
  "content-type": "application/json",
};

const candidatePaths = [
  "/",
  "/health",
  "/status",
  "/api",
  "/api/health",
  "/api/status",
  "/api/version",
  "/api/projects",
  "/api/project",
  "/api/conversations",
  "/api/conversation",
  "/api/sessions",
  "/api/session",
  "/api/agents",
  "/api/agent",
  "/api/v1/projects",
  "/api/v1/conversations",
  "/api/v1/sessions",
  "/v1/projects",
  "/v1/conversations",
  "/v1/sessions",
  "/v1/agents",
  "/graphql",
  "/rpc",
  "/jsonrpc",
  "/ws",
  "/socket.io",
  "/openapi.json",
  "/swagger.json",
  "/.well-known/openapi",
];

const probes = [];
for (const pth of candidatePaths) {
  for (const withCsrf of [false, true]) {
    const res = await request(baseUrl + pth, {
      method: "GET",
      headers: withCsrf ? headersCsrf : headersNoAuth,
    });
    const contentType = res.headers?.["content-type"] || "";
    probes.push({
      path: pth,
      withCsrf,
      status: res.status,
      ok: res.ok,
      contentType,
      looksJson: contentType.includes("json") || /^\s*[\[{]/.test(res.body || ""),
      bodyPreview: res.bodyPreview,
      message: res.message || "",
    });
  }
}

// Also try OPTIONS/POST on a few likely endpoints
const mutating = [];
for (const pth of ["/api/conversations", "/api/v1/conversations", "/v1/conversations", "/graphql", "/rpc"]) {
  for (const method of ["OPTIONS", "POST"]) {
    const res = await request(baseUrl + pth, {
      method,
      headers: headersCsrf,
      body: method === "POST" ? JSON.stringify({ query: "{ __typename }" }) : null,
    });
    mutating.push({
      path: pth,
      method,
      status: res.status,
      contentType: res.headers?.["content-type"] || "",
      bodyPreview: res.bodyPreview,
      message: res.message || "",
    });
  }
}

// Download JS assets and search for API path strings
const assetHits = [];
const downloaded = [];
for (const asset of assets.slice(0, 20)) {
  const url = asset.startsWith("http") ? asset : baseUrl + (asset.startsWith("/") ? asset : "/" + asset);
  const res = await request(url, { headers: headersNoAuth, timeoutMs: 4000 });
  if (!res.ok || !res.body) continue;
  downloaded.push({ url, bytes: res.body.length, contentType: res.headers?.["content-type"] || "" });
  if (!url.endsWith(".js") && !(res.headers?.["content-type"] || "").includes("javascript")) continue;
  const patterns = [
    /\/api\/[A-Za-z0-9_\-\/{}]+/g,
    /\/v1\/[A-Za-z0-9_\-\/{}]+/g,
    /conversation[sA-Za-z0-9_\-]*/gi,
    /project[sA-Za-z0-9_\-]*/gi,
    /approval[sA-Za-z0-9_\-]*/gi,
    /agent[sA-Za-z0-9_\-]*/gi,
    /csrf[A-Za-z0-9_\-]*/gi,
    /RemoteControl[A-Za-z0-9_\-]*/g,
    /createConversation|listProjects|dispatchPrompt|sendPrompt|listConversations/g,
  ];
  const found = {};
  for (const re of patterns) {
    const matches = res.body.match(re) || [];
    if (matches.length) found[String(re)] = [...new Set(matches)].slice(0, 40);
  }
  if (Object.keys(found).length) {
    assetHits.push({ url, found });
  }
}

const out = {
  measuredAt: new Date().toISOString(),
  baseUrl,
  appConfig,
  assets,
  probes,
  mutating,
  downloaded,
  assetHits,
};
const outFile = path.join(
  "docs/superpowers/specs",
  "2026-08-15-antigravity-local-api-reverse-result.json",
);
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));

const jsonLike = probes.filter((p) => p.looksJson);
const nonHtmlOk = probes.filter((p) => p.ok && !(p.contentType || "").includes("text/html"));
console.log(JSON.stringify({
  outFile,
  csrfPresent: Boolean(csrf),
  assetCount: assets.length,
  downloadedJs: downloaded.length,
  assetHitCount: assetHits.length,
  jsonLikeCount: jsonLike.length,
  nonHtmlOkCount: nonHtmlOk.length,
  nonHtmlOk: nonHtmlOk.slice(0, 20),
  sampleAssetHits: assetHits.slice(0, 3).map((x) => ({ url: x.url, keys: Object.keys(x.found) })),
}, null, 2));
