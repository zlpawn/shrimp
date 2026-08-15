import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
        const c = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () => {
          const t = Buffer.concat(c).toString("utf8");
          let j = null;
          try {
            j = JSON.parse(t);
          } catch {}
          resolve({ status: res.statusCode, json: j, preview: t.slice(0, 1200) });
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

function discoverFromLog() {
  const mainLog = path.join(
    process.env.APPDATA || "",
    "Antigravity",
    "logs",
    "main.log",
  );
  const text = fs.readFileSync(mainLog, "utf8");
  const locals = [...text.matchAll(/Local:\s+(https:\/\/127\.0\.0\.1:(\d+)\/?)/g)];
  const csrf = [...text.matchAll(/--csrf_token\s+([A-Za-z0-9-]+)/gi)];
  const latest = locals.at(-1);
  return {
    baseUrl: latest ? latest[1].replace(/\/?$/, "") : "",
    csrfFromLog: csrf.at(-1)?.[1] || "",
  };
}

const discovered = discoverFromLog();
const baseUrl = discovered.baseUrl || "https://127.0.0.1:12683";
const html = await get(baseUrl + "/");
const csrf = html.match(/csrfToken":"([^"]+)/)?.[1] || discovered.csrfFromLog;
const headers = { "x-codeium-csrf-token": csrf };
const service = baseUrl + "/exa.language_server_pb.LanguageServerService";
console.log({ baseUrl, csrf: csrf.slice(0, 8) + "..." });

// probe model-related methods
const modelMethods = [
  "GetCascadeModelConfigData",
  "GetModelConfigData",
  "GetClientModelConfig",
  "GetUserModelConfig",
  "GetModelConfigs",
  "ListModels",
  "GetModels",
  "GetUserStatus",
  "GetPlanStatus",
  "GetUserSettings",
];
const methodResults = [];
for (const m of modelMethods) {
  const res = await post(service + "/" + m, {}, headers);
  methodResults.push({
    method: m,
    status: res.status,
    code: res.json?.code || null,
    message: res.json?.message || null,
    keys: res.json && !res.json.code ? Object.keys(res.json) : [],
    preview: res.preview?.slice(0, 250),
  });
  console.log(m, res.status, res.json?.code || "ok", (res.preview || "").slice(0, 160));
}

// reuse model from known successful conversation if still present
const known = "21335b56-743a-4e24-8066-43540024eb37";
const knownDetail = await post(service + "/GetCascadeTrajectory", { cascadeId: known }, headers);
console.log(
  "known detail",
  knownDetail.status,
  knownDetail.json?.status,
  knownDetail.json?.trajectory?.steps?.at?.(-1)?.metadata?.modelUsage?.model,
);

// try create+send with model config variants
const modelCandidates = [
  { label: "alias AUTO", requestedModel: { choice: { case: "alias", value: "AUTO" } } },
  { label: "alias RECOMMENDED", requestedModel: { choice: { case: "alias", value: "RECOMMENDED" } } },
  { label: "alias CASCADE_BASE", requestedModel: { choice: { case: "alias", value: "CASCADE_BASE" } } },
  { label: "model PLACEHOLDER_M298", requestedModel: { choice: { case: "model", value: "MODEL_PLACEHOLDER_M298" } } },
  { label: "model number 1298", requestedModel: { choice: { case: "model", value: 1298 } } },
  { label: "model GOOGLE flash name", requestedModel: { choice: { case: "model", value: "GOOGLE_GEMINI_2_5_FLASH" } } },
];

const itemCandidates = [
  { name: "text_field", items: [{ text: "用一句话回答 1+1=?" }] },
  { name: "chunk_case_value", items: [{ chunk: { case: "text", value: "用一句话回答 1+1=?" } }] },
  { name: "chunk_text", items: [{ chunk: { text: "用一句话回答 1+1=?" } }] },
  { name: "text_value_obj", items: [{ text: { value: "用一句话回答 1+1=?" } }] },
  { name: "raw_string_items", items: ["用一句话回答 1+1=?"] },
];

const turnResults = [];
for (const model of modelCandidates) {
  for (const item of itemCandidates.slice(0, 2)) {
    // limit combos a bit
    const cascadeId = crypto.randomUUID();
    const startBody = {
      cascadeId,
      source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
      trajectoryType: "CORTEX_TRAJECTORY_TYPE_CASCADE",
      workspaceUris: ["file:///d:/agent-transfer"],
      requestedModel: model.requestedModel,
    };
    const start = await post(service + "/StartCascade", startBody, headers);
    const sendBody = {
      cascadeId,
      items: item.items,
      cascadeConfig: {
        plannerConfig: {
          requestedModel: model.requestedModel,
          plannerTypeConfig: {
            case: "conversational",
            value: {
              plannerMode: "DEFAULT",
              agenticMode: true,
            },
          },
        },
      },
    };
    const send = await post(service + "/SendUserCascadeMessage", sendBody, headers);
    await new Promise((r) => setTimeout(r, 1200));
    const detail = await post(service + "/GetCascadeTrajectory", { cascadeId }, headers);
    const steps = detail.json?.trajectory?.steps || [];
    const user = steps.find((s) => String(s.type || "").includes("USER_INPUT"));
    const err = steps.find((s) => String(s.type || "").includes("ERROR"));
    const assistant = steps.find((s) => String(s.type || "").includes("PLANNER_RESPONSE"));
    const row = {
      model: model.label,
      item: item.name,
      startStatus: start.status,
      startMsg: start.json?.message || null,
      sendStatus: send.status,
      sendMsg: send.json?.message || null,
      runStatus: detail.json?.status || null,
      stepTypes: steps.map((s) => s.type),
      userText:
        user?.userInput?.userResponse ||
        user?.userInput?.items?.[0]?.text ||
        JSON.stringify(user?.userInput?.items || null),
      error:
        err?.errorMessage?.error?.shortError ||
        err?.errorMessage?.error?.userErrorMessage ||
        null,
      assistant:
        assistant?.plannerResponse?.modifiedResponse ||
        assistant?.plannerResponse?.response ||
        null,
    };
    turnResults.push(row);
    console.log(
      model.label,
      item.name,
      "steps",
      row.stepTypes,
      "user",
      String(row.userText).slice(0, 40),
      "err",
      String(row.error || "").slice(0, 80),
      "assistant",
      String(row.assistant || "").slice(0, 40),
    );
    if (row.assistant) break;
  }
  if (turnResults.some((r) => r.assistant)) break;
}

fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-model-turn-probe.json",
  JSON.stringify({ baseUrl, methodResults, turnResults }, null, 2),
);
console.log("wrote probe json, assistantHits", turnResults.filter((r) => r.assistant).length);
