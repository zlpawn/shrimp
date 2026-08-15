import fs from "node:fs";
import https from "node:https";
import path from "node:path";

function request(url, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

const baseUrl = "https://127.0.0.1:9608";
const js = await request(baseUrl + "/main.js");
fs.writeFileSync("docs/superpowers/specs/_tmp-antigravity-main.js", js, "utf8");

function collect(re, label, max = 80) {
  const matches = js.match(re) || [];
  return { label, count: matches.length, samples: [...new Set(matches)].slice(0, max) };
}

const reports = [];
reports.push(collect(/\/api\/[A-Za-z0-9_\-\/.{}]+/g, "api_paths"));
reports.push(collect(/\/v1\/[A-Za-z0-9_\-\/.{}]+/g, "v1_paths"));
reports.push(collect(/["'`](\/[A-Za-z0-9_\-/.{}]+(?:conversation|project|session|agent|approval|prompt|message|cascade)[A-Za-z0-9_\-/.{}]*)["'`]/gi, "quoted_domain_paths"));
// better quoted path extraction
const quoted = [];
for (const m of js.matchAll(/["'`](\/[A-Za-z0-9_\-/.${}]+ )["'`]/g)) {
  // skip
}
for (const m of js.matchAll(/["'`](\/[A-Za-z0-9_\-/.${}]+)["'`]/g)) {
  const p = m[1];
  if (
    /conversation|project|session|agent|approval|prompt|message|cascade|remote|control|grpc|ws|socket/i.test(p)
  ) {
    quoted.push(p);
  }
}
reports.push({ label: "quoted_interesting_paths", count: quoted.length, samples: [...new Set(quoted)].slice(0, 120) });

// function-ish names
const names = [];
for (const m of js.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{0,40}(?:Conversation|Project|Session|Approval|Prompt|RemoteControl|Cascade)[A-Za-z0-9_]{0,40})\b/g)) {
  names.push(m[1]);
}
reports.push({ label: "interesting_identifiers", count: names.length, samples: [...new Set(names)].slice(0, 120) });

// nearby context for conversation create/list
function contexts(term, max = 12) {
  const out = [];
  let idx = 0;
  while (out.length < max) {
    const i = js.indexOf(term, idx);
    if (i < 0) break;
    out.push(js.slice(Math.max(0, i - 120), Math.min(js.length, i + 180)).replace(/\s+/g, " "));
    idx = i + term.length;
  }
  return out;
}

const contextTerms = [
  "createConversation",
  "listConversations",
  "listProjects",
  "RemoteControl",
  "/api/conversations",
  "/api/projects",
  "approval",
  "dispatch",
  "sendMessage",
  "cascade",
];
const contextHits = {};
for (const term of contextTerms) {
  contextHits[term] = contexts(term, 8);
}

// Try probing interesting quoted paths discovered from JS
const interestingPaths = [...new Set(quoted)].filter((p) => p.startsWith("/") && p.length < 120).slice(0, 60);
const probe = [];
const home = await request(baseUrl + "/");
const csrfMatch = home.match(/"csrfToken":"([^"]+)"/);
const csrf = csrfMatch ? csrfMatch[1] : "";
function reqJson(urlPath) {
  return new Promise((resolve) => {
    const u = new URL(baseUrl + urlPath);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        rejectUnauthorized: false,
        timeout: 1500,
        headers: {
          accept: "application/json, text/plain, */*",
          "x-csrf-token": csrf,
          cookie: "csrf_token=" + csrf,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            path: urlPath,
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            bodyPreview: body.slice(0, 180),
          });
        });
      },
    );
    req.on("error", (e) => resolve({ path: urlPath, status: 0, message: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ path: urlPath, status: 0, message: "timeout" });
    });
    req.end();
  });
}
for (const p of interestingPaths) {
  probe.push(await reqJson(p));
}

const out = {
  measuredAt: new Date().toISOString(),
  jsBytes: js.length,
  reports,
  contextHits,
  interestingPathProbes: probe,
};
fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-mainjs-api-extract.json",
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify({
  jsBytes: js.length,
  apiPathSamples: reports.find((r) => r.label === "api_paths")?.samples?.slice(0, 30) || [],
  v1PathSamples: reports.find((r) => r.label === "v1_paths")?.samples?.slice(0, 30) || [],
  quotedSamples: reports.find((r) => r.label === "quoted_interesting_paths")?.samples?.slice(0, 40) || [],
  idSamples: reports.find((r) => r.label === "interesting_identifiers")?.samples?.slice(0, 40) || [],
  nonHtmlProbes: probe.filter((p) => p.status && !(p.contentType || "").includes("text/html")).slice(0, 20),
  contextKeys: Object.fromEntries(Object.entries(contextHits).map(([k, v]) => [k, v.length])),
}, null, 2));
