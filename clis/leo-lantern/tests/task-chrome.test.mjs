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
  };
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

test("missing dedicated task window is recreated without changing strategy", async () => {
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
  assert.equal(recovered.groupId, null);
  assert.equal(recovered.claimedTabId, null);
  assert.deepEqual(api.calls[0], [
    "windows.create",
    { focused: false, type: "normal", url: "about:blank" },
  ]);
});

test("missing shared task window selects current window without claiming user tabs", async () => {
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
  assert.equal(recovered.groupId, null);
  assert.equal(recovered.claimedTabId, null);
  assert.equal(api.calls.some(([name]) => name === "tabs.group"), false);
});
