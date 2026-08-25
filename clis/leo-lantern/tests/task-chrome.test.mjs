import test from "node:test";
import assert from "node:assert/strict";
import {
  closeTaskTab,
  createOrNavigateTaskTab,
  ensureRecoverableTaskResources,
  navigateTaskTab,
  resolveChromeTaskTab,
} from "../../../extensions/leo-cookie-txt-locally/task-chrome.mjs";

function chromeApi({ tabs = [], windows = [] } = {}) {
  const liveTabs = new Map(tabs.map((tab) => [tab.id, { ...tab }]));
  const liveWindows = new Map(windows.map((win) => [win.id, { ...win }]));
  const calls = [];
  let nextTabId = 100;
  let nextGroupId = 200;
  let nextWindowId = 300;

  return {
    calls,
    tabs: {
      async query() {
        return [...liveTabs.values()];
      },
      async get(tabId) {
        const tab = liveTabs.get(Number(tabId));
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return { ...tab };
      },
      async update(tabId, patch) {
        calls.push(["tabs.update", Number(tabId), patch]);
        const tab = liveTabs.get(Number(tabId));
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        Object.assign(tab, patch);
        return { ...tab };
      },
      async create(patch) {
        calls.push(["tabs.create", patch]);
        const tab = { id: nextTabId++, windowId: patch.windowId, groupId: -1, url: patch.url };
        liveTabs.set(tab.id, tab);
        return { ...tab };
      },
      async remove(tabId) {
        calls.push(["tabs.remove", Number(tabId)]);
        if (!liveTabs.has(Number(tabId))) throw new Error(`No tab with id: ${tabId}`);
        liveTabs.delete(Number(tabId));
      },
      async group({ groupId, createProperties, tabIds }) {
        const id = groupId ?? nextGroupId++;
        for (const tabId of tabIds) {
          liveTabs.get(tabId).groupId = id;
        }
        calls.push(["tabs.group", id, createProperties || null, [...tabIds]]);
        return id;
      },
    },
    windows: {
      async getAll() {
        return [...liveWindows.values()];
      },
      async get(windowId) {
        const win = liveWindows.get(Number(windowId));
        if (!win) throw new Error(`No window with id: ${windowId}`);
        return { ...win };
      },
      async getCurrent() {
        const current = [...liveWindows.values()][0];
        if (!current) throw new Error("No current window");
        return { ...current };
      },
      async create(patch) {
        calls.push(["windows.create", patch]);
        const win = { id: nextWindowId++, ...patch };
        liveWindows.set(win.id, win);
        return { ...win };
      },
      async update() {},
    },
    tabGroups: {
      async update(groupId, patch) {
        const groupIsLive = [...liveTabs.values()].some((tab) => tab.groupId === groupId);
        if (!groupIsLive) throw new Error(`No group with id: ${groupId}`);
        calls.push(["tabGroups.update", groupId, patch]);
        return { id: groupId, ...patch };
      },
    },
  };
}

function chromeApiWithUpdateFailure() {
  const api = chromeApi({
    windows: [{ id: 9 }],
    tabs: [{ id: 19, windowId: 9, groupId: 29, url: "https://before.example" }],
  });
  api.tabs.update = async (tabId, patch) => {
    api.calls.push(["tabs.update", Number(tabId), patch]);
    throw new Error("navigation blocked");
  };
  return api;
}

test("stale claimed tab is replaced instead of navigated", async () => {
  const api = chromeApi({ windows: [{ id: 4 }] });
  const result = await createOrNavigateTaskTab(
    {
      url: "https://example.com",
      action: "navigate-claimed",
      claimedTabId: 99,
      windowId: 4,
      groupId: null,
    },
    api
  );

  assert.equal(result.reused, false);
  assert.equal(result.tabId, 100);
  assert.equal(api.calls.some(([name]) => name === "tabs.update"), false);
  assert.deepEqual(api.calls[0], [
    "tabs.create",
    { windowId: 4, url: "https://example.com", active: false },
  ]);
});

test("a non-missing navigation failure does not create a replacement tab", async () => {
  const api = chromeApiWithUpdateFailure();
  await assert.rejects(
    () =>
      createOrNavigateTaskTab(
        {
          url: "https://example.com",
          action: "navigate-claimed",
          claimedTabId: 19,
          windowId: 9,
          groupId: 29,
        },
        api
      ),
    /navigation blocked/
  );
  assert.equal(api.calls.some(([name]) => name === "tabs.create"), false);
});

test("Chrome task resolver rejects an existing tab before callers mutate it", async () => {
  const api = chromeApi({
    windows: [{ id: 1 }],
    tabs: [
      { id: 10, windowId: 1, groupId: 7 },
      { id: 11, windowId: 1, groupId: -1 },
    ],
  });

  await assert.rejects(
    () =>
      resolveChromeTaskTab(
        {
          task: { taskId: "shared", sameWindow: true, windowId: 1, groupId: 7, claimedTabId: 10 },
          explicitTabId: 11,
        },
        api
      ),
    (err) => err.code === "tab_outside_task"
  );
  assert.deepEqual(api.calls, []);
});

test("Chrome task resolver clears stale claim and accepts another owned tab", async () => {
  const api = chromeApi({
    windows: [{ id: 2 }],
    tabs: [{ id: 12, windowId: 2, groupId: 8 }],
  });

  const result = await resolveChromeTaskTab(
    {
      task: { taskId: "dedicated", sameWindow: false, windowId: 2, groupId: 8, claimedTabId: 98 },
      explicitTabId: 12,
    },
    api
  );
  assert.equal(result.tabId, 12);
  assert.equal(result.task.claimedTabId, null);
});

test("navigate rejects an outside tab without calling Chrome update", async () => {
  const api = chromeApi({
    windows: [{ id: 3 }],
    tabs: [
      { id: 13, windowId: 3, groupId: 9 },
      { id: 14, windowId: 3, groupId: -1 },
    ],
  });

  await assert.rejects(
    () =>
      navigateTaskTab(
        {
          task: { taskId: "shared", sameWindow: true, windowId: 3, groupId: 9, claimedTabId: 13 },
          explicitTabId: 14,
          url: "https://example.com",
        },
        api
      ),
    (err) => err.code === "tab_outside_task"
  );
  assert.equal(api.calls.some(([name]) => name === "tabs.update"), false);
});

test("close rejects an outside tab and clears the claim after a valid close", async () => {
  const task = { taskId: "dedicated", sameWindow: false, windowId: 5, groupId: 15, claimedTabId: 16 };
  const api = chromeApi({
    windows: [{ id: 5 }],
    tabs: [
      { id: 16, windowId: 5, groupId: 15 },
      { id: 17, windowId: 6, groupId: -1 },
    ],
  });

  await assert.rejects(
    () => closeTaskTab({ task, explicitTabId: 17 }, api),
    (err) => err.code === "tab_outside_task"
  );
  assert.equal(api.calls.some(([name]) => name === "tabs.remove"), false);

  const result = await closeTaskTab({ task, explicitTabId: 16 }, api);
  assert.equal(result.tabId, 16);
  assert.equal(result.task.claimedTabId, null);
  assert.deepEqual(api.calls.at(-1), ["tabs.remove", 16]);
});

test("missing dedicated task window is recreated with a grouped claimed tab", async () => {
  const api = chromeApi();
  const recovered = await ensureRecoverableTaskResources(
    {
      taskId: "dedicated-missing",
      sameWindow: false,
      windowId: null,
      groupId: null,
      claimedTabId: null,
    },
    { focus: false },
    api
  );

  assert.equal(recovered.sameWindow, false);
  assert.equal(recovered.windowId, 300);
  assert.equal(recovered.groupId, 200);
  assert.equal(recovered.claimedTabId, 100);
  assert.deepEqual(api.calls[0], [
    "windows.create",
    { focused: false, type: "normal", url: "about:blank" },
  ]);
});

test("missing shared task window creates a new grouped claim without claiming user tabs", async () => {
  const api = chromeApi({
    windows: [{ id: 8 }],
    tabs: [{ id: 18, windowId: 8, groupId: -1 }],
  });
  const recovered = await ensureRecoverableTaskResources(
    {
      taskId: "shared-missing",
      sameWindow: true,
      windowId: null,
      groupId: null,
      claimedTabId: null,
    },
    {},
    api
  );

  assert.equal(recovered.sameWindow, true);
  assert.equal(recovered.windowId, 8);
  assert.equal(recovered.groupId, 200);
  assert.equal(recovered.claimedTabId, 100);
  assert.deepEqual(api.calls.find(([name]) => name === "tabs.group"), [
    "tabs.group",
    200,
    { windowId: 8 },
    [100],
  ]);
  assert.equal(api.calls.some(([name, , , tabIds]) => name === "tabs.group" && tabIds?.includes(18)), false);
});

test("missing claim in a live task group is recreated and claimed", async () => {
  const api = chromeApi({
    windows: [{ id: 10 }],
    tabs: [{ id: 20, windowId: 10, groupId: 30 }],
  });
  const recovered = await ensureRecoverableTaskResources(
    {
      taskId: "missing-claim",
      sameWindow: true,
      windowId: 10,
      groupId: 30,
      claimedTabId: null,
      title: "Task",
      color: "blue",
    },
    {},
    api
  );
  assert.equal(recovered.windowId, 10);
  assert.equal(recovered.groupId, 30);
  assert.equal(recovered.claimedTabId, 100);
  assert.deepEqual(api.calls.find(([name]) => name === "tabGroups.update"), [
    "tabGroups.update",
    30,
    { title: "Task", color: "blue", collapsed: false },
  ]);
});

test("missing group in a dedicated task window is recreated around the live claim", async () => {
  const api = chromeApi({
    windows: [{ id: 12 }],
    tabs: [{ id: 13, windowId: 12, groupId: -1 }],
  });
  const recovered = await ensureRecoverableTaskResources(
    {
      taskId: "missing-group",
      sameWindow: false,
      windowId: 12,
      groupId: 45,
      claimedTabId: 13,
      title: "Task",
      color: "blue",
    },
    {},
    api
  );

  assert.equal(recovered.windowId, 12);
  assert.equal(recovered.groupId, 200);
  assert.equal(recovered.claimedTabId, 13);
  assert.equal(api.calls.some(([name]) => name === "tabs.create"), false);
  assert.deepEqual(api.calls.find(([name]) => name === "tabs.group"), [
    "tabs.group",
    200,
    { windowId: 12 },
    [13],
  ]);
  assert.deepEqual(api.calls.find(([name]) => name === "tabGroups.update"), [
    "tabGroups.update",
    200,
    { title: "Task", color: "blue", collapsed: false },
  ]);
});
