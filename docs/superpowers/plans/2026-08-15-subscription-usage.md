# Subscription Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Grok subscription mini-tool and remaining-usage display for Grok, Codex, and Antigravity.

**Architecture:** Keep subscription tools in the existing provider registry. Status remains cheap and synchronous; usage becomes an optional provider action so network/process work never blocks detail-page loading. Antigravity response credits are captured in an in-memory latest-snapshot cache.

**Tech Stack:** Node.js ESM, node:test, existing desktop TypeScript panel built with esbuild.

## Global Constraints

- Do not commit `gateway.config.json` or `antigravity.secrets.json`.
- No new runtime dependencies.
- Do not implement Grok OAuth; `grok login` owns credentials.
- Usage failure must never make auth status or node configuration unusable.
- Preserve the provider registry public interface while adding an optional `getUsage`.

---

### Task 1: Grok provider and usage action

**Files:**

- Create: `lib/grok/subscription-auth.mjs`
- Modify: `lib/subscription-auth/index.mjs`
- Test: `tests/unit/grok-subscription-auth.test.mjs`

**Interfaces:**

- Produces `getGrokAuthStatus({ env, home, config, authPath })`
- Produces `getGrokUsage({ env, home, config, authPath, baseUrl, fetchImpl })`
- Produces `grokSubscriptionAuthProvider` with id `grok`, actions `status`, `discover`, and `usage`
- Registry action `usage` calls `provider.getUsage(options)` when present

**Steps:**

- [ ] Write tests for missing/ready/expired auth, endpoint counting, billing normalization, request headers, and registry actions.
- [ ] Run `node --test tests/unit/grok-subscription-auth.test.mjs` and verify imports fail.
- [ ] Implement the provider, register it, and add the generic `usage` action.
- [ ] Re-run the test and commit.

### Task 2: Codex app-server usage reader

**Files:**

- Create: `lib/codex/account-usage.mjs`
- Modify: `lib/codex/subscription-auth.mjs`
- Test: `tests/unit/codex-account-usage.test.mjs`

**Interfaces:**

- Produces `readCodexAccountUsage({ command, spawnImpl, timeoutMs })`
- Produces `normalizeCodexRateLimits(payload)`
- Codex provider exposes `getUsage(options)`

**Steps:**

- [ ] Write tests for NDJSON framing, request IDs, timeout cleanup, and snapshot normalization.
- [ ] Run the new test and verify module import fails.
- [ ] Implement the child-process JSON-RPC client and normalize primary/secondary windows plus multi-bucket limits.
- [ ] Wire the provider action and test file, run Codex auth/account tests, and commit.

### Task 3: Antigravity remaining-credit capture

**Files:**

- Modify: `lib/antigravity/proto-codec.mjs`
- Create: `lib/antigravity/usage-store.mjs`
- Modify: `lib/antigravity/auth-service.mjs`
- Modify: `server.js` where Antigravity responses are consumed
- Test: `tests/unit/antigravity-usage.test.mjs`

**Interfaces:**

- Decoder returns `consumedCredits` and `remainingCredits`
- Produces `recordAntigravityUsage(snapshot)` and `getAntigravityUsage()`
- Provider `getUsage` returns the latest snapshot

**Steps:**

- [ ] Write protobuf decoding tests for fields 3 and 4 and store tests for latest-wins updates.
- [ ] Run the test and verify it fails.
- [ ] Implement decoding/store/provider wiring and record values in the existing streaming loop.
- [ ] Run Antigravity proto/auth tests and commit.

### Task 4: Subscription detail UI

**Files:**

- Modify: `desktop/src/app.ts`
- Test: `tests/unit/config-panel.test.mjs`

**Interfaces:**

- `toolsView` supports `grok-subscribe`
- Grok card appears in the 订阅接入 group
- Each detail renderer includes a shared usage summary and refresh path

**Steps:**

- [ ] Add panel tests for Grok tool metadata/detail routing and usage rendering in all three detail views.
- [ ] Run config-panel tests and verify failures.
- [ ] Implement `renderGrokSubscribeDetail`, shared usage formatting, and Grok state/actions.
- [ ] Run `npm run test:config-panel` and commit.

### Task 5: End-to-end verification

**Files:**

- No new source files.

**Steps:**

- [ ] Run all subscription/auth/proto tests.
- [ ] Run `npm run check`.
- [ ] Run `npm run build:panel`.
- [ ] Inspect `git status` and ensure only intended code/docs are committed; private runtime files remain uncommitted.
