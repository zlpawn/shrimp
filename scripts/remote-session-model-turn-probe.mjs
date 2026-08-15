import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";

const agent = new https.Agent({ rejectUnauthorized: false });
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent, timeout: 10000 }, (res) => {
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
          resolve({ status: res.statusCode, json: j, preview: t.slice(0, 1500) });
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

const baseUrl = "https://127.0.0.1:6506";
const html = await get(baseUrl + "/");
const csrf = html.match(/csrfToken":"([^"]+)/)?.[1] || "";
const headers = { "x-codeium-csrf-token": csrf };
const service = baseUrl + "/exa.language_server_pb.LanguageServerService";

const model = "MODEL_PLACEHOLDER_M298";
const requestedModelShapes = [
  { name: "model_string_field", value: { model } },
  { name: "choice_model", value: { choice: { case: "model", value: model } } },
  { name: "plain_enum_string", value: model },
  { name: "plain_enum_number_guess", value: 1298 },
];

const itemShapes = [
  {
    name: "chunk_case_value",
    items: [{ chunk: { case: "text", value: "用一句话回答：1+1等于几？不要工具，不要改文件。" } }],
  },
  {
    name: "text_field",
    items: [{ text: "用一句话回答：1+1等于几？不要工具，不要改文件。" }],
  },
];

const results = [];
for (const modelShape of requestedModelShapes) {
  for (const itemShape of itemShapes) {
    const cascadeId = crypto.randomUUID();
    // StartCascade WITHOUT requestedModel (it is enum and rejects objects)
    const start = await post(
      service + "/StartCascade",
      {
        cascadeId,
        source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
        trajectoryType: "CORTEX_TRAJECTORY_TYPE_CASCADE",
        workspaceUris: ["file:///d:/agent-transfer"],
      },
      headers,
    );
    if (start.status !== 200) {
      results.push({
        modelShape: modelShape.name,
        itemShape: itemShape.name,
        stage: "start",
        start,
      });
      console.log("start fail", modelShape.name, start.preview);
      continue;
    }

    const cascadeConfig = {
      plannerConfig: {
        requestedModel: modelShape.value,
        planModel: model,
        plannerTypeConfig: {
          case: "conversational",
          value: {
            plannerMode: "DEFAULT",
            agenticMode: true,
          },
        },
      },
    };

    const send = await post(
      service + "/SendUserCascadeMessage",
      {
        cascadeId,
        items: itemShape.items,
        cascadeConfig,
      },
      headers,
    );

    let final = null;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      final = await post(service + "/GetCascadeTrajectory", { cascadeId }, headers);
      const steps = final.json?.trajectory?.steps || [];
      const types = steps.map((s) => s.type);
      if (
        String(final.json?.status || "").includes("IDLE") &&
        (types.some((t) => String(t).includes("PLANNER_RESPONSE")) ||
          types.some((t) => String(t).includes("ERROR")) ||
          types.length > 0)
      ) {
        // keep polling a bit if only user input so far and not idle? but usually idle quickly on error
        if (
          types.some((t) => String(t).includes("PLANNER_RESPONSE")) ||
          types.some((t) => String(t).includes("ERROR")) ||
          i >= 2
        ) {
          break;
        }
      }
    }

    const steps = final?.json?.trajectory?.steps || [];
    const user = steps.find((s) => String(s.type || "").includes("USER_INPUT"));
    const err = steps.find((s) => String(s.type || "").includes("ERROR"));
    const asst = steps.find((s) => String(s.type || "").includes("PLANNER_RESPONSE"));
    const row = {
      modelShape: modelShape.name,
      itemShape: itemShape.name,
      cascadeId,
      startStatus: start.status,
      sendStatus: send.status,
      sendMsg: send.json?.message || null,
      runStatus: final?.json?.status || null,
      stepTypes: steps.map((s) => s.type),
      userText:
        user?.userInput?.userResponse ||
        user?.userInput?.items?.[0]?.text ||
        JSON.stringify(user?.userInput?.items || null),
      userItems: user?.userInput?.items || null,
      error:
        err?.errorMessage?.error?.shortError ||
        err?.errorMessage?.error?.userErrorMessage ||
        null,
      assistant:
        asst?.plannerResponse?.modifiedResponse ||
        asst?.plannerResponse?.response ||
        null,
    };
    results.push(row);
    console.log(
      "CASE",
      modelShape.name,
      itemShape.name,
      "steps",
      row.stepTypes,
      "user",
      String(row.userText).slice(0, 50),
      "err",
      String(row.error || "").slice(0, 90),
      "asst",
      String(row.assistant || "").slice(0, 60),
    );
    if (row.assistant) {
      fs.writeFileSync(
        "docs/superpowers/specs/2026-08-15-antigravity-model-turn-probe.json",
        JSON.stringify({ baseUrl, results }, null, 2),
      );
      console.log("SUCCESS");
      process.exit(0);
    }
  }
}

fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-model-turn-probe.json",
  JSON.stringify({ baseUrl, results }, null, 2),
);
console.log("done, assistantHits", results.filter((r) => r.assistant).length);
