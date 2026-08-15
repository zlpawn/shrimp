import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(".");

test("config panel exposes DeepSeek auto-continue mini-tool", async () => {
  const app = await readFile(path.join(ROOT, "desktop", "src", "app.ts"), "utf8");
  assert.match(app, /deepseek-auto-continue/);
  assert.match(app, /DeepSeek 自动续写/);
  assert.match(app, /renderDeepSeekAutoContinueDetail/);
  assert.match(app, /\/v1\/tools\/deepseek-auto-continue/);
  assert.match(app, /require_agent_context/);
  assert.match(app, /preserve_stage_text/);
});
