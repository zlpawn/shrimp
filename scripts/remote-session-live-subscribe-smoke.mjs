import {
  createLocalHostBackend,
} from "../lib/remote-session/index.mjs";

const host = createLocalHostBackend({
  logger: { warn: (...a) => console.warn(...a), log: () => {} },
});
await host.attach();
const projects = await host.listProjects();
const project =
  projects.find((p) => String(p.path || "").toLowerCase().includes("agent-transfer")) ||
  projects[0];
const created = await host.createConversation(project.id);
console.log("created", created.conversationId);

// start subscribe first, then dispatch
const eventsPromise = (async () => {
  const out = [];
  for await (const event of await host.subscribeEvents({
    conversationId: created.conversationId,
    cursor: 0,
    intervalMs: 700,
    timeoutMs: 20000,
  })) {
    out.push({
      seq: event.seq,
      type: event.type,
      text: String(event.text || "").slice(0, 80),
      status: event.status,
    });
    console.log("event", out[out.length - 1]);
    if (event.type === "assistant_text" && String(event.text || "").trim()) break;
  }
  return out;
})();

// tiny delay so poll loop starts
await new Promise((r) => setTimeout(r, 300));
const result = await host.dispatchPrompt({
  conversationId: created.conversationId,
  prompt: "只回答数字：5+5=?",
  controllerPeerId: "stream-smoke",
  model: "MODEL_PLACEHOLDER_M298",
});
console.log(
  "dispatch final",
  result.snapshot?.status,
  result.events?.map((e) => ({ type: e.type, text: String(e.text || "").slice(0, 40) })),
);

const streamed = await eventsPromise;
console.log("streamed count", streamed.length);
console.log(
  "has assistant",
  streamed.some((e) => e.type === "assistant_text" && e.text.trim()),
);
