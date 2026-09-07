import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SchedulerConfigStore, DEFAULT_SCHEDULER_CONFIG } from "../../lib/scheduler/config-store.mjs";

describe("SchedulerConfigStore", () => {
  let tmpDir;
  let configPath;
  let exampleConfigPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-test-"));
    configPath = path.join(tmpDir, "scheduler.config.json");
    exampleConfigPath = path.join(tmpDir, "scheduler.config.example.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("loads defaults and writes to disk when config file does not exist", () => {
    const store = new SchedulerConfigStore({ configPath, exampleConfigPath });
    const config = store.load();

    assert.equal(config.version, 1);
    assert.equal(config.jobs.trend_intel_crawl.enabled, true);
    assert.equal(config.jobs.trend_intel_crawl.interval_minutes, 30);
    assert.equal(fs.existsSync(configPath), true);
  });

  it("loads from example config if actual config does not exist", () => {
    const customExample = {
      version: 1,
      jobs: {
        trend_intel_crawl: {
          enabled: false,
          interval_minutes: 60,
        },
      },
    };
    fs.writeFileSync(exampleConfigPath, JSON.stringify(customExample), "utf-8");

    const store = new SchedulerConfigStore({ configPath, exampleConfigPath });
    const config = store.load();

    assert.equal(config.jobs.trend_intel_crawl.enabled, false);
    assert.equal(config.jobs.trend_intel_crawl.interval_minutes, 60);
    // Unspecified jobs should merge from DEFAULT_SCHEDULER_CONFIG
    assert.equal(config.jobs.trend_intel_daily_brief.enabled, true);
    assert.equal(fs.existsSync(configPath), true);
  });

  it("updates individual job config and persists to disk", () => {
    const store = new SchedulerConfigStore({ configPath, exampleConfigPath });
    store.load();

    const updated = store.updateJobConfig("trend_intel_crawl", {
      interval_minutes: 15,
      enabled: false,
    });

    assert.equal(updated.interval_minutes, 15);
    assert.equal(updated.enabled, false);

    const reloaded = new SchedulerConfigStore({ configPath, exampleConfigPath }).load();
    assert.equal(reloaded.jobs.trend_intel_crawl.interval_minutes, 15);
    assert.equal(reloaded.jobs.trend_intel_crawl.enabled, false);
  });

  it("retrieves job config by id", () => {
    const store = new SchedulerConfigStore({ configPath, exampleConfigPath });
    const jobConf = store.getJobConfig("kb_incremental_sync");

    assert.ok(jobConf);
    assert.equal(jobConf.mode, "daily");
    assert.equal(jobConf.daily_time, "04:00");
  });
});
