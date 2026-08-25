import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyTaskState,
  toBridgeTaskSummary,
  validateTaskState,
  upsertActiveTask,
  clearActiveTask,
} from "../../../extensions/leo-cookie-txt-locally/task-state.mjs";

test("upsert reuses one active task and summary exposes stable fields", () => {
  const first = upsertActiveTask(createEmptyTaskState(), {
    title: "deploy",
    sameWindow: false,
    windowId: 1,
  }, 1000);
  assert.equal(first.activeTask.title, "deploy");
  assert.equal(first.activeTask.sameWindow, false);
  assert.equal(first.activeTask.createdAt, 1000);

  const second = upsertActiveTask(first, { title: "deploy-2", color: "green" }, 2000);
  assert.equal(second.activeTask.taskId, first.activeTask.taskId);
  assert.equal(second.activeTask.title, "deploy-2");
  assert.equal(second.activeTask.color, "green");
  assert.equal(second.activeTask.createdAt, 1000);
  assert.equal(second.activeTask.updatedAt, 2000);

  assert.deepEqual(toBridgeTaskSummary(second), {
    taskId: second.activeTask.taskId,
    title: "deploy-2",
    color: "green",
    groupId: null,
    windowId: 1,
    claimedTabId: null,
    sameWindow: false,
    updatedAt: 2000,
  });
});

test("upsert preserves established same-window strategy when the field is omitted", () => {
  const first = upsertActiveTask(createEmptyTaskState(), {
    sameWindow: true,
    windowId: 7,
    groupId: 70,
    claimedTabId: 71,
  }, 1000);
  const second = upsertActiveTask(first, { title: "renamed" }, 2000);

  assert.equal(second.activeTask.sameWindow, true);
  assert.equal(second.activeTask.windowId, 7);
  assert.equal(second.activeTask.groupId, 70);
  assert.equal(second.activeTask.claimedTabId, 71);
});

test("validate clears invalid chrome ids and clearActiveTask resets state", () => {
  const state = upsertActiveTask(createEmptyTaskState(), {
    title: "keep",
    groupId: 10,
    windowId: 20,
    claimedTabId: 30,
  }, 1000);
  const validated = validateTaskState(state, {
    tabIds: [99],
    groupIds: [10],
    windowIds: [],
  });
  assert.equal(validated.activeTask.groupId, 10);
  assert.equal(validated.activeTask.windowId, null);
  assert.equal(validated.activeTask.claimedTabId, null);
  assert.equal(clearActiveTask(validated).activeTask, null);
  assert.equal(toBridgeTaskSummary(clearActiveTask(validated)), null);
});

test("validate applies relationship-aware recovery for a missing dedicated group", () => {
  const state = upsertActiveTask(createEmptyTaskState(), {
    title: "recover",
    sameWindow: false,
    groupId: 10,
    windowId: 20,
    claimedTabId: 30,
  }, 1000);

  const validated = validateTaskState(state, {
    tabs: [{ id: 30, windowId: 20, groupId: -1 }],
    windows: [{ id: 20 }],
    groups: [],
  });

  assert.equal(validated.activeTask.windowId, 20);
  assert.equal(validated.activeTask.groupId, null);
  assert.equal(validated.activeTask.claimedTabId, 30);
  assert.equal(validated.activeTask.sameWindow, false);
});

test("validate clears a shared-window claim when its task group relationship is gone", () => {
  const state = upsertActiveTask(createEmptyTaskState(), {
    sameWindow: true,
    groupId: 11,
    windowId: 21,
    claimedTabId: 31,
  }, 1000);

  const validated = validateTaskState(state, {
    tabs: [{ id: 31, windowId: 21, groupId: -1 }],
    windows: [{ id: 21 }],
    groups: [],
  });

  assert.equal(validated.activeTask.windowId, 21);
  assert.equal(validated.activeTask.groupId, null);
  assert.equal(validated.activeTask.claimedTabId, null);
  assert.equal(validated.activeTask.sameWindow, true);
});
