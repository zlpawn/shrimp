export function assertClaimParams(params = {}) {
  const raw = params.tabId;
  if (raw === undefined || raw === null || raw === "") {
    throw new Error("tabs.claim requires explicit tabId");
  }
  const tabId = Number(raw);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    throw new Error(`tabs.claim received invalid tabId: ${raw}`);
  }
  return { tabId };
}

export function assertActiveTask(state) {
  if (!state?.activeTask) {
    throw new Error("No active task. Run task.start first.");
  }
  return state.activeTask;
}

export function decideNewTabAction({ hasActiveTask, hasClaimedTab, force = false } = {}) {
  if (!hasActiveTask) return "reject-no-task";
  if (force) return "create-force";
  if (hasClaimedTab) return "navigate-claimed";
  return "create-first";
}

export function decideGotoAction({ hasActiveTask, hasClaimedTab, tabId = null } = {}) {
  if (!hasActiveTask) return "reject-no-task";
  if (tabId != null) return "navigate-explicit";
  if (!hasClaimedTab) return "reject-no-claimed-tab";
  return "navigate-claimed";
}

export function shouldReuseActiveTask(state) {
  return Boolean(state?.activeTask);
}
