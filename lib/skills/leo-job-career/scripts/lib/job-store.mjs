import fs from "node:fs";
import path from "node:path";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "./config.mjs";

export class JobStore {
  constructor(options = {}) {
    this.paths = options.paths || resolveRuntimePaths();
    ensureRuntimeDirectories(this.paths);
  }

  saveRawSearch(queryId, page, data) {
    const fileName = `${queryId}_p${page}_${Date.now()}.json`;
    const targetFile = path.join(this.paths.rawSearches, fileName);
    fs.writeFileSync(targetFile, JSON.stringify(data, null, 2), "utf8");
    return targetFile;
  }

  saveRawDetail(jobId, data) {
    const targetFile = path.join(this.paths.rawDetails, `${jobId}.json`);
    fs.writeFileSync(targetFile, JSON.stringify(data, null, 2), "utf8");
    return targetFile;
  }

  getRawDetail(jobId) {
    const targetFile = path.join(this.paths.rawDetails, `${jobId}.json`);
    if (!fs.existsSync(targetFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(targetFile, "utf8"));
    } catch {
      return null;
    }
  }

  saveJobFacts(newFacts) {
    const existingMap = new Map();
    if (fs.existsSync(this.paths.jobFactsFile)) {
      const lines = fs.readFileSync(this.paths.jobFactsFile, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const item = JSON.parse(trimmed);
          if (item.canonical_key) {
            existingMap.set(item.canonical_key, item);
          }
        } catch {}
      }
    }

    for (const fact of newFacts) {
      if (!fact || !fact.canonical_key) continue;
      if (existingMap.has(fact.canonical_key)) {
        const prev = existingMap.get(fact.canonical_key);
        fact.observations = {
          ...fact.observations,
          first_seen_at: prev.observations?.first_seen_at || fact.observations?.first_seen_at,
          last_seen_at: new Date().toISOString(),
        };
      }
      existingMap.set(fact.canonical_key, fact);
    }

    const tmpFile = `${this.paths.jobFactsFile}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    const lines = Array.from(existingMap.values()).map((f) => JSON.stringify(f));
    fs.writeFileSync(tmpFile, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
    fs.renameSync(tmpFile, this.paths.jobFactsFile);
    return existingMap.size;
  }

  loadJobFacts(filterFn = null) {
    if (!fs.existsSync(this.paths.jobFactsFile)) return [];
    const lines = fs.readFileSync(this.paths.jobFactsFile, "utf8").split("\n");
    const facts = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const item = JSON.parse(trimmed);
        if (!filterFn || filterFn(item)) {
          facts.push(item);
        }
      } catch {}
    }
    return facts;
  }

  saveJobAnalyses(newAnalyses) {
    const existingMap = new Map();
    if (fs.existsSync(this.paths.jobAnalysesFile)) {
      const lines = fs.readFileSync(this.paths.jobAnalysesFile, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const item = JSON.parse(trimmed);
          if (item.job_id) {
            existingMap.set(item.job_id, item);
          }
        } catch {}
      }
    }

    for (const ana of newAnalyses) {
      if (ana && ana.job_id) {
        existingMap.set(ana.job_id, ana);
      }
    }

    const tmpFile = `${this.paths.jobAnalysesFile}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    const lines = Array.from(existingMap.values()).map((a) => JSON.stringify(a));
    fs.writeFileSync(tmpFile, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
    fs.renameSync(tmpFile, this.paths.jobAnalysesFile);
    return existingMap.size;
  }

  loadJobAnalyses() {
    if (!fs.existsSync(this.paths.jobAnalysesFile)) return [];
    const lines = fs.readFileSync(this.paths.jobAnalysesFile, "utf8").split("\n");
    const analyses = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        analyses.push(JSON.parse(trimmed));
      } catch {}
    }
    return analyses;
  }
}
