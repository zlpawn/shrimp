import fs from "node:fs";
import path from "node:path";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "./config.mjs";

export function getDefaultCareerProfile() {
  return {
    schema_version: 1,
    user_name: "Candidate",
    target_city: "北京",
    target_role: "Java Agent / 大模型后端架构师",
    compensation: {
      current_cash_annual_cny: 450000,
      target_cash_annual_cny: 650000,
      target_band: "60-70万",
    },
    level: {
      current_level: "P6",
      target_benchmark: "大厂P7",
    },
    experience_years: 8,
    assessments: {},
    updated_at: new Date().toISOString(),
  };
}

export function initCareerProfile(options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  ensureRuntimeDirectories(paths);

  const profile = {
    ...getDefaultCareerProfile(),
    ...(options.overrides || {}),
    updated_at: new Date().toISOString(),
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

export function updateCareerProfile(updates = {}, options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  const current = loadCareerProfile(options);
  const updated = {
    ...current,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const tmpFile = `${paths.careerProfileFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(updated, null, 2), "utf8");
  fs.renameSync(tmpFile, paths.careerProfileFile);
  return updated;
}
