import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileTaskRelationships,
  resolveTaskTab,
} from "../../../extensions/leo-cookie-txt-locally/task-target.mjs";

function liveState({ tabs = [], windows = [], groups = [] } = {}) {
  return {
    tabsById: new Map(tabs.map((tab) => [Number(tab.id), tab])),
    windowsById: new Map(windows.map((win) => [Number(win.id), win])),
    groupsById: new Map(groups.map((group) => [Number(group.id), group])),
  };
}

test("explicit tab outside a shared-window task group fails closed", () => {
  const task = {
    taskId: "task_shared",
    sameWindow: true,
    windowId: 1,
    groupId: null,
    claimedTabId: null,
  };
  assert.throws(
    () =>
      resolveTaskTab({
        task,
        explicitTabId: 9,
        live: liveState({
          tabs: [{ id: 9, windowId: 1, groupId: -1 }],
          windows: [{ id: 1 }],
        }),
      }),
    (err) => err.code === "tab_outside_task"
  );
});

test("stale claim does not block another explicit task-owned tab", () => {
  const result = resolveTaskTab({
    task: {
      taskId: "task_dedicated",
      sameWindow: false,
      windowId: 2,
      groupId: 7,
      claimedTabId: 99,
    },
    explicitTabId: 10,
    live: liveState({
      tabs: [{ id: 10, windowId: 2, groupId: 7 }],
      windows: [{ id: 2 }],
      groups: [{ id: 7, windowId: 2 }],
    }),
  });
  assert.equal(result.tabId, 10);
  assert.equal(result.task.claimedTabId, null);
});

test("missing group preserves a dedicated-window claim but clears a shared-window claim", () => {
  const live = liveState({
    tabs: [
      { id: 20, windowId: 3, groupId: -1 },
      { id: 21, windowId: 4, groupId: -1 },
    ],
    windows: [{ id: 3 }, { id: 4 }],
  });

  const dedicated = reconcileTaskRelationships(
    { taskId: "dedicated", sameWindow: false, windowId: 3, groupId: 30, claimedTabId: 20 },
    live
  );
  assert.equal(dedicated.groupId, null);
  assert.equal(dedicated.claimedTabId, 20);

  const shared = reconcileTaskRelationships(
    { taskId: "shared", sameWindow: true, windowId: 4, groupId: 40, claimedTabId: 21 },
    live
  );
  assert.equal(shared.groupId, null);
  assert.equal(shared.claimedTabId, null);
});

test("missing window clears Chrome IDs while preserving task strategy", () => {
  const task = reconcileTaskRelationships(
    {
      taskId: "task_missing_window",
      title: "Deploy",
      sameWindow: true,
      windowId: 5,
      groupId: 50,
      claimedTabId: 51,
    },
    liveState()
  );

  assert.deepEqual(
    {
      taskId: task.taskId,
      title: task.title,
      sameWindow: task.sameWindow,
      windowId: task.windowId,
      groupId: task.groupId,
      claimedTabId: task.claimedTabId,
    },
    {
      taskId: "task_missing_window",
      title: "Deploy",
      sameWindow: true,
      windowId: null,
      groupId: null,
      claimedTabId: null,
    }
  );
});

test("a group ID is invalid when no live group tab connects it to the task window", () => {
  const task = reconcileTaskRelationships(
    { taskId: "task_group", sameWindow: true, windowId: 6, groupId: 60, claimedTabId: 61 },
    liveState({
      windows: [{ id: 6 }],
      groups: [{ id: 60, windowId: 6 }],
      tabs: [{ id: 61, windowId: 6, groupId: -1 }],
    })
  );
  assert.equal(task.groupId, null);
  assert.equal(task.claimedTabId, null);
});
