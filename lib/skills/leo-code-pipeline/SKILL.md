---
name: leo-code-pipeline
description: "Pluggable, modular engineering quality orchestrator for the full development lifecycle. Assembles pre-coding architectural standards (leo-coding-standards), post-coding bug review & requirement falsification (leo-code-review), and future testing slots. Features on-demand stage skipping (full, review-only, guide-only), zero-friction JIT dependency auto-install via npx skills, and dynamic delivery quality cards."
---

# Leo Code Pipeline (可插拔代码研发质量编排中枢)

An extensible, composable development lifecycle orchestrator. Seamlessly connects **pre-coding standards** and **post-coding review** into an agile quality gate with on-demand skipping and zero-friction dependency auto-healing.

---

## 1. Core Principles (核心编排原则)

1. **Pluggable & Composable (乐高式可插拔)**:
   - Not an all-or-nothing monolith. Users are **NEVER forced to execute every stage**.
   - Supports 3 core modes: **Full-Pipeline (`full`)**, **Review-Only (`review-only`)**, and **Guide-Only (`guide-only`)** (see [stage-registry.md](references/stage-registry.md)).
2. **Context-Aware Stage Routing (智能上下文自适应)**:
   - If the workspace has uncommitted changes (`git diff` non-empty) and user asks for review $\rightarrow$ automatically enters **Review-Only** mode without forcing a pre-code loop.
   - If starting fresh and user asks for advice or new feature $\rightarrow$ enters **Full** or **Guide-Only** mode.
3. **On-Demand JIT Auto-Heal (按需依赖自愈)**:
   - Only ensures dependencies for the **active stages**. In **Review-Only** mode, `leo-code-review` is always required; when diff touches Java files or in a Java workspace, `leo-coding-standards` is **also pulled and activated** as the domain compliance ruleset to prevent architectural blind spots.
   - Self-heals missing skills non-interactively via `npx -y skills add zlpawn/shrimp -g --skill <name>`.
4. **Dynamic Delivery Quality Card (动态质量体检卡)**:
   - Only reports stages that actually executed. Skipped stages are marked with clear indicators (see [quality-card-template.md](references/quality-card-template.md)).

---

## 2. Stage Slots Architecture (阶段插槽)

```
leo-code-pipeline (Orchestrator)
├── Slot 0: Mode Selection & JIT Dependency Probe (scripts/ensure_dependencies.mjs)
├── Slot 1: [pre-code]    Pre-Coding Standards Injection (leo-coding-standards)
├── Slot 2: [impl]        Implementation by Host Agent
├── Slot 3: [post-review] Post-Coding Review & Falsification (leo-code-review)
├── Slot 4: [test]        Testing & Verification Gate (leo-code-qa)
└── Slot 5: [delivery]    Dynamic Delivery Quality Card
```

---

## 3. Step-by-Step Execution Workflow (执行流水线)

### Step 0: Mode Selection & Dependency Auto-Heal (模式判定与依赖就绪)
1. **Determine Active Slots**:
   - Check user prompt and workspace state:
     - **Review-Only**: Explicit review request or non-empty `git diff` with review intent $\rightarrow$ activate `[post-review]` (with domain hook `leo-coding-standards` if Java changes exist) and `[delivery]`.
     - **Guide-Only**: User asks for architecture, schema rules, or API advice before writing $\rightarrow$ activate `[pre-code]`.
     - **Full-Pipeline**: User asks to implement a complete task from scratch $\rightarrow$ activate `[pre-code]`, `[impl]`, `[post-review]`, `[test]`, and `[delivery]`.
2. **Check & Auto-Heal Dependencies**:
   - For each active slot, verify if its provider skill exists in `~/.agents/skills/`, `~/.gemini/config/skills/`, or `./lib/skills/`:
     - If `[pre-code]` is active and missing $\rightarrow$ run `npx -y skills add zlpawn/shrimp -g --skill leo-coding-standards`.
     - If `[post-review]` is active and missing $\rightarrow$ run `npx -y skills add zlpawn/shrimp -g --skill leo-code-review`. If the diff touches Java code, also ensure `leo-coding-standards` is available.
     - If `[test]` is active and missing $\rightarrow$ run `npx -y skills add zlpawn/shrimp -g --skill leo-code-qa`.
   - If a slot is **skipped**, DO NOT install its provider.

---

### Step 1: Pre-Code Guidance (Slot: `pre-code`)
*(Skipped in Review-Only mode)*
1. Invoke `leo-coding-standards` for the detected technology stack (e.g. Java):
   - Extract project architectural constraints (e.g. table non-null + default values, no unique indexes, Apollo fallback defaults, Guava/Commons API preferences).
2. Inject these rules into the working context as **mandatory pre-conditions** for coding.

---

### Step 2: Implementation (Slot: `impl`)
*(Skipped in Review-Only and Guide-Only modes)*
1. The host agent executes the code changes, strictly adhering to the pre-coding constraints injected in Step 1.

---

### Step 3: Post-Code Review & Falsification (Slot: `post-review`)
*(Skipped in Guide-Only mode)*
1. Invoke `leo-code-review` on the local `git diff` (including untracked files).
2. Execute the multi-track audit:
   - **Track A**: Logic bugs, edge-case crashes, concurrency races, resource leaks.
   - **Track B**: AI Agent compliance—unimplemented `TODO` stubs, silent exception swallows, dropped requirements.
   - **Track C (Domain Architectural Compliance)**: If changes include Java files, attach `leo-coding-standards` review checklist (`references/review-checklist.md`) to verify architectural `MUST` constraints (DDL not null + defaults, no physical unique index, Apollo fallbacks, Spring Bean field injection only, critical path INFO logs).
3. Conduct independent falsification (Devil's Advocate, confidence cutoff $\ge 80$).
4. If blocking bugs or architectural violations ($\ge 80$) are found, halt and prompt the agent/user for a fix before proceeding.

---

### Step 4: Testing & Verification Gate (Slot: `test` - Default: `leo-code-qa`)
*(Optional / Pluggable)*
1. Invoke `leo-code-qa` to execute targeted verification:
   - Scope diff impacts via `scope_diff.mjs`.
   - Run black-box E2E testing and backend diagnostics (via `leo-live-inspector`), or unit tests.
   - Enforce anti-optimistic UI checks and triple-check error detection.
2. If testing is skipped by user or not configured, mark as skipped.

---

### Step 5: Render Dynamic Quality Card (Slot: `delivery`)
1. **Default Delivery Mode (Zero-Pollution)**:
   - Output the final summary card in high-density Chinese directly to the **Chat / Terminal dialogue window**.
   - **Do NOT create any temporary report files in the project workspace** to prevent git pollution.
2. **Explicit User Archive Mode (On-Demand Persistence)**:
   - If the user explicitly requests saving or archiving the report (e.g. "保存报告", "把结果存下来", or `--save-report`):
     - **Destination Directory**: `~/.shrimp/skills/leo-code-pipeline/reports/` (auto-creates if missing).
     - **Naming Convention**: `YYYY-MM-DD_代码质量交付报告.md` (or `YYYY-MM-DD_<功能名>_代码质量<审查/交付>报告.md`).
     - Save via script: `node <skill-dir>/scripts/archive_report.mjs --title "<功能名>" --type "<交付/审查>报告" --content "<Markdown内容>"`.
     - Notify the user of the saved absolute path.
