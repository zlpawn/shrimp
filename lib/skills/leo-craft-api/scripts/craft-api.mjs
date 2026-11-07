#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  CraftClient,
  loadConfig,
  saveConfig,
  maskApiKey,
  CONFIG_FILE
} from "./craft-client.mjs";

function printHelp() {
  console.log(`
Leo Craft API CLI (leo-craft-api)
Full-featured CLI tool for managing your Craft space via Craft Full Space API.

Usage:
  node craft-api.mjs <command> [subcommand] [options]

Global Options:
  --api-key <key>       Craft API Bearer token (overrides saved config)
  --api-url <url>       Craft API server endpoint (overrides saved config)
  --json                Output raw JSON only
  -h, --help            Show this help text

Commands:

  1. Config Management:
    config get                                    View current API configuration & key status
    config set [--api-key <key>] [--api-url <url>] Save API key or URL to ~/.shrimp/skills/leo-craft-api/config.json

  2. Space & Connection:
    info                                          Show space name, ID, timezone and URL templates

  3. Folders:
    folders list                                  List all folders & locations with document counts
    folders create <name> [--parent <folderId>]   Create a new folder (root or nested)
    folders delete <folderId...>                  Delete folder(s) (contents moved to parent/unsorted)
    folders move <folderId...> --to <parentId>    Move folder(s) into another folder
    folders move <folderId...> --to-root          Move folder(s) to space root

  4. Documents:
    docs list [options]                           List documents in space
      --location unsorted|trash|templates|daily_notes
      --folder <folderId>
      --metadata                                  Include dates and clickable app links
      --created-gte <date>                        Filter created on/after (YYYY-MM-DD, today)
      --created-lte <date>                        Filter created on/before
      --modified-gte <date>                       Filter modified on/after
      --modified-lte <date>                       Filter modified on/before
    docs create <title...> [options]              Create one or more documents
      --folder <folderId>                         Place in folder
      --template                                  Place in Templates
      --unsorted                                  Place in Unsorted (default)
    docs delete <documentId...>                   Soft-delete document(s) to trash
    docs move <documentId...> --to <folderId>     Move document(s) to a folder
    docs move <documentId...> --to-unsorted       Move document(s) to Unsorted (or restore from trash)
    docs move <documentId...> --to-templates      Move document(s) to Templates
    docs search <query> [options]                 Search documents across the entire space
      --location <loc>                            Filter by location
      --folder <folderId>                         Filter by folder
      --regex <pattern>                           Search by RE2 regexp
      --fetch-blocks                              Include matched blocks in results

  5. Blocks & Content:
    blocks get <documentIdOrBlockId> [options]    Get document or block content
      --depth <n>                                 Max depth (-1: all, 0: self, 1: direct children)
      --format json|markdown                      Content format (default: json)
      --metadata                                  Include block metadata
    blocks get --date today|yesterday|tomorrow|YYYY-MM-DD
                                                  Get Daily Note content
    blocks insert --page <pageId> [options]       Insert content into document
      --markdown <text>                           Markdown string to insert
      --file <filePath>                           File containing markdown to insert
      --pos start|end|before|after                Insertion position (default: end)
      --target <blockId>                          Target block ID for before/after
    blocks update --id <blockId> --markdown <txt> Update block text/markdown
    blocks delete <blockId...>                    Delete block(s) by ID
    blocks move <blockId...> --page <pageId>      Move block(s)
      --pos start|end|before|after
      --target <targetBlockId>
    blocks search --id <docId> <query>            Search content inside a specific document

  6. Tasks:
    tasks list [options]                          List tasks across the space
      --scope active|upcoming|inbox|logbook|document|all (default: active)
      --doc <documentId>                          Required if scope is 'document'
    tasks add <markdown...> [options]             Add new task(s)
      --date <YYYY-MM-DD|today>                   Schedule date
      --time <HH:mm>                              Task time
    tasks update <taskId> [options]               Update task state or text
      --state todo|done|cancelled
      --markdown <text>
    tasks delete <taskId...>                      Delete task(s)

  7. Collections:
    collections list [--doc <documentId>]         List collections
    collections items <collectionId>              Get items in collection
    collections schema <collectionId>             Get collection schema

  8. Media Upload:
    upload <filePath> --page <pageId> [options]   Upload image/video/doc and insert as block
      --pos start|end|before|after                (default: end)
      --name <customFileName>                     Title for document attachment
      --target <siblingBlockId>                   Required for before/after

  9. Raw API Escape Hatch:
    raw <GET|POST|PUT|DELETE> <path> [options]    Directly call any Craft endpoint
      --body <jsonStringOrFile>                   JSON payload
      --params <key=val...>                       Query parameters
`);
}

// Simple CLI arg parser
function parseArgs(args) {
  const result = {
    _: [],
    flags: {}
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.flags.help = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        result.flags[key] = next;
        i++;
      } else {
        result.flags[key] = true;
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      result.flags[key] = true;
    } else {
      result._.push(arg);
    }
  }

  return result;
}

function outputResult(data, isRawJson = false) {
  if (isRawJson || typeof data === "object") {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const [cmd, subCmd, ...rest] = parsed._;

  if (parsed.flags.help || !cmd) {
    printHelp();
    return;
  }

  const clientOpts = {};
  if (parsed.flags["api-key"]) clientOpts.apiKey = parsed.flags["api-key"];
  if (parsed.flags["api-url"]) clientOpts.apiUrl = parsed.flags["api-url"];

  const client = new CraftClient(clientOpts);
  const isJson = Boolean(parsed.flags.json);

  try {
    switch (cmd) {
      // ----------------- CONFIG -----------------
      case "config": {
        if (subCmd === "get") {
          const cfg = loadConfig();
          console.log(`\nCraft API Configuration:`);
          console.log(`  Config File : ${CONFIG_FILE}`);
          console.log(`  API URL     : ${cfg.api_url || "(not set)"}`);
          console.log(`  API Key     : ${maskApiKey(cfg.api_key)}`);
          if (cfg.updated_at) console.log(`  Last Updated: ${cfg.updated_at}`);
          console.log(`\nTo update config:`);
          console.log(`  node craft-api.mjs config set --api-key <KEY> [--api-url <URL>]\n`);
          return;
        }

        if (subCmd === "set") {
          const updates = {};
          if (parsed.flags["api-key"] !== undefined) {
            updates.api_key = parsed.flags["api-key"] === true ? "" : String(parsed.flags["api-key"]).trim();
          }
          if (parsed.flags["api-url"] !== undefined) {
            updates.api_url = parsed.flags["api-url"] === true ? "" : String(parsed.flags["api-url"]).trim();
          }
          if (Object.keys(updates).length === 0) {
            console.error("Error: Please provide --api-key <key> or --api-url <url>");
            process.exit(1);
          }
          const saved = saveConfig(updates);
          console.log(`\n[OK] Configuration successfully saved to: ${CONFIG_FILE}`);
          console.log(`  API URL : ${saved.api_url || "(not set)"}`);
          console.log(`  API Key : ${maskApiKey(saved.api_key)}\n`);
          return;
        }

        console.error(`Unknown config action: "${subCmd}". Expected: get | set`);
        process.exit(1);
      }

      // ----------------- INFO -----------------
      case "info": {
        const info = await client.getConnectionInfo();
        if (isJson) {
          outputResult(info, true);
        } else {
          console.log(`\nConnected Craft Space Information:`);
          console.log(`  Space ID  : ${info?.space?.id || "N/A"}`);
          console.log(`  Space Name: ${info?.space?.name || "N/A"}`);
          console.log(`  Timezone  : ${info?.space?.timezone || "N/A"}`);
          console.log(`  Local Time: ${info?.space?.friendlyDate || info?.space?.time || "N/A"}`);
          if (info?.urlTemplates?.app) {
            console.log(`  App Link  : ${info.urlTemplates.app}`);
          }
          console.log();
        }
        return;
      }

      // ----------------- FOLDERS -----------------
      case "folders": {
        if (subCmd === "list") {
          const res = await client.listFolders();
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "create") {
          const name = rest[0] || parsed.flags.name;
          if (!name) {
            console.error("Error: Folder name is required. Usage: folders create <name> [--parent <folderId>]");
            process.exit(1);
          }
          const payload = { name };
          if (parsed.flags.parent) payload.parentFolderId = parsed.flags.parent;
          const res = await client.createFolders([payload]);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "delete") {
          const folderIds = rest.length > 0 ? rest : (parsed.flags.id ? [parsed.flags.id] : []);
          if (folderIds.length === 0) {
            console.error("Error: At least one folderId required. Usage: folders delete <folderId...>");
            process.exit(1);
          }
          const res = await client.deleteFolders(folderIds);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "move") {
          const folderIds = rest.length > 0 ? rest : (parsed.flags.id ? [parsed.flags.id] : []);
          if (folderIds.length === 0) {
            console.error("Error: At least one folderId required. Usage: folders move <folderId...> (--to <parentId> | --to-root)");
            process.exit(1);
          }
          let dest = "root";
          if (parsed.flags.to) dest = parsed.flags.to;
          else if (parsed.flags["to-root"]) dest = "root";
          const res = await client.moveFolders(folderIds, dest);
          outputResult(res, isJson);
          return;
        }

        console.error(`Unknown folders command: "${subCmd}". Expected: list | create | delete | move`);
        process.exit(1);
      }

      // ----------------- DOCUMENTS -----------------
      case "docs": {
        if (subCmd === "list") {
          const params = {};
          if (parsed.flags.location) params.location = parsed.flags.location;
          if (parsed.flags.folder) params.folderId = parsed.flags.folder;
          if (parsed.flags.metadata) params.fetchMetadata = true;
          if (parsed.flags["created-gte"]) params.createdDateGte = parsed.flags["created-gte"];
          if (parsed.flags["created-lte"]) params.createdDateLte = parsed.flags["created-lte"];
          if (parsed.flags["modified-gte"]) params.lastModifiedDateGte = parsed.flags["modified-gte"];
          if (parsed.flags["modified-lte"]) params.lastModifiedDateLte = parsed.flags["modified-lte"];
          const res = await client.listDocuments(params);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "create") {
          const titles = rest.length > 0 ? rest : (parsed.flags.title ? [parsed.flags.title] : []);
          if (titles.length === 0) {
            console.error("Error: Document title is required. Usage: docs create <title...> [--folder <id>]");
            process.exit(1);
          }
          const docs = titles.map((t) => ({ title: t }));
          let destination = undefined;
          if (parsed.flags.folder) destination = { folderId: parsed.flags.folder };
          else if (parsed.flags.template) destination = { destination: "templates" };
          else if (parsed.flags.unsorted) destination = { destination: "unsorted" };

          const res = await client.createDocuments(docs, destination);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "delete") {
          const docIds = rest.length > 0 ? rest : (parsed.flags.id ? [parsed.flags.id] : []);
          if (docIds.length === 0) {
            console.error("Error: Document ID(s) required. Usage: docs delete <documentId...>");
            process.exit(1);
          }
          const res = await client.deleteDocuments(docIds);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "move") {
          const docIds = rest.length > 0 ? rest : (parsed.flags.id ? [parsed.flags.id] : []);
          if (docIds.length === 0) {
            console.error("Error: Document ID(s) required. Usage: docs move <docId...> (--to <folderId> | --to-unsorted | --to-templates)");
            process.exit(1);
          }
          let destination = { destination: "unsorted" };
          if (parsed.flags.to) destination = { folderId: parsed.flags.to };
          else if (parsed.flags["to-templates"]) destination = { destination: "templates" };
          else if (parsed.flags["to-unsorted"]) destination = { destination: "unsorted" };

          const res = await client.moveDocuments(docIds, destination);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "search") {
          const query = rest.join(" ") || parsed.flags.query || parsed.flags.include;
          const params = {};
          if (query) params.include = query;
          if (parsed.flags.regex) params.regexps = parsed.flags.regex;
          if (parsed.flags.location) params.location = parsed.flags.location;
          if (parsed.flags.folder) params.folderIds = [parsed.flags.folder];
          if (parsed.flags["fetch-blocks"]) params.fetchBlocks = true;

          const res = await client.searchDocuments(params);
          outputResult(res, isJson);
          return;
        }

        console.error(`Unknown docs command: "${subCmd}". Expected: list | create | delete | move | search`);
        process.exit(1);
      }

      // ----------------- BLOCKS -----------------
      case "blocks": {
        if (subCmd === "get") {
          const id = rest[0] || parsed.flags.id;
          const date = parsed.flags.date;
          if (!id && !date) {
            console.error("Error: Either document/block ID or --date (today, YYYY-MM-DD) is required.");
            process.exit(1);
          }
          const params = {};
          if (id) params.id = id;
          if (date) params.date = date;
          if (parsed.flags.depth !== undefined) params.maxDepth = Number(parsed.flags.depth);
          if (parsed.flags.metadata) params.fetchMetadata = true;
          if (parsed.flags.format) params.format = parsed.flags.format;

          const res = await client.getBlocks(params);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "insert") {
          const pageId = parsed.flags.page || parsed.flags.pageId;
          const date = parsed.flags.date;
          if (!pageId && !date) {
            console.error("Error: --page <pageId> or --date <date> is required for insertion.");
            process.exit(1);
          }

          let markdownText = parsed.flags.markdown;
          if (!markdownText && parsed.flags.file) {
            const resolvedFile = path.resolve(parsed.flags.file);
            if (!fs.existsSync(resolvedFile)) {
              console.error(`Error: File not found: ${parsed.flags.file}`);
              process.exit(1);
            }
            markdownText = fs.readFileSync(resolvedFile, "utf-8");
          }

          if (!markdownText && rest.length > 0) {
            markdownText = rest.join(" ");
          }

          if (!markdownText) {
            console.error("Error: Markdown content required via --markdown <text>, --file <path>, or inline arguments.");
            process.exit(1);
          }

          const pos = parsed.flags.pos || "end";
          const position = { position: pos };
          if (pageId) position.pageId = pageId;
          if (date) position.date = date;
          if (parsed.flags.target) position.targetBlockId = parsed.flags.target;

          const res = await client.insertBlocks({
            markdown: markdownText,
            position
          });
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "update") {
          const id = rest[0] || parsed.flags.id;
          let markdownText = parsed.flags.markdown;
          if (!markdownText && parsed.flags.file) {
            const resolvedFile = path.resolve(parsed.flags.file);
            if (!fs.existsSync(resolvedFile)) {
              console.error(`Error: File not found: ${parsed.flags.file}`);
              process.exit(1);
            }
            markdownText = fs.readFileSync(resolvedFile, "utf-8");
          }
          if (!id || !markdownText) {
            console.error("Error: Block ID and updated markdown are required. Usage: blocks update <blockId> --markdown <txt>");
            process.exit(1);
          }
          const res = await client.updateBlocks([{ id, markdown: markdownText }]);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "delete") {
          const blockIds = rest.length > 0 ? rest : (parsed.flags.id ? [parsed.flags.id] : []);
          if (blockIds.length === 0) {
            console.error("Error: Block ID(s) required. Usage: blocks delete <blockId...>");
            process.exit(1);
          }
          const res = await client.deleteBlocks(blockIds);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "move") {
          const blockIds = rest.length > 0 ? rest : (parsed.flags.id ? [parsed.flags.id] : []);
          const pageId = parsed.flags.page || parsed.flags.pageId;
          if (blockIds.length === 0 || !pageId) {
            console.error("Error: Block ID(s) and --page <pageId> are required. Usage: blocks move <blockId...> --page <pageId>");
            process.exit(1);
          }
          const pos = parsed.flags.pos || "end";
          const targetPosition = { position: pos, pageId };
          if (parsed.flags.target) targetPosition.targetBlockId = parsed.flags.target;

          const res = await client.moveBlocks(blockIds, targetPosition);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "search") {
          const docId = parsed.flags.id || parsed.flags.doc;
          const query = rest.join(" ") || parsed.flags.query;
          if (!docId || !query) {
            console.error("Error: Document ID (--id <docId>) and query are required. Usage: blocks search --id <docId> <query>");
            process.exit(1);
          }
          const res = await client.searchBlocks({ id: docId, query });
          outputResult(res, isJson);
          return;
        }

        console.error(`Unknown blocks command: "${subCmd}". Expected: get | insert | update | delete | move | search`);
        process.exit(1);
      }

      // ----------------- TASKS -----------------
      case "tasks": {
        if (subCmd === "list") {
          const params = {
            scope: parsed.flags.scope || "active"
          };
          if (parsed.flags.doc) params.documentId = parsed.flags.doc;
          const res = await client.listTasks(params);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "add") {
          const taskMarkdown = rest.join(" ") || parsed.flags.markdown;
          if (!taskMarkdown) {
            console.error("Error: Task description markdown required. Usage: tasks add <markdown...> [--date <YYYY-MM-DD>]");
            process.exit(1);
          }
          const taskItem = { markdown: taskMarkdown };
          if (parsed.flags.date) taskItem.date = parsed.flags.date;
          if (parsed.flags.time) taskItem.time = parsed.flags.time;
          const res = await client.addTasks([taskItem]);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "update") {
          const taskId = rest[0] || parsed.flags.id;
          if (!taskId) {
            console.error("Error: Task ID required. Usage: tasks update <taskId> [--state todo|done|cancelled] [--markdown <txt>]");
            process.exit(1);
          }
          const item = { id: taskId };
          if (parsed.flags.state) {
            item.taskInfo = { state: parsed.flags.state };
          }
          if (parsed.flags.markdown) {
            item.markdown = parsed.flags.markdown;
          }
          const res = await client.updateTasks([item]);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "delete") {
          const taskIds = rest.length > 0 ? rest : (parsed.flags.id ? [parsed.flags.id] : []);
          if (taskIds.length === 0) {
            console.error("Error: Task ID(s) required. Usage: tasks delete <taskId...>");
            process.exit(1);
          }
          const res = await client.deleteTasks(taskIds);
          outputResult(res, isJson);
          return;
        }

        console.error(`Unknown tasks command: "${subCmd}". Expected: list | add | update | delete`);
        process.exit(1);
      }

      // ----------------- COLLECTIONS -----------------
      case "collections": {
        if (subCmd === "list") {
          const params = {};
          if (parsed.flags.doc) params.documentId = parsed.flags.doc;
          const res = await client.listCollections(params);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "items") {
          const collectionId = rest[0] || parsed.flags.id;
          if (!collectionId) {
            console.error("Error: Collection ID required. Usage: collections items <collectionId>");
            process.exit(1);
          }
          const res = await client.getCollectionItems(collectionId);
          outputResult(res, isJson);
          return;
        }

        if (subCmd === "schema") {
          const collectionId = rest[0] || parsed.flags.id;
          if (!collectionId) {
            console.error("Error: Collection ID required. Usage: collections schema <collectionId>");
            process.exit(1);
          }
          const res = await client.getCollectionSchema(collectionId);
          outputResult(res, isJson);
          return;
        }

        console.error(`Unknown collections command: "${subCmd}". Expected: list | items | schema`);
        process.exit(1);
      }

      // ----------------- UPLOAD -----------------
      case "upload": {
        const filePath = subCmd || rest[0];
        const pageId = parsed.flags.page || parsed.flags.pageId;
        const date = parsed.flags.date;
        if (!filePath || (!pageId && !date)) {
          console.error("Error: File path and target page (--page <id> or --date <date>) are required.");
          console.error("Usage: upload <filePath> --page <pageId> [--pos start|end|before|after] [--name <title>]");
          process.exit(1);
        }

        const opts = {
          position: parsed.flags.pos || "end"
        };
        if (pageId) opts.pageId = pageId;
        if (date) opts.date = date;
        if (parsed.flags.target) opts.siblingId = parsed.flags.target;
        if (parsed.flags.name) opts.fileName = parsed.flags.name;

        const res = await client.uploadFile(filePath, opts);
        outputResult(res, isJson);
        return;
      }

      // ----------------- RAW ESCAPE HATCH -----------------
      case "raw": {
        const method = (subCmd || "GET").toUpperCase();
        const endpoint = rest[0];
        if (!endpoint) {
          console.error("Error: Endpoint path required. Usage: raw <GET|POST|PUT|DELETE> <path> [--body <json>]");
          process.exit(1);
        }

        let body = undefined;
        if (parsed.flags.body) {
          if (fs.existsSync(parsed.flags.body)) {
            body = JSON.parse(fs.readFileSync(parsed.flags.body, "utf-8"));
          } else {
            body = JSON.parse(parsed.flags.body);
          }
        }

        const params = {};
        if (parsed.flags.params) {
          const pairs = Array.isArray(parsed.flags.params) ? parsed.flags.params : [parsed.flags.params];
          for (const pair of pairs) {
            const [k, v] = pair.split("=");
            if (k) params[k] = v;
          }
        }

        const res = await client.request(endpoint, {
          method,
          params,
          body
        });
        outputResult(res, true);
        return;
      }

      default:
        console.error(`Unknown command: "${cmd}". Run "node craft-api.mjs --help" for available commands.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
