import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(".");

test("copy-node module keeps copy rules in focused pure helpers", async () => {
  const source = await readFile(
    path.join(ROOT, "desktop/src/modules/copy-node.ts"),
    "utf8",
  ).catch(() => "");

  assert.match(source, /export function inferCopiedEndpointType/);
  assert.match(source, /export function buildEndpointCopyDraft/);
  assert.match(source, /draft\.is_default\s*=\s*false/);
  assert.match(source, /credentialIdFactory/);
  assert.match(source, /api_key_values/);
});

test("endpoint type reserves credential metadata without requiring label", async () => {
  const source = await readFile(
    path.join(ROOT, "desktop/src/core/types.ts"),
    "utf8",
  );

  assert.match(
    source,
    /interface Credential\s*\{[\s\S]*id:\s*string;[\s\S]*label\?:\s*string;/,
  );
  assert.match(source, /api_key\?:\s*string/);
  assert.match(source, /api_keys\?:\s*Credential\[\]/);
  assert.match(source, /key_strategy\?:\s*KeyStrategy/);
  assert.match(source, /api_key_values\?:\s*Record<string,\s*string>/);
});

test("copy UI is preview-first and never auto-saves", async () => {
  const [app, index, module] = await Promise.all([
    readFile(path.join(ROOT, "desktop/src/app.ts"), "utf8"),
    readFile(path.join(ROOT, "desktop/index.html"), "utf8"),
    readFile(path.join(ROOT, "desktop/src/modules/copy-node.ts"), "utf8"),
  ]);

  assert.match(app + index, /复制节点/);
  assert.match(module, /export function openCopyNodeModal/);
  assert.match(module, /export async function revealEndpointSecrets/);
  assert.match(
    app,
    /selectedEndpoint\s*=\s*\{\s*client:\s*targetClient,\s*index:\s*0\s*\}/,
  );
  assert.doesNotMatch(module, /\/v1\/config\/save/);
  assert.match(module, /credential_id/);
  assert.doesNotMatch(module, /multiKeyDisabled/);
});

test("copy source client uses the shared mini-tool select UI", async () => {
  const [copyModule, selectModule] = await Promise.all([
    readFile(path.join(ROOT, "desktop/src/modules/copy-node.ts"), "utf8"),
    readFile(path.join(ROOT, "desktop/src/components/ui-select.ts"), "utf8")
      .catch(() => ""),
  ]);

  assert.match(copyModule, /renderUiSelectHtml/);
  assert.match(copyModule, /个可复制节点/);
  assert.doesNotMatch(
    copyModule,
    /<select id="copy-node-source-client"/,
  );
  assert.match(selectModule, /export function renderUiSelectHtml/);
  assert.match(selectModule, /ui-select-option-description/);
});
