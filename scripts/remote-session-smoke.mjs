#!/usr/bin/env node
// Safe smoke for Remote Session.
// Default mode is pure in-process fake host.
// It does NOT start gateway, does NOT open Codex desktop, and does NOT touch
// running desktop processes.

import {
  createFakeHostBackend,
  createMemoryEventLog,
  createRemoteSessionService,
} from "../lib/remote-session/index.mjs";

function parseArgs(argv) {
  const out = { mode: "fake" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") out.mode = String(argv[++i] || "fake");
    else if (arg.startsWith("--mode=")) out.mode = arg.slice("--mode=".length);
  }
  return out;
}

function makeNatTraversal() {
  return {
    async capabilities() {
      return { enabled: true };
    },
    async getPublicConfig() {
      return { enabled: true, peers: [] };
    },
    async listPeers() {
      return [];
    },
    async ensureLink(peerId) {
      return { peerId, provider: "frpc", status: "online", endpoint: "" };
    },
    async openService(peerId, service) {
      return { service, endpoint: "127.0.0.1:18788" };
    },
  };
}

async function runFakeSmoke() {
  let stored = { enabled: true };
  const host = createFakeHostBackend({
    projects: [{ id: "p1", name: "demo", path: "/tmp/demo" }],
    scriptedTurns: [
      {
        events: [
          { type: "assistant_text", text: "smoke editing" },
          { type: "approval_required", approvalId: "ap-smoke", summary: "run tests" },
        ],
      },
    ],
  });

  const service = createRemoteSessionService({
    configStore: {
      get: () => stored,
      save: (next) => {
        stored = next;
      },
    },
    natTraversal: makeNatTraversal(),
    hostBackendFactory: async () => host,
    eventLogFactory: createMemoryEventLog,
  });

  const session = await service.openSession({
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "smoke-controller",
  });
  console.log("[smoke] opened", session.id, session.hostConversationId);

  const prompted = await service.dispatchPrompt({
    sessionId: session.id,
    prompt: "smoke prompt",
    controllerPeerId: "smoke-controller",
  });
  console.log("[smoke] prompt state", prompted.session.state);

  if (prompted.session.state === "awaiting_approval") {
    const decided = await service.decideApproval({
      sessionId: session.id,
      approvalId: "ap-smoke",
      decision: "allow",
      controllerPeerId: "smoke-controller",
    });
    console.log("[smoke] approval", decided.session.state);
  }

  await service.markDisconnected({ sessionId: session.id });
  const resumed = await service.resumeSession({
    sessionId: session.id,
    controllerPeerId: "smoke-controller",
    cursor: 0,
  });
  console.log("[smoke] resumed events", resumed.events.length, "state", resumed.session.state);

  const ended = await service.endSession({
    sessionId: session.id,
    controllerPeerId: "smoke-controller",
  });
  console.log("[smoke] ended", ended.state);
  console.log("[smoke] PASS fake mode (no desktop/gateway process touched)");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode !== "fake") {
    console.error(
      "[smoke] only --mode fake is enabled by default to avoid touching running Codex desktop / gateway processes",
    );
    console.error("[smoke] requested mode:", args.mode);
    process.exit(2);
  }
  await runFakeSmoke();
}

main().catch((error) => {
  console.error("[smoke] FAIL", error?.stack || error?.message || String(error));
  process.exit(1);
});
