import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initSchedulerModule } from "../../lib/scheduler/index.mjs";

describe("Scheduler REST API Integration Tests", () => {
  let tmpDir;
  let server;
  let baseUrl;
  let schedulerModule;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-api-test-"));

    // Copy example config
    fs.writeFileSync(
      path.join(tmpDir, "scheduler.config.example.json"),
      JSON.stringify({
        version: 1,
        jobs: {
          trend_intel_crawl: { enabled: true, interval_minutes: 20 },
        },
      }),
      "utf-8"
    );

    let crawlCalled = false;
    schedulerModule = initSchedulerModule({
      configDir: tmpDir,
      getTrendIntelService: () => ({
        crawlOnce: async () => {
          crawlCalled = true;
          return { count: 18 };
        },
      }),
      getTrendIntelScheduler: () => ({
        getStatus: () => ({
          running: true,
          enabled: true,
          interval_minutes: 20,
          lastCrawlAt: "2026-09-07T00:00:00.000Z",
        }),
      }),
    });

    server = http.createServer(async (req, res) => {
      const handled = await schedulerModule.handleSchedulerRequest(req, res);
      if (!handled) {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("GET /v1/scheduler/jobs returns all 7 jobs", async () => {
    const res = await fetch(`${baseUrl}/v1/scheduler/jobs`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.jobs));
    assert.equal(body.jobs.length, 7);

    const crawlJob = body.jobs.find((j) => j.id === "trend_intel_crawl");
    assert.ok(crawlJob);
    assert.equal(crawlJob.module, "热点情报 (Trend Radar)");
    assert.equal(crawlJob.config.interval_minutes, 20);
    assert.ok(crawlJob.schema.length >= 2);
  });

  it("POST /v1/scheduler/jobs/:id/run executes the job", async () => {
    const res = await fetch(`${baseUrl}/v1/scheduler/jobs/trend_intel_crawl/run`, {
      method: "POST",
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.message, /18 条/);

    // Verify recent runs updated in job list
    const listRes = await fetch(`${baseUrl}/v1/scheduler/jobs`);
    const listBody = await listRes.json();
    const crawlJob = listBody.jobs.find((j) => j.id === "trend_intel_crawl");
    assert.equal(crawlJob.recentRuns.length, 1);
    assert.equal(crawlJob.recentRuns[0].success, true);
  });

  it("PATCH /v1/scheduler/jobs/:id/config updates job config and persists", async () => {
    const res = await fetch(`${baseUrl}/v1/scheduler/jobs/trend_intel_crawl/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval_minutes: 45, enabled: false }),
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.job.config.interval_minutes, 45);
    assert.equal(body.job.config.enabled, false);

    // Verify persisted on disk
    const savedConfig = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "scheduler.config.json"), "utf-8")
    );
    assert.equal(savedConfig.jobs.trend_intel_crawl.interval_minutes, 45);
    assert.equal(savedConfig.jobs.trend_intel_crawl.enabled, false);
  });

  it("POST /v1/scheduler/jobs/:id/run returns 404 for unknown job", async () => {
    const res = await fetch(`${baseUrl}/v1/scheduler/jobs/non_existent_job/run`, {
      method: "POST",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
  });
});
