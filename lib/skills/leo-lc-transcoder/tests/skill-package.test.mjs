import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillInstaller } from "../../../session-sync/skill-installer.mjs";

const SKILL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), "utf8");

test("安装后包含完整的脚本、素材和参考资料", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lc-install-")), ".agents", "skills", "leo-lc-transcoder");
  SkillInstaller.installBaseSkill(dir, "leo-lc-transcoder");
  for (const rel of [
    "SKILL.md",
    "scripts/lc.mjs",
    "scripts/viz.mjs",
    "scripts/lib/config.mjs",
    "scripts/lib/args.mjs",
    "scripts/sites/leetcode-com/api.mjs",
    "scripts/sites/leetcode-com/cookie.mjs",
    "assets/T.java",
    "assets/player.html",
    "references/pattern-catalog.md",
    "references/teaching-examples.md",
    "references/card-templates.md",
  ]) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `missing ${rel}`);
  }
});

test("SKILL.md 的 frontmatter 和关键约定", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /^---\nname: leo-lc-transcoder\ndescription: /);
  for (const cmd of ["lc config", "lc login", "lc search", "lc show", "lc run", "lc submit", "lc solutions", "viz.mjs"]) {
    assert.ok(skill.includes(cmd), `SKILL.md 缺少命令 ${cmd}`);
  }
  for (const rule of ["解题四问", "Easy 10 分钟", "Medium / Hard 15 分钟", "掌握度", "MOST_VOTES", "references/teaching-examples.md"]) {
    assert.ok(skill.includes(rule), `SKILL.md 缺少约定：${rule}`);
  }
});

test("托管目录里登记了本 skill", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, "..", "managed-catalog.json"), "utf8"));
  const entry = catalog.skills.find((s) => s.name === "leo-lc-transcoder");
  assert.ok(entry, "catalog entry missing");
  assert.equal(entry.id, "leo-lc-transcoder");
  assert.equal(entry.managed, true);
});

test("题型目录有 P01～P13", () => {
  const catalog = read("references/pattern-catalog.md");
  for (let i = 1; i <= 13; i++) {
    assert.match(catalog, new RegExp(`^## P${String(i).padStart(2, "0")} `, "m"));
  }
});
