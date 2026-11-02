import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  formatPostFolderName,
  resolveWorkspaceDir,
  resolvePostDir,
  readConfig,
  updateConfig,
  getDefaultOutputDir,
} from "../scripts/config.mjs";

import {
  XHS_SKILLS_CATALOG,
  formatMissingSkillCard,
  detectAllSkillsStatus,
} from "../scripts/install_xhs_skills.mjs";

import {
  auditTextContent,
  auditPostDirectory,
  BANNED_PATTERNS,
} from "../scripts/quality_guard.mjs";

test("config: formatPostFolderName generates standard YYYY-MM-DD-topic", () => {
  const d = new Date(2026, 5, 17); // June 17, 2026
  const folder = formatPostFolderName("GLM-5.2开源模型解析", d);
  assert.equal(folder, "2026-06-17-GLM-5.2开源模型解析");

  // If topic already has date, don't duplicate
  const folder2 = formatPostFolderName("2026-06-17-GLM-5.2开源模型解析", d);
  assert.equal(folder2, "2026-06-17-GLM-5.2开源模型解析");
});

test("config: workspace resolution with smart persistence", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-xhs-test-"));
  const fakeCfgFile = path.join(tmpDir, "config.json");
  process.env.LEO_XHS_CONFIG_PATH = fakeCfgFile;

  try {
    // 1. Initial should fallback to default
    const r1 = resolveWorkspaceDir();
    assert.equal(r1.source, "default");
    assert.equal(r1.persisted, false);

    // 2. User specified should persist to config
    const customDir = path.join(tmpDir, "my-xhs-workspace");
    const r2 = resolveWorkspaceDir(customDir);
    assert.equal(r2.source, "user_specified");
    assert.equal(r2.persisted, true);
    assert.equal(r2.dir, path.resolve(customDir));

    // Verify written to config
    const saved = readConfig();
    assert.equal(saved.workspace_dir, path.resolve(customDir));

    // 3. Subsequent call without path uses remembered config
    const r3 = resolveWorkspaceDir();
    assert.equal(r3.source, "config");
    assert.equal(r3.dir, path.resolve(customDir));
  } finally {
    delete process.env.LEO_XHS_CONFIG_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("skills catalog: contains only XHS skills and excludes gzh/video", () => {
  const keys = Object.keys(XHS_SKILLS_CATALOG);
  assert.equal(keys.length, 10);
  assert.ok(keys.includes("space-xhs-positioning"));
  assert.ok(keys.includes("space-xhs-hotspot"));
  assert.ok(keys.includes("space-xhs-title"));
  assert.ok(keys.includes("space-xhs-writer"));
  assert.ok(keys.includes("space-xhs-cover"));
  assert.ok(keys.includes("xhs-html"));
  assert.ok(keys.includes("space-xhs-image"));
  assert.ok(keys.includes("space-xhs-account-audit"));
  assert.ok(keys.includes("space-xhs-note-analytics"));
  assert.ok(keys.includes("xhs-writer"));

  // Verify no gzh or video skills
  assert.ok(!keys.includes("gzh-hotnotes"));
  assert.ok(!keys.includes("video-skills"));

  const card = formatMissingSkillCard("xhs-html");
  assert.ok(card.includes("xhs-html"));
  assert.ok(card.includes("SpaceZephyr/creator-buddy"));
});

test("quality_guard: catches banned creator-facing strings", () => {
  const badContent = `
# 标题候选
1. 这个真不错
## 推荐标题
测试标题
## 封面文案
封面
## 正文可复制版
这是正文，参考原文进行了改写。
这里有个 TODO 待补充数据。
AI 生成的内容在这里。
## 话题标签
#测试
`;

  const res = auditTextContent(badContent);
  assert.equal(res.pass, false);
  assert.equal(res.issues.length, 3);
  assert.ok(res.issues.some(i => i.type === "工作流/源文说明"));
  assert.ok(res.issues.some(i => i.type === "占位符/未完工"));
  assert.ok(res.issues.some(i => i.type === "AI生成提示"));

  const cleanContent = `
# 标题候选
1. 真的很好用
## 推荐标题
好用的神器
## 封面文案
效率翻倍
## 正文可复制版
这是专门给真实读者看的高价值干货分享。
## 话题标签
#效率工具 #干货
`;
  const cleanRes = auditTextContent(cleanContent);
  assert.equal(cleanRes.pass, true);
  assert.equal(cleanRes.issues.length, 0);
});

test("quality_guard: audits post directory structure", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-post-audit-"));
  try {
    const postDir = path.join(tmpDir, "2026-06-17-test-post");
    fs.mkdirSync(postDir, { recursive: true });

    // Missing 内容.md initially
    const r1 = auditPostDirectory(postDir);
    assert.equal(r1.pass, false);

    // Create 内容.md
    fs.writeFileSync(path.join(postDir, "内容.md"), `
## 推荐标题
测试
## 正文可复制版
正文内容
## 话题标签
#标签
`, "utf-8");

    // Create images dir
    const pubDir = path.join(postDir, "图片", "发布版");
    fs.mkdirSync(pubDir, { recursive: true });
    fs.writeFileSync(path.join(pubDir, "01-封面.png"), "dummy");
    fs.writeFileSync(path.join(pubDir, "02-卡片1.png"), "dummy");

    const r2 = auditPostDirectory(postDir);
    assert.equal(r2.pass, true);
    assert.equal(r2.imageCount, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
