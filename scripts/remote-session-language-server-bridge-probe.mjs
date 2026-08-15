import https from "node:https";
import http from "node:http";

const agent = new https.Agent({ rejectUnauthorized: false });

function request(url, { method = "GET", headers = {}, body = null, timeout = 2500 } = {}) {
  const lib = url.startsWith("https") ? https : http;
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
        agent: url.startsWith("https") ? agent : undefined,
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf8");
          resolve({
            url,
            method,
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            length: buf.length,
            looksJson: /^\s*[\[{]/.test(text),
            looksHtml: /<!doctype html|<html/i.test(text),
            preview: text.slice(0, 220).replace(/\s+/g, " "),
            interestingHeaders: Object.fromEntries(
              Object.entries(res.headers).filter(([k]) =>
                /content|server|upgrade|websocket|grpc|csrf|x-/i.test(k),
              ),
            ),
          });
        });
      },
    );
    req.on("error", (e) => resolve({ url, method, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ url, method, error: "timeout" });
    });
    if (body) req.write(body);
    req.end();
  });
}

function wsUpgrade(host, port, path) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path,
        method: "GET",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": Buffer.from("test-key-123456789012").toString("base64"),
          Host: `${host}:${port}`,
        },
        timeout: 2000,
      },
      (res) => {
        resolve({
          host,
          port,
          path,
          status: res.statusCode,
          upgrade: false,
          headers: res.headers,
        });
        res.resume();
      },
    );
    req.on("upgrade", (res, socket, head) => {
      resolve({
        host,
        port,
        path,
        status: 101,
        upgrade: true,
        headers: res.headers,
        headLen: head.length,
      });
      socket.destroy();
    });
    req.on("error", (e) => resolve({ host, port, path, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ host, port, path, error: "timeout" });
    });
    req.end();
  });
}

const root = await request("https://127.0.0.1:9608/");
const csrfMatch = String(root.preview || "").match(/csrfToken":"([^"]+)/);
const liveCsrf = csrfMatch?.[1] || "";
console.log("root", {
  status: root.status,
  contentType: root.contentType,
  liveCsrf,
  preview: root.preview,
});

const paths = [
  "/",
  "/health",
  "/status",
  "/api",
  "/api/store",
  "/rpc",
  "/grpc",
  "/ws",
  "/websocket",
  "/socket",
  "/connect",
  "/v1",
  "/v1/rpc",
  "/jsonrpc",
  "/events",
  "/stream",
  "/browser",
  "/chrome",
  "/cdp",
];
const bases = [
  "https://127.0.0.1:9608",
  "http://127.0.0.1:9609",
  "https://127.0.0.1:9609",
  "http://127.0.0.1:9608",
];

const results = [];
for (const base of bases) {
  for (const p of paths) {
    results.push(await request(base + p, { method: "GET" }));
    results.push(
      await request(base + p, {
        method: "GET",
        headers: {
          "x-csrf-token": liveCsrf,
          "csrf-token": liveCsrf,
          accept: "application/json",
        },
      }),
    );
    results.push(
      await request(base + p, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": liveCsrf,
          accept: "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    results.push(await request(base + p, { method: "OPTIONS" }));
  }
}

const upgrades = [];
for (const p of ["/", "/ws", "/websocket", "/socket", "/rpc", "/grpc", "/events", "/stream", "/browser"]) {
  upgrades.push(await wsUpgrade("127.0.0.1", 9609, p));
  upgrades.push(await wsUpgrade("127.0.0.1", 9608, p));
}

const interesting = results.filter(
  (r) =>
    !r.error &&
    (r.looksJson ||
      r.status === 101 ||
      r.status === 426 ||
      r.status === 401 ||
      r.status === 403 ||
      r.status === 404 ||
      (r.contentType && !/html/i.test(r.contentType))),
);
const nonHtml = results.filter((r) => !r.error && !r.looksHtml);

console.log(
  JSON.stringify(
    {
      totals: {
        results: results.length,
        nonHtml: nonHtml.length,
        interesting: interesting.length,
        errors: results.filter((r) => r.error).length,
      },
      interesting: interesting.slice(0, 50),
      nonHtmlSample: nonHtml.slice(0, 30),
      upgrades,
      errorSample: results.filter((r) => r.error).slice(0, 20),
    },
    null,
    2,
  ),
);
