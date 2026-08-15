import fs from "node:fs";
import https from "node:https";
import path from "node:path";

function request(url, { method = "GET", headers = {}, body = null, timeoutMs = 2500 } = {}) {
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
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({
              status: res.statusCode,
              headers: res.headers,
              bodyPreview: text.slice(0, 500),
              contentType: res.headers["content-type"] || "",
            });
          });
        },
      );
      req.on("error", (e) => resolve({ status: 0, message: e.message, bodyPreview: "", contentType: "" }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ status: 0, message: "timeout", bodyPreview: "", contentType: "" });
      });
      if (body) req.write(body);
      req.end();
    } catch (e) {
      resolve({ status: 0, message: e.message || String(e), bodyPreview: "", contentType: "" });
    }
  });
}

const baseUrl = "https://127.0.0.1:9608";
const home = await request(baseUrl + "/");
const csrf = (home.bodyPreview.match(/"csrfToken":"([^"]+)"/) || [])[1] || "";
const headers = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "x-csrf-token": csrf,
  cookie: "csrf_token=" + csrf,
};

const variants = [
  { method: "GET", path: "/api/store" },
  { method: "GET", path: "/api/store#subscribelistener" },
  { method: "POST", path: "/api/store", body: JSON.stringify({ type: "subscribe" }) },
  { method: "POST", path: "/api/store", body: JSON.stringify({ method: "listProjects" }) },
  { method: "POST", path: "/api/store", body: JSON.stringify({ method: "getConversationItems" }) },
  { method: "POST", path: "/api/store", body: JSON.stringify({ method: "openNewConversation" }) },
  { method: "POST", path: "/api/store", body: JSON.stringify({ op: "list", resource: "projects" }) },
  { method: "POST", path: "/api/store", body: JSON.stringify({ type: "rpc", method: "listProjects", params: {} }) },
  { method: "OPTIONS", path: "/api/store" },
];

const results = [];
for (const v of variants) {
  const res = await request(baseUrl + v.path.replace(/#.*/, ""), {
    method: v.method,
    headers,
    body: v.body || null,
  });
  results.push({ ...v, ...res });
}

const out = {
  measuredAt: new Date().toISOString(),
  baseUrl,
  csrfPresent: Boolean(csrf),
  results,
};
fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-api-store-probe.json",
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify({
  csrfPresent: Boolean(csrf),
  results: results.map((r) => ({
    method: r.method,
    path: r.path,
    status: r.status,
    contentType: r.contentType,
    bodyPreview: r.bodyPreview?.slice(0, 120),
    message: r.message || "",
  })),
}, null, 2));
