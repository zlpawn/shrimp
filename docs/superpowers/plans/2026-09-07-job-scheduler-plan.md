# 定时任务中心 (Job Scheduler) - Phase 1 实施计划

## 概述
实现网关定时任务的显式化与在线配置管理，包含独立的配置存储 `scheduler.config.json`、符合开闭原则的适配器架构、REST API 接口以及桌面端卡片网格面板。

---

## 阶段划分

### 任务 1：配置存储与模板设计
- [ ] 创建 `scheduler.config.example.json`
- [ ] 创建 `lib/scheduler/config-store.mjs`（负责读写、默认值补全、错误容错）
- [ ] 编写单测 `tests/unit/scheduler-config-store.test.mjs` 并验证通过

### 任务 2：基类适配器与任务注册表 (JobRegistry)
- [ ] 创建 `lib/scheduler/adapters/base-adapter.mjs`
- [ ] 创建 `lib/scheduler/registry.mjs`（适配器注册、状态聚合、执行锁、配置分发）
- [ ] 编写单测 `tests/unit/scheduler-registry.test.mjs` 并验证通过

### 任务 3：7 个已有任务的具体适配器实现
- [ ] `lib/scheduler/adapters/trend-crawl.mjs` (热点资讯抓取)
- [ ] `lib/scheduler/adapters/trend-brief.mjs` (AI 早晚报生成)
- [ ] `lib/scheduler/adapters/kb-sync.mjs` (知识库 WeRead & Craft 同步)
- [ ] `lib/scheduler/adapters/kanban-dispatch.mjs` (会话看板队列派发)
- [ ] `lib/scheduler/adapters/fx-rate.mjs` (汇率定时刷新)
- [ ] `lib/scheduler/adapters/model-pricing.mjs` (LiteLLM 价格表刷新)
- [ ] `lib/scheduler/adapters/session-sync.mjs` (会话日志监听守护)
- [ ] 编写适配器单测 `tests/unit/scheduler-adapters.test.mjs` 并验证通过

### 任务 4：HTTP 路由与模块组装
- [ ] 创建 `lib/scheduler/routes.mjs` (`GET /v1/scheduler/jobs`, `POST /v1/scheduler/jobs/:id/run`, `PATCH /v1/scheduler/jobs/:id/config`)
- [ ] 创建 `lib/scheduler/index.mjs` (初始化工厂函数 `initSchedulerModule`)
- [ ] 编写集成测试 `tests/integration/scheduler-api.test.mjs` 并验证通过

### 任务 5：接入网关服务 (`server.js`)
- [ ] 在 `server.js` 中引入 `initSchedulerModule`
- [ ] 挂载 `/v1/scheduler` 路由
- [ ] 将各业务模块句柄注入调度中心
- [ ] 运行 `npm run check` 确保语法无误

### 任务 6：桌面端 UI 开发与构建
- [ ] 创建 `desktop/src/modules/job-scheduler.ts` (卡片网格渲染、折叠表单、立即执行与倒计时刷新)
- [ ] 修改 `desktop/index.html` 添加导航条目与容器 pane
- [ ] 在 `desktop/src/app.ts` 中注册 `scheduler` 选项卡切换逻辑
- [ ] 运行 `npm run build:panel` 构建前端静态资源

### 任务 7：端到端验证与交付
- [ ] 运行完整测试套件 (`npm test`, `npm run check`)
- [ ] 启动模拟或真实服务验证接口返回与桌面端呈现
- [ ] 编写总结说明并呈现给用户
