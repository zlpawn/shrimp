import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "../../scripts/lib/config.mjs";
import { BossClient } from "../../scripts/lib/boss-client.mjs";
import { JobStore } from "../../scripts/lib/job-store.mjs";
import { RunStore } from "../../scripts/lib/run-store.mjs";
import { executeMarketRun, generateMarketReport } from "../../scripts/lib/market-pipeline.mjs";

test("BossClient correctly parses search list and handles mock transport", async () => {
  const searchFixture = JSON.parse(fs.readFileSync("lib/skills/leo-job-career/tests/fixtures/search-list.json", "utf8"));
  const detailFixture = JSON.parse(fs.readFileSync("lib/skills/leo-job-career/tests/fixtures/job-detail-core.json", "utf8"));

  const mockFetch = async (url) => {
    if (url.includes("/job/list.json")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(searchFixture),
      };
    }
    if (url.includes("/job/detail.json")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(detailFixture),
      };
    }
    return { ok: false, status: 404, text: async () => "{}" };
  };

  const client = new BossClient({
    cookieHeader: "mock_cookie=1",
    fetchFn: mockFetch,
    delayRangeMs: [0, 1], // fast in test
  });

  const listRes = await client.searchJobs({ query: "Java Agent", page: 1 });
  assert.equal(listRes.jobList.length, 3);
  assert.equal(listRes.jobList[0].encryptJobId, "job_core_001");

  const detailRes = await client.getJobDetail({ securityId: "s1", lid: "l1", jobId: "job_core_001" });
  assert.equal(detailRes.jobInfo.encryptJobId, "job_core_001");
});

test("executeMarketRun processes search list, applies filters, dedupes, and persists valid facts", async () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-pipeline-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  ensureRuntimeDirectories(paths);

  const searchFixture = JSON.parse(fs.readFileSync("lib/skills/leo-job-career/tests/fixtures/search-list.json", "utf8"));
  const detailCore = JSON.parse(fs.readFileSync("lib/skills/leo-job-career/tests/fixtures/job-detail-core.json", "utf8"));
  const detailOut = JSON.parse(fs.readFileSync("lib/skills/leo-job-career/tests/fixtures/job-detail-outsourcing.json", "utf8"));

  const mockFetch = async (url) => {
    if (url.includes("/job/list.json")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(searchFixture),
      };
    }
    if (url.includes("/job/detail.json")) {
      if (url.includes("job_outsourcing_002")) {
        return { ok: true, status: 200, text: async () => JSON.stringify(detailOut) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(detailCore) };
    }
    return { ok: false, status: 404, text: async () => "{}" };
  };

  const client = new BossClient({
    cookieHeader: "mock_cookie=1",
    fetchFn: mockFetch,
    delayRangeMs: [0, 1],
  });

  const runStore = new RunStore({ paths });
  const jobStore = new JobStore({ paths });

  const runResult = await executeMarketRun({
    paths,
    client,
    runStore,
    jobStore,
    target: 5,
    searchQueries: ["Java Agent"],
  });

  assert.equal(runResult.ok, true);
  assert.ok(runResult.stats.candidates_seen >= 3);
  assert.ok(runResult.stats.excluded_outsourcing >= 1);
  assert.ok(runResult.stats.valid_jobs >= 1);

  const savedFacts = jobStore.loadJobFacts();
  assert.ok(savedFacts.length >= 1);
  assert.equal(savedFacts[0].source_job_id, "job_core_001");

  const report = generateMarketReport({ paths, jobStore });
  assert.ok(report.total_valid_jobs >= 1);
  assert.ok(report.role_families);
  assert.ok(report.capability_matrix);

  fs.rmSync(tmpBase, { recursive: true, force: true });
});
