# 定时任务中心 (Job Scheduler) - Phase 1 设计规范

## 1. 目标与范围 (Goals & Scope)

### 1.1 背景与痛点
网关（Shrimp）后台常驻运行了多个关键的定时任务与周期调度器（如趋势情报抓取、AI 早晚报生成、知识库增量同步、会话看板派发、汇率刷新、模型定价同步、会话日志监听）。目前这些任务均散落在各模块内部，对用户呈现“黑盒状态”：
1. 用户无法感知任务是否正常执行、何时触发、是否发生故障；
2. 无法在线调整周期或启停任务（必须手动改多处配置或重启网关）；
3. 无法在界面上一键手动触发调试（Run Now）。

### 1.2 Phase 1 目标
1. **显式化查看**：在桌面端「系统扩展」下新增「定时任务 (Job Scheduler)」Tab，以卡片网格全景呈现 7 个已有任务的状态、执行周期、上次运行时间/耗时、下次预定时间。
2. **轻量在线配置**：卡片内提供折叠式表单，允许在线修改开关、执行周期/时间点等参数，保存后即时热重载（无需重启网关）。
3. **一键手动触发**：每张卡片提供「立即执行」按钮，方便随时测试并展示即时执行日志。
4. **高扩展与开闭原则 (OCP)**：引入统一的 `JobRegistry` 与 `JobAdapter` 抽象，未来 Phase 2 扩展自定义 CLI / HTTP / 串并行流水线时核心引擎零修改。
5. **专有配置存储**：采用专有的 `scheduler.config.json`（配合 `scheduler.config.example.json`），完全不污染 `gateway.config.json`。

### 1.3 非本期目标 (Non-Goals for Phase 1)
* Phase 2 自定义任务新建弹窗（第一阶段仅聚焦已有任务的标准化管理，但架构接口完全预留）。
* 复杂多步骤 DAG 编排（第一阶段按既有独立任务模式管理）。

---

## 2. 系统架构设计 (Architecture)

### 2.1 模块目录划分 (`lib/scheduler/`)

```text
lib/scheduler/
├── index.mjs               # 模块入口，工厂函数 initSchedulerModule()
├── config-store.mjs        # scheduler.config.json 读写与默认值生成
├── registry.mjs            # JobRegistry: 统一维护所有 JobAdapter，分发生命周期与状态
├── routes.mjs              # REST API 路由挂载 (/v1/scheduler/*)
└── adapters/               # 7 个现有任务的适配器
    ├── base-adapter.mjs    # JobAdapter 基类，规范接口定义
    ├── trend-crawl.mjs     # 趋势资讯抓取适配器
    ├── trend-brief.mjs     # 趋势早晚报生成适配器
    ├── kb-sync.mjs         # 知识库增量同步适配器 (WeRead + Craft)
    ├── kanban-dispatch.mjs # 会话看板队列扫描派发适配器
    ├── fx-rate.mjs         # 汇率定时刷新适配器
    ├── model-pricing.mjs   # LiteLLM 模型价格同步适配器
    └── session-sync.mjs    # 会话同步日志守护监听适配器
```

### 2.2 核心抽象接口 (Open-Closed Principle)

```ts
export class BaseJobAdapter {
  constructor({ id, name, module, description, defaultSchedule }) {
    this.id = id;
    this.name = name;
    this.module = module;
    this.description = description;
    this.defaultSchedule = defaultSchedule;
  }

  // 必须由子类实现：
  abstract getStatus(): JobStatusSummary;
  abstract getConfigSchema(): ConfigFieldDefinition[];
  abstract onConfigChange(newConfig: Record<string, any>): Promise<void> | void;
  abstract runNow(): Promise<RunResult>;
}
```

每个适配器通过依赖注入的方式获取对应底层服务的句柄，对外暴露一致的生命周期与配置结构。

---

## 3. 配置文件规范 (`scheduler.config.json`)

在项目根目录设立独立的 `scheduler.config.json`：

```json
{
  "version": 1,
  "jobs": {
    "trend_intel_crawl": {
      "enabled": true,
      "interval_minutes": 30
    },
    "trend_intel_daily_brief": {
      "enabled": true,
      "daily_times": ["08:30", "18:00"]
    },
    "kb_incremental_sync": {
      "enabled": true,
      "mode": "daily",
      "daily_time": "04:00",
      "interval_hours": 12,
      "sync_on_startup": true
    },
    "session_kanban_dispatch": {
      "enabled": true,
      "interval_seconds": 30
    },
    "fx_rate_refresh": {
      "enabled": true,
      "interval_hours": 6
    },
    "model_pricing_refresh": {
      "enabled": true,
      "interval_hours": 24
    },
    "session_watcher_daemon": {
      "enabled": true,
      "debounce_ms": 1500
    }
  }
}
```

*如果文件不存在，`ConfigStore` 将自动克隆 `scheduler.config.example.json` 生成，并带有平滑的 schema 校验与缺省值回退。*

---

## 4. REST API 契约

所有 API 前缀为 `/v1/scheduler`：

1. **`GET /v1/scheduler/jobs`**
   * 返回所有已注册任务的卡片状态、可配置模式与最近执行记录。
   * 响应结构：
     ```json
     {
       "ok": true,
       "jobs": [
         {
           "id": "trend_intel_crawl",
           "name": "热点资讯周期抓取",
           "module": "热点情报 (Trend Radar)",
           "description": "定时拉取 GitHub Trending、HackerNews 等热榜资讯",
           "status": "idle",
           "enabled": true,
           "scheduleSummary": "每 30 分钟",
           "lastRunAt": "2026-09-07T08:00:00.000Z",
           "lastDurationMs": 1240,
           "nextRunAt": "2026-09-07T08:30:00.000Z",
           "lastError": null,
           "lastMessage": "抓取成功: 24 条新增资讯",
           "config": {
             "enabled": true,
             "interval_minutes": 30
           },
           "schema": [
             { "key": "enabled", "label": "启用任务", "type": "boolean" },
             { "key": "interval_minutes", "label": "抓取间隔 (分钟)", "type": "number", "min": 1, "max": 1440 }
           ],
           "recentRuns": [
             { "timestamp": "...", "durationMs": 1240, "success": true, "message": "..." }
           ]
         }
       ]
     }
     ```

2. **`POST /v1/scheduler/jobs/:id/run`**
   * 手动触发立即运行。
   * 响应：`{ "ok": true, "durationMs": 1120, "message": "执行成功" }` 或 `{ "ok": false, "error": "..." }`。

3. **`PATCH /v1/scheduler/jobs/:id/config`**
   * 更新任务配置并热生效。
   * 请求体：`{ "enabled": false, "interval_minutes": 60 }`
   * 响应：`{ "ok": true, "job": { ...更新后的 job 状态与配置 } }`。

---

## 5. 前端 UI 与交互设计 (Desktop UI)

### 5.1 侧边栏导航入口
在 `desktop/index.html` 的「系统扩展」分组下添加：
```html
<a href="#scheduler" class="nav-item" onclick="switchTab('scheduler')">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
    定时任务 (Job Scheduler)
</a>
```

### 5.2 页面主体与卡片网格
* 容器：`<section id="section-scheduler" class="content-pane">`
* 顶栏：
  * 标题：`定时任务调度中心`
  * 概览徽标：`总任务: 7` | `运行中: 1` | `待机: 5` | `已停用: 1`
  * 全局操作：`[ 刷新列表 ]`
* 卡片网格（CSS Grid 响应式布局）：
  * **卡片头部**：模块标签（如 `热点情报`）、状态圆点徽标（🟢 待机 / 🟡 运行中 / 🔴 异常 / ⚪ 停用）、任务名称；
  * **卡片主体**：任务说明、调度周期摘要、时间指标（上次执行时间与耗时、下次执行倒计时）；
  * **操作与折叠条**：
    * `[ 立即执行 ]` 按钮（触发中显示 loading 动画与计时）；
    * `[ ⚙️ 配置 ▾ ]` 折叠展开按钮；
  * **内嵌折叠表单**：
    * 点击「配置」向下平滑展开（轻量表单）；
    * 渲染开关（Toggle Switch）、数字输入框、下拉框或输入框；
    * 底部提供 `[ 保存配置 ]` 与 `[ 收起 ]` 按钮。保存成功后卡片指标即时刷新，弹出轻量 toast 提示。

---

## 6. 测试与验证策略 (Verification Strategy)
1. **单元测试**：
   * `tests/unit/scheduler-config-store.test.mjs`：测试配置文件的加载、写入、默认值回退。
   * `tests/unit/scheduler-registry.test.mjs`：测试适配器注册、状态查询、配置局部更新分发、并发 runNow 锁。
   * `tests/unit/scheduler-adapters.test.mjs`：针对各任务适配器的 mock 测试。
2. **集成测试**：
   * `tests/integration/scheduler-api.test.mjs`：对 `/v1/scheduler/jobs`、`run`、`config` 进行 HTTP 级测试。
3. **构建与桌面端校验**：
   * 运行 `npm run build:panel` 构建前端静态资源。
   * 运行 `npm run check` 确保无语法与类型错误。
   * 运行全量测试套件。
