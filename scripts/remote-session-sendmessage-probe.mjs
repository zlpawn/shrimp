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
        timeout: 20000,
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
          resolve({ status: res.statusCode, json, preview: text.slice(0, 800) });
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
const workspaceUri = "file:///d:/agent-transfer";

async function start() {
  const cascadeId = crypto.randomUUID();
  const res = await post(
    base + "/StartCascade",
    {
      cascadeId,
      source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
      trajectoryType: "CORTEX_TRAJECTORY_TYPE_CASCADE",
      workspaceUris: [workspaceUri],
    },
    headers,
  );
  return { cascadeId, res };
}

const { cascadeId, res: startRes } = await start();
console.log("start", startRes.status, startRes.preview);

const itemVariants = [
  {
    name: "items_text_chunk",
    body: {
      cascadeId,
      items: [{ chunk: { case: "text", value: "ping from remote-session probe" } }],
    },
  },
  {
    name: "items_plain_text",
    body: {
      cascadeId,
      items: [{ text: "ping from remote-session probe plain" }],
    },
  },
  {
    name: "items_oneof_text",
    body: {
      cascadeId,
      items: [{ text: "ping oneof style", item: undefined }],
    },
  },
  {
    name: "items_value_text",
    body: {
      cascadeId,
      items: [{ value: "ping value style" }],
    },
  },
  {
    name: "items_content_text",
    body: {
      cascadeId,
      items: [{ content: "ping content style" }],
    },
  },
  {
    name: "message_field",
    body: {
      cascadeId,
      message: "ping message field",
    },
  },
  {
    name: "prompt_field",
    body: {
      cascadeId,
      prompt: "ping prompt field",
    },
  },
  {
    name: "items_chunk_text_only",
    body: {
      cascadeId,
      items: [{ chunk: { text: "ping nested text" } }],
    },
  },
  {
    name: "items_case_text_field",
    body: {
      cascadeId,
      items: [{ case: "text", value: "ping case value", text: "ping case value" }],
    },
  },
];

const results = [];
for (const v of itemVariants) {
  // start a fresh cascade for each write probe to avoid pollution if one succeeds
  const started = await start();
  const body = JSON.parse(JSON.stringify(v.body));
  body.cascadeId = started.cascadeId;
  const res = await post(base + "/SendUserCascadeMessage", body, headers);
  const row = {
    name: v.name,
    cascadeId: started.cascadeId,
    status: res.status,
    error: res.error || null,
    code: res.json?.code || null,
    message: res.json?.message || null,
    keys: res.json && !res.json.code ? Object.keys(res.json) : [],
    preview: res.preview,
  };
  results.push(row);
  console.log(v.name, res.status, res.json?.code || "ok", (res.json?.message || res.preview || "").slice(0, 200));
  if (res.status === 200 && !res.json?.code) {
    // inspect trajectory after a short wait
    await new Promise((r) => setTimeout(r, 1500));
    const detail = await post(
      base + "/GetCascadeTrajectory",
      { cascadeId: started.cascadeId },
      headers,
    );
    console.log(
      "  inspect steps",
      detail.json?.trajectory?.steps?.length,
      detail.json?.status,
      JSON.stringify(detail.json?.trajectory?.steps?.[0] || null).slice(0, 250),
    );
    row.inspect = {
      status: detail.status,
      runStatus: detail.json?.status,
      stepCount: detail.json?.trajectory?.steps?.length,
      firstStepType: detail.json?.trajectory?.steps?.[0]?.type,
    };
  }
}

fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-sendmessage-probe.json",
  JSON.stringify({ results }, null, 2),
);
