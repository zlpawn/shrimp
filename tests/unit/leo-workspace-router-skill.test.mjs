import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL_DIR = path.join(ROOT, "lib", "skills", "leo-workspace-router");

test("leo-workspace-router satisfies shrimp skill conventions", () => {
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "package.json")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "README.md")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "references", "engines-catalog.md")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "references", "ignore-presets.md")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "references", "engines", "mutagen.md")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "probe.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "router.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "askpass.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "core", "remote-exec.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "modules", "remote-git.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "modules", "scheduler.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "engines", "mutagen.mjs")));
});
