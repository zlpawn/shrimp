# 基于 TrendRadar 的个人热点情报系统 (Trend Intelligence) 技术设计规格说明书

**日期**：2026-08-26  
**版本**：v1.0.0 (Phase 1 MVP)  
**分支**：`feat/trendradar-intelligence`  
**状态**：设计评审中 (In Review)  

---

## 一、 背景与定位

### 1.1 背景与核心痛点
用户为自媒体创作者，本地已有大模型 Agent（如 Claude Code / Codex / Antigravity）。用户当前不缺 AI 推理与写作能力，真正缺少的是**持续、稳定、结构化、具备时序分析的互联网全网热点数据**。

### 1.2 两个同等重要的核心目标
* **目标 A：服务自媒体创作（Creator Value）**
  * 发现全网正在升温、跨平台传播的热点。
  * 挖掘反常识、信息差与认知差。
  * 判定当前时效窗口（早期 / 爆发 / 见顶 / 偏晚），提供 2~3 个具体切入角度与内容大纲建议。
* **目标 B：帮助用户理解世界（World Importance）**
  * 广泛覆盖国际政治、全球经济、商业、前沿科技、地缘、宏观政策、重要科学等领域。
  * 拒绝信息茧房，保持宽进严出，保障宏观认知视野。

### 1.3 独立双评分体系（彻底解耦）
* **`World Importance Score`（世界重要性 1~10）**：衡量事件对理解世界、全球走势、历史和行业发展的重要性。
* **`Creator Value Score`（内容价值 1~10）**：衡量事件对自媒体爆款生产、情绪共鸣、认知差及表达空间的价值。

---

## 二、 第一期范围与架构边界

### 2.1 明确边界（第一期不做）
1. **单一数据源体系**：数据源仅使用 TrendRadar 支持的源（NewsNow API + RSS），不自写微博/知乎/抖音爬虫。
2. **不拓展其他独立平台**：暂不接入 X、Reddit、小红书、YouTube、Google Trends（预留 Provider 接口留待二期）。
3. **轻量化原则**：不引入重量级向量数据库，不修改 TrendRadar Python 原版，将其数据抓取逻辑直接用原生 Node.js 进行高效无依赖移植。
4. **高内聚可拆分**：前端、后端、数据库、配置完全自包含，未来可零改动独立抽取为独立开源项目。

---

## 三、 系统整体架构设计

```text
               ┌────────────────────────────────────────────────────────┐
               │              数据采集源 (Data Provider)               │
               │   • NewsNow API (微博/知乎/百度/抖音/B站/头条/36氪等)   │
               │   • RSS Feeds (科技/全球新闻/宏观经济)                  │
               └──────────────────────────┬─────────────────────────────┘
                                          │ 原生 Fetch (自动继承网关代理)
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │         TrendRadar Provider & Normalizer 层            │
               │   • 统一标准 Schema 转换                                │
               │   • 100% 完整保留原始 JSON (`raw` 字段)                 │
               └──────────────────────────┬─────────────────────────────┘
                                          │ 写入 / 更新
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │         独立存储层 (`trend-intel.db` SQLite)           │
               │   • raw_items (当前最新条目)                            │
               │   • snapshots (时序排名变化快照：09:00#28 -> 10:00#2)  │
               │   • events (跨平台聚类事件)                            │
               │   • daily_briefs (每日情报历史归档)                     │
               └──────────────────────────┬─────────────────────────────┘
                                          │
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │           趋势分析引擎 (Trend Engine)                  │
               │   • 排名速度与加速度计算 (Velocity)                     │
               │   • 状态判定 (NEW / RISING / RAPID_RISING / PEAK...)    │
               │   • 跨平台事件去重与聚类 (Event Graph)                 │
               │   • 批量双维度初评 (World & Creator Scores)             │
               └──────────────┬───────────────────────────┬─────────────┘
                              │                           │
              ┌───────────────┴───────────────┐           │ 标准导出
              ▼                               ▼           ▼
   【 Web UI 扩展 Tab 】          【 网关 REST API 】   【 标准文件落盘 】
   • 今日简报卡片看板             • GET /v1/.../brief   • `latest_brief.md`
   • 实时升温事件流               • GET /v1/.../events  • `latest_events.json`
   • 3级模型级联选择              • POST /v1/.../crawl  • `archive/YYYY-MM-DD/`
   • 调度与代理配置               • POST /v1/.../refresh         │
                                                                 │
                                                                 ▼
                                                  【 Agent Skill (方法论) 】
                                                  • 优先调 REST API
                                                  • 离线降级读落盘文件
                                                  • 6+4 深度自媒体选题输出
```

---

## 四、 核心数据模型与 Schema 设计

### 4.1 统一条目模型 (Standard Item Schema)
```json
{
  "id": "trend_weibo_123456",
  "source": "trendradar",
  "platform": "weibo",
  "country": "CN",
  "language": "zh",
  "type": "hotlist",
  "title": "某科技突发事件发布",
  "url": "https://s.weibo.com/...",
  "rank": 3,
  "previous_rank": 15,
  "velocity": "+12 ranks/hr",
  "score": 1250000,
  "first_seen_at": "2026-08-26T08:00:00Z",
  "last_seen_at": "2026-08-26T10:00:00Z",
  "collected_at": "2026-08-26T10:00:00Z",
  "raw": {}
}
```

### 4.2 时序快照表 (`snapshots`)
用于精准捕捉事件的爆发速度与衰退拐点：
```sql
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    rank INTEGER NOT NULL,
    score REAL,
    recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_item_time ON snapshots(item_id, recorded_at);
```

### 4.3 聚类事件表 (`events`)
将跨平台的相同讨论归并为单一事件：
```sql
CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    platforms TEXT NOT NULL,         -- JSON array: ["weibo", "zhihu", "baidu"]
    platform_count INTEGER NOT NULL,
    trend_state TEXT NOT NULL,       -- NEW, RISING, RAPID_RISING, PEAK, DECLINING, DEAD
    velocity REAL NOT NULL,
    world_importance_score REAL,     -- 1.0 - 10.0
    creator_value_score REAL,        -- 1.0 - 10.0
    creator_angles TEXT,             -- JSON array: ["角度1", "角度2"]
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

## 五、 模块与功能详细设计

### 5.1 数据采集与适配层 (`lib/trend-intel/providers/`)
* **`newsnow.mjs`**：实现针对 NewsNow API 的抓取，支持超时、重试、错误兜底以及批量并发控制；
* **`rss.mjs`**：原生轻量 XML/RSS 解析器，拉取订阅新闻；
* **`platforms.mjs`**：包含全平台配置（微博、知乎、百度、抖音、B站、头条、GitHub、36氪、华尔街见闻等）；
* **`proxy-helper.mjs`**：读取网关现有 `https-proxy-agent` / `socks-proxy-agent` 与环境代理。

### 5.2 存储与路径解析策略 (`lib/trend-intel/storage/`)
* **自适应数据根路径 (`resolveDataDir`)**：
  1. 用户显式设置（Web 面板配置或 `TREND_INTEL_DATA_DIR`）；
  2. 源码开发环境：`./output/trend-intel/`；
  3. 全局 npm 安装环境：`~/.shrimp/trend-intel/`。
* **文件落盘与归档**：
  * 每次调度生成后，自动将最新简报同步写入 `latest_brief.md` 与 `latest_events.json`；
  * 按日期在 `archive/` 目录下保留历史副本。

### 5.3 趋势计算与智能分析引擎 (`lib/trend-intel/engine/`)
* **`trend-calculator.mjs`**：基于时序快照比对计算排名变化速率，判定生命周期（RAPID_RISING / PEAK / DEAD 等）；
* **`cluster.mjs`**：文本相似度初筛 + 网关模型智能聚类，生成跨平台事件；
* **`scorer.mjs`**：调用网关所选模型，完成 World Importance & Creator Value 双评分，输出 6+4 思考切入点；
* **`brief-generator.mjs`**：组装《每日世界与内容情报》5 大板块 Markdown 报告。

### 5.4 前端界面设计 (`desktop/src/modules/trend-intel.ts` & `desktop/index.html`)
* **导航入口**：左侧“系统扩展”分组下新增 `热点情报 (Trend Radar)`；
* **三大视图板块**：
  1. **今日简报 (Daily Brief)**：以结构化卡片展示 5 大板块，支持一键复制 Markdown 或导出；
  2. **事件大盘 (Event Explorer)**：展示聚类事件列表，包含各平台热度标签、时序排名跳变折线/走势、双评分 Badge；
  3. **系统设置 (Settings)**：
     * **调度周期**：开关与间隔（15m / 30m / 1h / 自定义 Cron）；
     * **平台源开关**：多选框勾选启用平台，支持添加自定义 RSS；
     * **三级模型路由**：`客户端 (Client)` ➔ `端点 (Endpoint)` ➔ `模型 (Model)` 级联选择；
     * **网络代理**：`跟随系统代理` / `直连` / `独立配置`；
     * **导出路径**：自定义文件输出目录。

### 5.5 Agent Skill 接入设计 (`lib/skills/trend-intelligence/`)
* **技能定义**：`SKILL.md`（包含分析员角色定义、6+4 思考框架、双评分规则、简报模版）；
* **双模调用**：
  * 模式 1（优先）：调用 `http://127.0.0.1:8787/v1/trend-intel/brief`；
  * 模式 2（降级）：直接读取 `./output/trend-intel/latest_brief.md` 或 `~/.shrimp/trend-intel/latest_brief.md`；
* **网关集成**：可在网关“预置技能”页面一键安装至本地 Agent。

---

## 六、 接口定义 (REST API)

| 方法 | 路径 | 描述 |
| :--- | :--- | :--- |
| `GET` | `/v1/trend-intel/brief` | 获取最新生成的《每日世界与内容情报》及结构化数据 |
| `GET` | `/v1/trend-intel/events` | 查询聚类事件列表（支持 `?state=&min_score=&limit=`） |
| `GET` | `/v1/trend-intel/events/:id/history` | 查询单个事件在各平台的时序排名快照历史 |
| `POST` | `/v1/trend-intel/crawl` | 立即触发一次全网数据抓取 |
| `POST` | `/v1/trend-intel/generate-brief` | 立即调用模型执行聚类、打分并重新生成简报 |
| `GET` | `/v1/trend-intel/config` | 读取当前模块配置 |
| `PUT` | `/v1/trend-intel/config` | 更新调度、平台开关、模型路由与代理配置 |

---

## 七、 实施与验证计划

### 7.1 自动化测试
* **单元测试**：
  * `tests/unit/trend-intel-fetcher.test.mjs`：测试 NewsNow & RSS 抓取与异常兜底；
  * `tests/unit/trend-intel-calculator.test.mjs`：测试时序快照与 Velocity 状态机计算；
  * `tests/unit/trend-intel-store.test.mjs`：测试 SQLite 读写与文件落盘；
* **集成测试**：
  * `tests/integration/trend-intel-api.test.mjs`：测试全链路 HTTP 接口响应与降级机制。

### 7.2 手动全链路验证
1. 启动网关服务，在前端打开“热点情报”Tab，验证平台配置与三级模型选择联动；
2. 执行抓取，查看快照数据落盘与时序排名曲线；
3. 触发生成简报，验证 5 大板块输出与 World/Creator 双评分；
4. 验证本地文件导出路径（`./output/trend-intel/latest_brief.md`）；
5. 模拟本地 Agent 载入 Skill，验证 Agent 能成功调取数据并输出自媒体选题建议。
