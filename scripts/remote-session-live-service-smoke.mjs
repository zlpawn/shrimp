import {
  createLocalHostBackend,
  createMemoryEventLog,
  createRemoteSessionService,
} from "../lib/remote-session/index.mjs";

function makeNatTraversal({ enabled = true } = {}) {
  return {
    async capabilities() {
      return { enabled };
    },
    async getPublicConfig() {
      return { enabled };
    },
    async listPeers() {
      return [];
    },
    async ensureLink() {},
    async openService() {
      return { endpoint: "" };
    },
  };
}

const host = createLocalHostBackend({
  logger: { warn: () => {}, log: () => {} },
});
let stored = { enabled: true };
const service = createRemoteSessionService({
  configStore: {
    get: () => stored,
    save: (next) => {
      stored = next;
    },
  },
  natTraversal: makeNatTraversal({ enabled: true }),
  hostBackendFactory: async () => host,
  eventLogFactory: createMemoryEventLog,
});

const projects = await service.listProjects("local-host");
const project =
  projects.find((item) => String(item.path || "").toLowerCase().includes("agent-transfer")) ||
  projects[0];
if (!project) throw new Error("no Antigravity project found");

const session = await service.openSession({
  peerId: "local-host",
  projectId: project.id,
  controllerPeerId: "live-service-smoke",
  model: "MODEL_PLACEHOLDER_M298",
});
console.log("session", {
  id: session.id,
  hostConversationId: session.hostConversationId,
});

const result = await service.dispatchPrompt({
  sessionId: session.id,
  prompt: "只回答数字：7+7=?",
  controllerPeerId: "live-service-smoke",
  model: "MODEL_PLACEHOLDER_M298",
});
console.log(
  "dispatch",
  result.turnId,
  result.events.map((event) => ({
    type: event.type,
    text: String(event.hostEvent?.text || "").slice(0, 60),
  })),
);

const streamed = [];
for await (const event of service.subscribe({
  sessionId: session.id,
  cursor: 0,
  includeHostEvents: true,
})) {
  streamed.push(event);
  if (event.hostEvent?.type === "assistant_text" && String(event.hostEvent?.text || "").trim()) {
    break;
  }
}
console.log(
  "stream",
  streamed.map((event) => ({
    type: event.type,
    text: String(event.hostEvent?.text || event.message || "").slice(0, 80),
  })),
);
console.log(
  "finalEvents",
  (await service.listEvents({ sessionId: session.id, cursor: 0 })).events.map((event) => event.type),
);

