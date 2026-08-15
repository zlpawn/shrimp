import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { spawnSync } from "node:child_process";

function httpGet(url, { headers = {}, timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    try {
      const req = https.request(
        url,
        {
          method: "GET",
          headers,
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 400,
              status: res.statusCode,
              headers: res.headers,
              bodyPreview: body.slice(0, 300),
            });
          });
        },
      );
      req.on("error", (error) => resolve({ ok: false, status: 0, message: error.message }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, status: 0, message: "timeout" });
      });
      req.end();
    } catch (error) {
      resolve({ ok: false, status: 0, message: error.message || String(error) });
    }
  });
}

function listListeningPorts() {
  const res = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::1','::') } | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 20000 },
  );
  if (res.status !== 0) return { ok: false, error: (res.stderr || res.stdout || "").trim(), rows: [] };
  try {
    const parsed = JSON.parse(res.stdout || "[]");
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return {
      ok: true,
      rows: rows.map((row) => ({
        address: String(row.LocalAddress || ""),
        port: Number(row.LocalPort || 0),
        pid: Number(row.OwningProcess || 0),
      })),
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error), rows: [] };
  }
}

const mainLog = "C:/Users/xtea/AppData/Roaming/Antigravity/logs/main.log";
const text = fs.readFileSync(mainLog, "utf8");
const localMatches = [...text.matchAll(/Local:\s+(https:\/\/127\.0\.0\.1:(\d+)\/)/g)];
const csrfMatches = [...text.matchAll(/--csrf_token\s+([a-f0-9-]+)/g)];
const latestLocal = localMatches.length ? localMatches[localMatches.length - 1] : null;
const latestCsrf = csrfMatches.length ? csrfMatches[csrfMatches.length - 1][1] : "";
const latestPort = latestLocal ? Number(latestLocal[2]) : 0;
const latestUrl = latestLocal ? latestLocal[1] : "";

const listening = listListeningPorts();
const interestingListen = (listening.rows || []).filter((row) =>
  [9607, 9608, 13405, 8787, 6045, 6046].includes(row.port) ||
  (row.port >= 9000 && row.port <= 14000),
);

const urlsToTry = [];
if (latestUrl) {
  urlsToTry.push(latestUrl);
  urlsToTry.push(latestUrl + "health");
  urlsToTry.push(latestUrl + "api/health");
  urlsToTry.push(latestUrl + "v1/health");
  urlsToTry.push(latestUrl + "status");
}
urlsToTry.push("https://127.0.0.1:9608/");
urlsToTry.push("https://127.0.0.1:9607/");
urlsToTry.push("http://127.0.0.1:9607/json/version");
urlsToTry.push("http://127.0.0.1:9607/json/list");

const results = [];
for (const url of urlsToTry) {
  if (url.startsWith("https://")) {
    results.push({
      url,
      ...(await httpGet(url)),
      withCsrf: false,
    });
    if (latestCsrf) {
      results.push({
        url,
        ...(await httpGet(url, {
          headers: {
            "x-csrf-token": latestCsrf,
            cookie: "csrf_token=" + latestCsrf,
          },
        })),
        withCsrf: true,
      });
    }
  } else {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 1200);
      const res = await fetch(url, { method: "GET", signal: ac.signal });
      const body = await res.text();
      clearTimeout(timer);
      results.push({
        url,
        ok: res.ok,
        status: res.status,
        bodyPreview: body.slice(0, 300),
        withCsrf: false,
      });
    } catch (error) {
      results.push({
        url,
        ok: false,
        status: 0,
        message: error.message || String(error),
        withCsrf: false,
      });
    }
  }
}

// project store clues
const projectRoots = [
  "C:/Users/xtea/.gemini/config/projects",
  "C:/Users/xtea/.gemini/antigravity",
  "C:/Users/xtea/AppData/Roaming/Antigravity",
];
const projectTree = {};
for (const root of projectRoots) {
  try {
    if (!fs.existsSync(root)) {
      projectTree[root] = null;
      continue;
    }
    const entries = fs.readdirSync(root, { withFileTypes: true }).slice(0, 40).map((e) => ({
      name: e.name,
      dir: e.isDirectory(),
    }));
    projectTree[root] = entries;
  } catch (error) {
    projectTree[root] = { error: error.message || String(error) };
  }
}

const out = {
  measuredAt: new Date().toISOString(),
  latestLocalUrl: latestUrl,
  latestPort,
  latestCsrfPresent: Boolean(latestCsrf),
  listeningInteresting: interestingListen,
  probeResults: results,
  projectTree,
};
const outFile = path.join(
  "docs/superpowers/specs",
  "2026-08-15-antigravity-host-backend-probe-result.deep.json",
);
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  outFile,
  latestLocalUrl: latestUrl,
  latestPort,
  latestCsrfPresent: Boolean(latestCsrf),
  listeningCount: interestingListen.length,
  successfulProbes: results.filter((r) => r.ok).map((r) => ({ url: r.url, status: r.status, withCsrf: r.withCsrf })),
}, null, 2));
