import test from "node:test";
import assert from "node:assert/strict";
import {
  createEngineRegistry,
  MarkItDownAdapter,
  DoclingAdapter
} from "../../lib/knowledge-base/engine-adapter.mjs";

test("EngineAdapters: Registry, detection interfaces and command definitions", async () => {
  const registry = createEngineRegistry();
  const mdAdapter = new MarkItDownAdapter();
  const docAdapter = new DoclingAdapter();

  registry.register(mdAdapter);
  registry.register(docAdapter);

  assert.equal(registry.list().length, 2);
  assert.equal(registry.get("markitdown").id, "markitdown");
  assert.equal(registry.get("docling").id, "docling");

  // Test detect interface returns well-formed status
  const statuses = await registry.detectAll();
  assert.equal("markitdown" in statuses, true);
  assert.equal("docling" in statuses, true);
  assert.equal(typeof statuses.markitdown.installed, "boolean");
  assert.equal(typeof statuses.docling.installed, "boolean");
  assert.equal(statuses.markitdown.installCommand, "uv tool install markitdown");
  assert.equal(statuses.docling.installCommand, "uv tool install docling");
  assert.equal(statuses.markitdown.upgradeCommand, "uv tool upgrade markitdown");
  assert.equal(statuses.docling.upgradeCommand, "uv tool upgrade docling");
});

test("EngineAdapters: Execution options and command builder", () => {
  const mdAdapter = new MarkItDownAdapter();
  const docAdapter = new DoclingAdapter();

  assert.equal(mdAdapter.supportedExtensions.includes(".docx"), true);
  assert.equal(mdAdapter.supportedExtensions.includes(".xlsx"), true);
  assert.equal(docAdapter.supportedExtensions.includes(".pdf"), true);

  const docCmd = docAdapter.buildParseCommand("/path/to/doc.pdf", {
    outputDir: "/path/to/output",
    assetsDir: "/path/to/assets",
  });
  assert.equal(docCmd.command, "docling");
  assert.equal(docCmd.args.includes("--to"), true);
  assert.equal(docCmd.args.includes("md"), true);
  assert.equal(docCmd.args.includes("html"), true);
  assert.equal(docCmd.args.includes("json"), true);
});
