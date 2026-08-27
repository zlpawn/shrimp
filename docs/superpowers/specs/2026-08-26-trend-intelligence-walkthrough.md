# Trend Intelligence (个人热点情报系统) 全模块技术规格与实操指南

> **版本**：v1.0.0 (Phase 1 MVP)  
> **日期**：2026-08-26  
> **分支**：`feat/trendradar-intelligence`  
> **适用对象**：自媒体创作者、内容团队、AI Agent 开发者、系统运维与架构师

---

## 1. 概述与核心价值

**Trend Intelligence** 是集成于 Shrimp 本地 AI 网关中的个人热点与全网趋势情报中枢。

### 1.1 核心痛点与定位
本地大模型 Agent（如 Claude Code / Codex / Antigravity）具备极高的写作与深度逻辑推理能力，但传统工作流中缺少**持续、稳定、多源、结构化且具备时序加速度分析的互联网热点数据**。

Trend Intelligence 为创作者与决策者提供：
1. **服务自媒体创作（Creator Value）**：
   - 捕捉全网正在升温与跨平台扩散的趋势（多平台聚类 + 时序排名加速度）。
   - 挖掘反常识、信息差与认知差。
   - 评估当前时效窗口（爆发期 / 见顶 / 偏晚），自动输出 2~3 个具体切入角度与大纲框架。
2. **辅助宏观世界认知（World Importance）**：
   - 覆盖国际政治、全球经济、前沿科技、宏观政策与关键产业。
   - 拒绝单一信息茧房，保持宽进严出。
3. **彻底解耦的双评分体系**：
   - **`World Importance Score`（世界重要性 1~10 分）**：客观衡量事件对行业历史与世界大势的影响力。
   - **`Creator Value Score`（内容价值 1~10 分）**：衡量事件对自媒体爆款生产、受众情绪共鸣与创作表达空间的价值。

---

## 2. 系统全景架构设计

```text
               ┌────────────────────────────────────────────────────────┐
               │              数据采集源 (Data Provider)               │
               │   • NewsNow API (微博/知乎/百度/抖音/B站/头条/36氪等)   │
               │   • RSS Feeds (前沿科技/全球新闻/宏观经济)             │
               └──────────────────────────┬─────────────────────────────┘
                                          │ 原生 Fetch (自动继承网关代理)
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │         TrendRadar Provider & Normalizer 层            │
               │   • 统一标准 Schema 转换 (`id`, `platform`, `rank`...) │
               │   • 100% 完整保留原始 JSON (`raw` 字段)                 │
               └──────────────────────────┬─────────────────────────────┘
                                          │ 写入 / 更新
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │         独立存储层 (`trend-intel.db` SQLite)           │
               │   • raw_items (当前最新抓取条目)                        │
               │   • snapshots (时序排名变化快照：09:00#28 -> 10:00#2)  │
               │   • events (跨平台去重与聚类事件)                      │
               │   • daily_briefs (每日情报历史归档)                     │
               └──────────────────────────┬─────────────────────────────┘
                                          │
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │           趋势分析引擎 (Trend Engine)                  │
               │   • 排名速度与加速度计算 (Velocity ranks/hr)           │
               │   • 状态判定 (NEW / RISING / RAPID_RISING / PEAK...)    │
               │   • 跨平台事件聚类 (Jaccard + 实体共现 + LLM 精炼)     │
               │   • 独立双评分 (World Importance & Creator Value)       │
               │   • 5 大板块结构化简报组装 (Brief Generator)            │
               └──────────────┬───────────────────────────┬─────────────┘
                               │                           │
               ┌───────────────┴───────────────┐           │ 标准文件落盘
               ▼                               ▼           ▼
    【 Web UI 扩展 Tab 】          【 网关 REST API 】   【 本地文件导出 】
    • 今日简报卡片看板             • GET /v1/.../brief   • `latest_brief.md`
    • 实时升温事件大盘             • GET /v1/.../events  • `latest_events.json`
    • 3级模型级联选择              • POST /v1/.../crawl  • `archive/YYYY-MM-DD_*.`
    • 调度/平台/代理配置           • POST /v1/.../refresh         │
                                                                 │
                                                                 ▼
                                                  【 Agent Skill (方法论) 】
                                                  • 优先调 REST API
                                                  • 离线降级读落盘文件
                                                  • 6+4 深度自媒体选题输出
```

---

## 3. 核心子模块详解

### 3.1 数据采集与标准化层 (`lib/trend-intel/providers/`)
* **`newsnow.mjs`**：针对 NewsNow API 跨平台榜单提供并发抓取、指数退避重试（支持 4xx 快速失败与 429 智能退避）及标准化解析。
* **`rss.mjs`**：原生 XML/Atom 解析器，零外部依赖提取标准 RSS / Atom 新闻条目。
* **`platforms.mjs`**：内置主流中文与全球平台配置（微博、知乎、百度、抖音、B站、今日头条、GitHub、36氪、华尔街见闻等）。
* **`proxy-helper.mjs`**：自适应网关 `https-proxy-agent` / `socks-proxy-agent` 与系统环境变量，支持 `inherit`、`direct`、`custom` 三种网络代理模式。

### 3.2 独立存储与路径层 (`lib/trend-intel/storage/`)
* **自适应存储路径 (`resolveDataDir`)**：
  1. 优先使用环境变量 `TREND_INTEL_DATA_DIR` 或用户在 UI 指定路径；
  2. 源码仓库模式默认输出至 `./output/trend-intel/`；
  3. 全局 npm 安装环境自适应至 `~/.shrimp/trend-intel/`。
* **SQLite 核心数据表 (`schema.sql` & `db.mjs`)**：
  - `raw_items`：各平台原始抓取条目，100% 保留 `raw` JSON。
  - `snapshots`：热搜榜单时序快照，记录平台、排名及抓取时间戳。
  - `events`：跨平台聚类事件，存储多平台聚合数组、趋势状态、双维度评分及自媒体切入角度。
  - `daily_briefs`：每日情报 Markdown 与统计元数据。

### 3.3 趋势分析与评分引擎 (`lib/trend-intel/engine/`)
* **`trend-calculator.mjs`**：
  - 基于线性回归与时间差分计算排名变化率 `velocity`（单位：排名/小时）；
  - 判定 6 种生命周期状态机：`NEW`（新上榜）、`RISING`（稳步上升）、`RAPID_RISING`（极速升温）、`PEAK`（高位盘整）、`DECLINING`（热度衰退）、`DEAD`（已跌落）。
* **`cluster.mjs`**：
  - 结合分词 Jaccard 相似度与强实体词共现算法，实现跨平台事件粗聚类；
  - 匹配用户自定义追踪赛道（Focus Topics）；
  - 支持可选 LLM 精炼事件标题与一句话核心事实。
* **`scorer.mjs`**：
  - 独立计算 `world_importance_score` 与 `creator_value_score`；
  - 离线 Heuristic 评分 + 在线 LLM 语义打分无缝衔接；
  - 生成针对性的自媒体创作切入角度。
* **`brief-generator.mjs`**：
  - 组装 5 大标准板块的 Markdown 日报：
    - ① 今天必须知道（重大世界事件）
    - ② 正在快速升温（时效爆发窗口）
    - ③ 今天最值得做的内容（爆款创作切入角度与窗口期）
    - ④ 值得知道，但不一定做（宏观背景与行业观察）
    - ⑤ 大众舆论讨论（全网情绪与争议焦点）
    - 🎯 重点赛道精选专栏（按用户配置的 Focus Topics 动态分组呈现）
* **`exporter.mjs`**：
  - 自动向数据目录导出 `latest_brief.md` 与 `latest_events.json`；
  - 在 `archive/` 目录下按日期归档历史副本。

---

## 4. REST API 接口规格说明

基础路径：`http://127.0.0.1:8787/v1/trend-intel`

| 方法 | 路径 | 描述 | 请求参数 / Body | 返回示例 |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/config` | 读取当前模块配置 | 无 | `{ scheduler: {...}, platforms: {...}, focus_topics: [...] }` |
| `PUT` | `/config` | 更新调度与平台配置 | JSON Patch | `{ scheduler: { interval_minutes: 15 }, ... }` |
| `POST` | `/crawl` | 立即触发全网采集 | 无 / `{ platforms: [...] }` | `{ count: 42, items: [...], crawled_at: "..." }` |
| `POST` | `/generate-brief` | 触发聚类、评分与简报生成 | `{ date?: "YYYY-MM-DD" }` | `{ brief: {...}, events: [...], exports: {...} }` |
| `GET` | `/brief` | 获取最新每日情报简报 | `?date=YYYY-MM-DD`（可选） | `{ date: "2026-08-26", markdown: "# ...", metadata: {...} }` |
| `GET` | `/events` | 查询跨平台聚类事件列表 | `?limit=10&min_creator_score=7.0&state=RAPID_RISING` | `{ events: [...], total: 12 }` |
| `GET` | `/events/:id/history` | 查询单个事件的时序排名快照 | 路径参数 `:id` | `{ event: {...}, snapshots: [{ rank: 28, recorded_at: "..." }, ...] }` |
| `GET` | `/raw-items` | 查询原始抓取热搜条目 | `?platform=weibo&limit=50` | `{ items: [...], total: 50 }` |

---

## 5. Web UI 管理面板实操

在网关桌面管理端（`http://127.0.0.1:8787/desktop/`），左侧导航栏点击 **「系统扩展」➔「热点情报 (Trend Radar)」** 进入控制台。

### 5.1 三大主视图
1. **今日简报 (Daily Brief)**：
   - 结构化卡片呈现 5 大核心板块与重点追踪赛道；
   - 顶部统计指标卡（覆盖事件总数、重大事件数、高价值选题数、极速升温数）；
   - 支持一键复制完整 Markdown 与下载文件。
2. **事件大盘 (Event Explorer)**：
   - 多维度筛选器（全部状态、极速升温 `RAPID_RISING`、高内容价值 `Creator >= 7.5`、高世界重要度 `World >= 8.0`）；
   - 事件卡片展示平台徽标集合、时序排名跳变走势、双评分 Badge 及自媒体切入角度建议；
   - 支持一键调取 Agent 深度分析（`6+4 思考框架` 与 `自媒体爆款大纲生成`）。
3. **系统设置 (Settings)**：
   - **自动调度**：开关定时抓取，设置轮询间隔（15m / 30m / 1h）与每日早晚报生成时间；
   - **平台源开关**：可视化勾选启用平台，支持自定义添加 RSS 新闻源；
   - **三级模型路由**：级联选择网关客户端、端点及模型；
   - **网络代理**：配置跟随网关代理、直连或自定义 HTTP/SOCKS 代理；
   - **重点赛道管理**：动态增删自定义 Focus Topics 与关键词标签。

---

## 6. Agent Skill 使用指南 (`leo-trend-intelligence`)

### 6.1 技能安装
在网关「预置技能」页面点击一键安装，或通过命令行安装：
```bash
node bin/shrimp.js sync install-skill
```

### 6.2 辅助脚本命令行用法 (`scripts/leo_trend_intel.mjs`)
Agent 可直接通过 CLI 脚本与 Trend Intelligence 交互，具备**实时网关 API 优先 + 离线本地文件降级**双模容灾保障：

```bash
# 1. 检查运行状态与数据源诊断
node lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs --status

# 2. 获取今日完整热点简报 Markdown
node lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs --brief

# 3. 获取全网高价值聚类事件 (文本卡片)
node lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs --events --limit 10

# 4. 获取聚类事件结构化 JSON (供 Agent 直接解析)
node lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs --events --format json

# 5. 立即触发一次全网采集与简报重新生成
node lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs --crawl
node lib/skills/leo-trend-intelligence/scripts/leo_trend_intel.mjs --generate-brief
```

### 6.3 6+4 分析方法论与选题 Prompt 范式
当 Agent 接收到用户的热点咨询时，将严格按照 6+4 方法论展开：

#### 基础事实与发展 6 问
1. **发生了什么**：提取核心事实与时间线，剔除情绪宣泄与噪音。
2. **为什么现在发生**：分析触发诱因、技术突破、政策出台或突发矛盾。
3. **为什么重要**：评估对行业格局、商业生态或社会生活的长远影响。
4. **接下来可能怎么发展**：给出 2~3 个后续演变情景推演。
5. **对普通人/从业者意味着什么**：拆解实际影响、利益相关点与行动建议。
6. **值不值得做成内容**：基于 World/Creator 评分给出明确结论与理由。

#### 自媒体爆款选题 4 问
1. **最值得讲的角度是什么**：提炼最能引发情绪共鸣、满足求知欲的核心主线。
2. **大多数人会怎么讲**：梳理主流媒体与普通博主的常规切入角度。
3. **有哪些不一样但成立的切入点**：挖掘反常识、底层认知差或冷门关键事实。
4. **现在做晚不晚**：基于时效窗口（RAPID_RISING / PEAK / DECLINING）给出发布策略与内容形态推荐（短视频/长图文/播客）。

---

## 7. 自动化测试与工程验证矩阵

系统包含 100% 覆盖率的自动化测试套件：

| 测试文件 | 类型 | 验证范围 | 状态 |
| :--- | :--- | :--- | :--- |
| `tests/unit/trend-intel-calculator.test.mjs` | 单元测试 | 线性回归斜率、6种生命周期状态机判定、时序乱序处理、跨平台传播度计算 |  PASSED |
| `tests/unit/trend-intel-engine.test.mjs` | 单元测试 | Jaccard 分词聚类、实体共现匹配、LLM 精炼、Heuristic 评分、5板块组装、文件导出 |  PASSED |
| `tests/unit/trend-intel-providers.test.mjs` | 单元测试 | NewsNow API 解析与退避重试、RSS/Atom 解析、代理透传、多源并发调度与错误容忍 |  PASSED |
| `tests/unit/trend-intel-storage.test.mjs` | 单元测试 | SQLite CRUD、时序快照写入、跨平台事件存储、自适应目录解析、ConfigStore 读写 |  PASSED |
| `tests/unit/trend-intel-skill.test.mjs` | 单元测试 | SKILL.md 规范、Managed Catalog 发现、SkillInstaller 安装、CLI 脚本与离线降级 |  PASSED |
| `tests/unit/trend-intel-ui-build.test.mjs` | 单元测试 | UI 模块注册、4个子视图渲染、3级模型选择器、AI 提示词动作注入、esbuild 打包 |  PASSED |
| `tests/integration/trend-intel-api.test.mjs` | 集成测试 | HTTP 路由、Config GET/PUT、Crawl 触发、Brief/Events 查询、Event Snapshot 历史 |  PASSED |
| `tests/integration/trend-intel-e2e.test.mjs` | E2E测试 | 全流程闭环（采集➔快照➔速度计算➔聚类➔双打分➔简报生成➔落盘➔API➔Skill CLI） |  PASSED |

### 验证命令
```bash
# 运行全部 Trend Intelligence 测试
npm test

# 执行语法与静态检查
npm run check

# 构建前端管理面板 Bundle
npm run build:panel

# 运行网关全套 CLI 与核心集成测试
npm run test:cli
```

---

## 8. 总结与后续演进建议

第一期 MVP 已经实现了从多源采集、时序分析、智能聚类、双维度评分、5板块简报生成到 Web 控制台与 Agent Skill 的完整工业级闭环。

**后续演进建议（Phase 2 规划）**：
1. **多模态与外部源扩展**：接入 X/Twitter、Reddit、YouTube 等全球社交网络 Provider 接口；
2. **个性化创作者画像学习**：根据创作者历史作品与账号受众偏好，自动调整 Creator Value 评分权重；
3. **自动图文大纲生图联动**：与网关现有的 `image-prompt` / `byted-ark-seedream-skill` 联动，一键为生成的选题大纲匹配配图与封面设计。
