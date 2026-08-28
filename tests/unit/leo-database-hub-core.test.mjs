import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadConnectionStore,
  summarizeConnections,
} from "../../clis/leo-database-hub/lib/config/store.mjs";
import { resolveConnection } from "../../clis/leo-database-hub/lib/config/resolver.mjs";
import { createAdapterRegistry } from "../../clis/leo-database-hub/lib/core/registry.mjs";
import {
  classifySqlCommand,
  classifyRedisCommand,
  authorizeOperation,
} from "../../clis/leo-database-hub/lib/core/policy.mjs";
import { splitSqlScript } from "../../clis/leo-database-hub/lib/sql/splitter.mjs";

const testAdapter = {
  id: "mysql",
  family: "sql",
  displayName: "Test",
  capabilities: {},
};

test("connection store validates configuration and masks credential summaries", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leo-db-config-"));
  const file = path.join(home, "connections.json");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      connections: {
        orders: {
          type: "mysql",
          url: "mysql://alice:secret@127.0.0.1:3306/orders",
          access: "read",
        },
      },
    }));

    const store = loadConnectionStore({ secretsFile: file, registry: createAdapterRegistry([testAdapter]) });
    assert.equal(store.connections.orders.access, "read");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }

    const summary = JSON.stringify(summarizeConnections(store));
    assert.match(summary, /"id":"orders"/);
    assert.doesNotMatch(summary, /alice|secret/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("resolver applies env override, stored URL, structured fields, and env secrets", () => {
  const env = {
    LEO_DB_ORDERS_URL: "mysql://override:override-password@db.example.com:3307/override",
    APP_PASSWORD: "field-secret",
  };
  const resolved = resolveConnection({
    id: "orders",
    config: {
      type: "mysql",
      url: "mysql://stored:stored-secret@127.0.0.1/orders",
    },
  }, { env });
  assert.equal(resolved.host, "db.example.com");
  assert.equal(resolved.port, 3307);
  assert.equal(resolved.user, "override");
  assert.equal(resolved.password, "override-password");

  const structured = resolveConnection({
    id: "orders",
    config: {
      type: "mysql",
      host: "127.0.0.1",
      port: 3306,
      user: "app",
      password: "env:APP_PASSWORD",
      database: "orders",
    },
  }, { env: { APP_PASSWORD: "field-secret" } });
  assert.equal(structured.password, "field-secret");
  assert.equal(structured.database, "orders");

  const sqliteUrl = resolveConnection({
    id: "local",
    config: { type: "sqlite", url: "sqlite:///tmp/app.db" },
  }, { env: {} });
  assert.equal(sqliteUrl.path, "/tmp/app.db");

  const redisTls = resolveConnection({
    id: "cache",
    config: { type: "redis", url: "rediss://:secret@cache.example.com:6380/2" },
  }, { env: {} });
  assert.equal(redisTls.tls, true);
  assert.equal(redisTls.database, 2);

  assert.throws(
    () => resolveConnection({ id: "orders", config: { type: "mysql", url: "redis://127.0.0.1:6379/0" } }, { env: {} }),
    /expects a mysql/i,
  );
});

test("registry exposes adapters by id and family without hard-coding command dependencies", () => {
  const registry = createAdapterRegistry([testAdapter]);
  assert.deepEqual(registry.get("mysql"), testAdapter);
  assert.deepEqual(registry.byFamily("sql"), [testAdapter]);
  assert.deepEqual(registry.list(), [testAdapter]);
});

test("policy classifies SQL and Redis operations and enforces authorization", () => {
  assert.equal(classifySqlCommand("SELECT * FROM users"), "read");
  assert.equal(classifySqlCommand("UPDATE users SET status=1 WHERE id=1"), "write");
  assert.equal(classifySqlCommand("TRUNCATE TABLE users"), "destructive");
  assert.equal(classifySqlCommand("WITH updated AS (UPDATE users SET x=1 RETURNING *) SELECT * FROM updated"), "write");

  assert.equal(classifyRedisCommand("GET"), "read");
  assert.equal(classifyRedisCommand("SET"), "write");
  assert.equal(classifyRedisCommand("FLUSHALL"), "destructive");

  assert.equal(authorizeOperation({ access: "read", operationClass: "read" }), true);
  assert.throws(
    () => authorizeOperation({ access: "read", operationClass: "write" }),
    /read-only/i,
  );
  assert.equal(authorizeOperation({ access: "readwrite", operationClass: "read" }), true);
  assert.throws(
    () => authorizeOperation({ access: "readwrite", operationClass: "write", flags: {} }),
    /--write/i,
  );
  assert.throws(
    () => authorizeOperation({ access: "readwrite", operationClass: "destructive", flags: { write: true } }),
    /--yes/i,
  );
  assert.equal(authorizeOperation({
    access: "readwrite",
    operationClass: "destructive",
    flags: { write: true, yes: true },
  }), true);
});

test("SQL splitter respects quotes and comments", () => {
  assert.deepEqual(splitSqlScript([
    "-- create users",
    "CREATE TABLE users (id INTEGER, name TEXT); /* inline */",
    "INSERT INTO users VALUES (1, 'a;b');",
    "UPDATE users SET name = \`quoted;name\` WHERE id = 1;",
  ].join("\n")), [
    "CREATE TABLE users (id INTEGER, name TEXT)",
    "INSERT INTO users VALUES (1, 'a;b')",
    "UPDATE users SET name = \`quoted;name\` WHERE id = 1",
  ]);
});
