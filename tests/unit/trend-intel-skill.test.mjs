import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SkillInstaller } from "../../lib/session-sync/skill-installer.mjs";

const execFileAsync = promisify(execFile);

test("skill - SKILL.md exists, has frontmatter, 6+4 framework and dual scoring", () => {
  const skillPath = path.resolve("lib/skills/leo-trend-intelligence/SKILL.md");
  assert.ok(fs.existsSync(skillPath), "lib/skills/leo-trend-intelligence/SKILL.md must exist");
  const content = fs.readFileSync(skillPath, "utf-8");

  // Frontmatter
  assert.ok(content.startsWith("---"), "SKILL.md should start with frontmatter");
  assert.ok(content.includes("name: leo-trend-intelligence"), "frontmatter must include name: leo-trend-intelligence");
  assert.ok(content.includes("description:"), "frontmatter must include description");

  // Dual Scoring definitions
  assert.ok(content.includes("World Importance"), "must mention World Importance");
  assert.ok(content.includes("Creator Value"), "must mention Creator Value");
  assert.ok(content.includes("世界重要性"), "must mention 世界重要性");
  assert.ok(content.includes("内容价值") || content.includes("创作者价值"), "must mention 内容价值");

  // 6+4 Analysis Framework
  assert.ok(content.includes("6+4"), "must explicitly describe 6+4 framework");
  assert.ok(content.includes("发生了什么"), "must include Q1: 发生了什么");
  assert.ok(content.includes("为什么现在发生"), "must include Q2: 为什么现在发生");
  assert.ok(content.includes("为什么重要"), "must include Q3: 为什么重要");
  assert.ok(content.includes("接下来可能怎么发展"), "must include Q4: 接下来可能怎么发展");
  assert.ok(content.includes("对普通人/行业意味着什么") || content.includes("普通人"), "must include Q5: 意味着什么");
  assert.ok(content.includes("值不值得做成内容"), "must include Q6: 值不值得做成内容");

  // 自媒体选题 4 问
  assert.ok(content.includes("最值得讲的角度"), "must include Creator Q1: 最值得讲的角度");
  assert.ok(content.includes("大多数人怎么讲") || content.includes("主流叙事"), "must include Creator Q2: 大多数人怎么讲 / 主流叙事");
  assert.ok(content.includes("不一样但成立") || content.includes("反常识") || content.includes("认知差"), "must include Creator Q3: 反常识 / 认知差 / 信息差");
  assert.ok(content.includes("现在做晚不晚") || content.includes("时效窗口"), "must include Creator Q4: 现在做晚不晚 / 时效窗口");

  // Dual Intake Mode
  assert.ok(content.includes("/v1/trend-intel/brief"), "must document REST API brief endpoint");
  assert.ok(content.includes("latest_brief.md"), "must document fallback latest_brief.md file");
  assert.ok(content.includes("latest_events.json"), "must document fallback latest_events.json file");
});

test("skill - managed catalog discovers and registers leo-trend-intelligence", () => {
  const skill = SkillInstaller.getManagedSkill("leo-trend-intelligence");
  assert.ok(skill, "leo-trend-intelligence must be discovered as managed skill");
  assert.equal(skill.name, "leo-trend-intelligence");
  assert.ok(skill.title, "must have a display title");
  assert.ok(skill.summary, "must have a summary");
  assert.equal(skill.featured, true);
  assert.ok(skill.tags.includes("leo-trend-intelligence"));
});

test("skill - SkillInstaller can install base skill to target directory", () => {
  const tmpDir = path.join(os.tmpdir(), "trend-intel-install-test-" + Date.now());
  try {
    const installedFile = SkillInstaller.installBaseSkill(tmpDir, "leo-trend-intelligence");
    assert.ok(fs.existsSync(installedFile));
    assert.ok(fs.existsSync(path.join(tmpDir, "scripts", "leo_trend_intel.mjs")));
    const content = fs.readFileSync(installedFile, "utf-8");
    assert.ok(content.includes("leo-trend-intelligence"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("skill - helper script leo_trend_intel.mjs runs with --help", async () => {
  const scriptPath = path.resolve("lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs");
  assert.ok(fs.existsSync(scriptPath), "scripts/leo_trend_intel.mjs must exist");

  const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--help"]);
  assert.ok(stdout.includes("trend-intel") || stdout.includes("Usage") || stdout.includes("用法") || stdout.includes("Leo Trend Intelligence"));
});

test("skill - helper script leo_trend_intel.mjs supports --status command", async () => {
  const scriptPath = path.resolve("lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs");
  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--status",
    "--gateway-url",
    "http://127.0.0.1:59998",
  ]);
  assert.ok(stdout.includes("Trend Intelligence 运行状态诊断"));
  assert.ok(stdout.includes("目标网关地址"));
});

test("skill - helper script leo_trend_intel.mjs falls back to local file when gateway offline", async () => {
  const scriptPath = path.resolve("lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs");
  const tmpDir = path.join(process.cwd(), "output", "trend-intel");
  fs.mkdirSync(tmpDir, { recursive: true });
  const testBriefPath = path.join(tmpDir, "latest_brief.md");
  const testContent = "# 测试热点简报\n## 自动化测试条目 123456";
  fs.writeFileSync(testBriefPath, testContent, "utf-8");

  // Call script pointing to a non-existent port to force fallback
  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--brief",
    "--gateway-url",
    "http://127.0.0.1:59999",
  ]);

  assert.ok(stdout.includes("自动化测试条目 123456") || stdout.includes("测试热点简报"));
});

test("skill - helper script leo_trend_intel.mjs falls back to local events json when gateway offline", async () => {
  const scriptPath = path.resolve("lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs");
  const tmpDir = path.join(process.cwd(), "output", "trend-intel");
  fs.mkdirSync(tmpDir, { recursive: true });
  const testEventsPath = path.join(tmpDir, "latest_events.json");
  const testEvents = [
    {
      event_id: "evt_offline_1",
      title: "离线本地降级事件测试 789",
      platforms: ["weibo", "zhihu"],
      world_importance_score: 8.8,
      creator_value_score: 9.1,
      summary: "离线事件摘要"
    }
  ];
  fs.writeFileSync(testEventsPath, JSON.stringify(testEvents, null, 2), "utf-8");

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--events",
    "--gateway-url",
    "http://127.0.0.1:59999",
  ]);

  assert.ok(stdout.includes("离线本地降级事件测试 789"));
  assert.ok(stdout.includes("8.8"));
});

test("skill - helper script leo_trend_intel.mjs fetches from live gateway when available", async () => {
  const scriptPath = path.resolve("lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs");

  // Start mock HTTP server
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/trend-intel/brief") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        data: {
          date: "2026-08-26",
          markdown: "# Gateway Online Brief\n## Real-time Hot Item 999",
          metadata: { total_events: 1 }
        }
      }));
      return;
    }
    if (req.url?.startsWith("/v1/trend-intel/events")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        data: {
          events: [
            {
              event_id: "evt_test",
              title: "Mock Event from Live Gateway",
              platforms: ["weibo", "36kr"],
              world_importance_score: 9.0,
              creator_value_score: 8.5,
              creator_angles: ["角度一", "角度二"]
            }
          ],
          total: 1
        }
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  try {
    const { stdout: briefOut } = await execFileAsync(process.execPath, [
      scriptPath,
      "--brief",
      "--gateway-url",
      `http://127.0.0.1:${port}`,
    ]);
    assert.ok(briefOut.includes("Real-time Hot Item 999") || briefOut.includes("Gateway Online Brief"));

    const { stdout: eventsOut } = await execFileAsync(process.execPath, [
      scriptPath,
      "--events",
      "--gateway-url",
      `http://127.0.0.1:${port}`,
    ]);
    assert.ok(eventsOut.includes("Mock Event from Live Gateway"));
    assert.ok(eventsOut.includes("角度一"));
  } finally {
    server.close();
  }
});
