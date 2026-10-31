import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL_DIR = path.join(ROOT, "lib", "skills", "leo-ppt-router");
const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(SKILL_DIR, rel));

test("fallback references migrated from leo-ppt-agent", () => {
  for (const f of ["outline-architect.md", "bento-grid-layout.md", "cognitive-design-principles.md"]) {
    assert.ok(exists(`references/fallback/${f}`), `missing ${f}`);
    assert.ok(read(`references/fallback/${f}`).length > 1000, `${f} looks truncated`);
  }
});

test("cjk-text-fit extracts the CJK width and font sizing rules", () => {
  const cjk = read("references/fallback/cjk-text-fit.md");
  assert.match(cjk, /1\.8/);
  assert.match(cjk, /font_size \* 1\.1/);
  assert.match(cjk, /1\.7/);            // CJK line height factor
  assert.match(cjk, /italic/i);         // 禁用斜体规则
  assert.match(cjk, /44 - \(25\.2-15\)\*0\.5/); // 字号收缩示例
});
