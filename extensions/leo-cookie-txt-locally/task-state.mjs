export function createEmptyTaskState() {
  return {
    version: 1,
    activeTask: null,
  };
}

export function createTaskId(now = Date.now()) {
  return `task_${now.toString(36)}`;
}

export function toBridgeTaskSummary(state) {
  const task = state?.activeTask;
  if (!task) return null;
  return {
    taskId: task.taskId,
    title: task.title,
    color: task.color,
    groupId: task.groupId ?? null,
    windowId: task.windowId ?? null,
    claimedTabId: task.claimedTabId ?? null,
    sameWindow: Boolean(task.sameWindow),
    updatedAt: task.updatedAt,
  };
}

export function validateTaskState(state, chromeIds = {}) {
  const next = {
    version: 1,
    activeTask: state?.activeTask ? { ...state.activeTask } : null,
  };
  if (!next.activeTask) return next;

  const tabIds = new Set((chromeIds.tabIds || []).map(Number));
  const groupIds = new Set((chromeIds.groupIds || []).map(Number));
  const windowIds = new Set((chromeIds.windowIds || []).map(Number));

  if (next.activeTask.claimedTabId != null && !tabIds.has(Number(next.activeTask.claimedTabId))) {
    next.activeTask.claimedTabId = null;
  }
  if (next.activeTask.groupId != null && !groupIds.has(Number(next.activeTask.groupId))) {
    next.activeTask.groupId = null;
  }
  if (next.activeTask.windowId != null && !windowIds.has(Number(next.activeTask.windowId))) {
    next.activeTask.windowId = null;
  }
  next.activeTask.updatedAt = Date.now();
  return next;
}

export function upsertActiveTask(state, patch = {}, now = Date.now()) {
  const current = state?.activeTask;
  if (current) {
    return {
      version: 1,
      activeTask: {
        ...current,
        ...patch,
        taskId: current.taskId,
        createdAt: current.createdAt,
        updatedAt: now,
        extensions: patch.extensions ?? current.extensions ?? {},
      },
    };
  }
  return {
    version: 1,
    activeTask: {
      taskId: patch.taskId || createTaskId(now),
      title: patch.title || "Agent Task",
      color: patch.color || "blue",
      groupId: patch.groupId ?? null,
      windowId: patch.windowId ?? null,
      claimedTabId: patch.claimedTabId ?? null,
      sameWindow: Boolean(patch.sameWindow),
      createdAt: now,
      updatedAt: now,
      extensions: patch.extensions || {},
    },
  };
}

export function clearActiveTask(state = createEmptyTaskState()) {
  return {
    version: state?.version || 1,
    activeTask: null,
  };
}
