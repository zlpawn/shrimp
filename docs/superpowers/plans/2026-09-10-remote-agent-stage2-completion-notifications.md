# Remote Agent Stage 2 Completion Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Session Kanban finishes dispatching a remote-agent task, Shrimp posts a bounded completion/failure reply back to the original IM chat through a configured webhook.

**Architecture:** Keep Stage 1 command ownership inside remote-agent. Extend queue rows with remote-delivery metadata, emit completion events from Session Kanban transitions, and deliver plain-text replies through a remote-agent webhook notifier. Desktop IM page only configures the webhook URL and shows delivery status; LangBot remains responsible for posting the callback text into the original chat.

**Tech Stack:** Node.js built-in test, fetch, SQLite via node:sqlite, existing lib/remote-agent and lib/session-kanban modules, desktop panel TypeScript.

**Spec:** docs/remote-agent-integration.md

## Global Constraints

- Users never see JSON; callbacks deliver plain-text reply only.
- Bot frameworks stay transport-only; Shrimp owns completion wording.
- Stage 2 covers dispatched and failed queue transitions only. Dangerous-action confirmation tokens remain Stage/M4.
- Do not invent a LangBot plugin. Use an outbound webhook that adapters can host.
- Bound reply size; never dump full agent transcripts into IM.
- Keep Session Kanban serial dispatch semantics unchanged.

---

### Task 1: Queue metadata for remote-agent delivery

**Files:**
- Modify: lib/session-kanban/infra/sqlite-store.mjs
- Modify: lib/remote-agent/application/service.mjs
- Test: tests/unit/session-kanban-store.test.mjs
- Test: tests/unit/remote-agent-service.test.mjs

**Interfaces:**
- Consumes: existing store.enqueue({ sessionId, message })
- Produces:
  - enqueue({ sessionId, message, source?, bindingKey?, platform?, chatType?, chatId?, userId?, replyToMessageId? })
  - public queue fields: source, bindingKey, platform, chatType, chatId, userId, replyToMessageId, notifyStatus, notifyAttempts, notifyError, notifiedAt

- [ ] **Step 1: Write the failing store test**

Add a test that enqueues with remote-agent metadata and asserts source/bindingKey/notifyStatus=pending.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test tests/unit/session-kanban-store.test.mjs
Expected: FAIL because metadata fields do not exist

- [ ] **Step 3: Extend sqlite store schema and publicRow**

Add columns with migration guards:

- source TEXT NOT NULL DEFAULT ''
- binding_key TEXT NOT NULL DEFAULT ''
- platform TEXT NOT NULL DEFAULT ''
- chat_type TEXT NOT NULL DEFAULT ''
- chat_id TEXT NOT NULL DEFAULT ''
- user_id TEXT NOT NULL DEFAULT ''
- reply_to_message_id TEXT NOT NULL DEFAULT ''
- notify_status TEXT NOT NULL DEFAULT 'none'
- notify_attempts INTEGER NOT NULL DEFAULT 0
- notify_error TEXT NOT NULL DEFAULT ''
- notified_at_ms INTEGER NOT NULL DEFAULT 0

Set notify_status to pending when source === "remote-agent", otherwise none.

- [ ] **Step 4: Pass metadata from remote-agent enqueue**

In createRemoteAgentService dispatch path, pass source/bindingKey/platform/chatType/chatId/userId/replyToMessageId into sessionKanban.enqueue.

- [ ] **Step 5: Run tests and commit**

Run: node --test tests/unit/session-kanban-store.test.mjs tests/unit/remote-agent-service.test.mjs
Expected: PASS

Commit: feat(session-kanban): persist remote-agent delivery metadata on queue items

---

### Task 2: Completion reply formatter and event payload

**Files:**
- Modify: lib/remote-agent/domain/replies.mjs
- Create: lib/remote-agent/domain/completion-events.mjs
- Test: tests/unit/remote-agent-domain.test.mjs

**Interfaces:**
- Produces:
  - formatCompletion(item, { panelUrl } = {}) -> string
  - formatFailure(item, { panelUrl } = {}) -> string
  - buildCompletionEvent(item, { reply, panelUrl } = {}) -> object

- [ ] **Step 1: Write failing formatter tests**

Assert formatCompletion mentions 已派发完成 and task id, stays under 500 chars; buildCompletionEvent sets type remote_agent.task_failed and preserves chatId/reply.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test tests/unit/remote-agent-domain.test.mjs
Expected: FAIL on missing exports

- [ ] **Step 3: Implement formatters and event builder**

Rules:

- success reply mentions session line + task id + optional panel link
- failure reply includes truncated error (<= 180 chars)
- event fields: type, taskId, status, reply, bindingKey, platform, chatType, chatId, userId, replyToMessageId, sessionId, occurredAt
- type is remote_agent.task_dispatched or remote_agent.task_failed

- [ ] **Step 4: Run tests and commit**

Run: node --test tests/unit/remote-agent-domain.test.mjs
Expected: PASS

Commit: feat(remote-agent): add completion reply and webhook event builders

---

### Task 3: Webhook notifier with retry bookkeeping

**Files:**
- Create: lib/remote-agent/infra/webhook-notifier.mjs
- Modify: lib/session-kanban/infra/sqlite-store.mjs
- Test: tests/unit/remote-agent-webhook-notifier.test.mjs

**Interfaces:**
- Consumes: queue item + completion event
- Produces:
  - createWebhookNotifier({ webhookUrl, token, fetchImpl, now } = {})
  - notify(event) -> { ok, status, body, error? }
  - store helpers: markNotifySent(id), markNotifyFailed(id, error)

- [ ] **Step 1: Write failing notifier test**

Assert notifier POSTs bearer-authenticated JSON to webhookUrl and returns ok=true on HTTP 200.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test tests/unit/remote-agent-webhook-notifier.test.mjs
Expected: FAIL because module missing

- [ ] **Step 3: Implement notifier and notify status transitions**

Behavior:

- no-op success when webhookUrl empty
- POST JSON event with Authorization: Bearer <REMOTE_AGENT_TOKEN>
- timeout 8s
- on HTTP 2xx -> notify_status=sent, notified_at_ms=now
- on failure -> notify_status=failed, increment notify_attempts, store truncated error
- never throw into dispatch loop; return structured result

- [ ] **Step 4: Run tests and commit**

Run: node --test tests/unit/remote-agent-webhook-notifier.test.mjs tests/unit/session-kanban-store.test.mjs
Expected: PASS

Commit: feat(remote-agent): add webhook notifier and notify status transitions

---

### Task 4: Hook Session Kanban dispatch outcomes into notifier

**Files:**
- Modify: lib/session-kanban/application/service.mjs
- Modify: server.js
- Modify: lib/remote-agent/index.mjs
- Modify: lib/remote-agent/application/config-service.mjs
- Test: tests/unit/session-kanban-service.test.mjs
- Test: tests/unit/remote-agent-config-service.test.mjs

**Interfaces:**
- Consumes: onQueueSettled?.(item) after markDispatched / markFailed
- Produces: automatic webhook delivery for source === "remote-agent" items

- [ ] **Step 1: Write failing service test**

Assert dispatchReady calls onQueueSettled for success and failure remote-agent items with statuses dispatched/failed.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test tests/unit/session-kanban-service.test.mjs
Expected: FAIL because onQueueSettled is ignored

- [ ] **Step 3: Wire settlement hook and server notifier**

In dispatchReady, after markDispatched / markFailed, await onQueueSettled(updatedItem).

In server.js, create notifier from:

- REMOTE_AGENT_WEBHOOK_URL
- or gateway.secrets.json -> remote_agent.webhook_url

For remote-agent items, build completion/failure reply, notify webhook, then markNotifySent / markNotifyFailed.

Expose webhook URL in config status for desktop page.

- [ ] **Step 4: Run tests and commit**

Run: node --test tests/unit/session-kanban-service.test.mjs tests/unit/remote-agent-config-service.test.mjs
Expected: PASS

Commit: feat(remote-agent): notify IM webhook when queue items settle

---

### Task 5: Desktop webhook config + docs/API surface

**Files:**
- Modify: desktop/src/modules/im-session-delivery.ts
- Modify: desktop/src/styles/panel.css
- Modify: lib/remote-agent/http/routes.mjs
- Modify: server.js
- Modify: .env.example
- Modify: docs/remote-agent-integration.md
- Test: tests/integration/remote-agent-api.test.mjs
- Test: tests/unit/remote-agent-config-service.test.mjs

**Interfaces:**
- Produces:
  - GET /v1/remote-agent/status includes webhookUrl, webhookConfigured
  - POST /v1/remote-agent/webhook body { webhookUrl }
  - desktop controls to save/clear webhook URL and show recent notify status

- [ ] **Step 1: Write failing config/API tests**

Assert configService.setWebhookUrl persists URL and getStatus reports webhookConfigured=true.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test tests/unit/remote-agent-config-service.test.mjs
Expected: FAIL on missing setWebhookUrl

- [ ] **Step 3: Implement API + desktop controls + docs**

Desktop IM 会话投递 page adds:

- webhook URL input
- save / clear buttons
- recent tasks show notifyStatus

Docs Stage 2 becomes implemented with callback contract containing type/taskId/reply/platform/chatType/chatId/userId/bindingKey/replyToMessageId.

Mark M3 items done except dangerous-action confirmations, which stay in M4.

- [ ] **Step 4: Full verification and commit**

Run:

node --test tests/unit/remote-agent-*.test.mjs tests/unit/session-kanban-*.test.mjs tests/integration/remote-agent-*.test.mjs
npm run check
npm run build:panel

Expected: PASS

Commit: feat(remote-agent): expose Stage 2 webhook config in desktop and docs

---

## Out of Scope for This Plan

- Dangerous-action confirmation tokens
- Native LangBot Runner / plugin packaging
- Streaming intermediate progress into IM
- Full transcript upload to chat
- AstrBot-specific adapter packaging

## Self-Review

1. Spec coverage: Stage 2 completion/failure events, webhook callback, bounded summaries/panel links, and adapter contract item 4 are covered. Confirmation tokens intentionally remain M4.
2. Placeholder scan: none intentionally left.
3. Type consistency: queue metadata field names and webhook event fields are reused across Tasks 1-5.
