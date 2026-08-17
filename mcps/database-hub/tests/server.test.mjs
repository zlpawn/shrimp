import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createDatabaseHubServer } from "../lib/server.mjs";

test("database-hub MCP initializes and handles full JSON-RPC lifecycle", async () => {
  const tmpDbPath = path.join(os.tmpdir(), `test-db-hub-${Date.now()}.db`);

  const fakeEnv = {
    test_orders: `sqlite:///${tmpDbPath.replace(/\\/g, "/")}`,
  };

  const { server, manager } = createDatabaseHubServer(fakeEnv);

  try {
    // 1. Test JSON-RPC initialize
    const initResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });
    assert.equal(initResp.result.serverInfo.name, "database-hub");
    assert.ok(initResp.result.capabilities.tools);

    // 2. Test tools/list
    const toolsResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const toolNames = toolsResp.result.tools.map((t) => t.name);
    assert.ok(toolNames.includes("list_databases"));
    assert.ok(toolNames.includes("list_tables"));
    assert.ok(toolNames.includes("describe_table"));
    assert.ok(toolNames.includes("get_database_summary"));
    assert.ok(toolNames.includes("query_sql"));
    assert.ok(toolNames.includes("execute_mutation"));
    assert.ok(toolNames.includes("redis_scan_keys"));

    // 3. Test list_databases tool call
    const listDbResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_databases", arguments: {} },
    });
    const listDbData = JSON.parse(listDbResp.result.content[0].text);
    assert.equal(listDbData.total, 1);
    assert.equal(listDbData.databases[0].id, "test_orders");

    // 4. Test execute_mutation to create table
    const createTableResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "execute_mutation",
        arguments: {
          sql: "CREATE TABLE houses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, price REAL);",
        },
      },
    });
    assert.ok(!createTableResp.result.isError);

    // 5. Test execute_mutation to insert data
    const insertResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "execute_mutation",
        arguments: {
          sql: "INSERT INTO houses (title, price) VALUES ('三亚海景大床房', 888.5), ('丽江古镇观景套房', 520.0);",
        },
      },
    });
    const insertData = JSON.parse(insertResp.result.content[0].text);
    assert.equal(insertData.affectedRows, 2);

    // 6. Test list_tables
    const listTablesResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "list_tables", arguments: {} },
    });
    const listTablesData = JSON.parse(listTablesResp.result.content[0].text);
    assert.equal(listTablesData.tables[0].name, "houses");

    // 7. Test describe_table
    const descResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "describe_table", arguments: { table_name: "houses" } },
    });
    const descData = JSON.parse(descResp.result.content[0].text);
    assert.equal(descData.table, "houses");
    const titleCol = descData.columns.find((c) => c.name === "title");
    assert.ok(titleCol);
    assert.equal(titleCol.nullable, "NO");

    // 8. Test get_database_summary
    const summaryResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "get_database_summary", arguments: {} },
    });
    const summaryData = JSON.parse(summaryResp.result.content[0].text);
    assert.ok(summaryData.summary.includes("Table: houses"));
    assert.ok(summaryData.summary.includes("price"));

    // 9. Test query_sql
    const queryResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "query_sql",
        arguments: {
          sql: "SELECT * FROM houses WHERE title LIKE '%海景%'",
        },
      },
    });
    const queryData = JSON.parse(queryResp.result.content[0].text);
    assert.equal(queryData.rowCount, 1);
    assert.equal(queryData.rows[0].title, "三亚海景大床房");
    assert.equal(queryData.rows[0].price, 888.5);

    // 10. Test safety guard on unconditional DELETE
    const unsafeDeleteResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "execute_mutation",
        arguments: {
          sql: "DELETE FROM houses",
        },
      },
    });
    assert.equal(unsafeDeleteResp.result.isError, true);
    assert.ok(unsafeDeleteResp.result.content[0].text.includes("Safety Guard"));
  } finally {
    await manager.closeAll();
    try {
      if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
    } catch {}
  }
});
