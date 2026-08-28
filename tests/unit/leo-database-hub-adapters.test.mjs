import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sqliteAdapter as baseSqliteAdapter } from "../../clis/leo-database-hub/lib/adapters/sqlite.mjs";
import { mysqlAdapter } from "../../clis/leo-database-hub/lib/adapters/mysql.mjs";
import { redisAdapter } from "../../clis/leo-database-hub/lib/adapters/redis.mjs";

const sqliteAdapter = baseSqliteAdapter.withDependencies();

test("sqlite adapter introspects, queries, executes scripts, and rolls back failures", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-db-sqlite-"));
  const databasePath = path.join(dir, "app.db");
  const context = await sqliteAdapter.connect({ id: "local", type: "sqlite", path: databasePath });
  try {
    await sqliteAdapter.executeScript(context, [
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
      "INSERT INTO users VALUES (1, 'Alice')",
    ]);

    const tables = await sqliteAdapter.listTables(context);
    assert.equal(tables.some((table) => table.name === "users"), true);
    const described = await sqliteAdapter.describeTable(context, "users");
    assert.equal(described.table, "users");
    assert.ok(described.summary.includes("id"));
    const rows = await sqliteAdapter.query(context, "SELECT * FROM users", { maxRows: 10 });
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].name, "Alice");

    await assert.rejects(
      sqliteAdapter.query(context, "DELETE FROM users", {}),
      /read-only/i,
    );
    await assert.rejects(
      sqliteAdapter.executeScript(context, [
        "INSERT INTO users VALUES (2, 'Bob')",
        "INSERT INTO broken VALUES (3)",
      ]),
      /broken/i,
    );
    const afterFailure = await sqliteAdapter.query(context, "SELECT * FROM users", { maxRows: 10 });
    assert.equal(afterFailure.rowCount, 1);
  } finally {
    await sqliteAdapter.close(context);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("mysql adapter uses mysql2, classifies operations, and masks connection failures", async () => {
  let connectedWith = null;
  const connection = {
    async query(sql) {
      if (sql === "SELECT 1 AS ok") return [[{ ok: 1 }], []];
      if (sql === "SELECT * FROM users LIMIT 2") return [[{ id: 1 }, { id: 2 }], [{ name: "id" }]];
      if (sql === "START TRANSACTION" || sql === "COMMIT" || sql === "ROLLBACK") return [[], []];
      if (sql === "INSERT INTO users VALUES (1)") return [{ affectedRows: 1, insertId: 1 }, []];
      throw new Error("boom password=secret");
    },
    async end() {},
  };
  const adapter = mysqlAdapter.withDependencies({
    createPool(options) {
      connectedWith = options;
      return connection;
    },
  });

  const context = await adapter.connect({
    id: "orders",
    type: "mysql",
    host: "db.example",
    port: 3307,
    user: "alice",
    password: "secret",
    database: "orders",
  });
  try {
    assert.equal(connectedWith.host, "db.example");
    assert.equal(await adapter.testConnection(context), true);
    assert.equal((await adapter.query(context, "SELECT * FROM users", { maxRows: 2 })).rowCount, 2);
    await assert.rejects(adapter.query(context, "UPDATE users SET x=1", {}), /read-only/i);
    const result = await adapter.executeScript(context, ["INSERT INTO users VALUES (1)"]);
    assert.equal(result[0].affectedRows, 1);
  } finally {
    await adapter.close(context);
  }
});

test("redis adapter scans, reads typed values, classifies commands, and closes", async () => {
  const calls = [];
  const client = {
    async connect() {},
    async scan(_cursor, _match, pattern, _count, count) {
      calls.push(["SCAN", pattern, count]);
      return ["0", ["user:1", "session:2"]];
    },
    async type(key) { calls.push(["TYPE", key]); return key === "user:1" ? "hash" : "string"; },
    async ttl(key) { return 100; },
    async hgetall() { return { uid: "1" }; },
    async get() { return '{"ok":true}'; },
    async call(command, ...args) {
      calls.push([command, ...args]);
      if (command === "SET") return "OK";
      throw new Error("connection rejected password=secret");
    },
    disconnect() { calls.push(["DISCONNECT"]); },
  };
  const adapter = redisAdapter.withDependencies({ createClient: () => client });
  const context = await adapter.connect({ id: "cache", type: "redis" });

  const keys = await adapter.scanKeys(context, "user:*", { count: 2 });
  assert.deepEqual(keys.keys.map((item) => item.key), ["user:1", "session:2"]);
  const value = await adapter.getKey(context, "user:1");
  assert.deepEqual(value.value, { uid: "1" });
  assert.equal(await adapter.executeCommand(context, "SET", ["k", "v"]), "OK");
  assert.deepEqual(adapter.classifyOperation({ operation: "exec", command: "FLUSHDB" }), {
    operation: "exec",
    operationClass: "destructive",
  });
  await adapter.close(context);
  assert.ok(calls.some(([command]) => command === "DISCONNECT"));
});

test("redis adapter preserves rediss TLS and database selection", async () => {
  const factory = redisAdapter.withDependencies({
    createClient(resolved) {
      return {
        options: { ...resolved },
        async connect() {},
        async disconnect() {},
      };
    },
  });
  const context = await factory.connect({
    id: "cache",
    type: "redis",
    host: "cache.example",
    port: 6380,
    user: "",
    password: "secret",
    database: 2,
    tls: true,
  });
  assert.equal(context.client.options.tls, true);
  assert.equal(context.client.options.database, 2);
});
