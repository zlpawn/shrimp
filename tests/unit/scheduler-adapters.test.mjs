import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TrendCrawlAdapter } from "../../lib/scheduler/adapters/trend-crawl.mjs";
import { TrendBriefAdapter } from "../../lib/scheduler/adapters/trend-brief.mjs";
import { KbSyncAdapter } from "../../lib/scheduler/adapters/kb-sync.mjs";
import { KanbanDispatchAdapter } from "../../lib/scheduler/adapters/kanban-dispatch.mjs";
import { FxRateAdapter } from "../../lib/scheduler/adapters/fx-rate.mjs";
import { ModelPricingAdapter } from "../../lib/scheduler/adapters/model-pricing.mjs";
import { SessionSyncAdapter } from "../../lib/scheduler/adapters/session-sync.mjs";

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
          return { title: "AI 早报精选" };
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

  it("KbSyncAdapter handles WeRead & Craft sync", async () => {
    let syncRan = false;
    const adapter = new KbSyncAdapter({
      getScheduler: () => ({
        getNextRunInfo: () => ({ timestamp: Date.now() + 60000 }),
        runSync: async () => {
          syncRan = true;
          return { ok: true, totalHighlights: 5, craftNotesCount: 2 };
        },
      }),
      getChannelSecrets: () => ({
        load: () => ({
          schedule: { enabled: true, mode: "daily", daily_time: "04:30" },
        }),
      }),
    });

    const status = adapter.getStatus({ mode: "daily", daily_time: "04:30" });
    assert.equal(status.scheduleSummary, "每日 04:30");
    assert.ok(status.nextRunAt);

    const res = await adapter.runNow();
    assert.equal(res.ok, true);
    assert.equal(syncRan, true);
    assert.match(res.message, /微信划线\/想法 \+5/);
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
});
