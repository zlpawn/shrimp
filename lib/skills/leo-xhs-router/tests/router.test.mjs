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
  decoupleMarkdown,
} from "../scripts/quality_guard.mjs";

test("config: formatPostFolderName generates standard YYYY-MM-DD-topic", () => {
  const d = new Date(2026, 5, 17); // June 17, 2026
  const folder = formatPostFolderName("GLM-5.2开源模型解析", d);
  assert.equal(folder, "2026-06-17-GLM-5.2开源模型解析");

  // If topic already has date, don't duplicate
  const folder2 = formatPostFolderName("2026-06-17-GLM-5.2开源模型解析", d);
  assert.equal(folder2, "2026-06-17-GLM-5.2开源模型解析");

  // If topic is a full path, it extracts basename
  const folder3 = formatPostFolderName("D:\\some\\path\\GLM-5.2开源模型解析", d);
  assert.equal(folder3, "2026-06-17-GLM-5.2开源模型解析");
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

test("quality_guard: catches banned creator-facing strings while allowing normal tech discussions", () => {
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
配图prompt: a photorealistic cat
## 话题标签
#测试
`;

  const res = auditTextContent(badContent);
  assert.equal(res.pass, false);
  assert.equal(res.issues.length, 3);
  assert.ok(res.issues.some(i => i.type === "工作流/源文说明"));
  assert.ok(res.issues.some(i => i.type === "占位符/未完工"));
  assert.ok(res.issues.some(i => i.type === "AI生图内部提示"));

  // Legitimate discussions of AI and prompts should NOT be falsely flagged
  const cleanTechContent = `
# 标题候选
1. 真的很好用
## 推荐标题
开源 AI 大模型实测与提示词技巧
## 封面文案
效率翻倍的神器
## 正文可复制版
今天来聊聊如何用好 AI 工具提高生产力。很多朋友问提示词该怎么写，其实只要掌握核心原则即可。
## 话题标签
#AI工具 #大模型
`;
  const cleanRes = auditTextContent(cleanTechContent);
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
    // Should have advisory warning about < 5 cards
    assert.ok(r2.warnings.some(w => w.type === "卡片数量建议"));

    // Overlong title test (> 20 characters)
    fs.writeFileSync(path.join(postDir, "内容.md"), `
## 推荐标题
这是一条故意写得超级无敌长已经远远超过二十个字符的小红书标题测试
## 正文可复制版
正文内容
## 话题标签
#标签
`, "utf-8");
    const r3 = auditPostDirectory(postDir);
    assert.equal(r3.pass, true); // non-blocking
    assert.ok(r3.warnings.some(w => w.type === "标题字数超限"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("quality_guard: decoupleMarkdown cleans raw markdown syntax for Xiaohongshu", () => {
  const raw = `
## 核心亮点
- **极速启动**：只需 15ms
- 兼容 \`CDP\` 协议与 Playwright
---
更多细节见主页
`;
  const cleaned = decoupleMarkdown(raw);
  assert.ok(!cleaned.includes("**"));
  assert.ok(!cleaned.includes("`"));
  assert.ok(!cleaned.includes("##"));
  assert.ok(!cleaned.includes("---"));
  assert.ok(cleaned.includes("• 极速启动：只需 15ms"));
  assert.ok(cleaned.includes("• 兼容 CDP 协议与 Playwright"));
});
