# Remote Agent M4 Dangerous Action Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate dangerous remote-agent dispatches behind short-lived confirmation tokens, with configurable policy modes and desktop controls.

**Architecture:** Keep command ownership in Shrimp. Before Session Kanban enqueue, classify the message; if policy requires confirmation, store a pending action on the chat binding and return a plain-text challenge. `/agent confirm <token>` consumes the pending action and enqueues it; `/agent cancel` discards it.

**Tech Stack:** Node.js built-in test, existing remote-agent binding store / config service / desktop IM page.

**Spec:** docs/remote-agent-integration.md

## Global Constraints

- Users only ever see plain-text replies.
- Default policy is `confirm_dangerous`.
- Confirmation tokens expire in 10 minutes.
- Do not implement LangBot/AstrBot packaging in this plan.
- Do not block read-only commands (`/agent list|use|status|unbind|help`).

---

### Task 1: Dangerous action classifier and confirm commands

**Files:**
- Create: lib/remote-agent/domain/policy.mjs
- Modify: lib/remote-agent/domain/commands.mjs
- Modify: lib/remote-agent/domain/replies.mjs
- Test: tests/unit/remote-agent-domain.test.mjs

- [ ] Detect dangerous patterns: git push/reset/clean, package installs, recursive deletes, DROP/TRUNCATE, sudo/shutdown/reboot, force push.
- [ ] Parse `/agent confirm [token]` and `/agent cancel`.
- [ ] Add reply helpers for confirmation challenge, confirmed queue, expired/invalid token, and cancelled pending action.
- [ ] Update help text.

### Task 2: Pending confirmation store + service gate

**Files:**
- Modify: lib/remote-agent/infra/binding-store.mjs
- Modify: lib/remote-agent/application/service.mjs
- Modify: lib/remote-agent/application/config-service.mjs
- Test: tests/unit/remote-agent-binding-store.test.mjs
- Test: tests/unit/remote-agent-service.test.mjs
- Test: tests/unit/remote-agent-config-service.test.mjs

- [ ] Persist policy mode and pending confirmation per bindingKey.
- [ ] On dispatch: open => enqueue; confirm_dangerous/confirm_all => create pending token when needed.
- [ ] `/agent confirm` validates token+expiry then enqueues original message.
- [ ] `/agent cancel` clears pending confirmation.
- [ ] Expose policy mode get/set via config service.

### Task 3: Desktop policy controls + docs/API

**Files:**
- Modify: desktop/src/modules/im-session-delivery.ts
- Modify: lib/remote-agent/http/routes.mjs
- Modify: server.js
- Modify: .env.example
- Modify: docs/remote-agent-integration.md
- Test: tests/integration/remote-agent-api.test.mjs

- [ ] Add `GET/POST` policy endpoint for desktop.
- [ ] Desktop selector: open / confirm_dangerous / confirm_all.
- [ ] Document confirmation UX and mark M4 confirmation items done.
- [ ] Verify tests, check, build:panel, commit, push.

## Out of Scope

- Full allowlist/denylist UI for users/chats
- LangBot/AstrBot adapter packaging
- MCP approve_agent_action surface

## Self-Review

1. Spec coverage: policy modes, confirmation tokens, dangerous-action gates are covered; thin bot adapters remain out of scope.
2. Placeholder scan: none intentionally left.
3. Type consistency: policyMode and confirmation token fields reused across store/service/desktop.
