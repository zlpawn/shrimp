# Trend Intelligence Scheduler Eager Startup & Unified Pipeline Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the Trend Intelligence background scheduler starts immediately on gateway boot, triggers an immediate zero-token crawl upon launch, and unifies brief generation with smart auto-crawl fallback so users never have to click two buttons sequentially.

**Architecture:** 
1. Eagerly invoke `ensureTrendIntelService()` in `server.js` upon `server.listen`.
2. Enhance `createTrendIntelScheduler` in `lib/trend-intel/scheduler.mjs` to execute an immediate `runCrawl()` upon `start()`.
3. Enhance `generateBriefOnce()` in `lib/trend-intel/service.mjs` to automatically perform `crawlOnce()` if existing raw items are empty or stale (>30m).
4. Update `desktop/src/modules/trend-intel.ts` toolbar and empty state to offer a unified, seamless one-click experience.

**Tech Stack:** Node.js (ESM), SQLite (node:sqlite / better-sqlite3 compatible), TypeScript, HTML5 / CSS3.

## Global Constraints
- Strict physical isolation in `lib/trend-intel/`
- Node.js ESM format throughout
- Zero Token cost for pure crawl operations; LLM is only called on brief generation (fixed schedule or explicit user click)
- Backward compatibility with all existing REST endpoints

---

### Task 1: Backend Smart Ingestion Fallback in `generateBriefOnce`

**Files:**
- Modify: `lib/trend-intel/service.mjs`
- Test: `tests/unit/trend-intel-engine.test.mjs` & `tests/integration/trend-intel-api.test.mjs`

**Interfaces:**
- `generateBriefOnce(options)`:
  - Checks `db.getRawItems({ limit: 1 })`. If count is 0 or if `options.forceCrawl` or data is older than 30 mins, automatically calls `await crawlOnce()`.
  - Proceed with clustering, dual scoring, and brief generation.

- [ ] **Step 1: Write the failing unit/integration test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement smart crawl fallback in `lib/trend-intel/service.mjs`**
- [ ] **Step 4: Run tests to verify pass**
- [ ] **Step 5: Commit**

---

### Task 2: Scheduler Immediate Startup Crawl & Catch-Up Logic

**Files:**
- Modify: `lib/trend-intel/scheduler.mjs`
- Test: `tests/integration/trend-intel-api.test.mjs`

**Interfaces:**
- `createTrendIntelScheduler(service, options)`:
  - `start()`: Registers interval timers AND immediately fires `runCrawl()` asynchronously.

- [ ] **Step 1: Write the test for immediate initial crawl on start**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement immediate initial crawl in `scheduler.mjs`**
- [ ] **Step 4: Run tests to verify pass**
- [ ] **Step 5: Commit**

---

### Task 3: Gateway Boot Hook (Eager Scheduler Initialization in `server.js`)

**Files:**
- Modify: `server.js:883-930`
- Test: `tests/integration/trend-intel-e2e.test.mjs`

**Interfaces:**
- Eager startup in `server.listen`:
  - `ensureTrendIntelService()` called in `setImmediate` alongside `SessionWatcherDaemon`.

- [ ] **Step 1: Add boot check test in integration tests**
- [ ] **Step 2: Implement eager startup in `server.js`**
- [ ] **Step 3: Run full tests to verify pass**
- [ ] **Step 4: Commit**

---

### Task 4: Frontend UI Toast & Button Feedback Refinement

**Files:**
- Modify: `desktop/src/modules/trend-intel.ts`
- Test: `tests/unit/trend-intel-ui-build.test.mjs`

**Interfaces:**
- `triggerGenerateBrief()`:
  - Shows clear loading state and toast indicating automatic data sync & AI analysis.
- Empty State card:
  - Primary button `⚡ 立即生成今日简报` (1-click full pipeline).

- [ ] **Step 1: Update UI handler in `desktop/src/modules/trend-intel.ts`**
- [ ] **Step 2: Build panel bundle and run tests**
- [ ] **Step 3: Commit**
