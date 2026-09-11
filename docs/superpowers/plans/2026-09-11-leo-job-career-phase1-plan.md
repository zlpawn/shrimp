# Implementation Plan - Phase 1: `leo-job-career` Skill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portable, deterministic Phase 1 of `leo-job-career` as an integrated Skill in `local-ai-gateway` to collect ~100 active Beijing Java + Agent jobs, extract an evidence-linked market capability matrix, conduct targeted career interviews, and output a progressive weekend preparation roadmap targeting an offer by 2026-12-31.

**Architecture:** A single portable Skill rooted at `lib/skills/leo-job-career/` orchestrated by `SKILL.md` and powered by a deterministic Node.js CLI (`scripts/leo_job_career.mjs`) that isolates authentication, transport, normalization, persistence, and deduplication into test-covered ESM modules. All mutable runtime state and user data remain outside the repo in `~/.shrimp/leo-job-career/`. The LLM operates above this deterministic engine to perform semantic evaluation and conduct Socratic career interviews.

**Tech Stack:** Node.js (>=18, ESM), native `node:test` + `node:assert/strict`, native `node:crypto`, macOS `pbpaste` for clipboard import, JSON / JSONL storage, JSON Schema Draft 7 validation. Zero new npm runtime dependencies.

---

## Global Constraints

- **Single Skill Rule:** Must build one Skill named `leo-job-career` under `lib/skills/leo-job-career/`. Do not split into multiple skills.
- **Runtime Isolation:** Zero runtime dependency on `127.0.0.1:8787`, gateway REST routes, or running Shrimp daemon. Runtime files strictly under `~/.shrimp/leo-job-career/`.
- **Secret Safety:** Cookie values, headers, raw `securityId`, and `lid` must be redacted from logs, reports, and model outputs. Secret files created with `0600`, directories with `0700`.
- **Safe Read-Only Transport:** No account mutations (no favorites, greetings, messages, applications). Strict rate limiting, exponential backoff, and immediate pause on security checks or captchas.
- **Evidence Integrity:** Source facts, deterministic calculations, and LLM inferences must remain strictly separated and traceable to job IDs and source snippets.

---

## User Review Required

> [!IMPORTANT]
> **Authentication via Browser Extension Clipboard:** Phase 1 uses the existing `Leo cookie.txt Locally` Chrome extension to copy the Cookie Header from `zhipin.com`. The Skill CLI imports it locally via `pbpaste` into `~/.shrimp/leo-job-career/auth/`. You will never need to paste cookies into the chat window.

> [!IMPORTANT]
> **Data Collection Volume & Safety:** We aim for approximately 100 valid, non-outsourcing, Beijing-based Java + Agent jobs. If the market only provides 70-90 quality records matching our strict criteria, collection will gracefully terminate with `complete_below_target` rather than diluting standards.

---

## Open Questions

None. All core requirements, target compensation (60-70w), role preferences (Tech Lead / AI Backend / Management), time commitment (progressive weekends starting at 4-5 hrs/week), and project location (`/Users/pa/project/AI/local-ai-gateway`) have been clarified and approved in the design specification (`docs/superpowers/specs/2026-09-10-leo-job-career-design.md`).

---

## Proposed Changes

### Component 1: Skill Skeleton, Schemas, and Documentation

#### [NEW] [SKILL.md](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/SKILL.md)
User-facing entry point with YAML frontmatter, mode routing (`doctor`, `auth`, `market`, `jobs`, `profile`, `prepare`), non-negotiable safety rules, and workflow guidance.

#### [NEW] [openai.yaml](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/agents/openai.yaml)
Agent interface configuration (`display_name`, `short_description`, `default_prompt`).

#### [NEW] References (`lib/skills/leo-job-career/references/`)
- [NEW] [boss-data-contract.md](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/references/boss-data-contract.md)
- [NEW] [collection-workflow.md](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/references/collection-workflow.md)
- [NEW] [job-quality-policy.md](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/references/job-quality-policy.md)
- [NEW] [market-analysis.md](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/references/market-analysis.md)
- [NEW] [career-interview.md](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/references/career-interview.md)
- [NEW] [preparation-planning.md](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/references/preparation-planning.md)
- [NEW] [roadmap-phases-2-3.md](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/references/roadmap-phases-2-3.md)

#### [NEW] Schemas (`lib/skills/leo-job-career/schemas/`)
- [NEW] [career-profile.schema.json](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/schemas/career-profile.schema.json)
- [NEW] [job-fact.schema.json](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/schemas/job-fact.schema.json)
- [NEW] [job-analysis.schema.json](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/schemas/job-analysis.schema.json)
- [NEW] [experience-evidence.schema.json](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/schemas/experience-evidence.schema.json)
- [NEW] [run-summary.schema.json](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/schemas/run-summary.schema.json)

---

### Component 2: Core Deterministic Engine (`scripts/lib/`)

#### [NEW] [config.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/config.mjs)
Runtime path resolution under `~/.shrimp/leo-job-career/`, directory initialization with POSIX `0700` permissions.

#### [NEW] [sanitize.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/sanitize.mjs)
Redaction logic for Cookie headers, tokens, `securityId`, and `lid`.

#### [NEW] [auth.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/auth.mjs)
Header parser, clipboard import via `pbpaste` with optional clearing, Netscape fallback, `auth-state.json` maintenance, atomic `0600` secret writes.

#### [NEW] [salary.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/salary.mjs)
Deterministic parser for salary formats (`35-50K·15薪`, `20-30K`, `100-150元/天`), cash calculations, and explicit unknown month tracking.

#### [NEW] [boss-client.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/boss-client.mjs)
Safe, low-concurrency HTTP client for BOSS search and detail endpoints with jitter, backoff, and error classifications (`AUTH_REQUIRED`, `SECURITY_CHECK_REQUIRED`, `RATE_LIMITED`).

#### [NEW] [normalize.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/normalize.mjs)
Transforms raw BOSS API JSON responses into validated `job-fact` structures.

#### [NEW] [dedupe.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/dedupe.mjs)
Exact identity matching (`canonical_key = boss:<encryptJobId>`) and semantic repost grouping across company postings.

#### [NEW] [freshness.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/freshness.mjs)
Assigns freshness grades (A/B/C/D/E) from observation timestamps, validity flags, and recruiter activity.

#### [NEW] [run-store.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/run-store.mjs)
Run state machine (`created`, `collecting_lists`, `collecting_details`, `normalizing`, `classifying`, `complete`), manifest management, and checkpointing for resumability.

#### [NEW] [job-store.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/job-store.mjs)
Atomic JSONL read/write for facts, analyses, observations, and search queries.

#### [NEW] [cli.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/lib/cli.mjs)
CLI argument parsing and standard output envelope (`{ ok, command, data, warnings, next_actions }`).

#### [NEW] [leo_job_career.mjs](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/leo-job-career/scripts/leo_job_career.mjs)
CLI executable entry point wiring subcommands: `doctor`, `auth`, `market`, `jobs`, `profile`, `prepare`.

---

### Component 3: Catalog Registration & Test Suite

#### [MODIFY] [managed-catalog.json](file:///Users/pa/project/AI/local-ai-gateway/lib/skills/managed-catalog.json)
Register `leo-job-career` into the managed skills catalog with appropriate category, icon, and tags.

#### [NEW] Unit & Integration Tests (`lib/skills/leo-job-career/tests/`)
- `tests/unit/sanitize.test.mjs`
- `tests/unit/salary.test.mjs`
- `tests/unit/auth.test.mjs`
- `tests/unit/normalize.test.mjs`
- `tests/unit/dedupe.test.mjs`
- `tests/unit/freshness.test.mjs`
- `tests/unit/run-store.test.mjs`
- `tests/unit/cli.test.mjs`
- `tests/integration/market-pipeline.test.mjs`
- `tests/integration/profile-prepare.test.mjs`
- `tests/fixtures/*.json`: Sanitized responses for search, detail, auth failure, and security checks.

---

## Detailed Task Decomposition

### Task 1: Skill Skeleton, Configuration & CLI Envelope
- **Files:**
  - Create: `lib/skills/leo-job-career/scripts/lib/config.mjs`
  - Create: `lib/skills/leo-job-career/scripts/lib/cli.mjs`
  - Create: `lib/skills/leo-job-career/scripts/leo_job_career.mjs`
  - Test: `lib/skills/leo-job-career/tests/unit/cli.test.mjs`
- **Interfaces:**
  - `resolveRuntimePaths(baseDir?)` returns `{ root, auth, config, profile, data, runs, reports }`
  - `formatSuccess(command, data, options)` returns `{ ok: true, command, data, warnings, next_actions }`
  - `formatError(code, message, options)` returns `{ ok: false, error: { code, message }, checkpoint_saved, next_actions }`
- [ ] Step 1.1: Write failing tests for CLI envelope formatting and argument parsing.
- [ ] Step 1.2: Implement `config.mjs` with runtime directory resolution and `0700` permission enforcement.
- [ ] Step 1.3: Implement `cli.mjs` and executable `leo_job_career.mjs doctor`.
- [ ] Step 1.4: Run `node --test lib/skills/leo-job-career/tests/unit/cli.test.mjs` and confirm pass.

### Task 2: Redaction and Secret-Safe Auth Import
- **Files:**
  - Create: `lib/skills/leo-job-career/scripts/lib/sanitize.mjs`
  - Create: `lib/skills/leo-job-career/scripts/lib/auth.mjs`
  - Test: `lib/skills/leo-job-career/tests/unit/sanitize.test.mjs`
  - Test: `lib/skills/leo-job-career/tests/unit/auth.test.mjs`
- **Interfaces:**
  - `redactHeaders(headers)` / `redactUrl(url)` / `sanitizeRecord(record)`
  - `parseCookieHeader(raw)` -> `{ valid: boolean, cookies: Map<string, string>, names: string[] }`
  - `importFromClipboard({ clearClipboard })` -> `{ ok: boolean, status: string, cookie_count: number, cookie_names: string[] }`
  - `saveAuthState(state)` (atomic write `0600`)
- [ ] Step 2.1: Write failing tests for header/cookie value redaction, equality splitting, and atomic credential storage.
- [ ] Step 2.2: Implement `sanitize.mjs` for secret-safe logging and error messages.
- [ ] Step 2.3: Implement `auth.mjs` supporting clipboard import via `pbpaste`, Netscape parsing fallback, and verification status.
- [ ] Step 2.4: Wire `auth status`, `auth import-clipboard`, and `auth verify` in CLI.
- [ ] Step 2.5: Run tests and ensure zero raw cookie values leak into stdout or JSON envelopes.

### Task 3: Salary Parsing, Normalization & Fixtures
- **Files:**
  - Create: `lib/skills/leo-job-career/scripts/lib/salary.mjs`
  - Create: `lib/skills/leo-job-career/scripts/lib/normalize.mjs`
  - Create: `lib/skills/leo-job-career/tests/fixtures/*.json`
  - Test: `lib/skills/leo-job-career/tests/unit/salary.test.mjs`
  - Test: `lib/skills/leo-job-career/tests/unit/normalize.test.mjs`
- **Interfaces:**
  - `parseSalary(salaryDesc)` -> `{ monthly_min_cny, monthly_max_cny, salary_months, annual_cash_min_cny, annual_cash_max_cny, uncertainties }`
  - `normalizeJobFact(rawItem, rawDetail)` -> conforming to `job-fact.schema.json`
- [ ] Step 3.1: Create sanitized test fixtures from real BOSS responses (scrubbed of personal IDs).
- [ ] Step 3.2: Write failing unit tests for salary normalization (monthly, annual, multi-month, missing months).
- [ ] Step 3.3: Implement `salary.mjs` strictly avoiding synthetic month estimates when months are missing.
- [ ] Step 3.4: Write failing unit tests for `normalizeJobFact` and implement `normalize.mjs`.
- [ ] Step 3.5: Run tests and verify strict schema compliance.

### Task 4: Deduplication, Freshness, and Policy Gates
- **Files:**
  - Create: `lib/skills/leo-job-career/scripts/lib/dedupe.mjs`
  - Create: `lib/skills/leo-job-career/scripts/lib/freshness.mjs`
  - Test: `lib/skills/leo-job-career/tests/unit/dedupe.test.mjs`
  - Test: `lib/skills/leo-job-career/tests/unit/freshness.test.mjs`
- **Interfaces:**
  - `computeCanonicalKey(job)` -> `"boss:<encryptJobId>"`
  - `groupSemanticReposts(jobs)` -> `{ uniqueJobs: JobFact[], repostGroups: Map<string, JobFact[]> }`
  - `evaluateFreshness(job, observations)` -> `{ grade: "A"|"B"|"C"|"D"|"E", confidence, evidence }`
  - `detectDeterministicExclusions(job)` -> `{ excluded: boolean, reasons: string[] }` (outsourcing/dispatch keywords)
- [ ] Step 4.1: Write failing tests for exact dedupe and semantic repost detection across similar postings.
- [ ] Step 4.2: Implement `dedupe.mjs` using normalized title, salary, recruiter, and JD similarity.
- [ ] Step 4.3: Implement `freshness.mjs` adhering to policy grades A through E.
- [ ] Step 4.4: Run tests and verify deterministic exclusion filters (驻场, 人力外派, etc.).

### Task 5: Stores, Checkpointing & Resumability
- **Files:**
  - Create: `lib/skills/leo-job-career/scripts/lib/run-store.mjs`
  - Create: `lib/skills/leo-job-career/scripts/lib/job-store.mjs`
  - Test: `lib/skills/leo-job-career/tests/unit/run-store.test.mjs`
- **Interfaces:**
  - `RunStore.createRun(plan)` / `RunStore.updateStage(runId, stage, progress)` / `RunStore.checkpoint(runId)`
  - `JobStore.appendRaw(runId, type, item)` / `JobStore.saveFacts(facts)` / `JobStore.loadFacts(filters)`
- [ ] Step 5.1: Write failing tests for run lifecycle states, checkpointing, and interrupted run resumption.
- [ ] Step 5.2: Implement `run-store.mjs` and `job-store.mjs` with atomic writes.
- [ ] Step 5.3: Verify that an interrupted run picks up from the last checkpoint without duplicate network calls.

### Task 6: BOSS Read-Only Client & Market Pipeline Integration
- **Files:**
  - Create: `lib/skills/leo-job-career/scripts/lib/boss-client.mjs`
  - Test: `lib/skills/leo-job-career/tests/integration/market-pipeline.test.mjs`
- **Interfaces:**
  - `BossClient.searchJobs(query, options)` -> `{ list: RawJob[], hasMore: boolean }`
  - `BossClient.getJobDetail(securityId, lid, jobId)` -> `RawDetail`
- [ ] Step 6.1: Write offline integration tests using a mocked HTTP transport returning fixtures.
- [ ] Step 6.2: Implement `boss-client.mjs` with jittered pacing (1-3s delays), exponential backoff, and strict safety pauses.
- [ ] Step 6.3: Wire `market init`, `market update`, and `market report` into `leo_job_career.mjs`.
- [ ] Step 6.4: Run integration test demonstrating complete pipeline: search -> detail -> dedupe -> filter -> facts.jsonl -> report.

### Task 7: Career Profile, Interview Engine & Preparation Planning
- **Files:**
  - Create: `lib/skills/leo-job-career/references/career-interview.md`
  - Create: `lib/skills/leo-job-career/references/preparation-planning.md`
  - Create: `lib/skills/leo-job-career/schemas/career-profile.schema.json`
  - Create: `lib/skills/leo-job-career/schemas/experience-evidence.schema.json`
  - Test: `lib/skills/leo-job-career/tests/integration/profile-prepare.test.mjs`
- **Interfaces:**
  - CLI `profile init` (generates baseline profile matching user constraints: 8+ yrs Java, Demo Agent, 60-70w target, weekend hours)
  - CLI `profile record-evidence` (records structured interview outputs into `experience-evidence.jsonl`)
  - CLI `prepare plan` (computes capability gap matrix and outputs rolling weekend action plan)
- [ ] Step 7.1: Write failing tests for profile initialization and evidence record validation.
- [ ] Step 7.2: Implement CLI commands `profile` and `prepare`.
- [ ] Step 7.3: Implement gap analysis mapping market requirements to `evidenced_now`, `needs_refresh`, `buildable_by_deadline`, and `experience_bound`.
- [ ] Step 7.4: Run integration tests verifying progressive weekend schedule generation (4-5h -> 6-8h -> 8-10h).

### Task 8: Documentation, Managed Catalog & Final Skill Validation
- **Files:**
  - Create: `lib/skills/leo-job-career/SKILL.md`
  - Create: `lib/skills/leo-job-career/agents/openai.yaml`
  - Create: All remaining reference and schema markdown/json files.
  - Modify: `lib/skills/managed-catalog.json`
- [ ] Step 8.1: Write comprehensive `SKILL.md` with explicit workflow instructions, error recovery guides, and prompt hooks.
- [ ] Step 8.2: Create `agents/openai.yaml` and reference documents.
- [ ] Step 8.3: Register `leo-job-career` in `lib/skills/managed-catalog.json`.
- [ ] Step 8.4: Run full test suite (`node --test lib/skills/leo-job-career/tests/unit/*.test.mjs lib/skills/leo-job-career/tests/integration/*.test.mjs`) and ensure 100% pass.

---

## Verification Plan

### Automated Tests
Execute the entire test suite via Node.js native test runner:
```bash
node --test lib/skills/leo-job-career/tests/unit/*.test.mjs lib/skills/leo-job-career/tests/integration/*.test.mjs
```
Verify syntax and lint across the codebase:
```bash
npm run check
```

### Manual Verification
1. Run `node lib/skills/leo-job-career/scripts/leo_job_career.mjs doctor` to verify environment checks, directory permissions (`0700`), and CLI output formatting.
2. Run `node lib/skills/leo-job-career/scripts/leo_job_career.mjs auth status` to confirm graceful reporting when credentials are missing.
3. Run `node lib/skills/leo-job-career/scripts/leo_job_career.mjs profile init` and confirm `~/.shrimp/leo-job-career/profile/career-profile.json` is created with expected defaults.
