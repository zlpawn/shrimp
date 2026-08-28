import fs from "node:fs";
import { importConnectionStore, loadConnectionStore, summarizeConnections } from "./config/store.mjs";
import { createAdapterRegistry } from "./core/registry.mjs";
import { authorizeOperation } from "./core/policy.mjs";
import { ConnectionManager } from "./core/connection-manager.mjs";
import { splitSqlScript } from "./sql/splitter.mjs";
import { formatOutput } from "./output.mjs";
import { builtInAdapters } from "./adapters/index.mjs";

export async function runCli(argv, options = {}) {
  const registry = createAdapterRegistry(options.adapters || builtInAdapters);
  const store = loadConnectionStore({ secretsFile: options.configPath, registry });
  const command = argv[0];
  const args = argv.slice(1);
  const flags = parseFlags(args);
  const positional = flags.positionals;
  const manager = new ConnectionManager({ store, registry });

  try {
    switch (command) {
      case "connections":
        return output({ connections: summarizeConnections(store) }, flags);
      case "adapters":
        return output({ adapters: registry.list().map((adapter) => ({
          id: adapter.id,
          family: adapter.family,
          displayName: adapter.displayName,
          capabilities: adapter.capabilities,
        })) }, flags);
      case "connection":
        if (positional[0] === "import") return output(importConnections({ argv: args, configPath: options.configPath, stdin: options.stdin }), flags);
        if (positional[0] !== "test" || !positional[1]) throw new Error("Usage: leo-database-hub connection test <id> | connection import --stdin");
        return output({ connection: positional[1], ok: await testConnection(manager, positional[1], options) }, flags);
      case "tables": {
        const id = requireConnection(positional[0]);
        const adapter = manager.adapterFor(id);
        requireCapability(adapter, "schemaIntrospection");
        return output(await adapter.listTables(await manager.getContext(id)), flags);
      }
      case "describe": {
        const id = requireConnection(positional[0]);
        const adapter = manager.adapterFor(id);
        requireCapability(adapter, "schemaIntrospection");
        return output(await adapter.describeTable(await manager.getContext(id), positional[1]), flags);
      }
      case "summary": {
        const id = requireConnection(positional[0]);
        const adapter = manager.adapterFor(id);
        requireCapability(adapter, "schemaIntrospection");
        return output({ summary: await adapter.getSummary(await manager.getContext(id)) }, flags);
      }
      case "query": {
        const id = requireConnection(positional[0]);
        const sql = positional.slice(1).join(" ");
        const adapter = manager.adapterFor(id);
        const classification = adapter.classifyOperation({ operation: "query", sql }).operationClass;
        if (classification !== "read") throw new Error("query only supports read-only SQL.");
        authorizeOperation({ access: store.connections[id].access, operationClass: classification, flags: { write: true } });
        authorizeOperation({ access: store.connections[id].access, operationClass: classification, flags });
        return output(await adapter.query(await manager.getContext(id), sql, { maxRows: flags.values["max-rows"] }), flags);
      }
      case "execute": {
        const id = requireConnection(positional[0]);
        const sql = flags.values.file ? fs.readFileSync(flags.values.file, "utf8") : positional.slice(1).join(" ");
        const statements = splitSqlScript(sql);
        const adapter = manager.adapterFor(id);
        const classes = statements.map((statement) => adapter.classifyOperation({ operation: "execute", sql: statement }).operationClass);
        const worst = classes.includes("destructive") ? "destructive" : classes.includes("write") ? "write" : classes[0] || "read";
        authorizeOperation({ access: store.connections[id].access, operationClass: worst, flags });
        return output(await adapter.executeScript(await manager.getContext(id), statements), flags);
      }
      case "redis": {
        const subcommand = positional[0];
        const id = requireConnection(positional[1]);
        const adapter = manager.adapterFor(id);
        if (subcommand === "keys") return output(await adapter.scanKeys(await manager.getContext(id), flags.values.pattern || "*", { count: flags.values.count }), flags);
        if (subcommand === "get") return output(await adapter.getKey(await manager.getContext(id), positional[2]), flags);
        if (subcommand === "exec") {
          const redisCommand = positional[2];
          const redisArgs = positional.slice(3);
          const classification = adapter.classifyOperation({ operation: "exec", command: redisCommand }).operationClass;
          authorizeOperation({ access: store.connections[id].access, operationClass: classification, flags });
          return output({ result: await adapter.executeCommand(await manager.getContext(id), redisCommand, redisArgs) }, flags);
        }
        throw new Error("Redis commands: keys <id>, get <id> <key>, exec <id> COMMAND ARGS...");
      }
      default:
        throw new Error(usageText);
    }
  } finally {
    await manager.close();
  }
}

function parseFlags(args) {
  const values = {};
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) { positionals.push(arg); continue; }
    const key = arg.slice(2);
    if (key === "write" || key === "yes" || key === "stdin") values[key] = true;
    else {
      const next = args[i + 1];
      if (next === undefined) throw new Error(`Missing value for --${key}`);
      values[key] = next;
      i += 1;
    }
  }
  return { values, positionals, write: values.write === true, yes: values.yes === true };
}

function importConnections({ argv, configPath, stdin }) {
  if (!argv.includes("--stdin")) throw new Error("connection import requires --stdin.");
  if (!stdin) throw new Error("connection import --stdin received no input.");
  return importConnectionStore(stdin, { secretsFile: configPath, registry: createAdapterRegistry(builtInAdapters) });
}

function output(value, flags) {
  return formatOutput(value, flags.values.format || "json");
}

async function testConnection(manager, id, options) {
  const adapter = manager.adapterFor(id);
  const context = await manager.getContext(id, options);
  if (adapter.testConnection) return adapter.testConnection(context);
  return true;
}

function requireConnection(id) {
  if (!id) throw new Error("A connection id is required. Run leo-database-hub connections.");
  return id;
}

function requireCapability(adapter, capability) {
  if (!adapter.capabilities[capability]) throw new Error(`${adapter.displayName} does not support ${capability}.`);
}

const usageText = `Usage:
  leo-database-hub connections
  leo-database-hub adapters
  leo-database-hub connection test <id>
  leo-database-hub tables <id>
  leo-database-hub describe <id> <table>
  leo-database-hub summary <id>
  leo-database-hub query <id> "SELECT ..."
  leo-database-hub execute <id> [--file file.sql] [--write] [--yes]
  leo-database-hub redis keys <id> [--pattern pattern]
  leo-database-hub redis get <id> <key>
  leo-database-hub redis exec <id> COMMAND ARGS... [--write] [--yes]`;
