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
