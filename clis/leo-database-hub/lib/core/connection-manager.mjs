import { resolveConnection } from "../config/resolver.mjs";

export class ConnectionManager {
  constructor({ store, registry }) {
    this.store = store;
    this.registry = registry;
    this.contexts = new Map();
  }

  async getContext(id, { env = process.env } = {}) {
    if (this.contexts.has(id)) return this.contexts.get(id);
    const config = this.store.connections[id];
    if (!config) throw new Error(`Unknown connection: ${id}`);
    const adapter = this.registry.get(config.type);
    const resolved = resolveConnection({ id, config }, { env });
    const context = await adapter.connect(resolved);
    this.contexts.set(id, context);
    return context;
  }

  adapterFor(id) {
    const config = this.store.connections[id];
    if (!config) throw new Error(`Unknown connection: ${id}`);
    const adapter = this.registry.get(config.type);
    if (!adapter) throw new Error(`No adapter registered for ${config.type}`);
    return adapter;
  }

  async close() {
    for (const [id, context] of this.contexts) {
      const config = this.store.connections[id];
      const adapter = this.registry.get(config.type);
      try { await adapter.close(context); } catch {}
    }
    this.contexts.clear();
  }
}
