import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "../../scripts/lib/config.mjs";
import { JobStore } from "../../scripts/lib/job-store.mjs";
import { initCareerProfile, loadCareerProfile, recordExperienceEvidence } from "../../scripts/lib/profile-engine.mjs";
import { generatePreparationPlan } from "../../scripts/lib/prepare-engine.mjs";

test("initCareerProfile creates default profile matching user constraints", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-prof-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  ensureRuntimeDirectories(paths);

  const profile = initCareerProfile({ paths });
  assert.equal(profile.target_city, "北京");
  assert.equal(profile.compensation.target_band, "60-70万");
  assert.equal(profile.level.target_benchmark, "大厂P7");
  assert.equal(profile.weekly_hours_plan.initial_hours, 5);

  const loaded = loadCareerProfile({ paths });
  assert.equal(loaded.experience_years, 8);
  assert.ok(fs.existsSync(paths.careerProfileFile));

  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test("recordExperienceEvidence appends validated evidence to experience-evidence.jsonl", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-evid-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  ensureRuntimeDirectories(paths);

  const evidence = recordExperienceEvidence({
    project_name: "电商交易与账户中心",
    role: "技术负责人",
    starting_problem: "跨系统事务一致性与分库分表数据迁移",
    personal_actions: ["设计基于可靠消息的最终一致性方案", "主导核心状态机重构"],
    technical_outcomes: ["零资金损失", "系统可用性达99.99%"],
  }, { paths });

  assert.ok(evidence.evidence_id);
  assert.equal(evidence.project_name, "电商交易与账户中心");

  const lines = fs.readFileSync(paths.experienceEvidenceFile, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.role, "技术负责人");

  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test("generatePreparationPlan generates gap matrix and progressive weekend schedule", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-plan-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  ensureRuntimeDirectories(paths);

  initCareerProfile({ paths });
  const jobStore = new JobStore({ paths });
  jobStore.saveJobFacts([
    {
      canonical_key: "boss:j1",
      title: "Java Agent架构师",
      salary: { raw: "40-60K·15薪", annual_cash_min_cny: 600000, annual_cash_max_cny: 900000 },
      requirements: { labels: ["Java", "Spring Boot", "RAG", "Agent", "MCP", "系统设计"] },
      company: { name: "智谱" }
    }
  ]);

  const plan = generatePreparationPlan({ paths, jobStore });
  assert.ok(plan.gap_analysis);
  assert.ok(plan.gap_analysis.evidenced_now);
  assert.ok(plan.gap_analysis.buildable_by_deadline);
  assert.ok(plan.gap_analysis.buildable_by_deadline.some(x => x.capability === "RAG" || x.capability === "Agent" || x.capability === "MCP"));

  assert.ok(plan.weekend_roadmap);
  assert.ok(plan.weekend_roadmap.length >= 4);
  assert.equal(plan.weekend_roadmap[0].allocated_hours, 5); // progressive starting at 5h

  fs.rmSync(tmpBase, { recursive: true, force: true });
});
