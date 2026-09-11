import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "../../scripts/lib/config.mjs";
import { RunStore } from "../../scripts/lib/run-store.mjs";
import { JobStore } from "../../scripts/lib/job-store.mjs";

test("RunStore creates run manifest, updates stage, and checkpoints progress", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-run-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  ensureRuntimeDirectories(paths);

  const runStore = new RunStore({ paths });
  const run = runStore.createRun({ city: "北京", target: 50 });
  assert.ok(run.run_id);
  assert.equal(run.stage, "created");
  assert.equal(run.target_count, 50);

  runStore.updateProgress(run.run_id, {
    stage: "collecting_lists",
    search_plan_index: 2,
    page_index: 3,
    stats: { candidates_seen: 35 }
  });

  const reloaded = runStore.getRun(run.run_id);
  assert.equal(reloaded.stage, "collecting_lists");
  assert.equal(reloaded.search_plan_index, 2);
  assert.equal(reloaded.page_index, 3);
  assert.equal(reloaded.stats.candidates_seen, 35);

  runStore.appendEvent(run.run_id, { type: "PAGE_FETCHED", page: 3 });
  const runDir = path.join(paths.runs, run.run_id);
  assert.ok(fs.existsSync(path.join(runDir, "events.jsonl")));

  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test("JobStore saves raw items, facts, and updates observations", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-jobstore-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  ensureRuntimeDirectories(paths);

  const jobStore = new JobStore({ paths });
  const sampleFact = {
    schema_version: 1,
    source: "boss",
    source_job_id: "j_100",
    canonical_key: "boss:j_100",
    title: "Java Agent 开发",
    salary: { raw: "30-40K·15薪", monthly_min_cny: 30000 },
    company: { name: "测试智能" },
    location: { city: "北京", district: "海淀区" },
    observations: { status: "active", first_seen_at: "2026-09-10" }
  };

  jobStore.saveJobFacts([sampleFact]);
  const loaded = jobStore.loadJobFacts();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].canonical_key, "boss:j_100");

  jobStore.saveRawDetail("j_100", { mock: "detail" });
  assert.ok(fs.existsSync(path.join(paths.rawDetails, "j_100.json")));

  fs.rmSync(tmpBase, { recursive: true, force: true });
});
