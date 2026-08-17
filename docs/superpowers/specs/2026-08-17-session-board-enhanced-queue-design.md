# 会话看板增强待发队列与模型限额智能避让系统设计规范 (Design Spec)

- **创建日期**：2026-08-17
- **分支与工作区**：`feat/session-board-queue` (`.worktrees/session-board-queue`)
- **状态**：Approved

---

## 1. 目标与背景

### 1.1 背景
当前系统扩展模块中的“会话看板”（Session Kanban）支持将会话待发消息加入队列（`session_kanban_queue`），并由后台调度器（`scheduler` 每 30 秒轮询一次）在会话空闲（距离上次活动 >90秒）时自动调用对应客户端的 CLI 执行投递。

然而在日常使用中，不同的大模型提供商（如 Anthropic Claude 5小时/周限额、Codex/OpenAI 用量限制、火山引擎 Ark 周配额限制、智谱 GLM 1301/1302 频率与额度限制、DeepSeek 429/402 欠费/并发限制、Grok 每日用量限制、Antigravity 额度耗尽等）存在周期性限额或频率超限情况。当限额耗尽时，会话中断，如果盲目轮询投递会不断触发错误，既浪费日志，也无法满足用户“先排队、等额度刷新后全自动投递”的需求。

### 1.2 目标
1. **主动式定时与延时投递**：在看板表单与对话抽屉（Chat Drawer）中，支持「空闲即发」、「快捷延时（+30分/+1小时/+3小时/+5小时）」及「自定义具体日期时间」。
2. **多厂商限额智能识别（Quota & Rate Limit Detector）**：全面覆盖 Grok、智谱 (GLM)、火山引擎 (Ark/豆包)、DeepSeek、Claude、Codex、Antigravity 等主流厂商，自动解析错误文本中的恢复时刻（绝对时间或相对时长），带智能厂商标签。
3. **会话级级联熔断保护（Session Circuit Breaker）**：某会话第一条消息因额度耗尽触发限额时，自动将该条目置为 `waiting_quota`，并将该会话后续所有排队消息统一推迟至预计恢复时间，避免无意义的并发撞墙。
4. **全生命周期可控 UI**：队列列表显示精确倒计时、厂商错误标签，支持随时「✏️ 改期」、「⚡ 立即试投」、「✕ 取消」等操作。

---

## 2. 架构设计与组件职责

```
┌────────────────────────────────────────────────────────┐
│               Web UI (Session Kanban)                  │
│  - Compose Form (时机选择: 即时 / 快捷延时 / 自定义时间)      │
│  - Chat Drawer (抽屉内快捷定时入队)                       │
│  - Queue Table (倒计时 / 厂商标签 / ✏️改期 / ⚡立即试投)  │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP API (/v1/session-kanban/*)
┌──────────────────────────▼─────────────────────────────┐
│                 SessionKanbanService                   │
│  - enqueue / updateSchedule / retry / cancel           │
│  - dispatchReady (过滤 now >= scheduled_at_ms)         │
│  - 捕获异常 -> 触发 quota-detector 智能分析              │
│  - 级联推迟同一会话排队消息 (rescheduleSessionQueue)    │
└──────────────────────────┬─────────────────────────────┘
          ┌────────────────┴────────────────┐
          ▼                                 ▼
┌──────────────────┐              ┌──────────────────┐
│  Quota Detector  │              │  SQLite Store    │
│  - 多厂商特征库   │              │  - 扩展调度字段  │
│  - 时间解析提取器 │              │  - 状态流转保障  │
└──────────────────┘              ┌──────────────────┘
```

---

## 3. 数据层规范 (`lib/session-kanban/infra/sqlite-store.mjs`)

### 3.1 队列状态（Queue Statuses）
扩展 `QUEUE_STATUSES`：
```javascript
export const QUEUE_STATUSES = Object.freeze([
  "pending",         // 空闲即发
  "scheduled",       // 用户指定未来时间等待中
  "waiting_quota",   // 限额熔断等待恢复中
  "dispatching",     // 正在投递
  "dispatched",      // 投递成功
  "failed",          // 终态失败（非限额致命错误）
  "canceled",        // 已取消
]);
```

### 3.2 数据库 Schema 迁移
表 `session_kanban_queue` 增加字段：
- `scheduled_at_ms INTEGER NOT NULL DEFAULT 0`：计划投递时间戳（毫秒），`0` 表示即刻/空闲即投。
- `vendor_tag TEXT NOT NULL DEFAULT ''`：捕获的厂商标签（如 `volcengine`、`claude`、`zhipu`、`deepseek`、`grok`、`antigravity` 等）。

存储层初始化时自动执行兼容迁移：
```sql
ALTER TABLE session_kanban_queue ADD COLUMN scheduled_at_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_kanban_queue ADD COLUMN vendor_tag TEXT NOT NULL DEFAULT '';
```

### 3.3 存储层核心 API
- `enqueue({ sessionId, message, scheduledAtMs = 0, vendorTag = '' })` -> 返回公共行对象（自动将未来时间的标记为 `scheduled`）。
- `updateSchedule(id, { scheduledAtMs })` -> 修改未投递条目的计划时间；若时间推迟至未来，状态置为 `scheduled`；若改为现在或过去，置为 `pending`。
- `rescheduleSessionQueue(sessionId, { notBeforeMs, vendorTag, errorMsg })` -> 级联将该会话所有 `pending`/`scheduled`/`waiting_quota` 任务推迟至 `notBeforeMs`，设置 `waiting_quota` 状态与错误信息。
- `markWaitingQuota(id, { notBeforeMs, vendorTag, error })` -> 标记单条条目因限额推迟。
- `retry(id, { immediate = true })` -> 重试，若 `immediate = true` 则将 `scheduled_at_ms` 归零，重置状态为 `pending`。

---

## 4. 多厂商限额识别器 (`lib/session-kanban/infra/quota-detector.mjs`)

### 4.1 厂商特征库规则
1. **火山引擎 (Ark / Doubao)**:
   - 特征：`AccountQuotaExceeded`、`SetRateLimitExceeded`、`TPMLimitExceeded`、`RPMLimitExceeded`、`weekly usage quota`。
   - 时间提取：匹配 `reset at (\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?: [+-]\\d{4})?(?: [A-Z]+)?)`，解析为绝对时间戳。
2. **Claude (Anthropic)**:
   - 特征：`5-hour limit`、`message limit`、`rate_limit_error`、`resets at`、`resets in`。
   - 时间提取：匹配 `resets at (\\d{1,2}:\\d{2}(?:\\s*(?:AM|PM))?)` 或 `in (\\d+)\\s*(?:hours|h|mins|minutes|m)`。
3. **智谱 AI (GLM)**:
   - 特征：错误码 `1301`（系统繁忙/限频）、`1302`（余额不足/欠费）、`1305`、`调用次数超限`、`并发超限`。
   - 退避策略：频率超限默认退避 15 分钟；欠费/用尽提示退避 30 分钟。
4. **DeepSeek**:
   - 特征：`429 Too Many Requests`、`402 Payment Required`、`Insufficient Balance`、`余额不足`、`Rate limit reached`。
   - 退避策略：429 默认退避 15 分钟；402 余额不足退避 30 分钟。
5. **Grok (xAI)**:
   - 特征：`Grok session token expired`、`Rate limit exceeded`、`Daily limit reached`、`throttled`。
   - 退避策略：每日限额推迟至次日 00:00，一般超限退避 30 分钟。
6. **Antigravity / Gemini**:
   - 特征：`Resource has been exhausted`、`check quota`、`ResourceExhausted`、`gRPC error: status=8`。
   - 退避策略：默认退避 30 分钟。
7. **Codex / OpenAI**:
   - 特征：`usage cap`、`insufficient_quota`、`rate_limit_exceeded`、`429`。
   - 时间提取：匹配 `resets at ...`，或默认退避 30 分钟。

### 4.2 统一输出接口
```javascript
detectQuotaExhaustion({ error, stdout = '', stderr = '', now = Date.now() })
// 返回：
// {
//   isQuotaError: boolean,
//   vendorTag: string,      // e.g. "volcengine", "claude", "zhipu", "deepseek", "grok", "antigravity", "codex", "generic"
//   vendorName: string,     // e.g. "火山引擎", "Claude", "智谱 AI", "DeepSeek", "Grok", "Antigravity", "Codex"
//   resumeAtMs: number,     // 预计恢复时间戳
//   reason: string,         // 格式化错误描述
// }
```

---

## 5. 调度服务与级联熔断 (`service.mjs` & `scheduler.mjs`)

### 5.1 调度就绪过滤 (`dispatchReady`)
```javascript
const eligible = queue.filter(item => {
  if (item.status !== "pending" && item.status !== "scheduled" && item.status !== "waiting_quota") return false;
  const scheduledAt = Number(item.scheduledAtMs || 0);
  return scheduledAt <= nowMs;
});
```

### 5.2 投递异常处理与级联熔断
```javascript
try {
  const result = await dispatcher.dispatch(session, item.message);
  await store.markDispatched(item.id, { command: result.command, exitCode: 0 });
  dispatched += 1;
} catch (error) {
  const quotaInfo = detectQuotaExhaustion({ error, now: now() });
  if (quotaInfo.isQuotaError) {
    // 标记当前任务为 waiting_quota
    await store.markWaitingQuota(item.id, {
      notBeforeMs: quotaInfo.resumeAtMs,
      vendorTag: quotaInfo.vendorTag,
      error: `[${quotaInfo.vendorName}] ${quotaInfo.reason}`,
    });
    // 级联推迟该会话其余所有待发任务
    await store.rescheduleSessionQueue(session.id, {
      notBeforeMs: quotaInfo.resumeAtMs,
      vendorTag: quotaInfo.vendorTag,
      errorMsg: `[${quotaInfo.vendorName}] 等待前置任务额度恢复`,
    });
  } else {
    await store.markFailed(item.id, error?.message || String(error));
  }
}
```

---

## 6. HTTP API 接口规范 (`routes.mjs`)

- `POST /v1/session-kanban/queue`：
  - Body: `{ sessionId, message, scheduledAt?: string | number, delayMinutes?: number }`
  - 返回创建的队列对象。
- `PATCH /v1/session-kanban/queue/:id/schedule`：
  - Body: `{ scheduledAt: string | number }`
  - 返回更新后的队列对象。
- `POST /v1/session-kanban/queue/:id/retry`：
  - Body: `{ immediate?: boolean }`
  - 立即重试或重置。

---

## 7. 前端 UI 规范 (`desktop/src/modules/session-kanban.ts`)

1. **投递时机选择器（Compose & Chat Drawer）**：
   - 提供 Segmented 按钮组：
     - `⚡ 空闲即发`（默认）
     - `⏱️ +30分`
     - `⏱️ +1小时`
     - `⏱️ +3小时`
     - `⏱️ +5小时`
     - `📅 自定义时间`
   - 选择自定义时间时展开 `<input type="datetime-local">`。
2. **队列列表（Queue Rows）增强**：
   - 状态徽章：
     - `pending`：排队中（空闲即投）
     - `scheduled`：⏳ 定时于 23:30 投递（约 2 小时后）
     - `waiting_quota`：🛑 [火山引擎] 超过周配额，预计 08-03 00:00 自动重试
   - 动作按钮：
     - `✏️ 改期`：弹出时间修改框，可一键改期或改为空闲即投
     - `⚡ 立即投递`：跳过等待直接调度
     - `✕ 取消`
3. **看板卡片状态关联**：
   - 若某会话存在 `waiting_quota` 任务，在卡片上展示对应厂商额度等待指示器。

---

## 8. 测试与质量验证计划

1. **单元测试**：
   - `tests/unit/session-kanban-quota-detector.test.mjs`：
     - 火山引擎周配额 `AccountQuotaExceeded` 与日期解析
     - Claude 5小时 `resets at` / `resets in` 解析
     - 智谱 1301/1302 频率/欠费解析
     - DeepSeek 429/402 余额与并发解析
     - Grok token 过期与日限额解析
     - Antigravity gRPC status=8 quota exhausted 解析
     - Codex 429 / usage cap 解析
   - `tests/unit/session-kanban-store-schedule.test.mjs`：
     - 计划时间存储与状态自动转换
     - 改期接口与时间回退/提前
     - 级联推迟（rescheduleSessionQueue）
   - `tests/unit/session-kanban-service-schedule.test.mjs`：
     - 未到时间不投递，到期且空闲才投递
     - 触发限额后自动熔断并级联推迟
2. **集成测试**：
   - `tests/integration/session-kanban-api.test.mjs`：
     - 测试定时入队接口、PATCH 改期接口、重试接口。
3. **前端编译与回归**：
   - `npm run build:panel` 编译前端静态产物无报错。
   - `npm run test:session-kanban` 保持 100% 通过。
