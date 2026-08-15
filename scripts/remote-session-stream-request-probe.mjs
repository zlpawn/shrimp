import https from "node:https";
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
function postRaw(url, { headers = {}, body, timeout = 12000 } = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
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
        timeout,
        headers: {
          "content-length": data.length,
          ...headers,
        },
      },
      (res) => {
        const c = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () => {
          const buf = Buffer.concat(c);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            buf,
            text: buf.toString("utf8"),
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
function connectFrame(obj, flags = 0) {
  const json = Buffer.from(JSON.stringify(obj));
  const out = Buffer.alloc(5 + json.length);
  out[0] = flags;
  out.writeUInt32BE(json.length, 1);
  json.copy(out, 5);
  return out;
}
function parseConnectFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset + 5 <= buf.length) {
    const flags = buf[offset];
    const len = buf.readUInt32BE(offset + 1);
    offset += 5;
    if (offset + len > buf.length) {
      frames.push({ flags, error: "truncated", remaining: buf.length - offset });
      break;
    }
    const payload = buf.subarray(offset, offset + len);
    offset += len;
    let json = null;
    try {
      json = JSON.parse(payload.toString("utf8"));
    } catch {
      json = null;
    }
    frames.push({
      flags,
      len,
      json,
      text: payload.toString("utf8").slice(0, 300),
    });
  }
  return frames;
}

const baseUrl = "https://127.0.0.1:6506";
const html = await get(baseUrl + "/");
const csrf = html.match(/csrfToken":"([^"]+)/)?.[1] || "";
const service = baseUrl + "/exa.language_server_pb.LanguageServerService";
const cascadeId = crypto.randomUUID();
const subscriberId = crypto.randomUUID();

// start + send a short turn so stream has something
const start = await postRaw(service + "/StartCascade", {
  headers: {
    "content-type": "application/json",
    "connect-protocol-version": "1",
    "x-codeium-csrf-token": csrf,
  },
  body: JSON.stringify({
    cascadeId,
    source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
    trajectoryType: "CORTEX_TRAJECTORY_TYPE_CASCADE",
    workspaceUris: ["file:///d:/agent-transfer"],
  }),
});
console.log("start", start.status, start.text);

const send = await postRaw(service + "/SendUserCascadeMessage", {
  headers: {
    "content-type": "application/json",
    "connect-protocol-version": "1",
    "x-codeium-csrf-token": csrf,
  },
  body: JSON.stringify({
    cascadeId,
    items: [{ text: "只回答数字：4+4=?" }],
    cascadeConfig: {
      plannerConfig: {
        requestedModel: { model: "MODEL_PLACEHOLDER_M298" },
        planModel: "MODEL_PLACEHOLDER_M298",
        plannerTypeConfig: {
          case: "conversational",
          value: { plannerMode: "DEFAULT", agenticMode: true },
        },
      },
    },
  }),
});
console.log("send", send.status, send.text);

const requestBodies = [
  {
    conversationId: cascadeId,
    subscriberId,
    trajectoryVerbosity: "PROD_UI",
  },
  {
    conversationId: cascadeId,
    subscriberId,
    trajectoryVerbosity: "CLIENT_TRAJECTORY_VERBOSITY_PROD_UI",
  },
  {
    conversationId: cascadeId,
    subscriberId,
    trajectoryVerbosity: 2,
  },
  {
    conversationId: cascadeId,
    subscriberId,
  },
];

const results = [];
for (const body of requestBodies) {
  const framed = connectFrame(body, 0);
  const res = await postRaw(
    service + "/StreamAgentStateUpdates",
    {
      headers: {
        "content-type": "application/connect+json",
        "connect-protocol-version": "1",
        "x-codeium-csrf-token": csrf,
        accept: "application/connect+json",
      },
      body: framed,
      timeout: 8000,
    },
  );
  const frames = res.buf ? parseConnectFrames(res.buf) : [];
  results.push({
    body,
    status: res.status,
    error: res.error || null,
    contentType: res.headers?.["content-type"] || "",
    frameCount: frames.length,
    frames: frames.slice(0, 5),
    textPreview: (res.text || "").slice(0, 300),
  });
  console.log(
    "stream",
    JSON.stringify(body.trajectoryVerbosity),
    res.status || res.error,
    "frames",
    frames.length,
    frames[0]?.json?.error?.message || frames[0]?.text?.slice(0, 120),
  );
}

// Also try end-stream flag style: single request frame is enough for unary-stream in connect.
// Try keep-alive by not closing quickly with longer timeout for best candidate.
const bestBody = {
  conversationId: cascadeId,
  subscriberId: crypto.randomUUID(),
  trajectoryVerbosity: "PROD_UI",
};
const longRes = await postRaw(service + "/StreamAgentStateUpdates", {
  headers: {
    "content-type": "application/connect+json",
    "connect-protocol-version": "1",
    "x-codeium-csrf-token": csrf,
    accept: "application/connect+json",
  },
  body: connectFrame(bestBody, 0),
  timeout: 12000,
});
const longFrames = longRes.buf ? parseConnectFrames(longRes.buf) : [];
console.log(
  "long stream",
  longRes.status || longRes.error,
  "frames",
  longFrames.length,
  longFrames.map((f) => ({
    flags: f.flags,
    keys: f.json ? Object.keys(f.json) : null,
    err: f.json?.error?.message || null,
    text: f.text?.slice(0, 100),
  })),
);

fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-stream-request-probe.json",
  JSON.stringify(
    {
      cascadeId,
      start: start.text,
      send: send.text,
      results,
      long: {
        status: longRes.status,
        error: longRes.error || null,
        frames: longFrames,
      },
    },
    null,
    2,
  ),
);
