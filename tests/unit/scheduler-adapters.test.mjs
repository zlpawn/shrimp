import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TrendCrawlAdapter } from "../../lib/scheduler/adapters/trend-crawl.mjs";
import { TrendBriefAdapter } from "../../lib/scheduler/adapters/trend-brief.mjs";
import { KbSyncAdapter } from "../../lib/scheduler/adapters/kb-sync.mjs";
import { KanbanDispatchAdapter } from "../../lib/scheduler/adapters/kanban-dispatch.mjs";
import { FxRateAdapter } from "../../lib/scheduler/adapters/fx-rate.mjs";
import { ModelPricingAdapter } from "../../lib/scheduler/adapters/model-pricing.mjs";
import { SessionSyncAdapter } from "../../lib/scheduler/adapters/session-sync.mjs";
import { createTrendIntelScheduler } from "../../lib/trend-intel/scheduler.mjs";

describe("Scheduler Adapters Unit Tests", () => {
  it("TrendCrawlAdapter reports status and triggers crawl", async () => {
    let crawled = false;
    const adapter = new TrendCrawlAdapter({
      getService: () => ({
        crawlOnce: async () => {
          crawled = true;
          return { count: 12 };
        },
      }),
      getScheduler: () => ({
        getStatus: () => ({
          running: true,
          enabled: true,
          interval_minutes: 25,
          lastCrawlAt: "2026-09-07T00:00:00.000Z",
        }),
      }),
    });

    const status = adapter.getStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.scheduleSummary, "每 25 分钟");
    assert.equal(status.lastRunAt, "2026-09-07T00:00:00.000Z");

    const runRes = await adapter.runNow();
    assert.equal(runRes.ok, true);
    assert.equal(crawled, true);
    assert.match(runRes.message, /12/);
  });

  it("TrendBriefAdapter reports next run and generates brief", async () => {
    let generated = false;
    const adapter = new TrendBriefAdapter({
      getService: () => ({
        generateBriefOnce: async () => {
          generated = true;
          return { brief: { title: "AI 早报精选" } };
        },
      }),
      getScheduler: () => ({
        getStatus: () => ({
          running: true,
          daily_brief_times: ["08:30", "18:00"],
        }),
      }),
    });

    const status = adapter.getStatus({ daily_times: ["09:00", "20:00"] });
    assert.equal(status.scheduleSummary, "每日 09:00, 20:00");
    assert.ok(status.nextRunAt);

    const runRes = await adapter.runNow();
    assert.equal(runRes.ok, true);
    assert.equal(generated, true);
    assert.match(runRes.message, /AI 早报精选/);
  });

  it("KbSyncAdapter handles WeRead & Craft sync and calls scheduleNext on config change", async () => {
    let syncRan = false;
    let scheduleNextCalled = false;
    let restartCalled = false;
    const adapter = new KbSyncAdapter({
      getScheduler: () => ({
        getNextRunInfo: () => ({ timestamp: Date.now() + 60000 }),
        runSync: async () => {
          syncRan = true;
          return {
            ok: true,
            summary: "增量同步成功：共更新 3 本书，新增 5 条划线与 2 条想法",
            highlightsCount: 5,
            reviewsCount: 2,
          };
        },
        scheduleNext: () => {
          scheduleNextCalled = true;
        },
        restart: () => {
          restartCalled = true;
        },
      }),
      getChannelSecrets: () => ({
        load: () => ({
          schedule: { enabled: true, mode: "daily", daily_time: "04:30" },
        }),
        updateSchedule: () => {},
      }),
    });

    const status = adapter.getStatus({ mode: "daily", daily_time: "04:30" });
    assert.equal(status.scheduleSummary, "每日 04:30");
    assert.ok(status.nextRunAt);

    const res = await adapter.runNow();
    assert.equal(res.ok, true);
    assert.equal(syncRan, true);
    assert.match(res.message, /新增 5 条划线/);

    await adapter.onConfigChange({ interval_hours: 6 }, { enabled: true, interval_hours: 6 });
    assert.equal(scheduleNextCalled, true);
    assert.equal(restartCalled, false);
  });

  it("KanbanDispatchAdapter triggers dispatch", async () => {
    let dispatched = false;
    const adapter = new KanbanDispatchAdapter({
      getScheduler: () => ({
        runOnce: async () => {
          dispatched = true;
        },
      }),
    });

    const status = adapter.getStatus({ interval_seconds: 45 });
    assert.equal(status.scheduleSummary, "每 45 秒");

    const res = await adapter.runNow();
    assert.equal(res.ok, true);
    assert.equal(dispatched, true);
  });

  it("FxRateAdapter fetches latest rate", async () => {
    let refreshed = false;
    const adapter = new FxRateAdapter({
      getService: () => ({
        refresh: async () => {
          refreshed = true;
          return true;
        },
        getRate: () => ({
          usd_to_cny: 7.2345,
          source: "api",
          updated_at: Date.now(),
        }),
      }),
    });

    const status = adapter.getStatus();
    assert.match(status.lastMessage, /7\.2345/);

    const res = await adapter.runNow();
    assert.equal(res.ok, true);
    assert.equal(refreshed, true);
  });

  it("ModelPricingAdapter triggers LiteLLM pricing refresh", async () => {
    let refreshed = false;
    const adapter = new ModelPricingAdapter({
      getEngine: () => ({
        refresh: async () => {
          refreshed = true;
          return true;
        },
        listPrices: () => ({
          models: [{ model: "gpt-4o" }, { model: "claude-3-5-sonnet" }],
        }),
      }),
    });

    const status = adapter.getStatus();
    assert.match(status.lastMessage, /收录 2 个模型规格/);

    const res = await adapter.runNow();
    assert.equal(res.ok, true);
    assert.equal(refreshed, true);
  });

  it("SessionSyncAdapter triggers scan and updates debounce", async () => {
    let scanned = false;
    const mockDaemon = {
      isRunning: true,
      debounceMs: 1500,
      scanExistingSessions: async () => {
        scanned = true;
      },
    };

    const adapter = new SessionSyncAdapter({
      getDaemon: () => mockDaemon,
    });

    const status = adapter.getStatus({ debounce_ms: 2000 });
    assert.equal(status.scheduleSummary, "事件驱动 (2000ms 防抖)");

    const res = await adapter.runNow();
    assert.equal(res.ok, true);
    assert.equal(scanned, true);

    await adapter.onConfigChange({ debounce_ms: 2500 }, { debounce_ms: 2500 });
    assert.equal(mockDaemon.debounceMs, 2500);
  });

  it("TrendCrawlAdapter writes through interval and enabled to trend-intel config", async () => {
    const updates = [];
    let rescheduled = 0;
    const adapter = new TrendCrawlAdapter({
      getService: () => ({
        crawlOnce: async () => ({ count: 1 }),
        updateConfig: (patch) => {
          updates.push(patch);
          return patch;
        },
      }),
      getScheduler: () => ({
        getStatus: () => ({ running: true, crawl_enabled: true, brief_enabled: true }),
        rescheduleCrawl: () => {
          rescheduled += 1;
        },
        stop: () => {},
      }),
    });

    await adapter.onConfigChange(
      { interval_minutes: 60 },
      { enabled: true, interval_minutes: 60 }
    );
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], {
      scheduler: { interval_minutes: 60, crawl_enabled: true },
    });
    assert.equal(rescheduled, 1);

    // Disabling only crawl must NOT stop the shared scheduler (brief still on)
    await adapter.onConfigChange(
      { enabled: false },
      { enabled: false, interval_minutes: 60 }
    );
    assert.equal(updates.length, 2);
    assert.deepEqual(updates[1].scheduler, {
      interval_minutes: 60,
      crawl_enabled: false,
    });
  });

  it("TrendBriefAdapter writes through daily_times and brief_enabled", async () => {
    const updates = [];
    const adapter = new TrendBriefAdapter({
      getService: () => ({
        generateBriefOnce: async () => ({ title: "t" }),
        updateConfig: (patch) => {
          updates.push(patch);
          return patch;
        },
      }),
      getScheduler: () => ({
        getStatus: () => ({ running: true, crawl_enabled: true, brief_enabled: true }),
        stop: () => {},
      }),
    });

    await adapter.onConfigChange(
      { daily_times: ["09:00"] },
      { enabled: true, daily_times: ["09:00"] }
    );
    assert.deepEqual(updates[0], {
      scheduler: { daily_brief_times: ["09:00"], brief_enabled: true },
    });

    await adapter.onConfigChange(
      { daily_times: [] },
      { enabled: true, daily_times: [] }
    );
    assert.deepEqual(updates[1], {
      scheduler: { daily_brief_times: [], brief_enabled: true },
    });

    // Disabled brief reports null nextRunAt
    const status = adapter.getStatus({ enabled: false, daily_times: ["09:00"] });
    assert.equal(status.enabled, false);
    assert.equal(status.nextRunAt, null);
  });

  it("Trend adapters restart the shared scheduler after both sub-jobs were disabled", async () => {
    let schedulerConfig = {
      enabled: true,
      crawl_enabled: true,
      brief_enabled: true,
      interval_minutes: 30,
      daily_brief_times: ["08:30"],
    };
    const service = {
      getConfig: () => ({ scheduler: schedulerConfig }),
      updateConfig: (patch) => {
        schedulerConfig = { ...schedulerConfig, ...patch.scheduler };
      },
      crawlOnce: async () => ({ count: 0 }),
    };
    const scheduler = createTrendIntelScheduler(service, { initialCrawl: false });
    const crawlAdapter = new TrendCrawlAdapter({
      getService: () => service,
      getScheduler: () => scheduler,
    });
    const briefAdapter = new TrendBriefAdapter({
      getService: () => service,
      getScheduler: () => scheduler,
    });

    scheduler.start();
    await crawlAdapter.onConfigChange({ enabled: false }, { enabled: false });
    await briefAdapter.onConfigChange({ enabled: false }, { enabled: false });
    assert.equal(scheduler.getStatus().running, false);

    await crawlAdapter.onConfigChange({ enabled: true }, { enabled: true });
    assert.equal(scheduler.getStatus().running, true);
    assert.equal(scheduler.getStatus().crawl_enabled, true);

    scheduler.stop();
  });

  it("KanbanDispatchAdapter applies interval and stop on config change", async () => {
    const calls = [];
    const adapter = new KanbanDispatchAdapter({
      getScheduler: () => ({
        runOnce: async () => {},
        setIntervalMs: (ms) => calls.push(["interval", ms]),
        stop: () => calls.push(["stop"]),
        start: () => calls.push(["start"]),
      }),
    });

    await adapter.onConfigChange(
      { interval_seconds: 45 },
      { enabled: true, interval_seconds: 45 }
    );
    assert.deepEqual(calls, [["interval", 45000], ["start"]]);

    calls.length = 0;
    await adapter.onConfigChange(
      { enabled: false },
      { enabled: false, interval_seconds: 45 }
    );
    assert.deepEqual(calls, [["interval", 45000], ["stop"]]);
  });

  it("FxRateAdapter re-arms timer on interval change and stops when disabled", async () => {
    const calls = [];
    const adapter = new FxRateAdapter({
      getService: () => ({
        getRate: () => ({ usd_to_cny: 7.2, source: "api", updated_at: Date.now() }),
        refresh: async () => true,
        setRefreshIntervalHours: (h) => calls.push(["interval", h]),
        stopRefresh: () => calls.push(["stop"]),
        startRefresh: () => calls.push(["start"]),
      }),
    });

    await adapter.onConfigChange(
      { interval_hours: 12 },
      { enabled: true, interval_hours: 12 }
    );
    assert.deepEqual(calls, [["interval", 12], ["start"]]);

    calls.length = 0;
    await adapter.onConfigChange(
      { enabled: false },
      { enabled: false, interval_hours: 12 }
    );
    assert.deepEqual(calls, [["interval", 12], ["stop"]]);
  });

  it("ModelPricingAdapter re-arms refresh timer on config change", async () => {
    const calls = [];
    const adapter = new ModelPricingAdapter({
      getEngine: () => ({
        listPrices: () => ({ models: [] }),
        refresh: async () => true,
        setRefreshIntervalHours: (h) => calls.push(["interval", h]),
        stopRefresh: () => calls.push(["stop"]),
        startRefresh: () => calls.push(["start"]),
      }),
    });

    await adapter.onConfigChange(
      { interval_hours: 48 },
      { enabled: true, interval_hours: 48 }
    );
    assert.deepEqual(calls, [["interval", 48], ["start"]]);
  });
});
