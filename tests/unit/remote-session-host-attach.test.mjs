import test from "node:test";
import assert from "node:assert/strict";

import {
  RemoteSessionError,
  createFakeHostBackend,
  createLocalHostBackend,
  probeLocalAntigravityBackend,
} from "../../lib/remote-session/index.mjs";

test("fake host supports coding loop primitives", async () => {
  const host = createFakeHostBackend({
    projects: [{ id: "p1", name: "demo", path: "/tmp/demo" }],
  });
  assert.equal(await host.isRunning(), true);
  await host.attach();
  const projects = await host.listProjects();
  assert.equal(projects[0].id, "p1");
  const { conversationId } = await host.createConversation("p1");
  const { turnId, events } = await host.dispatchPrompt({
    conversationId,
    prompt: "edit README",
    controllerPeerId: "a",
  });
  assert.ok(turnId);
  assert.ok(events.some((event) => event.type === "assistant_text"));
  assert.ok(events.some((event) => event.type === "turn_completed"));
});

test("fake host can require and decide approval", async () => {
  const host = createFakeHostBackend({
    projects: [{ id: "p1", name: "demo" }],
    scriptedTurns: [{
      events: [
        { type: "assistant_text", text: "need approval" },
        { type: "approval_required", summary: "run rm" },
      ],
    }],
  });
  await host.attach();
  const { conversationId } = await host.createConversation("p1");
  await host.dispatchPrompt({
    conversationId,
    prompt: "delete temp",
    controllerPeerId: "a",
  });
  const pending = await host.listPendingApprovals(conversationId);
  assert.equal(pending.length, 1);
  const decided = await host.decideApproval({
    conversationId,
    approvalId: pending[0].approvalId,
    decision: "allow",
    controllerPeerId: "a",
  });
  assert.equal(decided.ok, true);
  const snapshot = await host.getConversation(conversationId);
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.pendingApprovals.length, 0);
});

test("fake host subscribeEvents resumes from cursor", async () => {
  const host = createFakeHostBackend({
    projects: [{ id: "p1", name: "demo" }],
  });
  await host.attach();
  const { conversationId } = await host.createConversation("p1");
  await host.dispatchPrompt({
    conversationId,
    prompt: "one",
    controllerPeerId: "a",
  });
  const first = [];
  for await (const event of await host.subscribeEvents({ conversationId, cursor: 0 })) {
    first.push(event);
  }
  assert.ok(first.length >= 2);
  const resumeFrom = first[0].seq;
  const rest = [];
  for await (const event of await host.subscribeEvents({ conversationId, cursor: resumeFrom })) {
    rest.push(event);
  }
  assert.equal(rest.length, first.length - 1);
  assert.equal(rest[0].seq, first[1].seq);
});

test("local host attach fails clearly when Antigravity is not running", async () => {
  const host = createLocalHostBackend({
    probe: async () => ({ running: false, supported: false, reason: "process_not_found" }),
  });
  await assert.rejects(
    () => host.attach(),
    (error) => error instanceof RemoteSessionError && error.code === "host_backend_unavailable",
  );
});

test("local host attach fails clearly when attach surface unsupported", async () => {
  const host = createLocalHostBackend({
    probe: async () => ({
      running: true,
      supported: false,
      reason: "process_found_but_attach_surface_unconfirmed",
    }),
  });
  await assert.rejects(
    () => host.attach(),
    (error) => error instanceof RemoteSessionError && error.code === "host_backend_unsupported",
  );
});

test("probe reports structured result without throwing when process missing", async () => {
  const report = await probeLocalAntigravityBackend({
    listProcesses: () => [],
    existsSync: () => false,
    statSync: () => {
      throw new Error("missing");
    },
    readdirSync: () => [],
    request: null,
  });
  assert.equal(report.running, false);
  assert.equal(report.supported, false);
  assert.equal(report.reason, "process_not_found");
  assert.equal(report.capabilities.processPresence, false);
});
