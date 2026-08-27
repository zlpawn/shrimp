import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createTrendIntelService } from "../../lib/trend-intel/service.mjs";
import { createTrendIntelScheduler } from "../../lib/trend-intel/scheduler.mjs";
import { routeTrendIntelRequest } from "../../lib/trend-intel/routes.mjs";
import { TREND_STATES } from "../../lib/trend-intel/engine/trend-calculator.mjs";

const execFileAsync = promisify(execFile);

/**
 * Creates dynamic mock fetch router simulating multi-platform hotlists and RSS feeds.
 */
function createE2EMockFetch(crawlRoundRef = { round: 1 }) {
  return async (url, options) => {
    const urlStr = String(url);

    // RSS Feed mock
    if (urlStr.includes("rss") || urlStr.includes("feed") || urlStr.includes(".xml")) {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Global Tech & Semiconductor Intelligence</title>
    <link>https://tech.example.com</link>
    <item>
      <title>全球半导体先进制程与算力芯片出口管制新政策出台</title>
      <link>https://tech.example.com/semiconductor-policy-2026</link>
      <description>多国联合发布新一代半导体设备与先进制程芯片贸易最新合规指南，影响全球AI产业链。</description>
      <pubDate>Wed, 26 Aug 2026 08:30:00 GMT</pubDate>
    </item>
    <item>
      <title>OpenAI 联合各方发布全球 AI 算力基建发展白皮书</title>
      <link>https://tech.example.com/openai-infra-report</link>
      <description>详细分析超大规模数据中心电网负荷与光模块需求拐点。</description>
      <pubDate>Wed, 26 Aug 2026 08:45:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;
      return new Response(xml, {
        status: 200,
        headers: { "Content-Type": "application/xml; charset=utf-8" }
      });
    }

    // NewsNow API Mock
    const round = crawlRoundRef.round;
    const items = [];

    if (urlStr.includes("weibo")) {
      if (round === 1) {
        items.push(
          { id: "wb-ent-1", title: "某当红偶像剧男女主演机场同框引发粉丝热议", url: "https://s.weibo.com/weibo?q=1", hot_value: "3500000" },
          { id: "wb-ds-1", title: "DeepSeek 发布新一代开源推理大模型技术预览", url: "https://s.weibo.com/weibo?q=2", hot_value: "420000" },
          { id: "wb-ev-1", title: "国内头部新能源车企开启新一轮全系降价潮", url: "https://s.weibo.com/weibo?q=3", hot_value: "380000" }
        );
      } else {
        // Round 2: DeepSeek jumps to #1 (rapid rising), Ent gossip drops
        items.push(
          { id: "wb-ds-1", title: "DeepSeek 发布新一代开源推理大模型技术预览", url: "https://s.weibo.com/weibo?q=2", hot_value: "4950000" },
          { id: "wb-ev-1", title: "国内头部新能源车企开启新一轮全系降价潮", url: "https://s.weibo.com/weibo?q=3", hot_value: "2100000" },
          { id: "wb-ent-1", title: "某当红偶像剧男女主演机场同框引发粉丝热议", url: "https://s.weibo.com/weibo?q=1", hot_value: "600000" }
        );
      }
    } else if (urlStr.includes("zhihu")) {
      if (round === 1) {
        items.push(
          { id: "zh-ev-1", title: "如何看待国内头部新能源车企开启新一轮降价潮？对燃油车市场有何冲击？", url: "https://zhihu.com/q/1", hot_value: "1200000" },
          { id: "zh-eco-1", title: "央行最新货币政策执行报告发布：保持流动性合理充裕", url: "https://zhihu.com/q/2", hot_value: "800000" }
        );
      } else {
        items.push(
          { id: "zh-ds-1", title: "如何评价 DeepSeek 新一代开源推理大模型？其架构革新对开发者意味着什么？", url: "https://zhihu.com/q/3", hot_value: "3800000" },
          { id: "zh-ev-1", title: "如何看待国内头部新能源车企开启新一轮降价潮？对燃油车市场有何冲击？", url: "https://zhihu.com/q/1", hot_value: "2500000" },
          { id: "zh-eco-1", title: "央行最新货币政策执行报告发布：保持流动性合理充裕", url: "https://zhihu.com/q/2", hot_value: "750000" }
        );
      }
    } else if (urlStr.includes("36kr")) {
      items.push(
        { id: "kr-ds-1", title: "DeepSeek 正式开源新一代推理大模型：算力成本再降 80%", url: "https://36kr.com/p/1", hot_value: "980000" },
        { id: "kr-semi-1", title: "全球半导体贸易新规靴子落地，国产算力芯片产业链迎新机遇", url: "https://36kr.com/p/2", hot_value: "850000" },
        { id: "kr-sea-1", title: "中国电商出海四小龙中东及拉美市场最新 GMV 战报出炉", url: "https://36kr.com/p/3", hot_value: "620000" }
      );
    } else if (urlStr.includes("baidu")) {
      items.push(
        { id: "bd-ds-1", title: "DeepSeek 大模型开源下载量登顶全球榜首", url: "https://baidu.com/s?wd=1", hot_value: "4500000" },
        { id: "bd-ev-1", title: "新能源汽车最新购置补贴与以旧换新细则出炉", url: "https://baidu.com/s?wd=2", hot_value: "3100000" }
      );
    } else {
      items.push(
        { id: "gen-1", title: "中国科技企业出海全球化布局提速", url: "https://example.com/1", hot_value: "500000" }
      );
    }

    return new Response(JSON.stringify({
      status: "success",
      data: items
    }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  };
}

test("E2E - Full Pipeline: Crawl ➔ Snapshots ➔ Velocity ➔ Cluster ➔ Dual Score ➔ 5-Section Brief ➔ Exports ➔ REST API ➔ Skill CLI", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trend-intel-e2e-test-"));
  const crawlRoundRef = { round: 1 };
  const mockFetch = createE2EMockFetch(crawlRoundRef);

  // Initialize service with isolated dataDir and mockFetch
  const service = createTrendIntelService({
    dataDir,
    fetchImpl: mockFetch
  });

  // Start HTTP Gateway server for REST API and Skill CLI
  const server = http.createServer(async (req, res) => {
    const handled = await routeTrendIntelRequest(req, res, service);
    if (!handled) {
      res.statusCode = 404;
      res.end("NOT_FOUND");
    }
  });

  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const gatewayUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------------------
    // Step 1: Config Initialization & Customization
    // -------------------------------------------------------------------------
    await t.test("1. Config API: GET and PUT custom focus topics and platforms", async () => {
      const configRes = await fetch(`${gatewayUrl}/v1/trend-intel/config`);
      assert.equal(configRes.status, 200);
      const initialConfig = await configRes.json();
      assert.ok(Array.isArray(initialConfig.focus_topics));

      // Customize focus topics and platforms
      const updateRes = await fetch(`${gatewayUrl}/v1/trend-intel/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          focus_topics: [
            {
              id: "topic_ai",
              name: "AI 与大模型",
              icon: "🤖",
              enabled: true,
              keywords: ["AI", "大模型", "DeepSeek", "算力", "OpenAI", "推理"]
            },
            {
              id: "topic_ev",
              name: "新能源与汽车",
              icon: "🚗",
              enabled: true,
              keywords: ["新能源", "汽车", "降价", "车企"]
            }
          ],
          platforms: {
            weibo: true,
            zhihu: true,
            "36kr": true,
            baidu: true,
            bilibili: false,
            toutiao: false
          },
          rss_feeds: [
            { id: "tech_rss", name: "Global Tech RSS", url: "https://tech.example.com/rss.xml", category: "tech", enabled: true }
          ]
        })
      });
      assert.equal(updateRes.status, 200);
      const updatedConfig = await updateRes.json();
      assert.equal(updatedConfig.focus_topics.length, 2);
      assert.equal(updatedConfig.focus_topics[0].name, "AI 与大模型");
      assert.equal(updatedConfig.platforms.weibo, true);
      assert.equal(updatedConfig.platforms.bilibili, false);
      assert.equal(updatedConfig.rss_feeds.length, 1);
    });

    // -------------------------------------------------------------------------
    // Step 2: First Round Crawl (T0 Baseline)
    // -------------------------------------------------------------------------
    await t.test("2. Crawl Cycle 1: Ingest raw items with full JSON payload & initial snapshots", async () => {
      crawlRoundRef.round = 1;
      const crawlRes = await fetch(`${gatewayUrl}/v1/trend-intel/crawl`, { method: "POST" });
      assert.equal(crawlRes.status, 200);
      const crawlData = await crawlRes.json();
      assert.ok(crawlData.count > 0, "Crawl count must be greater than 0");

      // Verify raw items in database via REST API
      const rawRes = await fetch(`${gatewayUrl}/v1/trend-intel/raw-items?limit=50`);
      assert.equal(rawRes.status, 200);
      const { items: rawItems } = await rawRes.json();
      assert.ok(rawItems.length > 0);

      // Verify 100% preservation of raw payload and standard schema
      for (const item of rawItems) {
        assert.ok(item.id, "Item must have id");
        assert.ok(item.platform, "Item must have platform");
        assert.ok(item.title, "Item must have title");
        assert.ok(typeof item.rank === "number", "Item must have numeric rank");
        assert.ok(item.raw, "Item must preserve raw JSON payload");
        assert.equal(typeof item.raw, "object", "raw should be an object");
      }

      // Check specific item
      const deepseekWb = rawItems.find(i => i.id === "weibo:wb-ds-1");
      assert.ok(deepseekWb, "DeepSeek Weibo item must exist in raw_items");
      assert.equal(deepseekWb.rank, 2); // 2nd item in array
    });

    // -------------------------------------------------------------------------
    // Step 3: Second Round Crawl (T1 Rank Velocity & State Progression)
    // -------------------------------------------------------------------------
    await t.test("3. Crawl Cycle 2: Calculate Velocity, Rank Acceleration & Trend States", async () => {
      crawlRoundRef.round = 2; // Switch mock to round 2 (DeepSeek jumps to rank #1)
      const crawlRes2 = await fetch(`${gatewayUrl}/v1/trend-intel/crawl`, { method: "POST" });
      assert.equal(crawlRes2.status, 200);

      // Check updated snapshots and velocity
      const rawRes2 = await fetch(`${gatewayUrl}/v1/trend-intel/raw-items?limit=50`);
      const { items: updatedItems } = await rawRes2.json();

      const deepseekWb2 = updatedItems.find(i => i.id === "weibo:wb-ds-1");
      assert.ok(deepseekWb2);
      assert.equal(deepseekWb2.rank, 1, "DeepSeek should now be rank 1 on Weibo");
      assert.equal(deepseekWb2.previous_rank, 2, "Previous rank should be 2");

      // Verify snapshots table contains both records
      const snaps = service.db.getItemSnapshots("weibo:wb-ds-1");
      assert.equal(snaps.length, 2, "Should have 2 historical snapshots for DeepSeek Weibo item");
      assert.equal(snaps[0].rank, 2);
      assert.equal(snaps[1].rank, 1);
    });

    // -------------------------------------------------------------------------
    // Step 4: Clustering, Dual Independent Scoring & Brief Generation
    // -------------------------------------------------------------------------
    await t.test("4. Engine: Event Clustering, Dual Scoring, and 5-Section Markdown Brief", async () => {
      const genRes = await fetch(`${gatewayUrl}/v1/trend-intel/generate-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-08-26" })
      });
      assert.equal(genRes.status, 200);
      const genData = await genRes.json();
      assert.ok(genData.brief, "Brief must be generated");
      assert.ok(Array.isArray(genData.events), "Events array must be returned");
      assert.ok(genData.events.length > 0);

      // 4.1 Check Cross-Platform Event Clustering
      const deepseekEvent = genData.events.find(e =>
        e.title.toLowerCase().includes("deepseek") || (e.summary && e.summary.toLowerCase().includes("deepseek"))
      );
      assert.ok(deepseekEvent, "Cross-platform DeepSeek event must be formed");
      assert.ok(deepseekEvent.platform_count >= 3, `DeepSeek event should aggregate across multiple platforms (got ${deepseekEvent.platform_count})`);
      assert.ok(deepseekEvent.platforms.includes("weibo"));
      assert.ok(deepseekEvent.platforms.includes("36kr"));

      // 4.2 Check Trend State & Velocity
      assert.ok(
        ["RAPID_RISING", "RISING", "NEW", "PEAK"].includes(deepseekEvent.trend_state),
        `DeepSeek trend state should be active (got ${deepseekEvent.trend_state})`
      );

      // 4.3 Check Dual Independent Scoring
      assert.ok(typeof deepseekEvent.world_importance_score === "number");
      assert.ok(typeof deepseekEvent.creator_value_score === "number");
      assert.ok(deepseekEvent.world_importance_score >= 1 && deepseekEvent.world_importance_score <= 10);
      assert.ok(deepseekEvent.creator_value_score >= 1 && deepseekEvent.creator_value_score <= 10);
      assert.ok(Array.isArray(deepseekEvent.creator_angles));
      assert.ok(deepseekEvent.creator_angles.length > 0, "High creator score event must have creator angles");

      // Verify Semiconductor event has high world importance score
      const semiEvent = genData.events.find(e =>
        e.title.includes("半导体") || e.title.includes("芯片")
      );
      assert.ok(semiEvent, "Semiconductor event must exist");
      assert.ok(semiEvent.world_importance_score >= 7.0, "Semiconductor event should have high world importance");

      // 4.4 Check 5-Section Markdown Brief Structure
      const markdown = genData.brief.markdown;
      assert.ok(markdown.includes("每日热点与趋势情报简报"), "Brief must have main title");
      assert.ok(markdown.includes("① 今天必须知道"), "Section 1: Must know must exist");
      assert.ok(markdown.includes("② 正在快速升温"), "Section 2: Rapid rising must exist");
      assert.ok(markdown.includes("③ 今天最值得做的内容"), "Section 3: Top creator ideas must exist");
      assert.ok(markdown.includes("④ 值得知道，但不一定做"), "Section 4: Background observations must exist");
      assert.ok(markdown.includes("⑤ 大众舆论讨论"), "Section 5: Public chatter must exist");

      // Verify Focus Columns contain user configured topic headings
      assert.ok(markdown.includes("AI 与大模型") || markdown.includes("重点赛道精选"), "Focus column must include topic selection");
    });

    // -------------------------------------------------------------------------
    // Step 5: Local Artifact File Exports
    // -------------------------------------------------------------------------
    await t.test("5. Local Exports: latest_brief.md, latest_events.json & archive directory", async () => {
      const latestBriefPath = path.join(dataDir, "latest_brief.md");
      const latestEventsPath = path.join(dataDir, "latest_events.json");
      const archiveBriefPath = path.join(dataDir, "archive", "2026-08-26_brief.md");
      const archiveEventsPath = path.join(dataDir, "archive", "2026-08-26_events.json");

      assert.ok(fs.existsSync(latestBriefPath), "latest_brief.md must exist on disk");
      assert.ok(fs.existsSync(latestEventsPath), "latest_events.json must exist on disk");
      assert.ok(fs.existsSync(archiveBriefPath), "archive brief.md must exist on disk");
      assert.ok(fs.existsSync(archiveEventsPath), "archive events.json must exist on disk");

      const briefContent = fs.readFileSync(latestBriefPath, "utf-8");
      assert.ok(briefContent.includes("每日热点与趋势情报简报"));
      assert.ok(briefContent.includes("2026-08-26"));

      const eventsJson = JSON.parse(fs.readFileSync(latestEventsPath, "utf-8"));
      assert.ok(Array.isArray(eventsJson));
      assert.ok(eventsJson.length > 0);
      assert.ok(eventsJson[0].event_id);
      assert.ok(eventsJson[0].world_importance_score !== undefined);
      assert.ok(eventsJson[0].creator_value_score !== undefined);
    });

    // -------------------------------------------------------------------------
    // Step 6: REST API Querying & History Verification
    // -------------------------------------------------------------------------
    await t.test("6. REST API: Query brief, filtered events, and single event history", async () => {
      // 6.1 GET /v1/trend-intel/brief
      const briefRes = await fetch(`${gatewayUrl}/v1/trend-intel/brief`);
      assert.equal(briefRes.status, 200);
      const briefBody = await briefRes.json();
      assert.equal(briefBody.date, "2026-08-26");
      assert.ok(briefBody.markdown.includes("① 今天必须知道"));

      // 6.2 GET /v1/trend-intel/events with filters
      const eventsRes = await fetch(`${gatewayUrl}/v1/trend-intel/events?min_creator_score=6.0&limit=5`);
      assert.equal(eventsRes.status, 200);
      const eventsBody = await eventsRes.json();
      const eventsList = eventsBody.events || eventsBody;
      assert.ok(Array.isArray(eventsList));
      for (const evt of eventsList) {
        assert.ok(evt.creator_value_score >= 6.0);
      }

      // 6.3 GET /v1/trend-intel/events/:id/history
      const firstEvent = eventsList[0];
      const historyRes = await fetch(`${gatewayUrl}/v1/trend-intel/events/${firstEvent.event_id}/history`);
      assert.equal(historyRes.status, 200);
      const historyBody = await historyRes.json();
      assert.equal(historyBody.event.event_id, firstEvent.event_id);
      assert.ok(Array.isArray(historyBody.snapshots));
      assert.ok(historyBody.snapshots.length > 0, "Event must have associated rank snapshots");
    });

    // -------------------------------------------------------------------------
    // Step 7: Agent Skill CLI Verification & Offline Fallback
    // -------------------------------------------------------------------------
    await t.test("7. Skill CLI: Live execution via gateway and graceful offline fallback", async () => {
      const scriptPath = path.resolve("lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs");
      assert.ok(fs.existsSync(scriptPath), "leo_trend_intel.mjs script must exist");

      // 7.1 CLI --status (Live Gateway)
      const { stdout: statusLive } = await execFileAsync(process.execPath, [
        scriptPath,
        "--status",
        "--gateway-url",
        gatewayUrl,
        "--data-dir",
        dataDir
      ]);
      assert.ok(statusLive.includes("Trend Intelligence 运行状态诊断"));
      assert.ok(statusLive.includes("在线 (已连接)"));
      assert.ok(statusLive.includes("latest_brief.md"));

      // 7.2 CLI --brief (Live Gateway)
      const { stdout: briefLive } = await execFileAsync(process.execPath, [
        scriptPath,
        "--brief",
        "--gateway-url",
        gatewayUrl,
        "--data-dir",
        dataDir
      ]);
      assert.ok(briefLive.includes("每日热点与趋势情报简报"));
      assert.ok(briefLive.includes("① 今天必须知道"));

      // 7.3 CLI --events (Live Gateway)
      const { stdout: eventsLive } = await execFileAsync(process.execPath, [
        scriptPath,
        "--events",
        "--gateway-url",
        gatewayUrl,
        "--data-dir",
        dataDir
      ]);
      assert.ok(eventsLive.includes("全网聚类热点事件"));
      assert.ok(eventsLive.includes("世界重要性"));
      assert.ok(eventsLive.includes("创作者价值"));

      // 7.4 CLI --events --format json (Live Gateway)
      const { stdout: jsonEventsLive } = await execFileAsync(process.execPath, [
        scriptPath,
        "--events",
        "--format",
        "json",
        "--gateway-url",
        gatewayUrl,
        "--data-dir",
        dataDir
      ]);
      const parsedJsonEvents = JSON.parse(jsonEventsLive);
      assert.ok(Array.isArray(parsedJsonEvents));
      assert.ok(parsedJsonEvents.length > 0);

      // 7.5 CLI Offline Fallback (Point to closed/invalid port, verify reading local files)
      const offlineUrl = "http://127.0.0.1:59997";
      const { stdout: briefOffline } = await execFileAsync(process.execPath, [
        scriptPath,
        "--brief",
        "--gateway-url",
        offlineUrl,
        "--data-dir",
        dataDir
      ]);
      assert.ok(briefOffline.includes("每日热点与趋势情报简报"), "Offline CLI must read fallback brief");

      const { stdout: eventsOffline } = await execFileAsync(process.execPath, [
        scriptPath,
        "--events",
        "--gateway-url",
        offlineUrl,
        "--data-dir",
        dataDir
      ]);
      assert.ok(eventsOffline.includes("全网聚类热点事件"), "Offline CLI must read fallback events");
      assert.ok(eventsOffline.includes("latest_events.json"));
    });

  } finally {
    server.close();
    service.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
