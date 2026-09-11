# Leo Job Career Skill Design

**Date:** 2026-09-10  
**Status:** Approved for planning  
**Skill name:** `leo-job-career`  
**Target repository:** `/Users/pa/project/AI/local-ai-gateway`  
**Phase 1 target:** Accept an offer by 2026-12-31; build a reliable market-research and preparation loop before resume generation or automated application work.

## 1. Decision summary

Build one portable Skill named `leo-job-career`. Do not split BOSS data collection, market analysis, resume adaptation, and application support into separate Skills. Keep one user-facing entry point and organize the implementation internally with deterministic Node.js scripts and selectively loaded references.

Phase 1 will:

1. import a BOSS Zhipin Cookie Header copied by the existing browser extension;
2. run without the local-ai-gateway daemon;
3. collect approximately 100 recent, valid, Beijing-based Java + Agent jobs;
4. keep fresh opportunities separate from stale benchmark-only jobs;
5. filter outsourcing, labor-dispatch, on-site contracting, Python-only, algorithm, and keyword-only AI jobs;
6. create an evidence-linked market capability matrix;
7. interview the user to reconstruct a career fact base;
8. compare the fact base with target-job requirements;
9. produce a progressive, weekend-oriented interview-preparation plan; and
10. support user-triggered incremental updates.

Phase 2 and Phase 3 are specified in this document for handoff, but are explicitly out of Phase 1 implementation scope.

## 2. Product intent

The Skill is a long-running career copilot grounded in current job evidence, not a one-shot job-description summarizer.

The first user's situation provides the initial acceptance scenario:

- Beijing-based Java backend engineer;
- more than eight years of experience;
- experience leading teams, designing architecture, owning core business systems, and coordinating cross-system governance;
- stronger in complex business systems than in extreme concurrency or performance infrastructure;
- Agent experience at the demo/API/RAG/function-calling level;
- little practical Python experience;
- current annual cash compensation approximately CNY 400,000-500,000, fixed monthly salary times 16, with no stock;
- minimum desired increase 30%, ideal increase 40%, target total compensation approximately CNY 600,000-700,000;
- large-company P7 or an equivalent senior/lead scope is a benchmark, not a hard requirement above compensation and real Agent experience;
- primary values are compensation growth and real Agent work;
- preparation time is concentrated on weekends and should increase progressively;
- desired outcome is accepting a satisfactory offer by 2026-12-31.

These values belong in a local profile, not in generic collection logic. Another user can initialize a different profile without changing the Skill.

## 3. Scope

### 3.1 Phase 1 — in scope

#### Market discovery

- Search BOSS Zhipin for Java-centric Agent, LLM application, RAG, knowledge-base, MCP, AI-platform, and AI technical-lead jobs.
- Search by full job content, not title alone.
- Prioritize Beijing opportunities.
- Include Internet companies, mature product companies, banks and financial technology, automotive technology, state-owned technology platforms, mature SaaS businesses, and credible AI product companies.
- Sample recent large-company roles as P7-level capability benchmarks.
- Normalize salaries, company facts, locations, recruiter activity, job descriptions, and access parameters.
- Preserve raw responses for reproducibility.
- Perform exact and semantic deduplication.
- Separate source facts from deterministic calculations and model judgments.

#### Personal analysis

- Build a market capability matrix from the valid job pool.
- Separate AI application backend, Agent platform/infrastructure, technical-lead, and technical-management expectations.
- Reconstruct the user's career facts through targeted interviews after market analysis.
- Classify capability gaps as already evidenced, needs refresh, learnable by the deadline, or dependent on experience that cannot be fabricated quickly.
- Recommend a primary, challenge, and fallback job strategy.
- Produce a short rolling preparation plan with one verifiable main outcome per weekend.

#### Operations

- Import authentication from the system clipboard.
- Read and write only under `~/.shrimp/leo-job-career/` for runtime state.
- Resume interrupted collection runs.
- Support manual incremental updates.
- Pause safely for expired authentication, security checks, or captcha.

### 3.2 Phase 1 — out of scope

- Scheduled or background collection.
- Automatic job collection without a user request.
- Automatic favorites, greetings, applications, or account mutations.
- Full resume generation.
- Application pipeline management.
- Offer comparison and negotiation workflows.
- Additional job boards.
- A web dashboard.
- Evasion of BOSS anti-abuse, captcha, rate limits, or account controls.
- Training, inference-kernel, or Python-only algorithm-job preparation as a primary track.

## 4. One Skill, internal modules

The intended source layout is:

```text
lib/skills/leo-job-career/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── scripts/
│   ├── leo_job_career.mjs
│   └── lib/
│       ├── auth.mjs
│       ├── boss-client.mjs
│       ├── cli.mjs
│       ├── config.mjs
│       ├── dedupe.mjs
│       ├── freshness.mjs
│       ├── job-store.mjs
│       ├── normalize.mjs
│       ├── run-store.mjs
│       ├── salary.mjs
│       └── sanitize.mjs
├── references/
│   ├── boss-data-contract.md
│   ├── collection-workflow.md
│   ├── job-quality-policy.md
│   ├── market-analysis.md
│   ├── career-interview.md
│   ├── preparation-planning.md
│   └── roadmap-phases-2-3.md
├── schemas/
│   ├── career-profile.schema.json
│   ├── job-fact.schema.json
│   ├── job-analysis.schema.json
│   ├── experience-evidence.schema.json
│   └── run-summary.schema.json
└── tests/
    ├── fixtures/
    └── *.test.mjs
```

This is one Skill. The files are implementation boundaries, not independently installed capabilities.

### 4.1 Responsibility boundaries

| Unit | Responsibility | Must not do |
|---|---|---|
| `SKILL.md` | Select operating mode, preserve user intent, route to the required reference, invoke scripts, interpret results | Embed large schemas, expose secrets, reimplement deterministic processing in prompts |
| CLI entry | Parse commands, return stable JSON envelopes, map expected failures to stable codes | Perform domain logic directly |
| Auth | Import, validate, store, and redact Cookie Headers | Print or send cookie values to the model |
| BOSS client | Issue bounded read-only requests and classify transport/auth/security failures | Circumvent controls or mutate the account |
| Normalizer | Convert raw API fields to versioned job facts | Add model inference to source facts |
| Stores | Atomic persistence, indexes, observations, run checkpoints | Make career judgments |
| Deterministic policies | Salary arithmetic, exact dedupe, freshness facts, obvious exclusion signals | Claim semantic certainty where interpretation is required |
| LLM analysis | Agent relevance, nuanced outsourcing assessment, capability extraction, career comparison | Modify source facts or invent missing evidence |

## 5. Portability and dependencies

The Skill must run in Codex, Claude Code, and comparable local agents that can execute Node.js commands and access the local filesystem.

### Required

- Node.js 18 or newer, matching the repository engine requirement.
- Network access to BOSS Zhipin.
- A locally copied Cookie Header for authenticated access.
- A supported clipboard command for the host OS when using clipboard import.

### Optional

- The existing `Leo cookie.txt Locally` Chrome extension to copy the Cookie Header.
- `ego-browser` for diagnostics or manual exploration when expressly available.
- local-ai-gateway for distribution and installation, but not runtime collection.

### Forbidden runtime dependency

Phase 1 must not require:

- `127.0.0.1:8787`;
- gateway cookie REST routes;
- the gateway extension task bus;
- a running Shrimp daemon;
- a browser automation session for every collection run.

## 6. Runtime data layout

All mutable and personal data lives outside the repository:

```text
~/.shrimp/leo-job-career/
├── auth/
│   ├── cookie-header.txt
│   ├── cookies-zhipin.com.txt
│   └── auth-state.json
├── config/
│   └── settings.json
├── profile/
│   ├── career-profile.json
│   ├── experience-evidence.jsonl
│   ├── skill-inventory.json
│   └── open-questions.json
├── data/
│   ├── raw/
│   │   ├── searches/
│   │   └── job-details/
│   ├── jobs/
│   │   ├── facts.jsonl
│   │   ├── analyses.jsonl
│   │   └── observations.jsonl
│   └── companies/
├── runs/
│   └── <run-id>/
│       ├── manifest.json
│       ├── events.jsonl
│       └── summary.json
├── reports/
├── resumes/          # reserved for Phase 2
└── applications/     # reserved for Phase 3
```

### Permissions

- Root and `auth/` directories: `0700` where supported.
- Secret files: `0600`.
- Writes to credentials and canonical records: temporary file plus atomic rename.
- Reports and logs must not contain cookie values, authorization headers, or full security parameters.

## 7. Authentication design

### 7.1 Primary Phase 1 flow

1. The Skill checks `auth/auth-state.json` and the secret file.
2. If credentials are missing or rejected, it asks the user to log into BOSS in Chrome.
3. The user opens `Leo cookie.txt Locally` and clicks **Copy Cookie Header** for `zhipin.com`.
4. The user tells the Skill that the header has been copied.
5. The Skill invokes `auth import-clipboard`.
6. The script reads the system clipboard locally, parses the header, writes it with restricted permissions, and validates it with a bounded read-only BOSS request.
7. The script returns only cookie count, names, source, timestamps, and validation status.

The user should not paste the Cookie Header into chat.

### 7.2 Accepted formats

Phase 1 must support:

1. Cookie Header from clipboard — primary UX;
2. Cookie Header from hidden standard input — fallback;
3. Netscape `cookies.txt` import — compatibility fallback.

The canonical request credential may remain a Cookie Header internally. Imported Netscape cookies can be converted to a request header without losing the original file.

### 7.3 Clipboard behavior

- macOS: prefer `pbpaste`; later implementations may add platform adapters.
- Validate the shape as semicolon-separated `name=value` pairs.
- Never echo clipboard content.
- Reject suspiciously large or obviously unrelated content.
- Preserve values containing `=` by splitting each pair at the first equals sign only.
- Clearing the clipboard after successful import is configurable and defaults to enabled.
- Clipboard clearing failure is non-fatal and must be reported without secret content.

### 7.4 Authentication state

`auth-state.json` contains metadata only:

```json
{
  "schema_version": 1,
  "domain": "zhipin.com",
  "source": "browser_extension_clipboard",
  "status": "valid",
  "imported_at": "2026-09-10T20:30:00+08:00",
  "last_verified_at": "2026-09-10T20:30:03+08:00",
  "cookie_count": 16,
  "cookie_names": ["__zp_stoken__", "lastCity"]
}
```

Do not hard-code one cookie name as sufficient. BOSS authentication may rely on multiple session and device cookies.

### 7.5 Failure handling

| Failure | Behavior |
|---|---|
| Missing credentials | Ask user to copy a new Cookie Header |
| Invalid clipboard format | Keep existing valid credentials; explain import format |
| Authentication rejected | Mark state rejected, checkpoint current run, ask for a new header |
| BOSS security check or captcha | Stop immediately, checkpoint, ask user to complete verification and recopy header |
| Job `securityId` expired | Refresh through search; do not ask for a new login unless authentication also fails |
| Account risk/limit response | Stop; do not retry aggressively or attempt evasion |

## 8. BOSS collection contract

The first verified data path used these read-only endpoint families:

- job-list search/recommend endpoint;
- job-detail endpoint using current `securityId` and `lid`;
- supporting filter and metadata endpoints when needed.

Endpoint paths and fields are observational, not a stable public API. They belong in `references/boss-data-contract.md` and isolated client/normalizer code so a BOSS change does not rewrite the career-analysis layer.

### 8.1 Collection strategy

1. Generate a versioned search plan from the profile.
2. Query sequentially or with very low bounded concurrency.
3. Save raw list responses before processing.
4. Run a cheap broad-relevance screen.
5. Fetch details for plausible candidates.
6. Save raw details before normalization.
7. Normalize facts.
8. Apply deterministic exclusions and exact dedupe.
9. Run semantic classification in bounded batches.
10. Apply semantic dedupe and final pool selection.
11. Produce quality and market reports.

### 8.2 Initial search families

Search phrases should cover titles and hidden JD content:

- Java Agent
- Java 智能体
- Java 大模型
- Java 大模型应用
- Java RAG
- Java 知识库
- Java MCP
- Java AI 应用
- AI 平台 后端 Java
- 大模型平台 后端 Java
- AI 应用 技术负责人
- AI 研发经理 Java
- Java 技术专家 大模型

Search-plan configuration remains editable because market wording will change.

### 8.3 Rate and safety policy

- Default to sequential requests with randomized delay.
- Allow only small configurable concurrency after live validation.
- Use capped exponential backoff for transient failures.
- Stop on authentication, security-check, captcha, risk-control, or repeated rate-limit responses.
- Never rotate IPs, forge devices, solve captchas, or otherwise evade controls.
- Persist progress before stopping.
- Do not guarantee exactly 100 jobs if the market does not provide 100 quality records.

## 9. Data model

### 9.1 Raw record

Each raw artifact includes:

- schema version;
- run ID;
- request family and non-secret query parameters;
- query/search-plan ID;
- request and response timestamps;
- HTTP/result status;
- body or a content-addressed body path;
- parser version;
- redaction status.

Secret request headers are never persisted with raw artifacts.

### 9.2 Normalized job facts

Facts contain only source-returned or deterministically calculated data:

```json
{
  "schema_version": 1,
  "source": "boss",
  "source_job_id": "...",
  "canonical_key": "boss:...",
  "title": "AI平台Java后端开发",
  "description": "...",
  "salary": {
    "raw": "35-50K·15薪",
    "monthly_min_cny": 35000,
    "monthly_max_cny": 50000,
    "salary_months": 15,
    "annual_cash_min_cny": 525000,
    "annual_cash_max_cny": 750000,
    "uncertainties": []
  },
  "requirements": {
    "experience_raw": "5-10年",
    "degree_raw": "本科",
    "labels": ["Java", "Spring Boot", "RAG"]
  },
  "company": {
    "name": "...",
    "industry": "...",
    "size": "...",
    "financing_stage": "...",
    "introduction": "..."
  },
  "location": {
    "city": "北京",
    "district": "海淀区",
    "business_district": "西北旺",
    "address": "...",
    "longitude": 116.0,
    "latitude": 39.0
  },
  "recruiter": {
    "name": "...",
    "title": "...",
    "activity_raw": "今日活跃"
  },
  "access": {
    "security_id": "...",
    "lid": "...",
    "captured_at": "..."
  },
  "observations": {
    "first_seen_at": "...",
    "last_seen_at": "...",
    "last_verified_at": "...",
    "status": "active"
  }
}
```

`security_id` and `lid` may be persisted because the user approved local caching. They are treated as refreshable job-access parameters, not durable login credentials, and are redacted from reports/logs.

### 9.3 Analysis record

Model and policy conclusions are separate and evidence-linked:

```json
{
  "schema_version": 1,
  "job_id": "boss:...",
  "analysis_version": "phase1-v1",
  "agent_relevance": {
    "level": "core",
    "confidence": 0.91,
    "evidence": ["负责企业智能体工作流平台建设"],
    "negative_evidence": []
  },
  "java_relevance": {
    "level": "primary",
    "confidence": 0.96,
    "evidence": ["Java/Spring Boot为主要后端技术栈"]
  },
  "role_family": "ai_application_backend",
  "outsourcing_risk": {
    "level": "low",
    "confidence": 0.82,
    "signals": [],
    "counter_evidence": []
  },
  "freshness": {
    "grade": "A",
    "confidence": 0.88,
    "evidence": ["岗位有效", "招聘者今日活跃"]
  },
  "pool": "main_target",
  "unknowns": []
}
```

Every inference must preserve concise source excerpts or field references. Unknown is preferable to invented certainty.

## 10. Job quality policy

### 10.1 Core validity gates

A job counts toward the initial target only when all apply:

1. Beijing or explicitly available for Beijing work;
2. detail is accessible and the role is currently active;
3. Java is primary or genuinely acceptable;
4. Agent/LLM application work is a substantive responsibility;
5. recruiter/job signals indicate a plausible active hiring intention;
6. no strong outsourcing, dispatch, or client-site contracting evidence;
7. not a duplicate of an already counted opportunity.

### 10.2 Java relevance

| Level | Meaning | Core pool |
|---|---|---|
| `primary` | Java/Spring is the explicit main backend stack | Yes |
| `accepted` | Multiple languages accepted and Java is credible | Yes, with caution |
| `adjacent` | Java transferable but team stack unclear | Watchlist until verified |
| `minor` | Java is only a weak bonus | No |
| `python_only` | Requires production Python as main language | No; benchmark only if exceptional |

Phase 1 does not require Python mastery. Basic Python literacy may later be recommended only when evidence shows it materially expands relevant Java-centric opportunities.

### 10.3 Agent relevance

Core signals include:

- Agent/智能体 runtime or applications;
- RAG or enterprise knowledge systems;
- function/tool calling;
- MCP or enterprise-tool integration;
- Agent workflow/orchestration;
- multi-Agent coordination;
- LLM application platforms;
- evaluation, observability, safety, permissions, or audit for Agent systems;
- integration of LLM capabilities with existing enterprise systems.

`keyword_only` jobs mention AI as an interest or bonus while remaining ordinary Java business development. They do not count.

### 10.4 Outsourcing assessment

Strong exclusion signals:

- explicit 驻场, 外派, 派驻客户, 人力派遣;
- employer differs from the actual working company without a credible product relationship;
- business is primarily IT staffing or labor dispatch;
- anonymous “top Internet client” project with unclear employer and business ownership;
- high-volume templated hiring across unrelated stacks;
- location/employer/client mismatch combined with delivery language.

Headhunter publication is not automatically outsourcing. Anonymous or incomplete headhunter jobs remain excluded from the core pool until the actual employer and relationship are verified.

### 10.5 Freshness grades

| Grade | Default rule | Core pool |
|---|---|---|
| A | Published/updated within 30 days, recruiter active within 7 days, detail valid | Yes, highest priority |
| B | Published/updated within 60 days, recruiter active within 14 days, detail valid | Yes |
| C | Date unavailable, but current search presence and recent recruiter activity support active hiring | Yes, lower confidence |
| D | Older than 60 days, recruiter inactive, or repeated without meaningful change | No; watchlist/benchmark |
| E | Near/over six months, removed, repeatedly stale, or recruiter inactive long-term | Excluded |

When BOSS does not expose a reliable publication date, the Skill must say so and use current search presence, recruiter activity, job validity, first-seen, last-seen, and repost history as evidence.

Old representative large-company jobs may enter `benchmark_only`, but never count toward the approximately 100 active jobs or current salary/activity statistics. Recent benchmark jobs are always preferred.

## 11. Deduplication

### 11.1 Exact identity

`source + source_job_id` identifies the same publication. Reobservation updates the observation timeline and detects fact changes.

### 11.2 Semantic repost identity

Within one company, compare normalized:

- title;
- location;
- salary;
- recruiter;
- responsibility and requirement text;
- skill labels.

High similarity produces a repost group, not duplicate counted jobs. Preserve every source ID and observation, select the freshest valid representative, and calculate repost/long-running risk.

Do not merge genuinely different teams or responsibilities merely because titles are similar.

## 12. Initial 100-job sampling

The target is approximately 100 valid jobs, not exactly 100 rows.

Expected funnel:

```text
150-250 raw list candidates
→ list-level coarse screening
→ detail retrieval
→ exact dedupe
→ semantic repost grouping
→ Java relevance
→ Agent relevance
→ freshness/activity
→ outsourcing/dispatch/on-site exclusion
→ up to approximately 100 valid Beijing jobs
```

If only 70-90 jobs pass, report `complete_below_target` with evidence that the main search space was exhausted. Never lower quality gates just to reach 100.

### Target portfolio, not quota

- approximately 60% realistic jobs whose visible compensation could plausibly meet CNY 600,000-700,000 or requires clarification;
- approximately 20% strong Agent-growth roles that may be slightly below target compensation;
- approximately 20% higher-paying or P7-caliber challenge roles.

Quality and actual availability override these percentages.

### Pools

- `main_target`
- `agent_growth`
- `challenge`
- `benchmark_only`
- `watchlist`
- `excluded`

## 13. CLI and user interaction

Natural language is primary. The model invokes a stable CLI for deterministic work.

### 13.1 Command surface

```text
leo_job_career.mjs doctor

leo_job_career.mjs auth status
leo_job_career.mjs auth import-clipboard
leo_job_career.mjs auth import-header
leo_job_career.mjs auth import-file <path>
leo_job_career.mjs auth verify

leo_job_career.mjs market init [--city 北京] [--target 100]
leo_job_career.mjs market update
leo_job_career.mjs market status
leo_job_career.mjs market report

leo_job_career.mjs jobs list [filters]
leo_job_career.mjs jobs show --id <id>
leo_job_career.mjs jobs explain --id <id>

leo_job_career.mjs profile init
leo_job_career.mjs profile status
leo_job_career.mjs profile record-evidence
leo_job_career.mjs profile build-skill-inventory

leo_job_career.mjs prepare plan
leo_job_career.mjs prepare update
```

The exact syntax may be refined during planning, but the modes and boundaries are stable.

### 13.2 Output envelope

Every command returns machine-readable JSON to stdout:

```json
{
  "ok": true,
  "command": "market.update",
  "data": {},
  "warnings": [],
  "next_actions": []
}
```

Expected user-action conditions return a stable non-secret error:

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "A fresh BOSS Cookie Header is required."
  },
  "checkpoint_saved": true,
  "next_actions": ["Copy a Cookie Header with the browser extension, then run auth import-clipboard."]
}
```

Stable codes should include at least:

- `AUTH_REQUIRED`
- `AUTH_REJECTED`
- `CLIPBOARD_INVALID`
- `SECURITY_CHECK_REQUIRED`
- `RATE_LIMITED`
- `NETWORK_ERROR`
- `UPSTREAM_SCHEMA_CHANGED`
- `JOB_REMOVED`
- `RUN_RESUMABLE`
- `INSUFFICIENT_MARKET_SAMPLE`

### 13.3 First-run conversation

1. User requests initialization.
2. Skill runs `doctor` and `auth status`.
3. If auth is absent, Skill gives the five-step browser-plugin instruction and waits.
4. User says the Cookie Header is copied.
5. Skill imports and verifies locally without exposing values.
6. Skill begins or resumes `market init`.
7. Skill reports stage-level progress, not every HTTP request.
8. Skill produces collection quality and market reports.
9. Skill starts targeted career interviews.
10. Skill produces the first rolling preparation plan.

### 13.4 Manual incremental update

The user triggers updates with requests such as “更新本周岗位”. The Skill:

1. loads the last successful state;
2. reruns the high-value search families, beginning with the freshest pages;
3. fetches only new or changed details where possible;
4. rechecks selected priority jobs for validity and recruiter activity;
5. updates repost and observation timelines;
6. recomputes market aggregates;
7. compares the previous report with the new report;
8. adjusts preparation only when changes are material.

No timer, scheduler, or daemon is required.

## 14. Run state and resumability

Long operations create a run manifest before network access.

Run states:

- `created`
- `collecting_lists`
- `collecting_details`
- `normalizing`
- `classifying`
- `reporting`
- `complete`
- `complete_below_target`
- `paused_auth_required`
- `paused_security_check`
- `paused_rate_limit`
- `partial`
- `failed`

Each unit of work has an idempotency key. A resumed run skips completed artifacts unless the user explicitly requests refresh.

Progress reports should include:

- search families complete/total;
- raw candidates;
- details succeeded/failed;
- exact and semantic duplicates;
- likely outsourcing;
- likely weak-Agent relevance;
- valid jobs by freshness grade;
- current authentication status without secret values.

## 15. Market analysis

The analysis layer operates on normalized, quality-filtered jobs and cites the underlying job IDs and evidence fields.

### 15.1 Role families

Each job receives one primary family and optional secondary families:

1. `ai_application_backend`
   - enterprise Agent applications;
   - RAG/knowledge base;
   - tool/MCP integration;
   - workflow and business-system integration.

2. `agent_platform_infrastructure`
   - Agent runtime/orchestration;
   - model gateway;
   - memory, evaluation, observability;
   - shared multi-tenant platform capabilities.

3. `technical_lead`
   - architecture, key-module implementation, technical decisions;
   - project decomposition and cross-team delivery;
   - team technical influence.

4. `technical_management`
   - people/team leadership plus meaningful technical ownership;
   - AI project planning, delivery, quality, and business outcomes.

5. `weak_or_adjacent_ai`
   - ordinary Java job with non-core AI wording; excluded from core market conclusions.

### 15.2 Capability taxonomy

Extract requirements into stable families:

- Java language and JVM;
- Spring/Spring Boot ecosystem;
- database/cache/message middleware;
- distributed-system design;
- performance and reliability;
- domain modeling and complex business architecture;
- cross-system integration and governance;
- RAG and retrieval;
- Agent orchestration and state;
- tool/function calling and MCP;
- prompt/context design;
- memory;
- evaluation and test methodology;
- observability, audit, permissions, and security;
- model gateway/provider integration;
- cost and latency management;
- Python literacy;
- technical leadership;
- people/project management;
- business/product collaboration;
- education, years, and domain requirements.

For every capability, report:

- weighted frequency in valid jobs;
- frequency by role family;
- frequency by company tier;
- frequency by compensation/pool;
- required versus preferred wording;
- representative recent jobs;
- benchmark-only appearance;
- confidence and sample-size caveats.

Do not let repeated postings by one company dominate frequency. Aggregate both by job and by unique company.

### 15.3 Compensation analysis

- Compute annual cash only when salary months are explicit.
- Never infer bonuses or stock from company reputation.
- Keep visible cash, unknown variable compensation, and claimed total compensation separate.
- Mark jobs with no salary-month count as `annual_unknown` rather than assuming 14/15/16 months.
- Use compensation as a pool signal, not the sole quality measure.

### 15.4 P7 benchmark analysis

P7 is a benchmark dimension, not a title filter. Analyze evidence for:

- ownership of an important direction;
- depth in at least one technical area;
- architecture and trade-off quality;
- ambiguous-problem decomposition;
- cross-team influence;
- project/business outcomes;
- mentoring or team leadership;
- operational responsibility;
- scale reasoning, even when the candidate's real systems were not hyperscale;
- credible Agent engineering depth.

Separate requirements that can be learned or demonstrated by December 2026 from experience claims that cannot be manufactured.

### 15.5 Report outputs

Phase 1 reports include:

1. collection-quality report;
2. Beijing Java + Agent market overview;
3. role-family comparison;
4. capability-frequency matrix;
5. compensation and company-tier analysis;
6. P7 benchmark profile;
7. target-company and target-role pools;
8. data limitations and unknowns.

## 16. Career fact base and structured interview

The user has no existing resume or durable career documents. Phase 1 therefore creates a fact base after the market report.

### 16.1 Interview principles

- Ask one question at a time.
- Ask about concrete events before abstract self-ratings.
- Prioritize questions mapped to high-frequency target capabilities.
- Distinguish personally implemented, led, influenced, and team-delivered work.
- Record missing metrics as unknown; never invent them.
- Preserve recalled facts separately from model summaries.
- Let the user correct any record.
- Revisit an experience progressively instead of requiring a long form upfront.

### 16.2 Evidence record

```json
{
  "schema_version": 1,
  "evidence_id": "exp-...",
  "employment_context": "...",
  "project_name": "...",
  "time_range": {"start": null, "end": null, "confidence": "unknown"},
  "business_context": "...",
  "starting_problem": "...",
  "role": "...",
  "team_scope": "...",
  "systems_involved": [],
  "constraints": [],
  "personal_actions": [],
  "led_actions": [],
  "team_actions": [],
  "decisions": [],
  "tradeoffs": [],
  "failures_and_recovery": [],
  "technical_outcomes": [],
  "business_outcomes": [],
  "metrics": [],
  "source": "structured_interview",
  "verification_status": "user_confirmed",
  "open_questions": []
}
```

The fact base is more complete than a resume. Phase 2 will select from it rather than rewrite history.

## 17. Gap analysis

Compare each market capability with career evidence using four main states:

1. `evidenced_now`
   - current facts demonstrate the capability at a relevant level.

2. `needs_refresh`
   - previously used or understood, but interview fluency or current implementation detail needs recovery.

3. `buildable_by_deadline`
   - can be learned and demonstrated with focused study, a project, or targeted practice before applications peak.

4. `experience_bound`
   - requires real production scale, model training, inference infrastructure, or other history that cannot honestly be created in a short preparation period.

Optional states:

- `not_required_for_primary_track`
- `unknown_need_interview`

For every gap, include:

- target roles that require it;
- job and company frequency;
- required depth;
- existing transferable evidence;
- recommended proof artifact;
- estimated effort;
- whether it should change job targeting.

The analysis must not treat lack of hyperscale experience as absence of architecture ability. It should identify transferable strengths such as complex business modeling, cross-system integration, state, permissions, audit, failure recovery, and team delivery, while keeping scale claims honest.

## 18. Preparation planning

### 18.1 Planning principles

- Market evidence defines preparation scope.
- Generate only the next two to four weekends in detail.
- Assign one primary, verifiable outcome per weekend.
- Increase effort progressively rather than demanding immediate 10-15 hour weeks.
- Favor artifacts and rehearsal over passive course completion.
- Start limited calibration applications before preparation feels complete.
- Do not change direction because of one unusual job.

### 18.2 Initial effort curve

Default for this user:

- first two weekends: approximately 4-5 hours each for market/profile calibration;
- following weekends: approximately 6-8 hours;
- key preparation period: approximately 8-10 hours, with optional 10-12 hour peaks;
- formal interview time is tracked separately.

The user can override this at any time.

### 18.3 Preparation workstreams

The plan may allocate time among:

- one narrow but deep enterprise Agent project selected after market analysis;
- Java/JVM/Spring refresh tied to actual target jobs;
- system-design and trade-off practice;
- Agent/RAG/MCP/evaluation/observability topics;
- reconstruction and rehearsal of two or three strongest past projects;
- P7-caliber leadership and influence stories;
- resume-fact readiness for Phase 2;
- limited calibration applications and interview feedback.

The Agent project should exploit the user's strengths. Likely shapes include an enterprise diagnostic or workflow Agent integrating multiple systems with permissions, audit, human confirmation, idempotency, failure recovery, and evaluation. The final project choice must follow the collected job matrix, not precede it.

### 18.4 Material-change rule

An incremental update changes priorities only when one or more apply:

- a requirement repeats across multiple new valid jobs;
- it appears across several company types;
- it is concentrated in target-compensation or target-level jobs;
- actual interviews confirm it;
- a previous high-frequency requirement materially declines.

Every adjustment explains evidence and expected benefit.

## 19. Phase 2 roadmap — targeted resumes

Phase 2 stays in the same Skill. It begins only after Phase 1 creates a useful career fact base and preparation evidence.

### 19.1 Goals

- Generate a truthful master resume from confirmed career facts.
- Generate role-specific versions for selected jobs.
- Select and order the most relevant evidence for each JD.
- Improve keyword coverage without copying or fabricating requirements.
- Identify unsupported claims and likely interview challenges.
- Produce a JD-to-resume trace explaining every adapted bullet.

### 19.2 Additional data

```text
~/.shrimp/leo-job-career/resumes/
├── master/
├── variants/<job-id>/
├── evidence-maps/
└── exports/
```

Resume records should contain:

- source evidence IDs;
- selected wording;
- target JD requirement IDs;
- truth/verification state;
- omitted relevant evidence;
- predicted follow-up questions;
- version and creation timestamp.

### 19.3 Hard rules

- Never invent employers, projects, metrics, scope, tools, or Agent production experience.
- Clearly separate learning/project evidence from production work.
- A model-generated metric is prohibited unless the user supplies or verifies it.
- “Team delivered” cannot silently become “I implemented”.
- Preserve a master fact base independent of any tailored resume.

### 19.4 Phase 2 completion

- one approved master resume;
- at least two role-family variants;
- traceable evidence for every material claim;
- a repeatable `resume adapt --job <id>` workflow;
- an interview-risk report for each generated variant.

## 20. Phase 3 roadmap — screening, applications, and offers

Phase 3 remains in `leo-job-career` and adds a user-controlled application pipeline.

### 20.1 Goals

- Continuously screen fresh jobs against profile and current preparation.
- Research company stability and employee/recruiting signals from multiple sources.
- Estimate commute impact from a privacy-preserving origin such as a nearby station or coordinates.
- Recommend apply now, prepare then apply, watch, or reject.
- Track application, recruiter contact, interviews, feedback, offers, and decisions.
- Compare offers using cash certainty, bonus, stock, work content, company risk, Agent authenticity, commute, and career value.

### 20.2 Application state machine

```text
discovered
→ watchlist
→ selected
→ resume_ready
→ user_approved_to_apply
→ applied
→ recruiter_contact
→ interviewing
→ offer
→ accepted | rejected | withdrawn | closed
```

### 20.3 Write-operation boundary

Phase 3 may prepare actions, but any BOSS mutation—favorite, greeting, message, or application—requires explicit user confirmation immediately before execution. Batch or silent applications are not an implied capability.

### 20.4 Company-review evidence

Separate:

- verified company facts;
- repeated multi-source patterns;
- single anonymous opinions;
- model inference;
- stale information.

Do not turn one employee complaint into a company-level fact.

### 20.5 Commute

- Store a nearby station or coordinates rather than a full home address where possible.
- Straight-line distance may be computed locally.
- Transit/driving time requires a routing source and timestamp.
- Distance is a ranking factor, not a universal hard filter; exceptional roles may remain.

## 21. Testing strategy

### 21.1 Unit tests

- Cookie Header parser, including values containing `=`.
- Redaction of cookies, headers, `securityId`, and `lid`.
- Permission and atomic-write behavior.
- Salary parsing and unknown salary-month handling.
- BOSS fixture normalization.
- exact dedupe and repost grouping.
- freshness grading with missing dates.
- deterministic outsourcing strong signals.
- run state transitions and resume behavior.
- JSON output envelopes and stable error codes.

### 21.2 Fixture tests

Use sanitized recorded fixtures for:

- successful search list;
- successful job detail;
- removed job;
- auth rejection;
- security-check response;
- schema drift/missing fields;
- anonymous headhunter role;
- clear outsourcing role;
- title without AI but JD with core Agent work;
- AI title with keyword-only JD;
- Python-only Agent role;
- repeated publication.

No real Cookie Header may enter the repository or test snapshots.

### 21.3 Integration tests

Offline integration tests cover:

- first-run initialization against fixture HTTP transport;
- checkpoint and resume;
- `complete_below_target` outcome;
- manual incremental update and change detection;
- report generation from facts and analyses;
- secret-free logs and reports.

Live BOSS smoke tests are manual and opt-in because they use a real account and unstable upstream behavior. They must be low-volume and read-only.

### 21.4 Skill validation

- Validate the Skill folder with the bundled Skill validator.
- Verify `SKILL.md` links every conditional reference.
- Verify `agents/openai.yaml` metadata and implicit invocation policy.
- Run realistic forward tests: missing auth, successful init, weekly update, excluded-job explanation, and gap-analysis interview.

## 22. Observability and privacy

### Logs may contain

- run ID;
- command;
- stage;
- counts;
- status/error code;
- endpoint family, not full sensitive URL;
- response timing;
- retry count;
- sanitized job/company IDs.

### Logs and reports must not contain

- Cookie Header values;
- clipboard contents;
- full request headers;
- raw `securityId` or `lid`;
- unnecessary personal identifiers;
- full home address.

The Skill should offer an `auth status`/`doctor` report that lists cookie names but never values.

## 23. Distribution in local-ai-gateway

Implementation should follow the repository's managed Skill conventions:

- source under `lib/skills/leo-job-career/`;
- `name: leo-job-career` in frontmatter;
- automatic invocation allowed unless later explicitly changed;
- `agents/openai.yaml` with concise UI metadata;
- add one deduplicated entry to `lib/skills/managed-catalog.json` if that remains the active catalog mechanism;
- ensure package publishing includes the Skill via the existing `lib` package inclusion;
- install/link through existing Shrimp Skill commands rather than adding a custom installer.

The current catalog contains duplicate historical entries for another Skill. `leo-job-career` implementation must not copy that duplication and should avoid unrelated catalog cleanup unless separately requested.

## 24. Phase 1 acceptance criteria

Phase 1 is complete when all of the following are demonstrated:

### Authentication

- User can copy a Cookie Header with the existing browser extension.
- `auth import-clipboard` stores and validates it without exposing values.
- Secret permissions and redaction tests pass.
- Expired/rejected authentication produces a resumable user-action state.

### Collection

- A fresh profile can start a Beijing Java + Agent collection run.
- Raw lists/details are preserved and normalized.
- Runs resume after interruption.
- Collection stops safely for captcha, security check, or account controls.
- The result is approximately 100 valid jobs or a justified `complete_below_target` result.

### Quality

- Core jobs are Beijing-centric, Java-centric, substantively Agent-related, active, and non-outsourcing.
- Freshness grades and evidence are visible.
- Stale benchmark jobs do not contaminate current-market statistics.
- Duplicate/reposted jobs do not inflate counts.
- Every exclusion is explainable.

### Analysis

- Reports separate AI application backend, Agent platform, technical lead, and technical management.
- Capability matrices include evidence, frequency, company diversity, and sample caveats.
- Compensation arithmetic does not invent salary months, bonuses, or stock.
- P7 benchmark requirements are separated from realistic near-term target roles.

### Personal preparation

- Structured interviews create user-confirmed career evidence.
- Gap analysis distinguishes evidenced, refreshable, buildable, and experience-bound capabilities.
- The next two to four weekends have concrete, verifiable outcomes and progressive effort.
- Manual market updates can revise the plan with an evidence-backed explanation.

## 25. Implementation sequence for the next model

The implementation plan should decompose work in this order:

1. Skill skeleton, metadata, local paths, CLI envelope, and `doctor`.
2. Secret-safe auth import/status/verify and tests.
3. BOSS transport abstraction plus sanitized fixture capture format.
4. Search/detail raw stores and normalizers.
5. Salary, observations, exact dedupe, run checkpoint/resume.
6. Freshness and deterministic exclusion policies.
7. Semantic classification batch contract and evidence records.
8. Semantic repost grouping and valid-pool selection.
9. Market reports and local queries/explanations.
10. Career profile, interview evidence, gap matrix, preparation plan.
11. Managed catalog integration and portable forward tests.

Do not begin Phase 2 resume generation or Phase 3 account mutations during this sequence.

## 26. Open implementation questions

These do not block design approval and should be resolved with small spikes during planning/implementation:

1. Which BOSS endpoint variant is most stable for keyword search versus recommendation pages?
2. Which exact response shapes reliably expose publication/update time and recruiter activity?
3. What request pacing is conservative enough in live use?
4. Should raw API bodies be one-file-per-response or content-addressed blobs plus indexes?
5. Which local persistence representation best balances JSONL inspectability and indexed queries—JSONL-only for Phase 1 or SQLite plus exported JSONL?
6. How should the CLI receive LLM semantic analyses portably across clients: stdin JSON batches, generated work files, or agent-written analysis records?
7. Which similarity method is sufficiently deterministic and dependency-light for repost grouping?
8. What minimum unique-company diversity is needed before presenting a market-wide capability conclusion?

The implementation plan must choose conservative defaults and keep formats versioned so these choices can evolve without losing collected data.

## 27. Handoff summary

The approved product is one portable Skill, not a gateway feature and not a family of Skills. Phase 1 first creates trustworthy current-market evidence, then personal preparation. The existing browser extension supplies a convenient Cookie Header, but the runtime remains independent of the gateway. All sensitive and personal data stays under `~/.shrimp/leo-job-career/`. Phase 2 and Phase 3 build on the same facts and stores without changing the Phase 1 truth/evidence boundaries.
