import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

const html = await get("https://127.0.0.1:9608/");
const csrf = html.match(/csrfToken":"([^"]+)/)?.[1] || "";
const mainPath = html.match(/src="(\/main\.js[^"]*)"/)?.[1] || "/main.js";
console.log({ csrf, mainPath, htmlLen: html.length });
const js = await get("https://127.0.0.1:9608" + mainPath);
console.log("jsBytes", js.length);

const out = {
  measuredAt: new Date().toISOString(),
  csrf,
  mainPath,
  jsBytes: js.length,
  connectWebsocket: [...js.matchAll(/connect-websocket/g)].length,
  csrfHeader: [...js.matchAll(/x-codeium-csrf-token/g)].length,
  procedures: [],
  typeNames: [],
  methodNames: [],
  serviceLike: [],
  connectPaths: [],
  interestingSnippets: {},
};

// Connect procedure path style: /package.Service/Method
const procRe = /\/((?:[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\/[A-Za-z0-9_]+)/g;
const procs = new Set();
for (const m of js.matchAll(procRe)) {
  const p = m[1];
  if (/Service|Cascade|Conversation|Trajectory|Agent|Project|Auth|Prompt|Message|State/i.test(p)) {
    procs.add(p);
  }
}
out.procedures = [...procs].sort().slice(0, 500);

// typeName assignments and service defs
const typeNameRe = /typeName:"([^"]+)"/g;
out.typeNames = [...new Set([...js.matchAll(typeNameRe)].map((m) => m[1]))].sort();

// methods around lsClient / startConversation
const methodCandidates = [
  "startConversation",
  "sendUserCascadeMessage",
  "getCascadeTrajectory",
  "getCascadeTrajectorySteps",
  "getConversationItems",
  "getAllCascadeTrajectories",
  "getConversationMetadata",
  "createAgentStateSession",
  "validateProject",
  "getCascadeConfig",
];
for (const name of methodCandidates) {
  const idx = js.indexOf(name);
  out.interestingSnippets[name] = idx >= 0 ? js.slice(Math.max(0, idx - 180), idx + 260) : null;
}

// extract connect service method tables: name:"Foo", I:"/pkg.Service/Foo" or similar
const connectPathRe = /"\/([A-Za-z0-9_.]+\/[A-Za-z0-9_]+)"/g;
out.connectPaths = [...new Set([...js.matchAll(connectPathRe)].map((m) => m[1]))]
  .filter((p) => /Service|Cascade|Conversation|Trajectory|Agent|Project|Auth|Prompt|Message|State|Cortex|Language/i.test(p))
  .sort();

// method list near service definitions
const methodsRe = /methods:\{([^}]{0,5000})\}/g;
const methodNames = new Set();
for (const m of js.matchAll(methodsRe)) {
  const body = m[1];
  for (const mm of body.matchAll(/([A-Za-z0-9_]+):\s*\{/g)) {
    if (/Conversation|Cascade|Trajectory|Prompt|Message|Project|Agent|Approval|Auth|State/i.test(mm[1])) {
      methodNames.add(mm[1]);
    }
  }
}
out.methodNames = [...methodNames].sort();

// service-like objects
const serviceRe = /typeName:"([^"]+Service[^"]*)"/g;
out.serviceLike = [...new Set([...js.matchAll(serviceRe)].map((m) => m[1]))].sort();

// broader typeNames that look like RPC services
out.serviceTypeNames = out.typeNames.filter((n) => /Service$|Cascade|Conversation|Trajectory|AgentState|LanguageServer|Cortex/i.test(n));

// extract around startConversation client method
const sc = js.indexOf("async startConversation");
out.startConversationClient = sc >= 0 ? js.slice(sc, sc + 800) : null;
const sc2 = js.indexOf("startConversation(a)");
out.startConversationCall = sc2 >= 0 ? js.slice(Math.max(0, sc2 - 200), sc2 + 500) : null;

// websocket connect path confirmation
const wsIdx = js.indexOf("connect-websocket");
out.wsSnippet = wsIdx >= 0 ? js.slice(Math.max(0, wsIdx - 250), wsIdx + 250) : null;

// find Connect content-types usage
out.contentTypes = [...new Set([...js.matchAll(/application\/[a-z0-9.+-]+/g)].map((m) => m[0]))]
  .filter((t) => /connect|grpc|json|proto/i.test(t))
  .sort();

const outPath = path.join(
  "docs",
  "superpowers",
  "specs",
  "2026-08-15-antigravity-connect-bridge-extract.json",
);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log("wrote", outPath);
console.log({
  procedures: out.procedures.length,
  typeNames: out.typeNames.length,
  serviceTypeNames: out.serviceTypeNames.slice(0, 40),
  connectPaths: out.connectPaths.slice(0, 80),
  methodNames: out.methodNames.slice(0, 80),
  contentTypes: out.contentTypes,
});
