import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "../../scripts/lib/config.mjs";
import {
  analyzeCapabilityGaps,
  generateMarkdownGapReport,
  saveMarkdownGapReport,
} from "../../scripts/lib/gap-analyzer.mjs";

test("analyzeCapabilityGaps transparently categorizes top blockers and all other gaps", () => {
  const marketSummary = {
    total_valid_jobs: 20,
    companies_by_tier: {
      big_tech: ["美团", "快手", "阿里巴巴"],
      mid_tech: ["小红书", "知乎"],
      star_startup: ["智谱华章", "MiniMax"],
      other: [],
    },
    capability_matrix: [
      { skill: "Java", count: 20, frequency: 100, tiers: ["大厂", "中厂"], company_sources: ["美团", "小红书"] },
      { skill: "分布式架构", count: 18, frequency: 90, tiers: ["大厂"], company_sources: ["美团", "快手"] },
      { skill: "Agent工作流编排", count: 16, frequency: 80, tiers: ["大厂", "知名AI创企"], company_sources: ["智谱华章", "快手"] },
      { skill: "RAG与知识库检索", count: 14, frequency: 70, tiers: ["知名AI创企", "中厂"], company_sources: ["MiniMax", "知乎"] },
      { skill: "MCP协议与工具路由", count: 10, frequency: 50, tiers: ["知名AI创企"], company_sources: ["智谱华章"] },
      { skill: "模型评测与可观测性", count: 6, frequency: 30, tiers: ["大厂"], company_sources: ["阿里巴巴"] },
    ],
  };

  const userProfile = {
    target_role: "Java Agent架构师",
    target_city: "北京",
    target_level: "大厂P7",
    experience_years: 8,
    target_compensation: "60-70万",
  };

  const userAssessments = {
    "Java": "proficient",
    "分布式架构": "proficient",
    "Agent工作流编排": "demo_only",
    "RAG与知识库检索": "not_touched",
    "MCP协议与工具路由": "not_touched",
    "模型评测与可观测性": "not_touched",
  };

  const result = analyzeCapabilityGaps({ userProfile, userAssessments, marketSummary });

  assert.equal(result.solid_baseline.length, 2); // Java, 分布式架构
  assert.ok(result.top_blockers.length >= 2 && result.top_blockers.length <= 3); // 2~3 critical blockers
  assert.ok(result.top_blockers.some(b => b.skill === "Agent工作流编排"));
  assert.ok(result.top_blockers.some(b => b.skill === "RAG与知识库检索"));

  // Check 100% full transparency: all missing skills must be present
  const totalGapsCount = result.top_blockers.length + result.secondary_gaps.length + result.bonus_gaps.length;
  assert.equal(totalGapsCount, 4); // Agent, RAG, MCP, 评测
  assert.ok(result.secondary_gaps.length > 0 || result.bonus_gaps.length > 0);
});

test("generateMarkdownGapReport produces structured document with companies and transparent sections", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-gap-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  ensureRuntimeDirectories(paths);

  const marketSummary = {
    total_valid_jobs: 10,
    companies_by_tier: {
      big_tech: ["美团", "快手"],
      mid_tech: ["小红书"],
      star_startup: ["智谱华章"],
      other: [],
    },
    capability_matrix: [
      { skill: "分布式治理", count: 10, frequency: 100, tiers: ["大厂"], company_sources: ["美团", "快手"] },
      { skill: "Agent编排", count: 8, frequency: 80, tiers: ["知名AI创企"], company_sources: ["智谱华章"] },
      { skill: "RAG防幻觉", count: 7, frequency: 70, tiers: ["中厂"], company_sources: ["小红书"] },
    ],
  };

  const userProfile = {
    target_role: "Java Agent架构师",
    target_city: "北京",
    target_level: "大厂P7",
    experience_years: 8,
    target_compensation: "60-70万",
  };

  const userAssessments = {
    "分布式治理": "proficient",
    "Agent编排": "demo_only",
    "RAG防幻觉": "not_touched",
  };

  const analysis = analyzeCapabilityGaps({ userProfile, userAssessments, marketSummary });
  const md = generateMarkdownGapReport({ userProfile, gapAnalysis: analysis, marketSummary });

  assert.ok(md.includes("# 人岗能力差距与市场画像诊断报告"));
  assert.ok(md.includes("美团"));
  assert.ok(md.includes("智谱华章"));
  assert.ok(md.includes("最高优先级硬骨头"));
  assert.ok(md.includes("欠缺能力全景清单"));
  assert.ok(md.includes("后续学习规划衔接"));

  const savedPath = saveMarkdownGapReport(md, { paths });
  assert.ok(fs.existsSync(savedPath));
  assert.equal(fs.readFileSync(savedPath, "utf8"), md);

  fs.rmSync(tmpBase, { recursive: true, force: true });
});
