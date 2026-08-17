# Session Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-client session kanban with persistent follow-up queues and safe automatic dispatch.

**Architecture:** A domain service normalizes client sessions and owns queue state. Reader adapters scan local client stores; dispatcher adapters call official CLI resume paths. SQLite persists queue records and dispatch audit fields. A modular panel tab renders board columns and queue actions.

**Tech Stack:** Node.js built-ins, `node:sqlite`, esbuild, TypeScript panel modules, node:test.

## Global Constraints

- Work only in `.worktrees/session-kanban` on branch `codex/session-kanban`.
- Never write a private client database with an unverified payload schema.
- Use `execFile`, not a shell, for all dispatcher commands.
- Preserve the existing panel design system and tab navigation behavior.
- Keep `server.js` limited to lazy service construction and route delegation.

---

### Task 1: Domain contracts and SQLite queue store

**Files:**
- Create: `lib/session-kanban/domain/model.mjs`
- Create: `lib/session-kanban/infra/sqlite-store.mjs`
- Test: `tests/unit/session-kanban-store.test.mjs`

**Interfaces:**
- Produces `SESSION_KANBAN_STATUSES`, `QUEUE_STATUSES`, `createSessionKanbanStore({ dbPath })`.
- Store methods: `enqueue`, `cancel`, `retry`, `list`, `claimForDispatch`, `markDispatched`, `markFailed`, `countBySession`.

### Task 2: Reader adapters

**Files:**
- Create: `lib/session-kanban/infra/codex-reader.mjs`
- Create: `lib/session-kanban/infra/claude-reader.mjs`
- Create: `lib/session-kanban/infra/antigravity-reader.mjs`
- Test: `tests/unit/session-kanban-readers.test.mjs`

**Interfaces:**
- Each reader exports `create<Client>Reader(options)` with `list(): Promise<KanbanSession[]>`.
- Readers never mutate source data.

### Task 3: Dispatchers and application service

**Files:**
- Create: `lib/session-kanban/infra/cli-dispatchers.mjs`
- Create: `lib/session-kanban/application/service.mjs`
- Test: `tests/unit/session-kanban-service.test.mjs`

**Interfaces:**
- Dispatchers export `canDispatch(session)` and `dispatch(session, message)`.
- Service exports `createSessionKanbanService` with `board()`, `enqueue`, `cancel`, `retry`, and `dispatchReady()`.

### Task 4: HTTP API

**Files:**
- Create: `lib/session-kanban/http/routes.mjs`
- Modify: `server.js`
- Test: `tests/unit/session-kanban-http.test.mjs`

**Interfaces:**
- `GET /v1/session-kanban/board`
- `POST /v1/session-kanban/queue`
- `POST /v1/session-kanban/queue/:id/cancel`
- `POST /v1/session-kanban/queue/:id/retry`
- `POST /v1/session-kanban/dispatch`

### Task 5: Panel tab and styles

**Files:**
- Create: `desktop/src/modules/session-kanban.ts`
- Modify: `desktop/src/main.ts`
- Modify: `desktop/index.html`
- Modify: `desktop/src/styles/panel.css`
- Test: `tests/unit/session-kanban-panel.test.mjs`

### Task 6: Verification and handoff

**Files:**
- Modify: `package.json`

Run all focused unit tests, `npm run check`, and `npm run build:panel`. Inspect the built panel contract and summarize limitations.
