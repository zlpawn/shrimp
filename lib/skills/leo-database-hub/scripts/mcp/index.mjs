#!/usr/bin/env node
import { createDatabaseHubServer } from "./lib/server.mjs";

async function main() {
  try {
    const { server, manager } = createDatabaseHubServer(process.env);
    const databases = await manager.listDatabases();

    // Diagnostics printed to stderr so JSON-RPC on stdout is unaffected
    process.stderr.write(
      `[database-hub] MCP Server started. Configured databases: ${databases.length}\n`
    );
    for (const db of databases) {
      process.stderr.write(`  - [${db.type}] ID: '${db.id}' (${db.details})\n`);
    }

    server.start();
  } catch (err) {
    process.stderr.write(`[database-hub] Failed to start: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

main();
