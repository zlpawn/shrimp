const DESTRUCTIVE_SQL = /^(drop|truncate|rename|grant|revoke|shutdown)\b/i;
const WRITE_SQL = /^(insert|update|delete|create|alter|set|replace|call|merge)\b/i;
const READ_SQL = /^(select|with|explain|pragma|show|describe|desc)\b/i;

const REDIS_READ = new Set(["GET", "MGET", "TTL", "PTTL", "TYPE", "EXISTS", "SCAN", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "DBSIZE", "PING"]);
const REDIS_DESTRUCTIVE = new Set(["FLUSHDB", "FLUSHALL", "SHUTDOWN", "RESET", "SCRIPT", "DEBUG", "CONFIG", "ACL"]);
const REDIS_WRITE = new Set(["SET", "MSET", "DEL", "UNLINK", "EXPIRE", "PERSIST", "HSET", "HMSET", "LPUSH", "RPUSH", "SADD", "ZADD", "INCR", "DECR", "RENAME", "APPEND", "SETEX"]);

export function classifySqlCommand(sql) {
  const normalized = String(sql || "").trim().replace(/\/s+/g, " ");
  if (READ_SQL.test(normalized)) return "read";
  if (DESTRUCTIVE_SQL.test(normalized)) return "destructive";
  if (WRITE_SQL.test(normalized)) return "write";
  return "unknown";
}

export function classifyRedisCommand(command) {
  const name = String(command || "").trim().toUpperCase();
  if (REDIS_READ.has(name)) return "read";
  if (REDIS_DESTRUCTIVE.has(name)) return "destructive";
  if (REDIS_WRITE.has(name)) return "write";
  return "unknown";
}

export function authorizeOperation({ access, operationClass, flags = {} }) {
  if (access === "read") {
    throw new Error("Connection is read-only. Configure access=readwrite to permit this operation.");
  }
  if (access !== "readwrite") throw new Error("Invalid connection access mode.");
  if (operationClass === "read") return true;
  if (operationClass === "write" || operationClass === "destructive") {
    if (!flags.write) throw new Error("Write operation requires --write.");
    if (operationClass === "destructive" && !flags.yes) throw new Error("Destructive operation requires --write --yes.");
    return true;
  }
  throw new Error("Unable to classify operation; refusing to execute.");
}
