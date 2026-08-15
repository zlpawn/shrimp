import https from "node:https";
import crypto from "node:crypto";
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
function post(url, body, headers = {}) {
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
        timeout: 12000,
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
          } catch {}
          resolve({
            status: res.statusCode,
            json,
            preview: text.slice(0, 500),
          });
        });
      },
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "timeout" });
    });
    req.write(data);
    req.end();
  });
}

const html = await get("https://127.0.0.1:9608/");
const csrf = html.match(/csrfToken":"([^"]+)/)?.[1] || "";
const headers = { "x-codeium-csrf-token": csrf };
const base = "https://127.0.0.1:9608/exa.language_server_pb.LanguageServerService";
const uuid = () => crypto.randomUUID();
const workspaceUri = "file:///d:/agent-transfer";

const cases = [];
function add(name, body) {
  cases.push({ name, body });
}

const cascadeId = uuid();
add("source_enum_name", {
  cascadeId,
  source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
  workspaceUris: [workspaceUri],
});
add("source_short_name", {
  cascadeId: uuid(),
  source: "CASCADE_CLIENT",
  workspaceUris: [workspaceUri],
});
add("source_number", {
  cascadeId: uuid(),
  source: 1,
  workspaceUris: [workspaceUri],
});
add("source_and_type_cascade", {
  cascadeId: uuid(),
  source: "CASCADE_CLIENT",
  trajectoryType: "CASCADE",
  workspaceUris: [workspaceUri],
});
add("source_and_type_full", {
  cascadeId: uuid(),
  source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
  trajectoryType: "CORTEX_TRAJECTORY_TYPE_CASCADE",
  workspaceUris: [workspaceUri],
});
add("source_type_numbers", {
  cascadeId: uuid(),
  source: 1,
  trajectoryType: 4,
  workspaceUris: [workspaceUri],
});
add("interactive_source", {
  cascadeId: uuid(),
  source: "INTERACTIVE_CASCADE",
  trajectoryType: "CASCADE",
  workspaceUris: [workspaceUri],
});
add("agent_api_source", {
  cascadeId: uuid(),
  source: "AGENT_API",
  trajectoryType: "CASCADE",
  workspaceUris: [workspaceUri],
});
add("only_source_no_workspace", {
  cascadeId: uuid(),
  source: "CASCADE_CLIENT",
});
add("workspace_single_field", {
  cascadeId: uuid(),
  source: "CASCADE_CLIENT",
  workspaceUri,
});

const results = [];
for (const c of cases) {
  const res = await post(base + "/StartCascade", c.body, headers);
  results.push({
    name: c.name,
    body: c.body,
    status: res.status,
    error: res.error || null,
    code: res.json?.code || null,
    message: res.json?.message || null,
    keys: res.json && !res.json.code ? Object.keys(res.json) : [],
    preview: res.preview,
  });
  console.log(
    c.name,
    res.status,
    res.json?.code || "ok",
    (res.json?.message || JSON.stringify(res.json || res.preview)).slice(0, 180),
  );
}

// if any success, inspect with GetCascadeTrajectory
const ok = results.find((r) => r.status === 200 && !r.code);
if (ok) {
  const id = ok.body.cascadeId;
  const detail = await post(base + "/GetCascadeTrajectory", { cascadeId: id }, headers);
  console.log("\ninspect after start", detail.status, detail.preview?.slice(0, 300));
}

fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-startcascade-probe.json",
  JSON.stringify({ csrf: csrf.slice(0, 8) + "...", results }, null, 2),
);
