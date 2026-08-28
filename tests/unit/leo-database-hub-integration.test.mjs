import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../../clis/leo-database-hub/lib/cli.mjs";

test("CLI executes an end-to-end SQLite query and transaction", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leo-db-e2e-"));
  const databasePath = path.join(home, "app.db");
  const configFile = path.join(home, "connections.json");
  fs.writeFileSync(configFile, JSON.stringify({
    version: 1,
    connections: { local: { type: "sqlite", path: databasePath, access: "readwrite" } },
  }));

  try {
    await runCli(["execute", "local", "--write", "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1, 'Alice')"], { configPath: configFile });
    const result = JSON.parse(await runCli(["query", "local", "SELECT * FROM users"], { configPath: configFile }));
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].name, "Alice");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
