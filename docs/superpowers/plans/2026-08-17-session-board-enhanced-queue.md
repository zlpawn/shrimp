# 会话看板增强待发队列与模型限额智能避让系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现会话看板的主动式定时/延时投递、多厂商（火山、智谱、DeepSeek、Grok、Claude、Codex、Antigravity）模型限额智能识别与恢复解析、会话级级联熔断保护及前端可视化管理。

**Architecture:** 
- `quota-detector.mjs` 提供纯函数式的多厂商限额特征匹配与时间戳解析；
- `sqlite-store.mjs` 扩展支持 `scheduled_at_ms`、`vendor_tag`、`scheduled` / `waiting_quota` 状态及级联改期操作；
- `service.mjs` 在 `dispatchReady` 调度时过滤已到期任务，捕获限额时触发会话级联熔断；
- `routes.mjs` 暴露定时入队与改期 PATCH API；
- `session-kanban.ts` 增强 Compose 表单、Chat Drawer 与队列列表的操作与展示。

**Tech Stack:** Node.js (ESM), `node:sqlite`, TypeScript / HTML5, esbuild.

## Global Constraints

- 工作区：`d:\agent-transfer\.worktrees\session-board-queue`
- 分支：`feat/session-board-queue`
- 保留已有代码中的路径自定义与会话读取功能
- 所有修改均包含单元测试，保持 `npm run test:session-kanban` 与 `npm run build:panel` 全部通过

---

### Task 1: 多厂商限额与恢复时间解析器 (`quota-detector.mjs`)

**Files:**
- Create: `lib/session-kanban/infra/quota-detector.mjs`
- Test: `tests/unit/session-kanban-quota-detector.test.mjs`

**Interfaces:**
- Produces: `detectQuotaExhaustion({ error, stdout, stderr, now }) => { isQuotaError, vendorTag, vendorName, resumeAtMs, reason }`

- [x] **Step 1: 编写多厂商限额识别测试用例**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 实现 `quota-detector.mjs` 逻辑（支持火山周限额、Claude 5h、智谱 1301/1302、DeepSeek 429/402、Grok、Antigravity gRPC 等）**
- [x] **Step 4: 运行测试验证全部通过**
- [x] **Step 5: 提交 Task 1 代码**

---

### Task 2: 存储层增强定时调度与会话级联推迟 (`sqlite-store.mjs`)

**Files:**
- Modify: `lib/session-kanban/infra/sqlite-store.mjs`
- Test: `tests/unit/session-kanban-store-schedule.test.mjs`

**Interfaces:**
- Consumes: `QUEUE_STATUSES` 包含 `scheduled` 与 `waiting_quota`
- Produces:
  - `enqueue({ sessionId, message, scheduledAtMs, vendorTag })`
  - `updateSchedule(id, { scheduledAtMs })`
  - `markWaitingQuota(id, { notBeforeMs, vendorTag, error })`
  - `rescheduleSessionQueue(sessionId, { notBeforeMs, vendorTag, errorMsg })`

- [x] **Step 1: 编写存储层定时与改期测试用例**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 修改 `sqlite-store.mjs`，执行 schema 自动迁移，实现新方法**
- [x] **Step 4: 运行测试验证全部通过**
- [x] **Step 5: 提交 Task 2 代码**

---

### Task 3: 调度服务与级联熔断集成 (`service.mjs` & `scheduler.mjs`)

**Files:**
- Modify: `lib/session-kanban/application/service.mjs`
- Test: `tests/unit/session-kanban-service-schedule.test.mjs`

**Interfaces:**
- Consumes: `detectQuotaExhaustion` from `quota-detector.mjs`, `store.rescheduleSessionQueue`
- Produces: `service.dispatchReady()`, `service.updateSchedule(id, { scheduledAt })`

- [x] **Step 1: 编写服务层调度过滤与熔断测试用例**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 修改 `service.mjs`，加入 `scheduled_at_ms <= now` 过滤与限额捕获熔断**
- [x] **Step 4: 运行测试验证全部通过**
- [x] **Step 5: 提交 Task 3 代码**

---

### Task 4: HTTP 路由与 API 扩展 (`routes.mjs`)

**Files:**
- Modify: `lib/session-kanban/http/routes.mjs`
- Test: `tests/integration/session-kanban-api.test.mjs`

**Interfaces:**
- Produces:
  - `POST /v1/session-kanban/queue` (支持 `scheduledAt` 与 `delayMinutes`)
  - `PATCH /v1/session-kanban/queue/:id/schedule`
  - `POST /v1/session-kanban/queue/:id/retry` (支持 `immediate`)

- [x] **Step 1: 在集成测试中增加定时与改期 API 验证**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 修改 `routes.mjs` 支持相关路由**
- [x] **Step 4: 运行测试验证全部通过**
- [x] **Step 5: 提交 Task 4 代码**

---

### Task 5: 前端 UI 交互与视觉优化 (`session-kanban.ts`)

**Files:**
- Modify: `desktop/src/modules/session-kanban.ts`
- Test: `tests/unit/session-kanban-panel.test.mjs`

- [x] **Step 1: 编写/更新前端面板渲染测试**
- [x] **Step 2: 运行测试验证**
- [x] **Step 3: 修改 `session-kanban.ts`（表单时机选择、抽屉时机选择、队列倒计时与厂商标签、改期交互）**
- [x] **Step 4: 编译打包 `npm run build:panel` 并运行测试**
- [x] **Step 5: 提交 Task 5 代码**

---

### Task 6: 全链路回归与整体验证

**Files:**
- Run: `npm run test:session-kanban`
- Run: `npm run build:panel`

- [x] **Step 1: 运行全量看板测试套件**
- [x] **Step 2: 验证无回归并提交最终更改**
