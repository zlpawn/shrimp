// tests/unit/trend-intel-storage.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveDataDir } from "../../lib/trend-intel/storage/paths.mjs";
import { createTrendIntelConfigStore } from "../../lib/trend-intel/storage/config-store.mjs";
import { createTrendIntelDb } from "../../lib/trend-intel/storage/db.mjs";

test("resolveDataDir - should resolve test tmp directory", () => {
  const tmp = path.join(os.tmpdir(), "trend-intel-test-" + Date.now());
  const resolved = resolveDataDir(tmp);
  assert.equal(resolved, tmp);
  assert.ok(fs.existsSync(resolved));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("resolveDataDir - should respect TREND_INTEL_DATA_DIR env variable", () => {
  const envDir = path.join(os.tmpdir(), "trend-intel-env-test-" + Date.now());
  const prevEnv = process.env.TREND_INTEL_DATA_DIR;
  process.env.TREND_INTEL_DATA_DIR = envDir;
  try {
    const resolved = resolveDataDir();
    assert.equal(resolved, envDir);
    assert.ok(fs.existsSync(resolved));
  } finally {
    if (prevEnv !== undefined) {
      process.env.TREND_INTEL_DATA_DIR = prevEnv;
    } else {
      delete process.env.TREND_INTEL_DATA_DIR;
    }
    fs.rmSync(envDir, { recursive: true, force: true });
  }
});

test("resolveDataDir - should resolve project output/trend-intel when in project root", () => {
  const prevEnv = process.env.TREND_INTEL_DATA_DIR;
  delete process.env.TREND_INTEL_DATA_DIR;
  try {
    const resolved = resolveDataDir();
    assert.ok(resolved.endsWith(path.join("output", "trend-intel")));
    assert.ok(fs.existsSync(resolved));
  } finally {
    if (prevEnv !== undefined) {
      process.env.TREND_INTEL_DATA_DIR = prevEnv;
    }
  }
});

test("config-store - should read default config and update dynamic focus topics", () => {
  const tmp = path.join(os.tmpdir(), "trend-intel-config-test-" + Date.now());
  const store = createTrendIntelConfigStore(tmp);
  const cfg = store.get();
  assert.equal(cfg.scheduler.interval_minutes, 30);
  assert.ok(Array.isArray(cfg.focus_topics));
  assert.ok(cfg.focus_topics.length >= 2);

  store.update({
    scheduler: { enabled: false, interval_minutes: 60 },
    focus_topics: [
      ...cfg.focus_topics,
      { id: "custom_1", name: "二次元", icon: "🎮", enabled: true, keywords: ["原神", "黑神话"] }
    ]
  });

  const updated = store.get();
  assert.equal(updated.scheduler.interval_minutes, 60);
  assert.equal(updated.focus_topics.find(t => t.id === "custom_1")?.name, "二次元");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("config-store - handles invalid json file gracefully with defaults", () => {
  const tmp = path.join(os.tmpdir(), "trend-intel-config-corrupt-" + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, "trend-intel.config.json"), "invalid json content", "utf-8");

  const store = createTrendIntelConfigStore(tmp);
  const cfg = store.get();
  assert.equal(cfg.scheduler.interval_minutes, 30);
  assert.ok(Array.isArray(cfg.focus_topics));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("db - should insert items, record snapshots, and query events", () => {
  const tmp = path.join(os.tmpdir(), "trend-intel-db-test-" + Date.now());
  const db = createTrendIntelDb(tmp);

  db.saveRawItems([
    {
      id: "weibo_101",
      platform: "weibo",
      title: "OpenAI 发布 GPT-5 Preview",
      url: "https://s.weibo.com/test",
      rank: 3,
      score: 100000,
      collected_at: new Date().toISOString(),
      raw: { test: true }
    }
  ]);

  db.recordSnapshots([
    { item_id: "weibo_101", platform: "weibo", rank: 3, score: 100000, recorded_at: new Date().toISOString() }
  ]);

  const items = db.getRawItems({ platform: "weibo" });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "OpenAI 发布 GPT-5 Preview");
  assert.deepEqual(items[0].raw, { test: true });

  const snapshots = db.getItemSnapshots("weibo_101");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].rank, 3);

  db.saveEvents([
    {
      event_id: "evt_1",
      title: "OpenAI 发布新模型",
      summary: "全球热议",
      platforms: ["weibo", "zhihu"],
      platform_count: 2,
      trend_state: "RAPID_RISING",
      velocity: 15.5,
      world_importance_score: 9.0,
      creator_value_score: 9.2,
      creator_angles: ["对程序员的影响"],
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]);

  const events = db.getEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].trend_state, "RAPID_RISING");
  assert.deepEqual(events[0].platforms, ["weibo", "zhihu"]);
  assert.deepEqual(events[0].creator_angles, ["对程序员的影响"]);

  // Test daily brief storage
  db.saveBrief({
    date: "2026-08-26",
    markdown: "# 今日简报\n测试内容",
    metadata: { total_events: 1, top_score: 9.2 },
    created_at: new Date().toISOString()
  });

  const latestBrief = db.getLatestBrief();
  assert.ok(latestBrief);
  assert.equal(latestBrief.date, "2026-08-26");
  assert.equal(latestBrief.metadata.total_events, 1);

  const specificBrief = db.getBriefByDate("2026-08-26");
  assert.ok(specificBrief);
  assert.equal(specificBrief.markdown, "# 今日简报\n测试内容");

  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("db - comprehensive filtering, updates, and rank progression", () => {
  const tmp = path.join(os.tmpdir(), "trend-intel-db-filter-test-" + Date.now());
  const db = createTrendIntelDb(tmp);

  // Initial insert
  db.saveRawItems([
    { id: "item_1", platform: "zhihu", title: "知乎热点 1", rank: 10, score: 5000 },
    { id: "item_2", platform: "weibo", title: "微博热点 2", rank: 1, score: 90000 },
    { id: "item_3", platform: "zhihu", title: "知乎热点 3", rank: 5, score: 20000 }
  ]);

  // Rank progression for item_1: 10 -> 2
  db.saveRawItems([
    { id: "item_1", platform: "zhihu", title: "知乎热点 1 (升级)", rank: 2, score: 80000 }
  ]);

  const item1 = db.getRawItems({ platform: "zhihu" }).find(i => i.id === "item_1");
  assert.equal(item1.rank, 2);
  assert.equal(item1.previous_rank, 10);
  assert.equal(item1.title, "知乎热点 1 (升级)");

  // Filter raw items by platform and limit
  const zhihuItems = db.getRawItems({ platform: "zhihu", limit: 1 });
  assert.equal(zhihuItems.length, 1);
  assert.equal(zhihuItems[0].id, "item_1"); // rank 2 before rank 5

  // Record multiple snapshots
  db.recordSnapshots([
    { item_id: "item_1", platform: "zhihu", rank: 10, score: 5000, recorded_at: "2026-08-26T08:00:00.000Z" },
    { item_id: "item_1", platform: "zhihu", rank: 5, score: 20000, recorded_at: "2026-08-26T08:30:00.000Z" },
    { item_id: "item_1", platform: "zhihu", rank: 2, score: 80000, recorded_at: "2026-08-26T09:00:00.000Z" }
  ]);

  const snapAsc = db.getItemSnapshots("item_1", { order: "asc" });
  assert.equal(snapAsc.length, 3);
  assert.equal(snapAsc[0].rank, 10);
  assert.equal(snapAsc[2].rank, 2);

  const snapDesc = db.getItemSnapshots("item_1", { order: "desc", limit: 2 });
  assert.equal(snapDesc.length, 2);
  assert.equal(snapDesc[0].rank, 2);

  // Events with multiple filters
  db.saveEvents([
    {
      event_id: "e1",
      title: "AI Agent 大战",
      platforms: ["weibo", "zhihu", "36kr"],
      platform_count: 3,
      trend_state: "RAPID_RISING",
      world_importance_score: 8.5,
      creator_value_score: 9.5,
      matched_topic: "topic_ai",
      creator_angles: ["对个人的机会", "商业模式探讨"],
      first_seen_at: "2026-08-26T08:00:00.000Z",
      last_seen_at: "2026-08-26T09:00:00.000Z",
      updated_at: "2026-08-26T09:00:00.000Z"
    },
    {
      event_id: "e2",
      title: "某地突发暴雨",
      platforms: ["weibo"],
      platform_count: 1,
      trend_state: "PEAK",
      world_importance_score: 6.0,
      creator_value_score: 4.0,
      matched_topic: null,
      creator_angles: [],
      first_seen_at: "2026-08-26T07:00:00.000Z",
      last_seen_at: "2026-08-26T08:30:00.000Z",
      updated_at: "2026-08-26T08:30:00.000Z"
    }
  ]);

  // Query events by state
  const rapidRisingEvents = db.getEvents({ state: "RAPID_RISING" });
  assert.equal(rapidRisingEvents.length, 1);
  assert.equal(rapidRisingEvents[0].event_id, "e1");

  // Query events by min_score
  const highValueEvents = db.getEvents({ min_score: 8.0 });
  assert.equal(highValueEvents.length, 1);
  assert.equal(highValueEvents[0].event_id, "e1");

  // Query events by matched_topic
  const aiTopicEvents = db.getEvents({ matched_topic: "topic_ai" });
  assert.equal(aiTopicEvents.length, 1);
  assert.equal(aiTopicEvents[0].matched_topic, "topic_ai");

  // Query empty brief returns null
  assert.equal(db.getBriefByDate("1999-01-01"), null);

  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
