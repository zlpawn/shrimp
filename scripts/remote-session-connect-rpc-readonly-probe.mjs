import https from "node:https";
import fs from "node:fs";

const agent = new https.Agent({ rejectUnauthorized: false });
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject);
  });
}
function postJson(url, body, headers = {}) {
  const data = JSON.stringify(body ?? {});
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "POST",
        agent,
        timeout: 8000,
        headers: {
          "content-type": "application/json",
          "connect-protocol-version": "1",
          accept: "application/json",
          "content-length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({
            url,
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            json,
            preview: text.slice(0, 500),
          });
        });
      },
    );
    req.on("error", (e) => resolve({ url, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ url, error: "timeout" });
    });
    req.write(data);
    req.end();
  });
}

const html = await get("https://127.0.0.1:9608/");
const csrf = html.match(/csrfToken":"([^"]+)/)?.[1] || "";
const headers = { "x-codeium-csrf-token": csrf };
const base = "https://127.0.0.1:9608/exa.language_server_pb.LanguageServerService";
const cascadeId = "21335b56-743a-4e24-8066-43540024eb37";

const calls = [];
calls.push(await postJson(base + "/GetAllCascadeTrajectories", {}, headers));
calls.push(
  await postJson(
    base + "/GetCascadeTrajectory",
    { cascadeId },
    headers,
  ),
);
calls.push(
  await postJson(
    base + "/GetCascadeTrajectory",
    { cascadeId, trajectoryVerbosity: "TRAJECTORY_VERBOSITY_FULL" },
    headers,
  ),
);
calls.push(
  await postJson(
    base + "/GetCascadeTrajectory",
    { cascadeId, trajectoryVerbosity: 2 },
    headers,
  ),
);
calls.push(
  await postJson(
    base + "/GetCascadeTrajectorySteps",
    { cascadeId, stepOffset: 0 },
    headers,
  ),
);
calls.push(
  await postJson(
    base + "/GetConversationMetadata",
    { cascadeId },
    headers,
  ),
);
calls.push(
  await postJson(
    base + "/GetConversationItems",
    { cascadeId },
    headers,
  ),
);
calls.push(
  await postJson(
    base + "/SearchConversations",
    { query: "什么东西" },
    headers,
  ),
);
calls.push(
  await postJson(
    base + "/GetCascadeConfig",
    {},
    headers,
  ),
);

// Discover more methods by probing likely names with empty body
const methodGuesses = [
  "GetProjects",
  "ListProjects",
  "GetLoadedProjects",
  "GetUserStatus",
  "GetPlanStatus",
  "GetCascadeNuxes",
  "GetAvailableCascadePlugins",
  "GetModelConfig",
  "GetUserSettings",
  "Ping",
  "HealthCheck",
  "GetServerInfo",
  "GetAuthToken",
  "RefreshAuthToken",
  "GetLocalEndpoints",
];
for (const m of methodGuesses) {
  calls.push(await postJson(base + "/" + m, {}, headers));
}

const summary = calls.map((c) => ({
  method: String(c.url || "").split("/").pop(),
  status: c.status,
  error: c.error || null,
  code: c.json?.code || null,
  message: c.json?.message || null,
  keys: c.json && typeof c.json === "object" ? Object.keys(c.json).slice(0, 20) : [],
  preview: c.preview?.slice(0, 220),
}));

fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-connect-rpc-readonly-probe.json",
  JSON.stringify({ csrf, summary, raw: calls }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
