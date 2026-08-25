import { reconcileTaskRelationships, resolveTaskTab } from "./task-target.mjs";

const COLORS = ["blue", "green", "red", "yellow", "pink", "purple", "cyan", "orange"];

export function pickTaskColor(preferred) {
  if (preferred && COLORS.includes(String(preferred))) return String(preferred);
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export async function listChromeIds(api = chrome) {
  const tabs = await api.tabs.query({});
  const windows = await api.windows.getAll({});
  const groupsById = new Map();
  for (const tab of tabs) {
    if (Number.isFinite(tab.groupId) && tab.groupId >= 0 && !groupsById.has(tab.groupId)) {
      groupsById.set(tab.groupId, { id: tab.groupId, windowId: tab.windowId });
    }
  }
  return {
    tabs,
    windows,
    groups: [...groupsById.values()],
    tabIds: tabs.map((tab) => tab.id),
    windowIds: windows.map((win) => win.id),
    groupIds: [...groupsById.keys()],
  };
}

export async function resolveChromeTaskTab(
  { task, explicitTabId = null, allowMissingClaim = false } = {},
  api = chrome
) {
  const chromeIds = await listChromeIds(api);
  return resolveTaskTab({
    task,
    explicitTabId,
    allowMissingClaim,
    live: {
      tabsById: new Map(chromeIds.tabs.map((tab) => [Number(tab.id), tab])),
      windowsById: new Map(chromeIds.windows.map((win) => [Number(win.id), win])),
      groupsById: new Map(chromeIds.groups.map((group) => [Number(group.id), group])),
    },
  });
}

export async function ensureRecoverableTaskResources(task, { focus = false } = {}, api = chrome) {
  const chromeIds = await listChromeIds(api);
  const reconciled = reconcileTaskRelationships(task, {
    tabsById: new Map(chromeIds.tabs.map((tab) => [Number(tab.id), tab])),
    windowsById: new Map(chromeIds.windows.map((win) => [Number(win.id), win])),
    groupsById: new Map(chromeIds.groups.map((group) => [Number(group.id), group])),
  });
  const windowId = await ensureTaskWindow(
    {
      sameWindow: Boolean(reconciled.sameWindow),
      focus,
      windowId: reconciled.windowId,
    },
    api
  );
  let claimedTabId = reconciled.claimedTabId;
  if (claimedTabId == null) {
    const created = await api.tabs.create({
      windowId,
      url: "about:blank",
      active: Boolean(focus),
    });
    claimedTabId = created.id;
  }

  const nextGroupId = await ensureTaskGroup(
    {
      windowId,
      title: task.title,
      color: task.color,
      groupId: reconciled.groupId,
      tabIds: [claimedTabId],
    },
    api
  );

  return {
    ...reconciled,
    windowId,
    groupId: nextGroupId,
    claimedTabId,
  };
}

export async function navigateTaskTab(
  { task, explicitTabId = null, url, focus = false } = {},
  api = chrome
) {
  const resolved = await resolveChromeTaskTab({ task, explicitTabId }, api);
  const updated = await api.tabs.update(resolved.tabId, {
    url,
    active: Boolean(focus),
  });
  if (focus) await api.windows.update(updated.windowId, { focused: true });
  return { tab: updated, task: resolved.task };
}

export async function closeTaskTab({ task, explicitTabId = null } = {}, api = chrome) {
  const resolved = await resolveChromeTaskTab({ task, explicitTabId }, api);
  await api.tabs.remove(resolved.tabId);
  const nextTask = {
    ...resolved.task,
    claimedTabId:
      Number(resolved.task.claimedTabId) === Number(resolved.tabId)
        ? null
        : resolved.task.claimedTabId,
  };
  return { tabId: resolved.tabId, task: nextTask };
}

export async function ensureTaskWindow({ sameWindow = false, focus = false, windowId = null } = {}, api = chrome) {
  if (sameWindow) {
    if (windowId != null) {
      try {
        const existing = await api.windows.get(windowId);
        if (existing?.id != null) return existing.id;
      } catch {}
    }
    const current = await api.windows.getCurrent();
    return current.id;
  }

  if (windowId != null) {
    try {
      const existing = await api.windows.get(windowId);
      if (existing?.id != null) {
        if (focus) await api.windows.update(existing.id, { focused: true });
        return existing.id;
      }
    } catch {}
  }

  const created = await api.windows.create({
    focused: Boolean(focus),
    type: "normal",
    url: "about:blank",
  });
  return created.id;
}

export async function ensureTaskGroup({
  windowId,
  title,
  color,
  groupId = null,
  tabIds = [],
} = {}, api = chrome) {
  if (groupId != null) {
    try {
      await api.tabGroups.update(groupId, {
        title: title || "Agent Task",
        color: pickTaskColor(color),
        collapsed: false,
      });
      return groupId;
    } catch {}
  }

  if (!tabIds.length) return null;

  const nextGroupId = await api.tabs.group({
    createProperties: { windowId },
    tabIds,
  });
  await api.tabGroups.update(nextGroupId, {
    title: title || "Agent Task",
    color: pickTaskColor(color),
    collapsed: false,
  });
  return nextGroupId;
}

export async function moveTabToTaskGroup({ tabId, groupId, windowId, focus = false } = {}, api = chrome) {
  const tab = await api.tabs.get(tabId);
  if (!tab) throw new Error(`Claim target tab not found: ${tabId}`);

  if (windowId != null && tab.windowId !== windowId) {
    await api.tabs.move(tabId, { windowId, index: -1 });
  }

  // Detach from any existing user group before adopting into Agent group.
  if (tab.groupId != null && tab.groupId >= 0 && tab.groupId !== groupId) {
    await api.tabs.ungroup(tabId);
  }

  let nextGroupId = groupId;
  if (nextGroupId == null) {
    nextGroupId = await api.tabs.group({
      createProperties: { windowId: windowId ?? tab.windowId },
      tabIds: [tabId],
    });
  } else {
    await api.tabs.group({ groupId: nextGroupId, tabIds: [tabId] });
  }

  if (focus) {
    await api.tabs.update(tabId, { active: true });
    await api.windows.update(windowId ?? tab.windowId, { focused: true });
  }

  return { tabId, groupId: nextGroupId, windowId: windowId ?? tab.windowId };
}

export async function createOrNavigateTaskTab({
  url,
  action,
  claimedTabId = null,
  windowId,
  groupId = null,
  focus = false,
} = {}, api = chrome) {
  if (action === "navigate-claimed") {
    if (claimedTabId == null) throw new Error("No claimed tab to navigate");
    try {
      await api.tabs.get(claimedTabId);
    } catch (error) {
      if (!/No tab with id/i.test(String(error?.message || error))) throw error;
      action = "create-first";
      claimedTabId = null;
    }
    if (action === "navigate-claimed") {
      const updated = await api.tabs.update(claimedTabId, { url, active: Boolean(focus) });
      if (focus) await api.windows.update(updated.windowId, { focused: true });
      return { tabId: updated.id, windowId: updated.windowId, groupId, reused: true };
    }
  }

  const created = await api.tabs.create({
    windowId,
    url: url || "about:blank",
    active: Boolean(focus),
  });

  let nextGroupId = groupId;
  if (nextGroupId == null) {
    nextGroupId = await api.tabs.group({
      createProperties: { windowId: created.windowId },
      tabIds: [created.id],
    });
  } else {
    await api.tabs.group({ groupId: nextGroupId, tabIds: [created.id] });
  }

  if (focus) await api.windows.update(created.windowId, { focused: true });
  return { tabId: created.id, windowId: created.windowId, groupId: nextGroupId, reused: false };
}
