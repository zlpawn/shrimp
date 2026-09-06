import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  resolveCraftMcpUrl,
  parseSseJsonRpc,
  createCraftChannel,
} from "../../lib/knowledge-base/craft-channel.mjs";
import { createKbStore } from "../../lib/knowledge-base/kb-store.mjs";
import { createEngineRegistry } from "../../lib/knowledge-base/engine-adapter.mjs";
import { createKbPipeline } from "../../lib/knowledge-base/pipeline.mjs";
import { createKbRoutes } from "../../lib/knowledge-base/routes.mjs";

test("CraftChannel: resolveCraftMcpUrl fallback and config priority", () => {
  // Explicit option
  const explicit = resolveCraftMcpUrl({ craft_mcp_url: "https://custom.craft.do/mcp" });
  assert.equal(explicit, "https://custom.craft.do/mcp");

  // Default fallback if no config or env
  const originalEnv = process.env.CRAFT_MCP_URL;
  delete process.env.CRAFT_MCP_URL;
  const fallback = resolveCraftMcpUrl({});
  assert.ok(fallback.startsWith("https://mcp.craft.do/links/"));
  if (originalEnv) process.env.CRAFT_MCP_URL = originalEnv;
});

test("CraftChannel: parseSseJsonRpc parses SSE data payload", () => {
  const sseRaw = `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"hello world"}],"isError":false}}\n\n`;
  const parsed = parseSseJsonRpc(sseRaw);
  assert.equal(parsed.result.content[0].text, "hello world");

  // Standard JSON fallback
  const jsonRaw = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } });
  const jsonParsed = parseSseJsonRpc(jsonRaw);
  assert.equal(jsonParsed.result.ok, true);
});

test("CraftChannel: getStatus, listDocuments, and fetchDocument with mock fetch", async () => {
  const mockFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const cmd = body.params?.arguments?.command || "";

    if (cmd === "connection info") {
      return {
        ok: true,
        status: 200,
        text: async () => `event: message\ndata: {"result":{"content":[{"type":"text","text":"{\\"space\\":{\\"id\\":\\"space_123\\",\\"name\\":\\"Tiger Space\\"},\\"urlTemplates\\":{\\"app\\":\\"craftdocs://open?spaceId=space_123&blockId={blockId}\\"}}"}],"isError":false}}\n\n`,
      };
    }

    if (cmd.startsWith("folders list")) {
      return {
        ok: true,
        status: 200,
        text: async () => `event: message\ndata: {"result":{"content":[{"type":"text","text":"3 folder(s) — format: <folderId> Folder Name\\n\\n* <fld_1> AI Research (5 docs)\\n  * <fld_2> Prompt Engineering (2 docs)\\n* <fld_3> Personal (0 docs)"}],"isError":false}}\n\n`,
      };
    }

    if (cmd.startsWith("documents list")) {
      const isPaged = cmd.includes("--cursor");
      return {
        ok: true,
        status: 200,
        text: async () => `event: message\ndata: {"result":{"content":[{"type":"text","text":"${isPaged ? "1 document(s) — format: <rootBlockId> Title\\n\\n  <doc_ccc_333> Note Gamma" : "2 document(s) — format: <rootBlockId> Title\\n\\n  <doc_aaa_111> Note Alpha\\n  <doc_bbb_222> Note Beta\\n\\nNext page: documents list --cursor cur_999"}"}],"isError":false}}\n\n`,
      };
    }

    if (cmd.startsWith("search")) {
      return {
        ok: true,
        status: 200,
        text: async () => `event: message\ndata: {"result":{"content":[{"type":"text","text":"Search results: 1 match(es)\\n\\n1) Document <doc_aaa_111>\\n   Match:\\n     Match snippet here\\n   Created: 2026-01-01"}],"isError":false}}\n\n`,
      };
    }

    if (cmd.startsWith("blocks get")) {
      return {
        ok: true,
        status: 200,
        text: async () => `event: message\ndata: {"result":{"content":[{"type":"text","text":"<page id=\\"doc_aaa_111\\">\\n  <pageTitle>Note Alpha</pageTitle>\\n  <content>\\n    # Heading 1\\n    This is the note body.\\n  </content>\\n</page>"}],"isError":false}}\n\n`,
      };
    }

    throw new Error("Unknown command: " + cmd);
  };

  const channel = createCraftChannel({
    mcpUrl: "https://mock.craft.do/mcp",
    fetchImpl: mockFetch,
  });

  // Test getStatus
  const status = await channel.getStatus();
  assert.equal(status.connected, true);
  assert.equal(status.spaceName, "Tiger Space");
  assert.equal(status.spaceId, "space_123");

  // Test listFolders
  const foldersRes = await channel.listFolders({});
  assert.equal(foldersRes.folders.length, 3);
  assert.equal(foldersRes.folders[0].id, "fld_1");
  assert.equal(foldersRes.folders[0].name, "AI Research");
  assert.equal(foldersRes.folders[0].depth, 0);
  assert.equal(foldersRes.folders[0].docCount, 5);
  assert.equal(foldersRes.folders[1].id, "fld_2");
  assert.equal(foldersRes.folders[1].name, "Prompt Engineering");
  assert.equal(foldersRes.folders[1].depth, 1);
  assert.equal(foldersRes.folders[1].docCount, 2);

  // Test listDocuments (auto-pagination fetches all pages)
  const list = await channel.listDocuments({});
  assert.equal(list.documents.length, 3);
  assert.equal(list.documents[0].id, "doc_aaa_111");
  assert.equal(list.documents[0].title, "Note Alpha");
  assert.equal(list.documents[2].id, "doc_ccc_333");
  assert.equal(list.nextCursor, null);

  // Test listDocuments with fetchAll: false (single page with cursor)
  const singlePage = await channel.listDocuments({ fetchAll: false });
  assert.equal(singlePage.documents.length, 2);
  assert.equal(singlePage.nextCursor, "cur_999");

  // Test search
  const searchResults = await channel.listDocuments({ search: "Alpha" });
  assert.equal(searchResults.documents.length, 1);
  assert.equal(searchResults.documents[0].id, "doc_aaa_111");

  // Test fetchDocument
  const doc = await channel.fetchDocument("doc_aaa_111");
  assert.equal(doc.title, "Note Alpha");
  assert.ok(doc.markdown.includes("This is the note body."));

  // Test buildCraftUrl
  const craftUrl = channel.buildCraftUrl("doc_aaa_111");
  assert.equal(craftUrl, "https://docs.craft.do/editor/d/space_123/doc_aaa_111");
});

test("CraftChannel: pipeline.ingestCraftNote and API routes", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-craft-test-"));
  const dbPath = path.join(tmpDir, "kb.db");
  const store = createKbStore({ dbPath });
  store.init();

  const registry = createEngineRegistry();
  const pipeline = createKbPipeline({
    store,
    registry,
    scraper: { scrape: async () => ({}) },
    dataDir: tmpDir,
  });

  const mockChannel = {
    getStatus: async () => ({ connected: true, spaceName: "Tiger Space", spaceId: "space_123" }),
    listFolders: async () => ({
      folders: [{ id: "fld_test_1", name: "Research", depth: 0, docCount: 1 }],
    }),
    listDocuments: async () => ({
      documents: [{ id: "doc_test_1", title: "Test Note 1" }],
    }),
    fetchDocument: async (rootBlockId) => ({
      rootBlockId,
      title: "Test Note 1",
      markdown: "# Test Note 1 Content\n\nSome great knowledge.",
    }),
    buildCraftUrl: (rootBlockId) => `https://docs.craft.do/editor/d/space_123/${rootBlockId}`,
  };

  // Test pipeline.ingestCraftNote
  const doc = await pipeline.ingestCraftNote({
    rootBlockId: "doc_test_1",
    title: "Test Note 1",
    markdown: "# Test Note 1 Content\n\nSome great knowledge.",
    collectionId: "col_default",
    craftUrl: "https://docs.craft.do/editor/d/space_123/doc_test_1",
  });

  assert.equal(doc.source_type, "craft");
  assert.equal(doc.title, "Test Note 1");
  assert.ok(doc.source_url.startsWith("https://docs.craft.do/"));
  assert.ok(doc.word_count > 0);

  // Verify in store
  const stored = store.getDocument(doc.id);
  assert.equal(stored.source_type, "craft");
  assert.equal(stored.title, "Test Note 1");

  // Verify FTS search
  const found = store.searchDocuments("knowledge");
  assert.equal(found.length, 1);
  assert.equal(found[0].id, doc.id);

  // Test routes
  const routeHandler = createKbRoutes({
    store,
    pipeline,
    registry,
    dataDir: tmpDir,
    craftChannel: mockChannel,
  });

  // GET /v1/kb/channels/craft/status
  let statusResponse = null;
  const mockRes = {
    writeHead(code, headers) {},
    end(data) {
      statusResponse = JSON.parse(data);
    },
  };

  const handledStatus = await routeHandler(
    { method: "GET" },
    mockRes,
    new URL("http://localhost/v1/kb/channels/craft/status"),
    "/v1/kb/channels/craft/status"
  );
  assert.equal(handledStatus, true);
  assert.equal(statusResponse.connected, true);
  assert.equal(statusResponse.spaceName, "Tiger Space");

  // GET /v1/kb/channels/craft/folders
  let foldersResponse = null;
  const mockResFolders = {
    writeHead(code, headers) {},
    end(data) {
      foldersResponse = JSON.parse(data);
    },
  };
  const handledFolders = await routeHandler(
    { method: "GET" },
    mockResFolders,
    new URL("http://localhost/v1/kb/channels/craft/folders"),
    "/v1/kb/channels/craft/folders"
  );
  assert.equal(handledFolders, true);
  assert.equal(foldersResponse.folders.length, 1);
  assert.equal(foldersResponse.folders[0].name, "Research");

  // Clean up
  store.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore windows temp file lock
  }
});
