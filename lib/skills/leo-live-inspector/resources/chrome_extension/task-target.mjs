import { lanternError } from "./errors.mjs";

function numericId(value) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

function hasWindow(live, windowId) {
  return windowId != null && live?.windowsById?.has(windowId);
}

function getTab(live, tabId) {
  return tabId == null ? null : live?.tabsById?.get(tabId) || null;
}

function hasLiveGroupInWindow(live, groupId, windowId) {
  if (groupId == null || windowId == null || !live?.groupsById?.has(groupId)) return false;
  for (const tab of live?.tabsById?.values?.() || []) {
    if (numericId(tab.groupId) === groupId && numericId(tab.windowId) === windowId) return true;
  }
  return false;
}

export function isTaskOwnedTab(task, tab, live) {
  if (!task || !tab) return false;
  const windowId = numericId(task.windowId);
  const groupId = numericId(task.groupId);
  if (!hasWindow(live, windowId) || numericId(tab.windowId) !== windowId) return false;
  if (task.sameWindow) return groupId != null && numericId(tab.groupId) === groupId;
  return groupId == null || numericId(tab.groupId) === groupId;
}

export function reconcileTaskRelationships(task, live) {
  if (!task) return null;
  const next = { ...task };
  const windowId = numericId(next.windowId);
  const groupId = numericId(next.groupId);
  const claimedTabId = numericId(next.claimedTabId);

  if (!hasWindow(live, windowId)) {
    next.windowId = null;
    next.groupId = null;
    next.claimedTabId = null;
    return next;
  }

  next.windowId = windowId;
  const groupIsLive = hasLiveGroupInWindow(live, groupId, windowId);
  if (!groupIsLive) next.groupId = null;
  else next.groupId = groupId;

  const claimedTab = getTab(live, claimedTabId);
  if (!claimedTab || numericId(claimedTab.windowId) !== windowId) {
    next.claimedTabId = null;
    return next;
  }

  if (groupIsLive) {
    next.claimedTabId = numericId(claimedTab.groupId) === groupId ? claimedTabId : null;
  } else if (next.sameWindow) {
    next.claimedTabId = null;
  } else {
    next.claimedTabId = claimedTabId;
  }
  return next;
}

export function resolveTaskTab({ task, explicitTabId = null, live, allowMissingClaim = false } = {}) {
  if (!task) throw lanternError("no_active_task", "No browser task is active");
  const reconciled = reconcileTaskRelationships(task, live);
  const requestedTabId = numericId(explicitTabId);

  if (reconciled.windowId == null) {
    throw lanternError("task_window_missing", "The active task window is unavailable");
  }

  if (explicitTabId !== null && explicitTabId !== undefined) {
    if (requestedTabId == null) throw lanternError("invalid_request", `Invalid tab ID: ${explicitTabId}`);
    const tab = getTab(live, requestedTabId);
    if (!tab) throw lanternError("tab_not_found", `Tab ${requestedTabId} was not found`);
    if (!isTaskOwnedTab(reconciled, tab, live)) {
      throw lanternError("tab_outside_task", `Tab ${requestedTabId} is outside the active task`);
    }
    return { tabId: requestedTabId, task: reconciled };
  }

  if (reconciled.claimedTabId == null) {
    if (allowMissingClaim) return { tabId: null, task: reconciled };
    throw lanternError("no_claimed_tab", "No task tab is currently claimed");
  }
  return { tabId: Number(reconciled.claimedTabId), task: reconciled };
}
