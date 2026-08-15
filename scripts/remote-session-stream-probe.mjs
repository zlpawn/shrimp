import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

const agent = new https.Agent({ rejectUnauthorized: false });
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent, timeout: 15000 }, (res) => {
      const c = [];
      res.on("data", (d) => c.push(d));
      res.on("end", () => resolve(Buffer.concat(c).toString("utf8")));
    }).on("error", reject);
  });
}
function request(url, { method = "POST", headers = {}, body = null, timeout = 8000 } = {}) {
  const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        agent: u.protocol === "https:" ? agent : undefined,
        timeout,
        headers: {
          ...(data ? { "content-length": data.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const c = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () => {
          const buf = Buffer.concat(c);
          const text = buf.toString("utf8");
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            buf,
          });
        });
      },
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "timeout" });
    });
    if (data) req.write(data);
    req.end();
  });
}

const baseUrl = "https://127.0.0.1:6506";
const html = await get(baseUrl + "/");
const csrf = html.match(/csrfToken":"([^"]+)/)?.[1] || "";
const service = "exa.language_server_pb.LanguageServerService";
const method = "StreamAgentStateUpdates";
const path = `/${service}/${method}`;

// create a cascade first so we have an id to subscribe
const cascadeId = crypto.randomUUID();
const start = await request(`${baseUrl}/${service}/StartCascade`, {
  headers: {
    "content-type": "application/json",
    "connect-protocol-version": "1",
    "x-codeium-csrf-token": csrf,
    accept: "application/json",
  },
  body: JSON.stringify({
    cascadeId,
    source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
    trajectoryType: "CORTEX_TRAJECTORY_TYPE_CASCADE",
    workspaceUris: ["file:///d:/agent-transfer"],
  }),
});
console.log("start", start.status, start.text);

const bodies = [
  {},
  { cascadeId },
  { conversationId: cascadeId },
  { cascadeIds: [cascadeId] },
  { ids: [cascadeId] },
];

const contentTypes = [
  "application/json",
  "application/connect+json",
  "application/connect+proto",
  "application/grpc-web+json",
  "application/grpc-web+proto",
];

const results = [];
for (const ct of contentTypes) {
  for (const body of bodies) {
    const headers = {
      "content-type": ct,
      "connect-protocol-version": "1",
      "x-codeium-csrf-token": csrf,
      accept: ct.includes("proto") ? "application/connect+proto" : "application/connect+json",
    };
    let payload;
    if (ct.includes("json")) {
      // for connect streaming unary envelope maybe need framing; first try plain json
      payload = JSON.stringify(body);
    } else {
      payload = JSON.stringify(body);
    }
    const res = await request(baseUrl + path, {
      headers,
      body: payload,
      timeout: 4000,
    });
    results.push({
      contentType: ct,
      body,
      status: res.status,
      error: res.error || null,
      respCT: res.headers?.["content-type"] || "",
      preview: (res.text || "").slice(0, 200),
    });
    console.log(ct, JSON.stringify(body), res.status || res.error, (res.text || "").slice(0, 120));
  }
}

// connect streaming frame attempt: 5-byte envelope + json body
function connectFrame(obj, flags = 0) {
  const json = Buffer.from(JSON.stringify(obj));
  const out = Buffer.alloc(5 + json.length);
  out.writeUInt8(flags, 0);
  out.writeUInt32BE(json.length, 1);
  json.copy(out, 5);
  return out;
}
for (const body of [{}, { cascadeId }]) {
  const framed = connectFrame(body, 0);
  const res = await request(baseUrl + path, {
    headers: {
      "content-type": "application/connect+json",
      "connect-protocol-version": "1",
      "x-codeium-csrf-token": csrf,
      accept: "application/connect+json",
    },
    body: framed,
    timeout: 5000,
  });
  results.push({
    contentType: "application/connect+json-framed",
    body,
    status: res.status,
    error: res.error || null,
    respCT: res.headers?.["content-type"] || "",
    preview: (res.text || "").slice(0, 200),
    hex: res.buf ? res.buf.slice(0, 40).toString("hex") : "",
  });
  console.log("framed", JSON.stringify(body), res.status || res.error, (res.text || "").slice(0, 160));
}

// websocket quick open on 6507
function wsOpen(port, pathName) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString("base64");
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathName,
        method: "GET",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": key,
          "x-codeium-csrf-token": csrf,
        },
        timeout: 3000,
      },
      (res) => {
        const c = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () =>
          resolve({
            upgrade: false,
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(c).toString("utf8").slice(0, 200),
          }),
        );
      },
    );
    req.on("upgrade", (res, socket) => {
      resolve({ upgrade: true, status: 101, headers: res.headers, path: pathName, port });
      socket.destroy();
    });
    req.on("error", (e) => resolve({ error: e.message, path: pathName, port }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "timeout", path: pathName, port });
    });
    req.end();
  });
}
const upgrades = [];
for (const pth of ["/connect-websocket", "/", "/ws"]) {
  upgrades.push(await wsOpen(6507, pth));
  upgrades.push(await wsOpen(6506, pth));
}
console.log("upgrades", upgrades);

fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-stream-probe.json",
  JSON.stringify({ cascadeId, results, upgrades }, null, 2),
);
