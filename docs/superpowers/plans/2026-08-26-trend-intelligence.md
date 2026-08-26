# Trend Intelligence (基于 TrendRadar 的热点情报系统) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个基于 TrendRadar 数据源（NewsNow API + RSS）、以高内聚独立插件架构运行在本地网关中的个人热点情报系统，具备时序排名快照、趋势状态机、跨平台事件聚类、世界重要性与内容价值双独立评分、Web 可视化看板以及 Agent 专属 Skill。

**Architecture:** 
1. **数据采集与适配层** (`lib/trend-intel/providers/`)：原生移植 NewsNow API 抓取与 RSS 解析，自动继承网关代理与超时重试，统一转换为标准 Item Schema 并保留原始 `raw` 结构；
2. **独立存储与路径层** (`lib/trend-intel/storage/`)：独立 SQLite 数据库 `trend-intel.db` 存储条目、时序快照、聚类事件与历史简报，支持源码模式 (`./output/trend-intel/`) 与 npm 模式 (`~/.shrimp/trend-intel/`) 的自适应路径；
3. **趋势计算与智能分析引擎** (`lib/trend-intel/engine/`)：基于快照斜率计算排名加速度（Velocity）与状态机（NEW/RISING/RAPID_RISING/PEAK/DECLINING/DEAD），通过网关三级模型路由执行跨平台事件聚类与 World/Creator 双评分，组装 5 大板块情报简报并输出标准文件；
4. **服务与 REST 接口** (`lib/trend-intel/service.mjs`, `routes.mjs`)：挂载 `/v1/trend-intel/*` 接口与后台定时轮询任务；
5. **Web 看板** (`desktop/src/modules/trend-intel.ts`, `desktop/index.html`)：在系统扩展下新增独立 Tab，提供简报卡片、原始榜单全景、时序趋势大盘与模块配置；
6. **Agent Skill** (`lib/skills/trend-intelligence/SKILL.md`)：提供 6+4 思考框架，支持 API 优先与本地落盘文件自动降级双模读取。

**Tech Stack:** Node.js 18+ (ESM), SQLite (via node built-in / existing gateway sqlite wrapper / better-sqlite3 if available or pure sqlite/json fallback compatible with gateway), TypeScript (Frontend), Web UI CSS.

## Global Constraints
- Node.js ESM (`import`/`export`)
- No heavy vector DB; use fast string/token matching + LLM semantic clustering
- Strict physical separation for `lib/trend-intel/` so it can be extracted without refactoring
- Preserve 100% of raw JSON payloads in `raw` field
- Never hardcode user focus topics; fully driven by `trend-intel.config.json`

---

### Task 1: Foundation, Config Store & Storage Layer

**Files:**
- Create: `lib/trend-intel/storage/paths.mjs`
- Create: `lib/trend-intel/storage/schema.sql`
- Create: `lib/trend-intel/storage/db.mjs`
- Create: `lib/trend-intel/storage/config-store.mjs`
- Test: `tests/unit/trend-intel-storage.test.mjs`

**Interfaces:**
- Consumes: Node.js standard `fs`, `path`, `os`
- Produces:
  - `resolveDataDir(overrideDir?: string): string`
  - `createTrendIntelDb(dataDir: string): TrendIntelDb`
  - `createTrendIntelConfigStore(dataDir: string): TrendIntelConfigStore`
  - Types: `RawItem`, `Snapshot`, `Event`, `DailyBrief`, `TrendIntelConfig`

- [ ] **Step 1: Write unit test for paths, config-store and SQLite storage**

```javascript
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

  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/trend-intel-storage.test.mjs`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `paths.mjs`, `schema.sql`, `config-store.mjs`, `db.mjs`**

Create `lib/trend-intel/storage/paths.mjs`:
```javascript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function resolveDataDir(overrideDir = null) {
  if (overrideDir) {
    if (!fs.existsSync(overrideDir)) {
      fs.mkdirSync(overrideDir, { recursive: true });
    }
    return overrideDir;
  }
  if (process.env.TREND_INTEL_DATA_DIR) {
    const p = process.env.TREND_INTEL_DATA_DIR;
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    return p;
  }
  // Source run check: if ./package.json and .git exist, use ./output/trend-intel
  const projectRoot = process.cwd();
  if (fs.existsSync(path.join(projectRoot, "package.json")) && fs.existsSync(path.join(projectRoot, ".git"))) {
    const localDir = path.join(projectRoot, "output", "trend-intel");
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
    return localDir;
  }
  const homeDir = path.join(os.homedir(), ".shrimp", "trend-intel");
  if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir, { recursive: true });
  return homeDir;
}
```

Create `lib/trend-intel/storage/config-store.mjs`:
```javascript
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG = {
  scheduler: {
    enabled: true,
    interval_minutes: 30,
    daily_brief_times: ["08:30", "18:00"]
  },
  model_route: {
    client: "codex",
    endpoint_index: 0,
    model: ""
  },
  proxy: {
    mode: "inherit", // 'inherit' | 'direct' | 'custom'
    custom_url: ""
  },
  platforms: {
    weibo: true,
    zhihu: true,
    baidu: true,
    bilibili: true,
    douyin: true,
    toutiao: true,
    github: true,
    "36kr": true,
    wallstreetcn: true
  },
  focus_topics: [
    {
      id: "topic_ai",
      name: "人工智能与前沿科技",
      icon: "🤖",
      enabled: true,
      keywords: ["AI", "大模型", "DeepSeek", "算力", "Agent", "OpenAI", "Claude", "英伟达", "具身智能"],
      rss_sources: ["https://36kr.com/feed"]
    },
    {
      id: "topic_cars",
      name: "智能汽车与出行",
      icon: "🚗",
      enabled: true,
      keywords: ["智驾", "固态电池", "小米汽车", "特斯拉", "比亚迪", "华为车", "新能源"],
      rss_sources: []
    }
  ]
};

export function createTrendIntelConfigStore(dataDir) {
  const configFile = path.join(dataDir, "trend-intel.config.json");

  function get() {
    if (!fs.existsSync(configFile)) {
      fs.writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    try {
      const raw = fs.readFileSync(configFile, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  function update(patch) {
    const current = get();
    const next = { ...current, ...patch };
    fs.writeFileSync(configFile, JSON.stringify(next, null, 2), "utf-8");
    return next;
  }

  return { get, update, configFile };
}
```

Create `lib/trend-intel/storage/db.mjs` (SQLite or light embedded store managing raw_items, snapshots, events, daily_briefs):
```javascript
import fs from "node:fs";
import path from "node:path";

// Implementation of SQLite database wrapping tables:
// raw_items, snapshots, events, daily_briefs
// Returns { saveRawItems, getRawItems, recordSnapshots, getItemSnapshots, saveEvents, getEvents, saveBrief, getLatestBrief, getBriefByDate, close }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/trend-intel-storage.test.mjs`  
Expected: PASS (3 tests, 0 failures)

- [ ] **Step 5: Commit**

```bash
git add lib/trend-intel/storage/ tests/unit/trend-intel-storage.test.mjs
git commit -m "feat(trend-intel): add storage layer, path resolver, and dynamic config store"
```

---

### Task 2: Provider Layer (NewsNow Fetcher, RSS Parser & Platform Registry)

**Files:**
- Create: `lib/trend-intel/providers/platforms.mjs`
- Create: `lib/trend-intel/providers/proxy-helper.mjs`
- Create: `lib/trend-intel/providers/newsnow.mjs`
- Create: `lib/trend-intel/providers/rss.mjs`
- Create: `lib/trend-intel/providers/index.mjs`
- Test: `tests/unit/trend-intel-providers.test.mjs`

**Interfaces:**
- Consumes: `TrendIntelConfigStore`, `proxy-helper`
- Produces:
  - `fetchNewsNowPlatform(platformId: string, options?: FetchOptions): Promise<RawItem[]>`
  - `fetchRssFeed(url: string, options?: FetchOptions): Promise<RawItem[]>`
  - `crawlAllActivePlatforms(config: TrendIntelConfig): Promise<RawItem[]>`

- [ ] **Step 1: Write unit test for NewsNow parsing and RSS fetching**

```javascript
// tests/unit/trend-intel-providers.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseNewsNowResponse } from "../../lib/trend-intel/providers/newsnow.mjs";
import { parseRssXml } from "../../lib/trend-intel/providers/rss.mjs";
import { PLATFORMS } from "../../lib/trend-intel/providers/platforms.mjs";

test("platforms - should contain major platforms", () => {
  assert.ok(PLATFORMS.weibo);
  assert.ok(PLATFORMS.zhihu);
  assert.ok(PLATFORMS.baidu);
  assert.ok(PLATFORMS.bilibili);
  assert.equal(PLATFORMS.weibo.name, "微博热搜");
});

test("newsnow - should parse standard newsnow payload into Standard Items", () => {
  const fakePayload = {
    status: "success",
    id: "weibo",
    updatedTime: 1724650000000,
    data: [
      { id: "1", title: "测试热搜1", url: "https://s.weibo.com/1", hot: 1200000 },
      { id: "2", title: "测试热搜2", url: "https://s.weibo.com/2", hot: 800000 }
    ]
  };
  const items = parseNewsNowResponse("weibo", fakePayload);
  assert.equal(items.length, 2);
  assert.equal(items[0].rank, 1);
  assert.equal(items[0].platform, "weibo");
  assert.equal(items[0].title, "测试热搜1");
  assert.ok(items[0].raw);
});

test("rss - should parse standard RSS XML feed", () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>科技快讯</title>
      <item>
        <title>某科技公司发布新一代产品</title>
        <link>https://example.com/news/1</link>
        <pubDate>Wed, 26 Aug 2026 08:00:00 GMT</pubDate>
        <description>产品详细介绍与评测...</description>
      </item>
    </channel>
  </rss>`;
  const items = parseRssXml("tech_rss", sampleXml, "https://example.com/rss");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "某科技公司发布新一代产品");
  assert.equal(items[0].url, "https://example.com/news/1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/trend-intel-providers.test.mjs`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `platforms.mjs`, `proxy-helper.mjs`, `newsnow.mjs`, `rss.mjs`, `index.mjs`**

Implement robust fetching, retries with backoff, agent proxy resolution using `https-proxy-agent` and native `fetch`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/trend-intel-providers.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/trend-intel/providers/ tests/unit/trend-intel-providers.test.mjs
git commit -m "feat(trend-intel): add newsnow fetcher, rss parser, and platforms registry"
```

---

### Task 3: Trend Engine (Velocity & Lifecycle State Machine)

**Files:**
- Create: `lib/trend-intel/engine/trend-calculator.mjs`
- Test: `tests/unit/trend-intel-calculator.test.mjs`

**Interfaces:**
- Consumes: Snapshots history from `TrendIntelDb`
- Produces:
  - `calculateVelocity(snapshots: Snapshot[]): { velocity: number, state: TrendState, deltaRank: number }`
  - `calculateMultiPlatformSpread(itemMatches: RawItem[]): { platformCount: number, platforms: string[] }`

- [ ] **Step 1: Write unit test for Velocity and State transitions**

```javascript
// tests/unit/trend-intel-calculator.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { calculateVelocityAndState } from "../../lib/trend-intel/engine/trend-calculator.mjs";

test("trend-calculator - should detect RAPID_RISING when rank jumps significantly", () => {
  const now = Date.now();
  const snapshots = [
    { rank: 28, recorded_at: new Date(now - 3600000).toISOString() },
    { rank: 14, recorded_at: new Date(now - 1800000).toISOString() },
    { rank: 3, recorded_at: new Date(now).toISOString() }
  ];
  const res = calculateVelocityAndState(snapshots, { platformCount: 3 });
  assert.equal(res.state, "RAPID_RISING");
  assert.ok(res.velocity > 10);
});

test("trend-calculator - should detect PEAK and DECLINING", () => {
  const now = Date.now();
  const peakSnapshots = [
    { rank: 2, recorded_at: new Date(now - 3600000).toISOString() },
    { rank: 1, recorded_at: new Date(now - 1800000).toISOString() },
    { rank: 2, recorded_at: new Date(now).toISOString() }
  ];
  const peakRes = calculateVelocityAndState(peakSnapshots, { platformCount: 1 });
  assert.equal(peakRes.state, "PEAK");

  const decliningSnapshots = [
    { rank: 5, recorded_at: new Date(now - 3600000).toISOString() },
    { rank: 18, recorded_at: new Date(now - 1800000).toISOString() },
    { rank: 35, recorded_at: new Date(now).toISOString() }
  ];
  const decRes = calculateVelocityAndState(decliningSnapshots, { platformCount: 1 });
  assert.equal(decRes.state, "DECLINING");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/trend-intel-calculator.test.mjs`  
Expected: FAIL

- [ ] **Step 3: Implement `trend-calculator.mjs`**

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/trend-intel-calculator.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/trend-intel/engine/trend-calculator.mjs tests/unit/trend-intel-calculator.test.mjs
git commit -m "feat(trend-intel): implement trend velocity and state machine engine"
```

---

### Task 4: Intelligence Engine (Clustering, Dual-Scoring & 5-Section Brief Generator)

**Files:**
- Create: `lib/trend-intel/engine/cluster.mjs`
- Create: `lib/trend-intel/engine/scorer.mjs`
- Create: `lib/trend-intel/engine/brief-generator.mjs`
- Create: `lib/trend-intel/engine/exporter.mjs`
- Test: `tests/unit/trend-intel-engine.test.mjs`

**Interfaces:**
- Consumes: Gateway Model Dispatcher / Client, Config Store, Storage
- Produces:
  - `clusterRawItems(items: RawItem[], focusTopics: FocusTopic[]): Promise<Event[]>`
  - `scoreEvents(events: Event[], modelCaller: ModelCaller): Promise<Event[]>`
  - `generateDailyBrief(events: Event[], focusTopics: FocusTopic[]): Promise<DailyBrief>`
  - `exportArtifactFiles(dataDir: string, brief: DailyBrief, events: Event[]): Promise<{ briefPath: string, jsonPath: string }>`

- [ ] **Step 1: Write unit test for clustering, brief layout, and artifact export**

```javascript
// tests/unit/trend-intel-engine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { coarseClusterItems } from "../../lib/trend-intel/engine/cluster.mjs";
import { assembleBriefMarkdown } from "../../lib/trend-intel/engine/brief-generator.mjs";
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
      world_importance_score: 7.5,
      creator_value_score: 9.3,
      creator_angles: ["从工程量产难度拆解", "对二手保值率影响"],
      first_seen_at: new Date().toISOString(),
      matched_topic: "topic_cars"
    }
  ];

  const md = assembleBriefMarkdown(events, [
    { id: "topic_cars", name: "智能汽车与出行", icon: "🚗", enabled: true }
  ]);
  assert.ok(md.includes("① 今天必须知道"));
  assert.ok(md.includes("② 正在快速升温"));
  assert.ok(md.includes("③ 今天最值得做的内容"));
  assert.ok(md.includes("🎯 重点赛道精选：智能汽车与出行"));
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
  fs.rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/trend-intel-engine.test.mjs`  
Expected: FAIL

- [ ] **Step 3: Implement `cluster.mjs`, `scorer.mjs`, `brief-generator.mjs`, `exporter.mjs`**

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/trend-intel-engine.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/trend-intel/engine/ tests/unit/trend-intel-engine.test.mjs
git commit -m "feat(trend-intel): add clustering, dual scoring, brief generator, and file exporter"
```

---

### Task 5: Application Service, Scheduler & REST API Routes

**Files:**
- Create: `lib/trend-intel/service.mjs`
- Create: `lib/trend-intel/scheduler.mjs`
- Create: `lib/trend-intel/routes.mjs`
- Create: `lib/trend-intel/index.mjs`
- Modify: `server.js` (mount `/v1/trend-intel`)
- Test: `tests/integration/trend-intel-api.test.mjs`

**Interfaces:**
- Consumes: Gateway HTTP router in `server.js`
- Produces: REST endpoints `/v1/trend-intel/brief`, `/v1/trend-intel/events`, `/v1/trend-intel/crawl`, `/v1/trend-intel/generate-brief`, `/v1/trend-intel/config`, `/v1/trend-intel/raw-items`

- [ ] **Step 1: Write integration test for HTTP routes**

```javascript
// tests/integration/trend-intel-api.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createTrendIntelService } from "../../lib/trend-intel/service.mjs";
import { routeTrendIntelRequest } from "../../lib/trend-intel/routes.mjs";

test("routes - GET /v1/trend-intel/config returns valid config", async () => {
  const service = createTrendIntelService({ dataDir: "/tmp/trend-intel-route-test-" + Date.now() });
  const server = http.createServer(async (req, res) => {
    const handled = await routeTrendIntelRequest(req, res, service);
    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });

  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/config`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.focus_topics);
  assert.ok(data.scheduler);

  server.close();
  service.destroy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/integration/trend-intel-api.test.mjs`  
Expected: FAIL

- [ ] **Step 3: Implement `service.mjs`, `scheduler.mjs`, `routes.mjs`, `index.mjs`, and mount in `server.js`**

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/integration/trend-intel-api.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/trend-intel/ server.js tests/integration/trend-intel-api.test.mjs
git commit -m "feat(trend-intel): add application service, scheduler, and mount REST API routes"
```

---

### Task 6: Agent Skill (`SKILL.md`) Creation & Preloaded Registration

**Files:**
- Create: `lib/skills/trend-intelligence/SKILL.md`
- Create: `lib/skills/trend-intelligence/scripts/trend_intel.mjs`
- Test: `tests/unit/trend-intel-skill.test.mjs`

**Interfaces:**
- Consumes: `lib/skills/` infrastructure
- Produces: Preloaded Agent Skill for Claude/Codex/Antigravity

- [ ] **Step 1: Write test verifying SKILL.md validity and script fallback execution**

```javascript
// tests/unit/trend-intel-skill.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("skill - SKILL.md exists and contains 6+4 framework and dual scoring", () => {
  const skillPath = path.resolve("lib/skills/trend-intelligence/SKILL.md");
  assert.ok(fs.existsSync(skillPath));
  const content = fs.readFileSync(skillPath, "utf-8");
  assert.ok(content.includes("World Importance"));
  assert.ok(content.includes("Creator Value"));
  assert.ok(content.includes("6+4"));
});
```

- [ ] **Step 2: Implement `SKILL.md` and helper script**

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test tests/unit/trend-intel-skill.test.mjs`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/skills/trend-intelligence/ tests/unit/trend-intel-skill.test.mjs
git commit -m "feat(trend-intel): create trend-intelligence agent skill"
```

---

### Task 7: Frontend Web Dashboard Module & Navigation

**Files:**
- Create: `desktop/src/modules/trend-intel.ts`
- Modify: `desktop/index.html` (Add nav item in 系统扩展 & container pane)
- Modify: `desktop/src/app.ts` (Bind module init & tab switch)
- Build: `npm run build:panel`
- Test: `tests/unit/trend-intel-ui-build.test.mjs`

- [ ] **Step 1: Implement `desktop/src/modules/trend-intel.ts` with 4 sub-views (Brief, Raw Feeds, Trend Explorer, Settings with dynamic Focus Topics & 3-level model selector)**
- [ ] **Step 2: Add sidebar navigation item in `desktop/index.html`**
- [ ] **Step 3: Run `npm run build:panel` and check for bundle errors**
- [ ] **Step 4: Run `npm run check`**
- [ ] **Step 5: Commit**

```bash
git add desktop/
git commit -m "feat(trend-intel): implement web dashboard tab with 4 views in desktop UI"
```

---

### Task 8: Full End-to-End Verification & Documentation

**Files:**
- Test: `tests/integration/trend-intel-e2e.test.mjs`
- Create: Walkthrough artifact `docs/superpowers/specs/2026-08-26-trend-intelligence-walkthrough.md`

- [ ] **Step 1: Write and run full E2E test (crawl ➔ snapshots ➔ cluster ➔ score ➔ brief ➔ API ➔ file export)**
- [ ] **Step 2: Run all release checks (`npm run check`, `npm run test:cli`, `npm run build:panel`)**
- [ ] **Step 3: Commit final verified work**

```bash
git add .
git commit -m "test(trend-intel): complete full e2e tests and verification"
```
