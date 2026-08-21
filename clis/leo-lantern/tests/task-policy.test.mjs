import test from "node:test";
import assert from "node:assert/strict";
import {
  assertClaimParams,
  assertActiveTask,
  decideNewTabAction,
  decideGotoAction,
  shouldReuseActiveTask,
} from "../../../extensions/leo-cookie-txt-locally/task-policy.mjs";

test("claim requires explicit numeric tabId", () => {
  assert.throws(() => assertClaimParams({}), /requires explicit tabId/);
  assert.throws(() => assertClaimParams({ tabId: "abc" }), /invalid tabId/);
  assert.deepEqual(assertClaimParams({ tabId: "42" }), { tabId: 42 });
});

test("new-tab policy fails closed without active task and reuses claimed tab", () => {
  assert.equal(decideNewTabAction({ hasActiveTask: false }), "reject-no-task");
  assert.equal(
    decideNewTabAction({ hasActiveTask: true, hasClaimedTab: true, force: false }),
    "navigate-claimed"
  );
  assert.equal(
    decideNewTabAction({ hasActiveTask: true, hasClaimedTab: false, force: false }),
    "create-first"
  );
  assert.equal(
    decideNewTabAction({ hasActiveTask: true, hasClaimedTab: true, force: true }),
    "create-force"
  );
});

test("goto policy requires active task and claimed tab by default", () => {
  assert.equal(decideGotoAction({ hasActiveTask: false }), "reject-no-task");
  assert.equal(
    decideGotoAction({ hasActiveTask: true, hasClaimedTab: false }),
    "reject-no-claimed-tab"
  );
  assert.equal(
    decideGotoAction({ hasActiveTask: true, hasClaimedTab: true }),
    "navigate-claimed"
  );
  assert.equal(
    decideGotoAction({ hasActiveTask: true, hasClaimedTab: true, tabId: 9 }),
    "navigate-explicit"
  );
});

test("active task helpers", () => {
  assert.equal(shouldReuseActiveTask({ activeTask: null }), false);
  assert.equal(shouldReuseActiveTask({ activeTask: { taskId: "t1" } }), true);
  assert.throws(() => assertActiveTask({ activeTask: null }), /No active task/);
  assert.equal(assertActiveTask({ activeTask: { taskId: "t1" } }).taskId, "t1");
});
