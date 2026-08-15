import https from "node:https";
import fs from "node:fs";

const agent = new https.Agent({ rejectUnauthorized: false });
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent, timeout: 20000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject);
  });
}
function request(url, { method = "POST", headers = {}, body = "" } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
        agent,
        timeout: 4000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf8");
          resolve({
            url,
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            headers: Object.fromEntries(
              Object.entries(res.headers).filter(([k]) =>
                /content|grpc|connect|csrf|x-/i.test(k),
              ),
            ),
            length: buf.length,
            looksHtml: /<!doctype html|<html/i.test(text),
            looksJson: /^\s*[\[{]/.test(text),
            preview: text.slice(0, 300).replace(/\s+/g, " "),
          });
        });
      },
    );
    req.on("error", (e) => resolve({ url, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ url, error: "timeout" });
    });
    if (body) req.write(body);
    req.end();
  });
}

const html = await get("https://127.0.0.1:9608/");
const csrf = html.match(/csrfToken":"([^"]+)/)?.[1] || "";
const js = await get("https://127.0.0.1:9608/main.js");

// Extract service typeName near package that has startCascade method.
// In protobuf-es generated code, service often has:
// { typeName: "pkg.Service", methods: { startCascade: { name: "StartCascade", ... } } }
// But minified may use different shape. Search for "StartCascade" case variants and nearby typeName.
const needles = [
  "StartCascade",
  "startCascade",
  "SendUserCascadeMessage",
  "GetCascadeTrajectory",
  "GetAllCascadeTrajectories",
  "StreamAgentStateUpdates",
  "CancelCascadeInvocation",
];
const nearby = {};
for (const n of needles) {
  const idx = js.indexOf(n);
  nearby[n] = idx >= 0 ? js.slice(Math.max(0, idx - 300), idx + 300) : null;
}

// Find all typeName strings that are not google.protobuf
const typeNames = [...js.matchAll(/typeName:"([^"]+)"/g)].map((m) => m[1]);
const nonGoogle = [...new Set(typeNames)].filter((t) => !t.includes("google.protobuf") && !t.startsWith(".google"));
console.log("nonGoogle typeNames", nonGoogle);

// Extract package names from file_* constants
const pkgs = [...js.matchAll(/file_([a-z0-9_]+)_pb_([a-z0-9_]+)/g)].map((m) => m[0]);
console.log("file packages", [...new Set(pkgs)]);

// From protobuf-es service client generation, methods usually have I: RequestSchema, O: ResponseSchema, kind: MethodKind.Unary
// Search for MethodKind around startCascade wrappers is hard. Try brute force common service path guesses.
const serviceCandidates = [
  "exa.language_server_pb.LanguageServerService",
  "exa.cortex_pb.CortexService",
  "exa.cortex_pb.LanguageServerService",
  "exa.seat_management_pb.SeatManagementService",
  "exa.chat_pb.ChatService",
  "codeium.LanguageServerService",
  "codeium.api_server_pb.ApiServerService",
  "jetski.cortex.LanguageServerService",
  "third_party.jetski.cortex.LanguageServerService",
  "third_party.jetski.cortex_pb.CortexService",
  "third_party.jetski.jetski_cortex_pb.JetskiCortexService",
  "jetski_cortex.JetskiCortexService",
  "jetski.LanguageServerService",
  "LanguageServerService",
  "CortexService",
  "CascadeService",
  "AgentService",
];
const methods = [
  "StartCascade",
  "startCascade",
  "GetCascadeTrajectory",
  "getCascadeTrajectory",
  "GetAllCascadeTrajectories",
  "getAllCascadeTrajectories",
  "SendUserCascadeMessage",
  "sendUserCascadeMessage",
  "StreamAgentStateUpdates",
  "streamAgentStateUpdates",
];

const headersBase = {
  "content-type": "application/json",
  "connect-protocol-version": "1",
  "x-codeium-csrf-token": csrf,
  accept: "application/json",
};

const probes = [];
for (const service of serviceCandidates) {
  for (const method of methods) {
    const path = `/${service}/${method}`;
    probes.push(
      await request("https://127.0.0.1:9608" + path, {
        headers: headersBase,
        body: "{}",
      }),
    );
  }
}

// Also probe websocket connect path over http on 9609 with CSRF
function wsUpgrade(port, path, headers = {}) {
  return new Promise((resolve) => {
    const req = https.request
      ? null
      : null;
  });
}

import http from "node:http";
function upgrade(port, path, extra = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": Buffer.from("abcdefghijklmnop").toString("base64"),
          "x-codeium-csrf-token": csrf,
          ...extra,
        },
        timeout: 2500,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            port,
            path,
            status: res.statusCode,
            upgrade: false,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8").slice(0, 200),
          });
        });
      },
    );
    req.on("upgrade", (res, socket) => {
      resolve({
        port,
        path,
        status: 101,
        upgrade: true,
        headers: res.headers,
      });
      socket.destroy();
    });
    req.on("error", (e) => resolve({ port, path, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ port, path, error: "timeout" });
    });
    req.end();
  });
}

const upgrades = [];
for (const p of [
  "/connect-websocket",
  "/connect-websocket/",
  "/ws",
  "/",
]) {
  upgrades.push(await upgrade(9609, p));
  upgrades.push(await upgrade(9608, p)); // may fail due https
}

const interesting = probes.filter(
  (p) =>
    p &&
    !p.error &&
    !p.looksHtml &&
    (p.status !== 200 || p.looksJson || /connect|grpc|json|proto/i.test(p.contentType)),
);

// classify statuses
const byStatus = {};
for (const p of probes) {
  const k = p.error ? "error" : String(p.status);
  byStatus[k] = (byStatus[k] || 0) + 1;
}

const nonHtml = probes.filter((p) => p && !p.error && !p.looksHtml);

const result = {
  csrf,
  nonGoogleTypeNames: nonGoogle,
  nearby,
  byStatus,
  nonHtmlCount: nonHtml.length,
  nonHtmlSample: nonHtml.slice(0, 40),
  interesting: interesting.slice(0, 40),
  upgrades,
  // any response not SPA html is gold
  gold: probes.filter((p) => p && !p.error && !p.looksHtml).slice(0, 80),
};

fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-connect-path-probe.json",
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    {
      byStatus,
      nonHtmlCount: nonHtml.length,
      goldSample: result.gold.slice(0, 20),
      upgrades,
      nonGoogleTypeNames: nonGoogle,
    },
    null,
    2,
  ),
);
