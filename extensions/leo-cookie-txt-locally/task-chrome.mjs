const COLORS = ["blue", "green", "red", "yellow", "pink", "purple", "cyan", "orange"];

export function pickTaskColor(preferred) {
  if (preferred && COLORS.includes(String(preferred))) return String(preferred);
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export async function listChromeIds(api = chrome) {
  const tabs = await api.tabs.query({});
  const windows = await api.windows.getAll({});
  const groupIds = [...new Set(tabs.map((tab) => tab.groupId).filter((id) => Number.isFinite(id) && id >= 0))];
  return {
    tabIds: tabs.map((tab) => tab.id),
    windowIds: windows.map((win) => win.id),
    groupIds,
  };
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
    const updated = await api.tabs.update(claimedTabId, { url, active: Boolean(focus) });
    if (focus) await api.windows.update(updated.windowId, { focused: true });
    return { tabId: updated.id, windowId: updated.windowId, groupId, reused: true };
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
