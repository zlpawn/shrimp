import {
  createLocalHostBackend,
} from "../lib/remote-session/index.mjs";

const host = createLocalHostBackend({
  logger: {
    warn: (...a) => console.warn(...a),
    log: (...a) => console.log(...a),
  },
});
await host.attach();
const projects = await host.listProjects();
const project =
  projects.find((p) => String(p.path || "").toLowerCase().includes("agent-transfer")) ||
  projects[0];
const created = await host.createConversation(project.id);
console.log("created", created.conversationId);
const result = await host.dispatchPrompt({
  conversationId: created.conversationId,
  prompt: "只回答数字：3+3=?",
  controllerPeerId: "live-smoke",
  model: "MODEL_PLACEHOLDER_M298",
});
console.log("status", result.snapshot?.status);
console.log(
  "events",
  (result.events || []).map((e) => ({ type: e.type, text: String(e.text || "").slice(0, 100) })),
);
