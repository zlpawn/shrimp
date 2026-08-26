import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  coarseClusterItems,
  refineClustersWithLLM,
  clusterRawItems
} from "../../lib/trend-intel/engine/cluster.mjs";
import { scoreEvents } from "../../lib/trend-intel/engine/scorer.mjs";
import {
  assembleBriefMarkdown,
  generateDailyBrief
} from "../../lib/trend-intel/engine/brief-generator.mjs";
import { exportArtifactFiles } from "../../lib/trend-intel/engine/exporter.mjs";

test("cluster - should group cross-platform items with high token overlap", () => {
  const items = [
    { id: "1", platform: "weibo", title: "OpenAI 发布 GPT-5 模型", rank: 3 },
    { id: "2", platform: "zhihu", title: "如何评价 OpenAI 刚刚发布的 GPT-5？", rank: 1 },
    { id: "3", platform: "baidu", title: "某明星今日结婚", rank: 5 }
  ];
  const clusters = coarseClusterItems(items);
  assert.equal(clusters.length, 2);
  const openAiCluster = clusters.find(c => c.items.length === 2);
  assert.ok(openAiCluster);
  assert.equal(openAiCluster.platforms.length, 2);
  assert.ok(openAiCluster.platforms.includes("weibo"));
  assert.ok(openAiCluster.platforms.includes("zhihu"));
});

test("cluster - should match dynamic user focus topics", () => {
  const items = [
    { id: "1", platform: "36kr", title: "DeepSeek 发布新一代推理大模型", rank: 2 },
    { id: "2", platform: "weibo", title: "某明星最新演唱会官宣", rank: 10 }
  ];
  const focusTopics = [
    {
      id: "topic_ai",
      name: "人工智能与前沿科技",
      icon: "🤖",
      enabled: true,
      keywords: ["DeepSeek", "AI", "大模型"]
    }
  ];

  const clusters = coarseClusterItems(items, focusTopics);
  const aiCluster = clusters.find(c => c.matched_topic === "topic_ai");
  assert.ok(aiCluster);
  assert.equal(aiCluster.matched_topic, "topic_ai");

  const otherCluster = clusters.find(c => !c.matched_topic);
  assert.ok(otherCluster);
});

test("cluster - refineClustersWithLLM should fallback gracefully when no model caller", async () => {
  const clusters = [
    {
      event_id: "e1",
      title: "OpenAI 发布 GPT-5",
      items: [{ id: "1", platform: "weibo", title: "OpenAI 发布 GPT-5" }]
    }
  ];

  const refined = await refineClustersWithLLM(clusters, null);
  assert.deepEqual(refined, clusters);
});

test("cluster - refineClustersWithLLM should refine cluster titles with mock model caller", async () => {
  const clusters = [
    {
      event_id: "e1",
      title: "OpenAI 发布 GPT-5",
      summary: "",
      items: [{ id: "1", platform: "weibo", title: "OpenAI 发布 GPT-5" }]
    }
  ];

  const mockModelCaller = async () => JSON.stringify([
    {
      event_id: "e1",
      title: "OpenAI 正式发布 GPT-5 前沿大模型",
      summary: "全球科技界热议其全新多模态与自主推理能力。"
    }
  ]);

  const refined = await refineClustersWithLLM(clusters, mockModelCaller);
  assert.equal(refined[0].title, "OpenAI 正式发布 GPT-5 前沿大模型");
  assert.ok(refined[0].summary.includes("全新多模态"));
});

test("cluster - clusterRawItems should return standard event objects", async () => {
  const items = [
    { id: "1", platform: "weibo", title: "特斯拉固态电池取得新突破", rank: 4 }
  ];
  const focusTopics = [
    { id: "topic_cars", name: "智能汽车", icon: "🚗", enabled: true, keywords: ["特斯拉", "固态电池"] }
  ];

  const events = await clusterRawItems(items, focusTopics);
  assert.equal(events.length, 1);
  assert.ok(events[0].event_id);
  assert.equal(events[0].matched_topic, "topic_cars");
  assert.ok(Array.isArray(events[0].platforms));
  assert.equal(events[0].platform_count, 1);
});

test("scorer - should calculate heuristic scores and creator angles offline", async () => {
  const events = [
    {
      event_id: "e1",
      title: "国际央行超预期降息",
      platforms: ["wallstreetcn", "36kr"],
      platform_count: 2,
      trend_state: "RISING",
      velocity: 8.5
    },
    {
      event_id: "e2",
      title: "某网红翻车事件引热议",
      platforms: ["weibo", "douyin"],
      platform_count: 2,
      trend_state: "RAPID_RISING",
      velocity: 15.0
    }
  ];

  const scored = await scoreEvents(events, null);
  assert.equal(scored.length, 2);

  const e1 = scored.find(e => e.event_id === "e1");
  assert.ok(e1.world_importance_score >= 6.0, "e1 world score should be high");
  assert.ok(Array.isArray(e1.creator_angles));
  assert.ok(e1.creator_angles.length >= 1);

  const e2 = scored.find(e => e.event_id === "e2");
  assert.ok(e2.creator_value_score >= 6.0, "e2 creator score should be high");
});

test("scorer - should parse LLM model response when modelCaller provided", async () => {
  const events = [
    {
      event_id: "e1",
      title: "OpenAI 发布新模型",
      platforms: ["weibo", "zhihu"]
    }
  ];

  const mockCaller = async () => JSON.stringify([
    {
      event_id: "e1",
      world_importance_score: 9.5,
      creator_value_score: 9.8,
      summary: "OpenAI 发布全新模型架构，算力效率提升 10 倍。",
      creator_angles: ["从工程落地角度拆解成本收益", "对比开源竞品的应对路径"]
    }
  ]);

  const scored = await scoreEvents(events, mockCaller);
  assert.equal(scored[0].world_importance_score, 9.5);
  assert.equal(scored[0].creator_value_score, 9.8);
  assert.equal(scored[0].creator_angles.length, 2);
  assert.ok(scored[0].summary.includes("算力效率"));
});

test("brief-generator - should assemble 5-section markdown brief with focus columns", () => {
  const events = [
    {
      event_id: "e1",
      title: "国际央行超预期降息",
      summary: "全球流动性迎来转折",
      platforms: ["wallstreetcn", "36kr"],
      trend_state: "RISING",
      world_importance_score: 9.2,
      creator_value_score: 5.5,
      first_seen_at: new Date().toISOString()
    },
    {
      event_id: "e2",
      title: "某固态电池汽车突破",
      summary: "续航超千公里",
      platforms: ["weibo", "zhihu"],
      trend_state: "RAPID_RISING",
      velocity: 12.0,
      world_importance_score: 7.5,
      creator_value_score: 9.3,
      creator_angles: ["从工程量产难度拆解", "对二手保值率影响"],
      first_seen_at: new Date().toISOString(),
      matched_topic: "topic_cars"
    },
    {
      event_id: "e3",
      title: "某跨国企业重组观察",
      summary: "组织架构调整",
      platforms: ["36kr"],
      trend_state: "NEW",
      world_importance_score: 6.5,
      creator_value_score: 4.0,
      first_seen_at: new Date().toISOString()
    },
    {
      event_id: "e4",
      title: "周末大众热门影视讨论",
      summary: "全网热播剧引发广泛讨论",
      platforms: ["weibo", "douyin", "bilibili"],
      trend_state: "PEAK",
      world_importance_score: 4.0,
      creator_value_score: 7.0,
      first_seen_at: new Date().toISOString()
    }
  ];

  const md = assembleBriefMarkdown(events, [
    { id: "topic_cars", name: "智能汽车与出行", icon: "🚗", enabled: true }
  ]);

  assert.ok(md.includes("① 今天必须知道"));
  assert.ok(md.includes("② 正在快速升温"));
  assert.ok(md.includes("③ 今天最值得做的内容"));
  assert.ok(md.includes("④ 值得知道，但不一定做"));
  assert.ok(md.includes("⑤ 大众舆论讨论"));
  assert.ok(md.includes("🎯 重点赛道精选：智能汽车与出行"));
});

test("brief-generator - generateDailyBrief should return date, markdown, and metadata", () => {
  const events = [
    {
      event_id: "e1",
      title: "测试热点",
      summary: "简要内容",
      platforms: ["weibo"],
      world_importance_score: 8.5,
      creator_value_score: 8.0
    }
  ];

  const brief = generateDailyBrief(events, []);
  assert.ok(brief.date);
  assert.ok(brief.markdown);
  assert.ok(brief.metadata);
  assert.equal(brief.metadata.total_events, 1);
});

test("exporter - should export latest_brief.md and latest_events.json to directory", () => {
  const tmp = path.join(os.tmpdir(), "trend-intel-export-" + Date.now());
  const sampleBrief = {
    date: "2026-08-26",
    markdown: "# 今日情报\n## 测试内容",
    metadata: { count: 1 }
  };
  const paths = exportArtifactFiles(tmp, sampleBrief, [{ event_id: "e1", title: "测试" }]);
  assert.ok(fs.existsSync(paths.briefPath));
  assert.ok(fs.existsSync(paths.jsonPath));
  assert.ok(fs.existsSync(paths.archiveBriefPath));
  assert.ok(fs.existsSync(paths.archiveJsonPath));

  const readBrief = fs.readFileSync(paths.briefPath, "utf-8");
  assert.equal(readBrief, "# 今日情报\n## 测试内容");

  const readEvents = JSON.parse(fs.readFileSync(paths.jsonPath, "utf-8"));
  assert.equal(readEvents.length, 1);
  assert.equal(readEvents[0].event_id, "e1");

  fs.rmSync(tmp, { recursive: true, force: true });
});
