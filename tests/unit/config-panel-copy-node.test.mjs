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
