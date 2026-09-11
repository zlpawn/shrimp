import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function resolveRuntimePaths(customBaseDir = null) {
  const root = customBaseDir || path.join(os.homedir(), ".shrimp", "leo-job-career");
  return {
    root,
    auth: path.join(root, "auth"),
    config: path.join(root, "config"),
    profile: path.join(root, "profile"),
    data: path.join(root, "data"),
    rawSearches: path.join(root, "data", "raw", "searches"),
    rawDetails: path.join(root, "data", "raw", "job-details"),
    jobs: path.join(root, "data", "jobs"),
    companies: path.join(root, "data", "companies"),
    runs: path.join(root, "runs"),
    reports: path.join(root, "reports"),
    resumes: path.join(root, "resumes"),
    applications: path.join(root, "applications"),
    // Key files
    cookieHeaderFile: path.join(root, "auth", "cookie-header.txt"),
    netscapeCookieFile: path.join(root, "auth", "cookies-zhipin.com.txt"),
    authStateFile: path.join(root, "auth", "auth-state.json"),
    settingsFile: path.join(root, "config", "settings.json"),
    careerProfileFile: path.join(root, "profile", "career-profile.json"),
    experienceEvidenceFile: path.join(root, "profile", "experience-evidence.jsonl"),
    skillInventoryFile: path.join(root, "profile", "skill-inventory.json"),
    openQuestionsFile: path.join(root, "profile", "open-questions.json"),
    jobFactsFile: path.join(root, "data", "jobs", "facts.jsonl"),
    jobAnalysesFile: path.join(root, "data", "jobs", "analyses.jsonl"),
    jobObservationsFile: path.join(root, "data", "jobs", "observations.jsonl"),
  };
}

export function ensureRuntimeDirectories(paths = null) {
  const resolved = paths || resolveRuntimePaths();
  const dirs = [
    resolved.root,
    resolved.auth,
    resolved.config,
    resolved.profile,
    resolved.data,
    resolved.rawSearches,
    resolved.rawDetails,
    resolved.jobs,
    resolved.companies,
    resolved.runs,
    resolved.reports,
    resolved.resumes,
    resolved.applications,
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(dir, 0o700);
      } catch {}
    }
  }

  return resolved;
}
