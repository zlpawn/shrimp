import { mysqlAdapter } from "./mysql.mjs";
import { sqliteAdapter } from "./sqlite.mjs";
import { redisAdapter } from "./redis.mjs";

export const builtInAdapters = [
  mysqlAdapter.withDependencies(),
  sqliteAdapter.withDependencies(),
  redisAdapter.withDependencies(),
];
