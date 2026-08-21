# Leo Lantern Task Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add extension-owned task isolation so CLI/MCP can start, claim, reuse, and end Agent Chrome tasks without stealing focus or polluting user tab groups.

**Architecture:** Keep CLI/MCP → bridge `:19527` → extension long-poll. Extension stores authoritative task state and executes window/group/tab strategies. Bridge caches a task summary for `doctor`. New commands register beside existing handlers without rewriting poll/dispatch.

**Tech Stack:** Node.js ESM (`clis/leo-lantern`, `mcps/leo-lantern`), Chrome MV3 extension (`extensions/leo-cookie-txt-locally`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-21-leo-lantern-task-isolation-design.md`

## Global Constraints

- One active task max.
- Default independent background window; `sameWindow=true` stays in current window.
- Same-task single-tab reuse unless `force=true`.
- `tabs.claim` requires explicit `tabId`; never infer current active tab.
- `tabs.new` / `tabs.goto` fail if no active task.
- Never adopt/rename user tab groups.
- Fail closed; no silent fallback.
- This phase does not implement wait/content/press/reload/network capture.

## File Structure

- Create: `extensions/leo-cookie-txt-locally/task-state.mjs` — authoritative state load/save/validate/summary
- Create: `extensions/leo-cookie-txt-locally/task-policy.mjs` — pure policy helpers for reuse/force/claim rules
- Create: `extensions/leo-cookie-txt-locally/task-chrome.mjs` — Chrome window/group/tab operations
- Create: `clis/leo-lantern/tests/task-policy.test.mjs`
- Create: `clis/leo-lantern/tests/task-state.test.mjs`
- Modify: `clis/leo-lantern/lib/protocol.mjs` — keep phase-A command constants
- Modify: `clis/leo-lantern/lib/server.mjs` — cache/sync task summary into doctor
- Modify: `extensions/leo-cookie-txt-locally/background.js` — register task handlers and sync summary
- Modify: `clis/leo-lantern/lib/cli.mjs` — start-task/claim/end-task + new-tab/goto policy flags
- Modify: `mcps/leo-lantern/lib/mcp-server.mjs` — matching MCP tools
- Modify: existing CLI/MCP/server tests

---

### Task 1: Protocol + pure task policy

**Files:**
- Modify: `clis/leo-lantern/lib/protocol.mjs`
- Create: `extensions/leo-cookie-txt-locally/task-policy.mjs`
- Create: `clis/leo-lantern/tests/task-policy.test.mjs`

**Interfaces:**
- Produces:
  - `COMMAND_TYPES.TASK_START = "task.start"`
  - `COMMAND_TYPES.TASK_END = "task.end"`
  - `COMMAND_TYPES.TABS_CLAIM = "tabs.claim"`
  - `decideNewTabAction({ hasClaimedTab, force }) -> "navigate-claimed" | "create-first" | "create-force" | "reject-no-task"` helpers as pure functions
  - `assertClaimParams(params) -> { tabId }`

- [ ] **Step 1: Write failing policy tests**
- [ ] **Step 2: Implement protocol constants + policy helpers**
- [ ] **Step 3: Run `node --test clis/leo-lantern/tests/task-policy.test.mjs`**
- [ ] **Step 4: Commit**

### Task 2: Extension task state module

**Files:**
- Create: `extensions/leo-cookie-txt-locally/task-state.mjs`
- Create: `clis/leo-lantern/tests/task-state.test.mjs`

**Interfaces:**
- Produces:
  - `createEmptyTaskState()`
  - `toBridgeTaskSummary(state)`
  - `validateTaskState(state, chromeIds)` clears invalid ids
  - `upsertActiveTask(state, patch)`
  - `clearActiveTask(state)`

- [ ] **Step 1: Write failing state tests**
- [ ] **Step 2: Implement state helpers**
- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

### Task 3: Bridge doctor summary cache

**Files:**
- Modify: `clis/leo-lantern/lib/server.mjs`
- Modify: `clis/leo-lantern/tests/server.test.mjs`

**Interfaces:**
- Produces: `LanternServer.taskSummary`, updated from `/ext/hello` and `/ext/result` payloads containing `task`
- Doctor body includes `task`

- [ ] **Step 1: Extend server tests for task summary**
- [ ] **Step 2: Implement cache + doctor field**
- [ ] **Step 3: Run server tests**
- [ ] **Step 4: Commit**

### Task 4: Extension Chrome operations + handlers

**Files:**
- Create: `extensions/leo-cookie-txt-locally/task-chrome.mjs`
- Modify: `extensions/leo-cookie-txt-locally/background.js`
- Modify: `extensions/leo-cookie-txt-locally/manifest.json` if needed for storage

**Interfaces:**
- Handlers for `task.start`, `task.end`, `tabs.claim`, and policy-aware `tabs.new` / `tabs.goto`
- Every task-mutating result includes `{ ..., task: summary }`

- [ ] **Step 1: Implement chrome ops + wire handlers**
- [ ] **Step 2: Ensure init restores/validates state and syncs summary on hello**
- [ ] **Step 3: Run lantern unit tests still green**
- [ ] **Step 4: Commit**

### Task 5: CLI + MCP surfaces

**Files:**
- Modify: `clis/leo-lantern/lib/cli.mjs`
- Modify: `mcps/leo-lantern/lib/mcp-server.mjs`
- Modify: `clis/leo-lantern/tests/cli.test.mjs`
- Modify: `mcps/leo-lantern/tests/mcp.test.mjs`

**Interfaces:**
- CLI: `start-task`, `claim`, `end-task`; `new-tab` supports `--force`; flags for `--same-window` / `--focus` / `--close-group`
- MCP: `browser_start_task`, `browser_claim_tab`, `browser_end_task`; existing new/goto accept `force`/`focus`

- [ ] **Step 1: Write CLI/MCP adapter tests**
- [ ] **Step 2: Implement adapters**
- [ ] **Step 3: Run `npm run test:leo-lantern`**
- [ ] **Step 4: Commit**

### Task 6: Verification gate

- [ ] **Step 1: Run `npm run check && npm run test:leo-lantern`**
- [ ] **Step 2: Sanity-check doctor task field and command mapping**
- [ ] **Step 3: Push branch if clean**

## Spec Coverage Check

- Active task reuse / single task → Task 1/2/4
- Independent background window + sameWindow → Task 4/5
- Single-tab reuse + force → Task 1/4/5
- Explicit claim tabId → Task 1/4/5
- Persistence + invalid id cleanup → Task 2/4
- Doctor summary → Task 3
- CLI/MCP parity → Task 5
- No wait/network in this phase → omitted intentionally
