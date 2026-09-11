import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "./config.mjs";

export function getDefaultCareerProfile() {
  return {
    schema_version: 1,
    user_name: "Candidate",
    target_city: "北京",
    direction: ["Java + AI应用后端", "Agent平台与基础设施"],
    compensation: {
      current_cash_annual_cny: 450000,
      current_structure: "16薪无股票",
      target_cash_annual_cny: 650000,
      target_band: "60-70万",
      minimum_raise_pct: 30,
      ideal_raise_pct: 40,
    },
    level: {
      current_level: "P6",
      target_benchmark: "大厂P7",
      acceptable_roles: [
        "Tech Lead",
        "AI应用技术负责人",
        "资深/高级Java+Agent研发",
        "技术型研发管理",
      ],
    },
    experience_years: 8,
    strengths: [
      "8年以上Java后端架构设计与核心研发",
      "复杂业务系统建模与全链路落地",
      "跨系统治理、中间件集成与事务一致性",
      "3-8人研发团队带领与业务交付",
    ],
    known_gaps: [
      "Agent/大模型项目主要处于Demo/API接入阶段，缺乏端到端生产级系统证据",
      "缺乏超高并发、超大规模分布式中间件基础设施实操",
      "Python未作为主开发语言",
    ],
    weekly_hours_plan: {
      pattern: "weekend_focused",
      initial_hours: 5,
      growth_policy: "progressive_increase",
      interview_time_separate: true,
    },
    deadline: "2026-12-31",
  };
}

export function initCareerProfile(options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  ensureRuntimeDirectories(paths);

  const profile = {
    ...getDefaultCareerProfile(),
    ...(options.overrides || {}),
  };

  const tmpFile = `${paths.careerProfileFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(profile, null, 2), "utf8");
  fs.renameSync(tmpFile, paths.careerProfileFile);
  return profile;
}

export function loadCareerProfile(options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  if (!fs.existsSync(paths.careerProfileFile)) {
    return initCareerProfile(options);
  }
  try {
    return JSON.parse(fs.readFileSync(paths.careerProfileFile, "utf8"));
  } catch {
    return initCareerProfile(options);
  }
}

export function recordExperienceEvidence(evidenceData, options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  ensureRuntimeDirectories(paths);

  const evidence = {
    schema_version: 1,
    evidence_id: `exp_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
    project_name: evidenceData.project_name || "未命名项目",
    time_range: evidenceData.time_range || { start: null, end: null, confidence: "approximate" },
    business_context: evidenceData.business_context || "",
    starting_problem: evidenceData.starting_problem || "",
    role: evidenceData.role || "核心研发/架构师",
    team_scope: evidenceData.team_scope || "3-8人",
    systems_involved: evidenceData.systems_involved || [],
    personal_actions: evidenceData.personal_actions || [],
    led_actions: evidenceData.led_actions || [],
    team_actions: evidenceData.team_actions || [],
    decisions: evidenceData.decisions || [],
    tradeoffs: evidenceData.tradeoffs || [],
    technical_outcomes: evidenceData.technical_outcomes || [],
    business_outcomes: evidenceData.business_outcomes || [],
    metrics: evidenceData.metrics || [],
    recorded_at: new Date().toISOString(),
    verification_status: "user_confirmed",
  };

  fs.appendFileSync(paths.experienceEvidenceFile, JSON.stringify(evidence) + "\n", "utf8");
  return evidence;
}

export function loadExperienceEvidence(options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  if (!fs.existsSync(paths.experienceEvidenceFile)) return [];
  const lines = fs.readFileSync(paths.experienceEvidenceFile, "utf8").split("\n");
  const list = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      list.push(JSON.parse(trimmed));
    } catch {}
  }
  return list;
}
