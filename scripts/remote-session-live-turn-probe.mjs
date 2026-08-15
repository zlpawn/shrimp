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
        timeout: 30000,
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
          resolve({ status: res.statusCode, json, preview: text.slice(0, 1200) });
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
const cascadeId = crypto.randomUUID();

const start = await post(
  base + "/StartCascade",
  {
    cascadeId,
    source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
    trajectoryType: "CORTEX_TRAJECTORY_TYPE_CASCADE",
    workspaceUris: ["file:///d:/agent-transfer"],
  },
  headers,
);
console.log("start", start.status, start.preview);

const send = await post(
  base + "/SendUserCascadeMessage",
  {
    cascadeId,
    items: [
      {
        chunk: {
          case: "text",
          value: "请用一句话回答：1+1等于几？不要工具，不要改文件。",
        },
      },
    ],
  },
  headers,
);
console.log("send", send.status, send.preview);

let finalDetail = null;
for (let i = 0; i < 16; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const detail = await post(base + "/GetCascadeTrajectory", { cascadeId }, headers);
  const steps = detail.json?.trajectory?.steps || [];
  console.log(
    "poll",
    i,
    detail.json?.status,
    "steps",
    steps.length,
    steps.map((s) => s.type),
  );
  finalDetail = detail;
  const hasAssistant = steps.some((s) => String(s.type || "").includes("PLANNER_RESPONSE"));
  const idle = String(detail.json?.status || "").includes("IDLE");
  if (idle && hasAssistant) break;
}

const steps = finalDetail?.json?.trajectory?.steps || [];
const assistant = [...steps].reverse().find((s) => String(s.type || "").includes("PLANNER_RESPONSE"));
const user = steps.find((s) => String(s.type || "").includes("USER_INPUT"));
console.log(
  "user",
  user?.userInput?.userResponse || user?.userInput?.items?.[0]?.text || null,
);
console.log(
  "assistant",
  assistant?.plannerResponse?.modifiedResponse ||
    assistant?.plannerResponse?.response ||
    null,
);

fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-live-turn-probe.json",
  JSON.stringify(
    {
      cascadeId,
      startStatus: start.status,
      sendStatus: send.status,
      finalStatus: finalDetail?.json?.status,
      stepTypes: steps.map((s) => s.type),
      user:
        user?.userInput?.userResponse ||
        user?.userInput?.items?.[0]?.text ||
        null,
      assistant:
        assistant?.plannerResponse?.modifiedResponse ||
        assistant?.plannerResponse?.response ||
        null,
    },
    null,
    2,
  ),
);
