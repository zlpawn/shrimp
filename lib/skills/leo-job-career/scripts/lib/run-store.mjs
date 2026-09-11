import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "./config.mjs";

export class RunStore {
  constructor(options = {}) {
    this.paths = options.paths || resolveRuntimePaths();
    ensureRuntimeDirectories(this.paths);
  }

  createRun(options = {}) {
    const runId = `run_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const runDir = path.join(this.paths.runs, runId);
    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    }

    const manifest = {
      schema_version: 1,
      run_id: runId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stage: "created",
      city: options.city || "北京",
      target_count: options.target || 100,
      search_plan_index: 0,
      page_index: 1,
      stats: {
        candidates_seen: 0,
        details_fetched: 0,
        valid_jobs: 0,
        excluded_outsourcing: 0,
        exact_dupes: 0,
        semantic_reposts: 0,
      },
      error: null,
    };

    this._writeManifest(runId, manifest);
    this.appendEvent(runId, { type: "RUN_CREATED", options });
    return manifest;
  }

  _writeManifest(runId, manifest) {
    const runDir = path.join(this.paths.runs, runId);
    const targetFile = path.join(runDir, "manifest.json");
    const tmpFile = `${targetFile}.tmp.${Date.now()}`;
    manifest.updated_at = new Date().toISOString();
    fs.writeFileSync(tmpFile, JSON.stringify(manifest, null, 2), "utf8");
    fs.renameSync(tmpFile, targetFile);
  }

  getRun(runId) {
    const manifestFile = path.join(this.paths.runs, runId, "manifest.json");
    if (!fs.existsSync(manifestFile)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    } catch {
      return null;
    }
  }

  getLatestResumableRun() {
    if (!fs.existsSync(this.paths.runs)) return null;
    const entries = fs.readdirSync(this.paths.runs, { withFileTypes: true });
    const runDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("run_"));
    runDirs.sort((a, b) => b.name.localeCompare(a.name));

    for (const d of runDirs) {
      const run = this.getRun(d.name);
      if (run && !["complete", "complete_below_target", "failed"].includes(run.stage)) {
        return run;
      }
    }
    return null;
  }

  updateProgress(runId, updates = {}) {
    const manifest = this.getRun(runId);
    if (!manifest) return null;

    if (updates.stage) manifest.stage = updates.stage;
    if (updates.search_plan_index !== undefined) manifest.search_plan_index = updates.search_plan_index;
    if (updates.page_index !== undefined) manifest.page_index = updates.page_index;
    if (updates.stats) {
      manifest.stats = { ...manifest.stats, ...updates.stats };
    }
    if (updates.error !== undefined) manifest.error = updates.error;

    this._writeManifest(runId, manifest);
    return manifest;
  }

  appendEvent(runId, event) {
    const runDir = path.join(this.paths.runs, runId);
    if (!fs.existsSync(runDir)) return;
    const eventsFile = path.join(runDir, "events.jsonl");
    const record = {
      timestamp: new Date().toISOString(),
      ...event,
    };
    fs.appendFileSync(eventsFile, JSON.stringify(record) + "\n", "utf8");
  }

  saveSummary(runId, summary) {
    const runDir = path.join(this.paths.runs, runId);
    const summaryFile = path.join(runDir, "summary.json");
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), "utf8");
  }
}
