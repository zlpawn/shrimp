import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL_DIR = path.join(ROOT, "lib", "skills", "leo-nat-traversal-router");

test("leo-nat-traversal-router satisfies shrimp skill conventions", () => {
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "package.json")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "README.md")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "references", "routing-matrix.md")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "references", "providers", "frp.md")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "probe.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "router.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "core", "system.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "core", "port.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "providers", "frp", "install.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "providers", "frp", "supervisor.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "providers", "frp", "config.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "tests", "router.test.mjs")));
});
