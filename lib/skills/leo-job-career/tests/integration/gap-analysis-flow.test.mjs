import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "../../scripts/lib/config.mjs";
import { JobStore } from "../../scripts/lib/job-store.mjs";
import { initCareerProfile, updateCareerProfile, loadCareerProfile } from "../../scripts/lib/profile-engine.mjs";
import { generateMarketReport } from "../../scripts/lib/market-pipeline.mjs";
import {
  analyzeCapabilityGaps,
  generateMarkdownGapReport,
  saveMarkdownGapReport,
} from "../../scripts/lib/gap-analyzer.mjs";
import { detectDeterministicExclusions } from "../../scripts/lib/freshness.mjs";

test("Full End-to-End Gap Analysis Workflow: Market Filtering -> Attribution -> Self-Eval -> Transparent Markdown Report", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-e2e-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  ensureRuntimeDirectories(paths);

  // 1. Initialize Profile
  const profile = initCareerProfile({
    paths,
    overrides: {
      target_role: "Java Agent架构师",
      target_city: "北京",
      level: { target_benchmark: "大厂P7" },
      experience_years: 8,
      compensation: { target_band: "60-70万" },
    },
  });
  assert.equal(profile.target_city, "北京");
  assert.equal(profile.level.target_benchmark, "大厂P7");

  // 2. Prepare mock job candidates including Big Tech, Star Startup, and Outsourcing
  const candidates = [
    {
      source_job_id: "job_meituan_001",
      canonical_key: "boss:job_meituan_001",
      title: "Java资深/技术专家 (Agent平台)",
      salary: { raw: "45-65K·16薪", annual_cash_min_cny: 720000, annual_cash_max_cny: 1040000 },
      requirements: { labels: ["Java", "分布式架构", "高并发治理", "Agent工作流编排"] },
      company: { name: "美团", size: "10000人以上", financing_stage: "已上市", industry: "互联网" },
      observations: { status: "active", last_seen_at: new Date().toISOString() },
    },
    {
      source_job_id: "job_zhipu_002",
      canonical_key: "boss:job_zhipu_002",
      title: "Java Agent架构师",
      salary: { raw: "40-60K·15薪", annual_cash_min_cny: 600000, annual_cash_max_cny: 900000 },
      requirements: { labels: ["Java", "Agent工作流编排", "MCP协议", "RAG知识检索"] },
      company: { name: "智谱华章", size: "100-499人", financing_stage: "B轮", industry: "人工智能" },
      observations: { status: "active", last_seen_at: new Date().toISOString() },
    },
    {
      source_job_id: "job_outsourcing_003",
      canonical_key: "boss:job_outsourcing_003",
      title: "Java资深开发（外派大厂）",
      salary: { raw: "25-35K", annual_cash_min_cny: 300000, annual_cash_max_cny: 420000 },
      description: "派驻客户现场办公，介意外包勿投",
      requirements: { labels: ["Java", "Spring Boot"] },
      company: { name: "中软国际科技服务有限公司", size: "10000人以上", financing_stage: "已上市", industry: "计算机软件" },
      observations: { status: "active", last_seen_at: new Date().toISOString() },
    },
  ];

  // 3. Filter candidates with Zero-Outsourcing gate
  const validFacts = [];
  for (const c of candidates) {
    const exclusion = detectDeterministicExclusions(c);
    if (!exclusion.excluded) {
      validFacts.push(c);
    }
  }

  // Verify outsourcing was strictly caught
  assert.equal(validFacts.length, 2);
  assert.ok(validFacts.every(f => !f.company.name.includes("中软国际")));

  const jobStore = new JobStore({ paths });
  jobStore.saveJobFacts(validFacts);

  // 4. Generate Market Report with company attribution
  const marketReport = generateMarketReport({ paths, jobStore });
  assert.equal(marketReport.total_valid_jobs, 2);
  assert.ok(marketReport.companies_by_tier.big_tech.includes("美团"));
  assert.ok(marketReport.companies_by_tier.star_startup.includes("智谱华章"));

  // Verify capability matrix has attribution
  const agentCap = marketReport.capability_matrix.find(c => c.skill === "Agent工作流编排");
  assert.ok(agentCap);
  assert.ok(agentCap.company_sources.includes("美团") || agentCap.company_sources.includes("智谱华章"));

  // 5. User provides self-evals
  const userAssessments = {
    "Java": "proficient",
    "分布式架构": "proficient",
    "高并发治理": "demo_only",
    "Agent工作流编排": "demo_only",
    "MCP协议": "not_touched",
    "RAG知识检索": "not_touched",
  };
  updateCareerProfile({ assessments: userAssessments }, { paths });

  // 6. Run Gap Analyzer
  const loadedProfile = loadCareerProfile({ paths });
  const gapResult = analyzeCapabilityGaps({
    userProfile: loadedProfile,
    userAssessments: loadedProfile.assessments,
    marketSummary: marketReport,
  });

  // Solid baseline
  assert.equal(gapResult.solid_baseline.length, 2); // Java, 分布式架构

  // Top blockers (2~3 critical blockers)
  assert.ok(gapResult.top_blockers.length >= 2 && gapResult.top_blockers.length <= 3);

  // 100% full transparency: all missing skills must be present
  const totalGapsCount = gapResult.top_blockers.length + gapResult.secondary_gaps.length + gapResult.bonus_gaps.length;
  assert.equal(totalGapsCount, 4); // 高并发治理, Agent工作流编排, MCP协议, RAG知识检索

  // 7. Generate & Save Markdown Report
  const mdReport = generateMarkdownGapReport({
    userProfile: loadedProfile,
    gapAnalysis: gapResult,
    marketSummary: marketReport,
  });

  assert.ok(mdReport.includes("# 人岗能力差距与市场画像诊断报告"));
  assert.ok(mdReport.includes("美团"));
  assert.ok(mdReport.includes("智谱华章"));
  assert.ok(mdReport.includes("100% 熔断过滤外包"));
  assert.ok(mdReport.includes("🔴 最高优先级核心硬骨头"));
  assert.ok(mdReport.includes("后​​续学习规划衔接说明") || mdReport.includes("后续学习规划衔接说明"));

  const savedReportFile = saveMarkdownGapReport(mdReport, { paths });
  assert.ok(fs.existsSync(savedReportFile));
  assert.equal(fs.readFileSync(savedReportFile, "utf8"), mdReport);

  fs.rmSync(tmpBase, { recursive: true, force: true });
});
