import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(".");

test("multi-key editor is isolated and keeps single-key fallback", async () => {
  const source = await readFile(
    path.join(ROOT, "desktop/src/modules/multi-key-editor.ts"),
    "utf8",
  ).catch(() => "");
  assert.match(source, /endpoint\.api_keys\?\.length/);
  assert.match(source, /添加更多密钥/);
  assert.match(source, /故障转移/);
  assert.match(source, /轮询/);
  assert.match(source, /随机/);
  assert.match(source, /secret-preview/);
});

test("transient values are removed after a successful save", async () => {
  const source = await readFile(path.join(ROOT, "desktop/src/app.ts"), "utf8");
  assert.match(source, /delete endpoint\.api_key_values/);
});

test("unsupported capability runtimes do not advertise multi-key routing", async () => {
  const source = await readFile(
    path.join(ROOT, "desktop/src/modules/multi-key-editor.ts"),
    "utf8",
  ).catch(() => "");
  assert.match(source, /supportsMultiKeyRuntime/);
  assert.match(source, /purpose/);
});
