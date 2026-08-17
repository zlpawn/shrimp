export function createCommandAppsProcessStore() {
  const children = new Map();

  return {
    record(appId, child) {
      if (!appId || !child || !Number.isInteger(child.pid) || child.pid <= 0) return;
      children.set(appId, { pid: child.pid, child, recordedAt: new Date().toISOString() });
    },
    clear(appId, pid) {
      const current = children.get(appId);
      if (!current || current.pid !== pid) return;
      children.delete(appId);
    },
    get(appId) {
      const current = children.get(appId);
      if (!current) return null;
      return { pid: current.pid, recordedAt: current.recordedAt };
    },
  };
}
