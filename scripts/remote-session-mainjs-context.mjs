import fs from "node:fs";
import path from "node:path";

const jsPath = "docs/superpowers/specs/_tmp-antigravity-main.js";
const js = fs.readFileSync(jsPath, "utf8");

function contexts(term, max = 15, radius = 220) {
  const out = [];
  let idx = 0;
  while (out.length < max) {
    const i = js.indexOf(term, idx);
    if (i < 0) break;
    out.push(js.slice(Math.max(0, i - radius), Math.min(js.length, i + radius)).replace(/\s+/g, " "));
    idx = i + term.length;
  }
  return out;
}

const terms = [
  "RemoteControl",
  "openNewConversation",
  "openConversationHistory",
  "_resolveConversations",
  "submitProject",
  "ArtifactApprovalStatus",
  "NewConversationEvent",
  "WebSocket",
  "websocket",
  "grpc",
  "JSON-RPC",
  "jsonrpc",
  "/api/store",
  "csrfToken",
  "https_server_port",
  "language_server",
  "cascadeId",
  "createAgentStateSession",
];

const out = {
  measuredAt: new Date().toISOString(),
  contexts: {},
};
for (const term of terms) {
  out.contexts[term] = contexts(term, 10);
}

// Extract possible RPC method names around RemoteControl / conversation verbs
const methodish = new Set();
for (const m of js.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{3,80})\b/g)) {
  const name = m[1];
  if (
    /(Conversation|Project|Approval|Cascade|RemoteControl|Prompt|Trajectory|AgentSession)/.test(name) &&
    /(get|list|create|open|send|submit|start|stop|update|resolve|set|fetch|load)/i.test(name)
  ) {
    methodish.add(name);
  }
}
out.methodish = [...methodish].sort().slice(0, 200);

// Search for ws urls or path templates
out.wsLike = [...new Set(js.match(/wss?:\/\/[^"'`\s]+|\/[A-Za-z0-9_\-/.]*ws[A-Za-z0-9_\-/.]*/g) || [])].slice(0, 80);
out.storeLike = [...new Set(js.match(/\/api\/store[^"'`\s]*/g) || [])].slice(0, 40);

fs.writeFileSync(
  "docs/superpowers/specs/2026-08-15-antigravity-mainjs-context.json",
  JSON.stringify(out, null, 2),
);

console.log(JSON.stringify({
  methodishCount: out.methodish.length,
  methodishSample: out.methodish.slice(0, 60),
  wsLike: out.wsLike.slice(0, 30),
  storeLike: out.storeLike,
  remoteControlContexts: out.contexts.RemoteControl.length,
  openNewConversationContexts: out.contexts.openNewConversation.length,
  openConversationHistoryContexts: out.contexts.openConversationHistory.length,
  resolveConversationsContexts: out.contexts._resolveConversations.length,
}, null, 2));
