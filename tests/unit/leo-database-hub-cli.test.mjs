import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../../clis/leo-database-hub/lib/cli.mjs";
import { scanInRepoClis } from "../../lib/cli-core/discovery.mjs";
import { SkillInstaller } from "../../lib/session-sync/skill-installer.mjs";

function writeConfig(home, connections) {
  const file = path.join(home, "connections.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, connections }));
  return file;
}

test("CLI lists connections and adapters without exposing credentials", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leo-db-cli-"));
  const file = writeConfig(home, {
    orders: { type: "mysql", url: "mysql://alice:secret@127.0.0.1:3306/orders", access: "read" },
  });
  try {
    const connections = JSON.parse(await runCli(["connections"], { configPath: file }));
    assert.equal(connections.connections[0].id, "orders");
    assert.doesNotMatch(JSON.stringify(connections), /alice|secret/);

    const adapters = JSON.parse(await runCli(["adapters"], { configPath: file }));
    assert.deepEqual(adapters.adapters.map((adapter) => adapter.id), ["mysql", "sqlite", "redis"]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI query enforces policy before opening a database connection", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leo-db-cli-"));
  const file = writeConfig(home, {
    local: { type: "sqlite", path: path.join(home, "app.db"), access: "readwrite" },
  });
  try {
    await assert.rejects(
      runCli(["query", "local", "DELETE FROM users"], { configPath: file }),
      /read-only SQL/i,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI execute requires explicit write and destructive confirmation", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leo-db-cli-"));
  const file = writeConfig(home, {
    local: { type: "sqlite", path: path.join(home, "app.db"), access: "readwrite" },
  });
  try {
    await assert.rejects(
      runCli(["execute", "local", "CREATE TABLE users (id INTEGER)"], { configPath: file }),
      /--write/i,
    );
    await assert.rejects(
      runCli(["execute", "local", "DROP TABLE users", "--write"], { configPath: file }),
      /--yes/i,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI executes a SQL file and honors table format output", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leo-db-cli-file-"));
  const databasePath = path.join(home, "app.db");
  const file = writeConfig(home, { local: { type: "sqlite", path: databasePath, access: "readwrite" } });
  const scriptPath = path.join(home, "init.sql");
  fs.writeFileSync(scriptPath, "CREATE TABLE users (id INTEGER);");
  try {
    const result = JSON.parse(await runCli(["execute", "local", "--file", scriptPath, "--write"], { configPath: file }));
    assert.equal(result[0].affectedRows, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("in-repo CLI discovery exposes leo-database-hub", () => {
  const cli = scanInRepoClis(process.cwd()).find((item) => item.name === "leo-database-hub");
  assert.ok(cli);
  assert.equal(cli.lang, "node");
  assert.equal(cli.args[0], "./clis/leo-database-hub/index.mjs");
});

test("managed skill library exposes leo-database-hub", () => {
  const skill = SkillInstaller.getManagedSkill("leo-database-hub");
  assert.ok(skill);
  assert.equal(skill.category, "development");
  assert.ok(fs.existsSync(path.join(process.cwd(), "lib", "skills", "leo-database-hub", "SKILL.md")));
});

test("CLI supports restricted stdin import and table formatting", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leo-db-import-"));
  const file = path.join(home, "connections.json");
  const input = JSON.stringify({
    version: 1,
    connections: { local: { type: "sqlite", path: path.join(home, "app.db"), access: "read" } },
  });
  try {
    const imported = JSON.parse(await runCli(["connection", "import", "--stdin"], { configPath: file, stdin: input }));
    assert.equal(imported.connections.local.access, "read");
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);

    const table = await runCli(["connections", "--format", "table"], { configPath: file });
    assert.match(table, /id\s+type\s+access\s+target/u);
    assert.match(table, /local/u);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI import rejects invalid access before writing the secrets file", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leo-db-import-invalid-"));
  const file = path.join(home, "connections.json");
  try {
    await assert.rejects(
      runCli(["connection", "import", "--stdin"], {
        configPath: file,
        stdin: JSON.stringify({
          version: 1,
          connections: { local: { type: "sqlite", path: path.join(home, "app.db"), access: "admin" } },
        }),
      }),
      /invalid access/i,
    );
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI import reads process stdin when no literal input is injected", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leo-db-import-stream-"));
  const file = path.join(home, "connections.json");
  const input = JSON.stringify({
    version: 1,
    connections: { local: { type: "sqlite", path: path.join(home, "app.db") } },
  });
  try {
    const imported = JSON.parse(await runCli(["connection", "import", "--stdin"], {
      configPath: file,
      readStdin: async () => input,
    }));
    assert.equal(imported.connections.local.access, "readwrite");
    assert.equal(fs.existsSync(file), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
