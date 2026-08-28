import { classifyRedisCommand } from "../core/policy.mjs";

function baseAdapter() {
  return {
    id: "redis",
    family: "kv",
    displayName: "Redis",
    capabilities: { scan: true, typedRead: true, commandExecution: true },
    classifyOperation({ operation, command }) {
      return { operation, operationClass: classifyRedisCommand(command) };
    },
  };
}

export const redisAdapter = {
  ...baseAdapter(),
  withDependencies({ createClient = defaultCreateClient } = {}) {
    return {
      ...baseAdapter(),
      async connect(resolved) {
        const client = createClient(resolved);
        await client.connect();
        return { id: resolved.id, type: "redis", client };
      },
      async scanKeys(context, pattern = "*", options = {}) {
        const count = normalizeCount(options.count);
        const [, keys] = await context.client.scan(0, "MATCH", pattern, "COUNT", count);
        const enriched = [];
        for (const key of keys.slice(0, count)) {
          const [type, ttl] = await Promise.all([context.client.type(key), context.client.ttl(key)]);
          enriched.push({ key, type, ttl });
        }
        return { connection: context.id, pattern, keys: enriched, totalFound: keys.length };
      },
      async getKey(context, key) {
        const type = String(await context.client.type(key)).toLowerCase();
        const ttl = await context.client.ttl(key);
        let value = null;
        if (type === "string") value = parseJson(await context.client.get(key));
        else if (type === "hash") value = await context.client.hgetall(key);
        else if (type === "list") value = await context.client.lrange(key, 0, 99);
        else if (type === "set") value = await context.client.smembers(key);
        else if (type === "zset") value = await context.client.zrange(key, 0, 99, "WITHSCORES");
        else if (type === "none") return { connection: context.id, key, exists: false };
        else value = `[unsupported type: ${type}]`;
        return { connection: context.id, key, type, ttl, value };
      },
      async executeCommand(context, command, args) {
        return context.client.call(String(command).toUpperCase(), ...args);
      },
      async close(context) { context.client.disconnect(); },
    };
  },
};

async function defaultCreateClient(resolved) {
  const Redis = (await import("ioredis")).default;
  return new Redis({
    host: resolved.host,
    port: resolved.port,
    username: resolved.user,
    password: resolved.password,
    db: resolved.database || 0,
    database: resolved.database || 0,
    lazyConnect: true,
    tls: resolved.tls ? {} : undefined,
  });
}

function normalizeCount(value) {
  const parsed = Number(value || 50);
  return Math.max(1, Math.min(1000, Number.isFinite(parsed) ? parsed : 50));
}

function parseJson(value) {
  if (typeof value !== "string") return value;
  if (!value.startsWith("{") && !value.startsWith("[")) return value;
  try { return JSON.parse(value); } catch { return value; }
}
