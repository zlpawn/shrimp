import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

test("E2E stdio integration: spawns node index.mjs as standalone subprocess and talks JSON-RPC 2.0", async () => {
  const tmpDb = path.join(os.tmpdir(), `e2e-mcp-db-${Date.now()}.db`).replace(/\\/g, "/");
  const indexPath = path.resolve("mcps/database-hub/index.mjs");

  const child = spawn("node", [indexPath], {
    env: {
      ...process.env,
      app_orders: `sqlite:///${tmpDb}`,
      redis_cache: `redis://:fake_secret@127.0.0.1:6379/1`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const sendRequest = (req) => {
    return new Promise((resolve, reject) => {
      const onData = (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const json = JSON.parse(trimmed);
            if (json.id === req.id) {
              child.stdout.off("data", onData);
              resolve(json);
              return;
            }
          } catch {}
        }
      };

      child.stdout.on("data", onData);
      child.stdin.write(JSON.stringify(req) + "\n");
    });
  };

  try {
    // 1. Initialize
    const initRes = await sendRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });
    assert.equal(initRes.result.serverInfo.name, "database-hub");

    // 2. List tools
    const toolsRes = await sendRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    assert.equal(toolsRes.result.tools.length, 9);

    // 3. Call list_databases
    const listDbRes = await sendRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_databases", arguments: {} },
    });
    const dbs = JSON.parse(listDbRes.result.content[0].text);
    assert.equal(dbs.total, 2);
    assert.ok(dbs.databases.some((d) => d.id === "app_orders" && d.type === "sqlite"));
    assert.ok(dbs.databases.some((d) => d.id === "redis_cache" && d.type === "redis"));

    // 4. Create table
    await sendRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "execute_mutation",
        arguments: {
          db_id: "app_orders",
          sql: "CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, city TEXT, price REAL);",
        },
      },
    });

    // 5. Insert rows
    await sendRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "execute_mutation",
        arguments: {
          db_id: "app_orders",
          sql: "INSERT INTO properties (name, city, price) VALUES ('洱海一线海景房', '大理', 1280.0), ('西湖观景民宿', '杭州', 850.0);",
        },
      },
    });

    // 6. Query SQL (NL2SQL output simulation)
    const queryRes = await sendRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "query_sql",
        arguments: {
          db_id: "app_orders",
          sql: "SELECT * FROM properties WHERE name LIKE '%海景%' ORDER BY price DESC",
        },
      },
    });
    const queryData = JSON.parse(queryRes.result.content[0].text);
    assert.equal(queryData.rowCount, 1);
    assert.equal(queryData.rows[0].name, "洱海一线海景房");
    assert.equal(queryData.rows[0].price, 1280.0);

    // 7. Test schema summary
    const summaryRes = await sendRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "get_database_summary",
        arguments: { db_id: "app_orders" },
      },
    });
    const summaryData = JSON.parse(summaryRes.result.content[0].text);
    assert.ok(summaryData.summary.includes("properties"));
    assert.ok(summaryData.summary.includes("price"));
  } finally {
    child.kill();
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    } catch {}
  }
});
