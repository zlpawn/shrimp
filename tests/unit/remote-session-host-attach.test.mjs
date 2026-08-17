import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RemoteSessionError,
  createFakeHostBackend,
  createLocalHostBackend,
  listProjectsFromStore,
  discoverDynamicLocalEndpoint,
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

test("listProjectsFromStore reads filesystem project json", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rs-projects-"));
  fs.writeFileSync(
    path.join(tmp, "59df.json"),
    JSON.stringify({
      id: "59df",
      name: "nightmare",
      projectResources: {
        resources: [
          {
            gitFolder: {
              folderUri: "file:///d%3A/Java%20Project/AI/bg/nightmare",
              defaultBranch: "master",
            },
          },
        ],
      },
    }),
  );
  fs.writeFileSync(
    path.join(tmp, "outside-of-project.json"),
    JSON.stringify({ id: "outside", name: "outside" }),
  );
  const projects = listProjectsFromStore({ storeDir: tmp });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, "59df");
  assert.equal(projects[0].name, "nightmare");
  assert.match(projects[0].path.replace(/\\/g, "/"), /d:\/Java Project\/AI\/bg\/nightmare/i);
});

test("discoverDynamicLocalEndpoint reads latest local url and csrf", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rs-endpoint-"));
  const logPath = path.join(tmp, "main.log");
  fs.writeFileSync(
    logPath,
    [
      "Spawning: language_server.exe --https_server_port 0 --csrf_token old-token",
      "Local:       https://127.0.0.1:1111/",
      "Spawning: language_server.exe --https_server_port 0 --csrf_token new-token",
      "Local:       https://127.0.0.1:9608/",
    ].join("\n"),
  );
  const endpoint = discoverDynamicLocalEndpoint({ mainLogPath: logPath });
  assert.equal(endpoint.url, "https://127.0.0.1:9608/");
  assert.equal(endpoint.port, 9608);
  assert.equal(endpoint.csrfToken, "new-token");
});

test("local host attach fails clearly when Antigravity is not running", async () => {
  const host = createLocalHostBackend({
    probe: async () => ({ running: false, supported: false, reason: "process_not_found" }),
    allowPartialAttach: false,
  });
  await assert.rejects(
    () => host.attach(),
    (error) => error instanceof RemoteSessionError && error.code === "host_backend_unavailable",
  );
});

test("local host attach fails clearly when full attach required but unsupported", async () => {
  const host = createLocalHostBackend({
    preferLiveConnect: false,
    probe: async () => ({
      running: true,
      supported: false,
      reason: "process_found_but_attach_surface_unconfirmed",
    }),
    allowPartialAttach: false,
  });
  await assert.rejects(
    () => host.attach(),
    (error) => error instanceof RemoteSessionError && error.code === "host_backend_unsupported",
  );
});

test("local host partial attach can list filesystem projects", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rs-local-partial-"));
  const storeDir = path.join(tmp, "projects");
  const logsDir = path.join(tmp, "logs");
  fs.mkdirSync(storeDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(storeDir, "p1.json"),
    JSON.stringify({
      id: "p1",
      name: "demo",
      projectResources: {
        resources: [{ gitFolder: { folderUri: "file:///tmp/demo" } }],
      },
    }),
  );
  fs.writeFileSync(
    path.join(logsDir, "main.log"),
    "Local:       https://127.0.0.1:9608/\n--csrf_token abc\n",
  );

  const host = createLocalHostBackend({
    preferLiveConnect: false,
    probe: async () => ({
      running: true,
      supported: false,
      reason: "process_found_but_attach_surface_unconfirmed",
    }),
    paths: {
      projectStoreDir: storeDir,
      mainLogPath: path.join(logsDir, "main.log"),
    },
    logger: { warn() {}, log() {} },
  });

  const attached = await host.attach();
  assert.equal(attached.transport, "local-partial");
  assert.equal(attached.endpoint.url, "https://127.0.0.1:9608/");
  const projects = await host.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, "p1");

  await assert.rejects(
    () => host.createConversation("p1"),
    (error) => error instanceof RemoteSessionError && error.code === "unsupported_feature",
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

test("local host can list and decide approvals over connect client", async () => {
  let sentPrompt = "";
  const mockConnect = {
    getAllCascadeTrajectories: async () => ({ trajectorySummaries: {} }),
    getCascadeTrajectory: async (cascadeId) => ({
      trajectory: {
        cascadeId,
        steps: [
          {
            type: "PLANNER_RESPONSE",
            status: "WAITING_FOR_USER_INPUT",
            approvalId: "ap_123",
            plannerResponse: { text: "Need permission to write config" },
          },
        ],
      },
    }),
    sendUserCascadeMessage: async (req) => {
      sentPrompt = req.items?.[0]?.text || "";
      return { ok: true };
    },
  };

  const host = createLocalHostBackend({
    preferLiveConnect: true,
    discoverConnectImpl: async () => ({
      ok: true,
      baseUrl: "https://127.0.0.1:9608",
      csrfToken: "mock-csrf",
    }),
    connectClientFactory: () => mockConnect,
    probe: async () => ({
      running: true,
      supported: false,
      reason: "process_found_but_attach_surface_unconfirmed",
    }),
    logger: { warn() {}, log() {} },
  });

  await host.attach();
  const pending = await host.listPendingApprovals("c_1");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].approvalId, "ap_123");

  const decided = await host.decideApproval({
    conversationId: "c_1",
    approvalId: "ap_123",
    decision: "allow",
    controllerPeerId: "ctrl_a",
  });
  assert.equal(decided.ok, true);
  assert.equal(decided.decision, "allow");
  assert.match(sentPrompt, /Approved:/);
});
