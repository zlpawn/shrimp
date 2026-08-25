import test from "node:test";
import assert from "node:assert/strict";
import { createCdpSessionManager } from "../../../extensions/leo-cookie-txt-locally/cdp-session.mjs";

function fakeDebugger({ failCommand = null, targets = [] } = {}) {
  const calls = [];
  const attached = new Set(targets.filter((target) => target.attached).map((target) => Number(target.tabId)));
  return {
    calls,
    async attach(source) {
      calls.push(["attach", source.tabId]);
      if (attached.has(source.tabId)) throw new Error(`Already attached to tab ${source.tabId}`);
      attached.add(source.tabId);
    },
    async detach(source) {
      calls.push(["detach", source.tabId]);
      attached.delete(source.tabId);
    },
    async sendCommand(source, method) {
      calls.push(["command", source.tabId, method]);
      if (method === failCommand) throw new Error(`${method} failed`);
      return {};
    },
    async getTargets() {
      calls.push(["getTargets"]);
      return targets;
    },
  };
}

function managerFixture(options = {}) {
  const debuggerApi = options.debuggerApi || fakeDebugger();
  const persisted = [];
  const manager = createCdpSessionManager({
    debuggerApi,
    validateTab: options.validateTab || (async (tabId) => Number(tabId)),
    persist: options.persist || (async (session) => persisted.push(session ? { ...session } : null)),
    now: options.now || (() => 100),
  });
  return { manager, debuggerApi, persisted };
}

test("repeated start on the same tab resets entries without attaching twice", async () => {
  const { manager, debuggerApi } = managerFixture();
  await manager.start({ tabId: 7 });
  manager.handleNetworkEvent(
    { tabId: 7 },
    "Network.requestWillBeSent",
    { requestId: "one", request: { method: "GET", url: "https://example.com" } }
  );
  const restarted = await manager.start({ tabId: 7 });

  assert.equal(debuggerApi.calls.filter(([name]) => name === "attach").length, 1);
  assert.equal(restarted.entryCount, 0);
  assert.deepEqual(manager.get({ tabId: 7 }).entries, []);
});

test("cross-tab start validates the new tab before detaching the old session", async () => {
  const debuggerApi = fakeDebugger();
  const { manager } = managerFixture({
    debuggerApi,
    validateTab: async (tabId) => {
      if (Number(tabId) === 8) throw Object.assign(new Error("outside"), { code: "tab_outside_task" });
      return Number(tabId);
    },
  });
  await manager.start({ tabId: 7 });
  const callsBefore = debuggerApi.calls.length;

  await assert.rejects(() => manager.start({ tabId: 8 }), (err) => err.code === "tab_outside_task");
  assert.equal(debuggerApi.calls.slice(callsBefore).some(([name]) => name === "detach"), false);
  assert.equal(manager.get({ tabId: 7 }).running, true);
});

test("cross-tab start detaches the old session before attaching the new tab", async () => {
  const { manager, debuggerApi } = managerFixture();
  await manager.start({ tabId: 7 });
  debuggerApi.calls.length = 0;
  await manager.start({ tabId: 8 });

  assert.deepEqual(debuggerApi.calls.slice(0, 3), [
    ["command", 7, "Network.disable"],
    ["detach", 7],
    ["attach", 8],
  ]);
  assert.equal(manager.get({ tabId: 8 }).running, true);
});

test("partial startup failure detaches an attachment acquired by that attempt", async () => {
  const debuggerApi = fakeDebugger({ failCommand: "Network.enable" });
  const { manager } = managerFixture({ debuggerApi });

  await assert.rejects(() => manager.start({ tabId: 9 }), (err) => err.code === "debugger_attach_failed");
  assert.deepEqual(debuggerApi.calls, [
    ["attach", 9],
    ["command", 9, "Network.enable"],
    ["detach", 9],
  ]);
  assert.throws(() => manager.get({ tabId: 9 }), (err) => err.code === "capture_not_active");
});

test("startup persistence failure also detaches an attachment acquired by that attempt", async () => {
  const debuggerApi = fakeDebugger();
  const { manager } = managerFixture({
    debuggerApi,
    persist: async () => {
      throw new Error("storage quota");
    },
  });

  await assert.rejects(() => manager.start({ tabId: 15 }), (err) => err.code === "debugger_attach_failed");
  assert.deepEqual(debuggerApi.calls, [
    ["attach", 15],
    ["command", 15, "Network.enable"],
    ["detach", 15],
  ]);
});

test("get and stop reject a tab that differs from the active capture", async () => {
  const { manager } = managerFixture();
  await manager.start({ tabId: 10 });
  assert.throws(() => manager.get({ tabId: 11 }), (err) => err.code === "capture_tab_mismatch");
  await assert.rejects(() => manager.stop({ tabId: 11 }), (err) => err.code === "capture_tab_mismatch");
  assert.equal(manager.get({ tabId: 10 }).running, true);
});

test("stop detaches Lantern-owned debugger and returns bounded entries", async () => {
  const { manager, debuggerApi } = managerFixture();
  await manager.start({ tabId: 12 });
  manager.handleNetworkEvent(
    { tabId: 12 },
    "Network.requestWillBeSent",
    { requestId: "r1", request: { method: "POST", url: "https://example.com/api" } }
  );
  const stopped = await manager.stop({ tabId: 12, grep: "api" });

  assert.equal(stopped.stopped, true);
  assert.equal(stopped.entries.length, 1);
  assert.equal(stopped.entries[0].method, "POST");
  assert.deepEqual(debuggerApi.calls.slice(-2), [
    ["command", 12, "Network.disable"],
    ["detach", 12],
  ]);
});

test("stop clears active ownership when Network.disable fails but detach succeeds", async () => {
  const debuggerApi = fakeDebugger({ failCommand: "Network.disable" });
  const { manager, persisted } = managerFixture({ debuggerApi });
  await manager.start({ tabId: 18 });

  await assert.rejects(() => manager.stop({ tabId: 18 }), (err) => err.code === "debugger_attach_failed");
  assert.throws(() => manager.get({ tabId: 18 }), (err) => err.code === "capture_not_active");
  assert.equal(persisted.at(-1).stoppedAt, 100);
  assert.deepEqual(debuggerApi.calls.slice(-2), [
    ["command", 18, "Network.disable"],
    ["detach", 18],
  ]);
});

test("network events update runtime memory without persisting every event", async () => {
  const { manager, persisted } = managerFixture();
  await manager.start({ tabId: 17 });
  const writesAfterStart = persisted.length;
  manager.handleNetworkEvent(
    { tabId: 17 },
    "Network.requestWillBeSent",
    { requestId: "r1", request: { method: "GET", url: "https://example.com" } }
  );
  manager.handleNetworkEvent(
    { tabId: 17 },
    "Network.responseReceived",
    { requestId: "r1", response: { status: 200, mimeType: "text/html" } }
  );

  assert.equal(persisted.length, writesAfterStart);
  assert.equal(manager.get({ tabId: 17 }).entryCount, 1);
});

test("MV3 recovery restores an attached task-owned target with an empty lost buffer", async () => {
  const debuggerApi = fakeDebugger({ targets: [{ tabId: 13, attached: true }] });
  const { manager } = managerFixture({ debuggerApi });
  const recovered = await manager.reconcile({
    tabId: 13,
    attachedByLantern: true,
    startedAt: 1,
    stoppedAt: null,
    entryCount: 22,
    recovered: false,
    entriesLost: false,
  });

  assert.equal(recovered.recovered, true);
  assert.equal(recovered.entriesLost, true);
  assert.equal(recovered.entryCount, 0);
  assert.deepEqual(manager.get({ tabId: 13 }).entries, []);
});

test("MV3 recovery detaches and clears a recorded tab that is no longer task-owned", async () => {
  const debuggerApi = fakeDebugger({ targets: [{ tabId: 16, attached: true }] });
  const { manager, persisted } = managerFixture({
    debuggerApi,
    validateTab: async () => {
      throw Object.assign(new Error("outside"), { code: "tab_outside_task" });
    },
  });
  const recovered = await manager.reconcile({
    tabId: 16,
    attachedByLantern: true,
    startedAt: 1,
    stoppedAt: null,
    entryCount: 2,
  });

  assert.equal(recovered, null);
  assert.deepEqual(debuggerApi.calls, [["getTargets"], ["detach", 16]]);
  assert.equal(persisted.at(-1), null);
});

test("MV3 recovery reports detach failure and preserves durable ownership for retry", async () => {
  const debuggerApi = fakeDebugger({ targets: [{ tabId: 19, attached: true }] });
  debuggerApi.detach = async (source) => {
    debuggerApi.calls.push(["detach", source.tabId]);
    throw new Error("detach denied");
  };
  const { manager, persisted } = managerFixture({
    debuggerApi,
    validateTab: async () => {
      throw Object.assign(new Error("outside"), { code: "tab_outside_task" });
    },
  });
  const durable = {
    tabId: 19,
    attachedByLantern: true,
    startedAt: 1,
    stoppedAt: null,
    entryCount: 2,
  };

  await assert.rejects(
    () => manager.reconcile(durable),
    (err) => err.code === "debugger_attach_failed" && /detach denied/.test(err.message)
  );
  assert.equal(persisted.length, 0);
});

test("debugger detach event clears active capture ownership", async () => {
  const { manager, persisted } = managerFixture();
  await manager.start({ tabId: 14 });
  await manager.handleDetach({ tabId: 14 });
  assert.throws(() => manager.get({ tabId: 14 }), (err) => err.code === "capture_not_active");
  assert.equal(persisted.at(-1), null);
});
