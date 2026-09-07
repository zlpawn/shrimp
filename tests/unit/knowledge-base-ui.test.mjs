import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("knowledge base - inline form handlers do not reference module-local state", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/knowledge-base.ts"), "utf8");

  // Inline event attributes execute in global scope. The KB state object is module-local,
  // so direct assignments such as oninput="state.editColName = this.value" throw
  // ReferenceError and leave the submit payload stale.
  assert.doesNotMatch(source, /on(?:input|change)="state\./);
});

test("knowledge base - collection edit modal has explicit state bindings", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/knowledge-base.ts"), "utf8");

  assert.match(source, /__kbSetEditColName/);
  assert.match(source, /__kbSetEditColDesc/);
  assert.match(source, /oninput="window\.__kbSetEditColName\(this\.value\)"/);
  assert.match(source, /oninput="window\.__kbSetEditColDesc\(this\.value\)"/);
});

test("knowledge base - collection edit success rerenders the workbench", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/knowledge-base.ts"), "utf8");
  const match = source.match(/__kbSubmitEditCol = async \(\) => \{[\s\S]*?\n\};/);

  assert.ok(match, "collection edit submit handler must exist");
  assert.match(match[0], /await loadCollections\(\);\s*\n\s*render\(\);/);
});

test("knowledge base - failed engine panels expose in-place retry", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/knowledge-base.ts"), "utf8");

  assert.match(source, /__kbReparseDocument/);
  assert.match(source, /documents\/\$\{docId\}\/reparse/);
  assert.match(source, /重跑解析/);
  assert.match(source, /state\.reparsingEngine === engine/);
});

test("knowledge base - panel actions wrap instead of overflowing one line", () => {
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/main.css"), "utf8");

  assert.match(css, /\.kb-panel-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(css, /\.kb-panel-header\s*\{[\s\S]*?row-gap:\s*6px/);
});
