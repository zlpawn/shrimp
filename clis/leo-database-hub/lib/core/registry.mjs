export function createAdapterRegistry(adapters = []) {
  const byId = new Map();
  for (const adapter of adapters) {
    if (!adapter?.id || !adapter?.family) throw new Error("Adapter must define id and family.");
    if (byId.has(adapter.id)) throw new Error(`Duplicate adapter id: ${adapter.id}`);
    byId.set(adapter.id, Object.freeze({ ...adapter }));
  }
  return {
    get(id) { return byId.get(id) || null; },
    ids() { return [...byId.keys()]; },
    list() { return [...byId.values()]; },
    byFamily(family) { return [...byId.values()].filter((adapter) => adapter.family === family); },
  };
}
