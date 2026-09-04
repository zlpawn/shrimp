---
name: leo-code-to-business
description: Use when translating a local legacy repository into evidence-linked business knowledge for AI onboarding, human understanding, maintenance, debugging, feature development, or trustworthy Git business-evolution analysis. Do not use for shallow architecture summaries or API inventories.
---

# Leo Code to Business

Build a systematic business knowledge base from a frozen code snapshot. The shared spine is the
current business behavior expressed as independently readable scenarios. Product readers understand
what the business does; engineers drill from the same scenario into implementation and change risk;
AI retrieves both layers without inventing a second story. New builds publish schema `3.2` under
`.leo_business`; schema `1.0`, `2.0`, and `3.0` remain readable.

## Non-negotiable outcome

A passed revision must let a person or AI answer:

- What business capabilities exist, who uses them, and for what outcome?
- How does each important trigger travel across modules to a terminal business result?
- Which decisions, rules, states, calculations, external effects, failures, retries, and repair paths
  determine that result?
- Which code surface proves each conclusion, and what important code is not yet explained?
- For each business step, where is it implemented, what data/state/integration behavior supports it,
  and where should an engineer investigate a change?
- When did verified behavior change, what differed before and after, and is the design reason known?

Every confirmed business flow must be understandable without source-code knowledge: describe actor
actions or business events, decisions, stages, and visible outcomes; keep identifiers and storage
mechanics in evidence, rules, or effect details.

The primary product is one independently readable business scenario, not separate product and
engineering stories or a collection of parallel artifact summaries. For every confirmed
critical/high use case, read
[scenario-narrative.md](references/scenario-narrative.md) and populate `scenario_narrative` with
business context, starting state, staged atomic steps, branch closure, failure/recovery closure,
variants, worked examples, verified evolution links, open questions, and current-source evidence.
`main_flow` remains a synopsis; it cannot substitute for the narrative.

Then read [engineering-drilldown.md](references/engineering-drilldown.md) and create one
`engineering-views.jsonl` record for the use case. Join the business and engineering layers only by
`use_case_id + step_id`: every atomic business step maps exactly once to implementation units and
verified data, state, external, configuration, and runtime behavior. Keep implementation-unit and
topic kinds open to extension; do not bind the model to a language, framework, repository layout, or
deployment style.

Never compress repository discovery directly into a few generic use cases. Preserve this intermediate
layer:

`complete surface → module archaeology → end-to-end flows → rules/states/calculations → use cases → Git evolution → code-to-knowledge coverage → independent review`

## Evidence rules

- Current source, schema, SQL, and active configuration outrank tests, documentation, Git messages,
  names, and inference.
- A commit message is a historical claim, never proof of behavior or design reason. Store it in
  `historical-claims.jsonl`; verify behavior from before/after source facts.
- Reopen current source for every load-bearing claim. `source_verified: true` requires a non-empty
  content hash tied to the frozen snapshot.
- Use forward trace and backward trace. Search alternate entries, reverse writers, callbacks,
  consumers, schedulers, retries, compensation, operational repair, and terminal outcomes.
- Missing knowledge becomes an evidence-linked searched unknown. It is never silently omitted.
- If `codebase-memory-mcp` is available, prefer its graph search and tracing after checking freshness;
  read [optional-code-tools.md](references/optional-code-tools.md). Provider absence is non-blocking.

## Required workflow

1. **Freeze the repository.** Read [output-workspace.md](references/output-workspace.md), resolve
   `.leo_business`, and run `scripts/repository_snapshot.py`. Use an external workspace for reference,
   acceptance, detached, or read-only repositories.
2. **Discover the full system surface.** Read
   [repository-investigation.md](references/repository-investigation.md) and run
   `scripts/discover_repository_signals.py`. Conserve every observation, inventory signal, and
   `use-case-candidates.jsonl` record; empty adapter output is not success.
3. **Identify business modules before deriving use cases.** Partition the surface using business
   responsibility, shared data/state, entry-to-effect connectivity, and operational ownership—not
   directory names alone. Read [project-completion.md](references/project-completion.md), create
   `project-progress.json` for the whole discovered surface, and select work from its priority queue.
4. **Perform module-by-module archaeology.** Read
   [module-archaeology.md](references/module-archaeology.md). Produce one complete
   `module-dossiers.jsonl` record per business module or an evidenced exclusion.
5. **Reconstruct cross-module business journeys.** Read
   [end-to-end-flow-analysis.md](references/end-to-end-flow-analysis.md). Trace every important
   trigger through callbacks, async jobs, persistence, integrations, terminal outcomes, failures,
   retries, and repair. Produce `end-to-end-flows.jsonl`.
6. **Extract decisions, states, and calculations.** Follow
   [business-discovery.md](references/business-discovery.md) and
   [calculation-and-scoring-analysis.md](references/calculation-and-scoring-analysis.md). Any detected
   score, formula, weight, threshold, aggregation, quota, price, or ranking logic requires a
   `calculation-models.jsonl` record.
7. **Derive independently readable scenarios and use-case families from completed flows.** Use cases
   express actor goal and concise synopsis; `scenario_narrative` must let a product reader, engineer,
   or AI follow the same current scenario from trigger to terminal result without switching among
   artifact pages.
   Complete every family action/channel
   matrix and every required investigation: vocabulary expansion, entry search, forward trace,
   backward trace, alternate-entry search, rule search, contradiction search, and source verification.
8. **Build the engineering drill-down from those same atomic steps.** Read
   [engineering-drilldown.md](references/engineering-drilldown.md). Produce
   `engineering-views.jsonl`; map every step exactly once, summarize the stable engineering topics,
   and add evidence-linked change guides for realistic maintenance goals. Unknown behavior must point
   to a searched unknown; absence or inapplicability must be explicit.
9. **Account for every important code surface.** Read
   [code-knowledge-traceability.md](references/code-knowledge-traceability.md). Produce
   `code-knowledge-matrix.jsonl`; high/critical signals require a business mapping or a specific,
   investigated, evidence-linked disposition. Candidate conservation alone is insufficient.
10. **Analyze requested Git history.** Run `scripts/git_business_history.py` across the requested
   reachable history. Preserve exact commit identity and parents, verified before/after facts,
   grouped evolution, current effectiveness, confirmed reasons, and unknown reasons. Never choose a
   smaller denominator to make coverage pass.
11. **Run an independent omission audit, semantic review, and dual closed-book review.** Compare
    modules, important signals, flows, calculations, families, reverse writers, and code-knowledge
    coverage, then follow [closed-book-review.md](references/closed-book-review.md). A reviewer who
    sees only the generated knowledge must be able to retell the flow, choose branches, locate a
    failure, identify implementation and runtime behavior for a named step, assess a realistic change
    and its verification targets, and distinguish verified history from unknown reasons.
    Critical/high omissions, shallow scenarios, or incomplete investigations force `partial`.
    Before leaving the audit, attach every new important omission or business surface to an unfinished
    project module with a concrete next action.
12. **Validate canonical schema 3.2 before projection.** Run
    `scripts/business_knowledge_guard.py`. A new build cannot pass without
    `module-dossiers.jsonl`, `end-to-end-flows.jsonl`, `calculation-models.jsonl`,
    `code-knowledge-matrix.jsonl`, `engineering-views.jsonl`, and `project-progress.json`.
13. **Build deterministic AI and human projections.** Use `scripts/task_context.py`,
    `scripts/site_view_model.py`, and `scripts/render_business_site.py` to publish task context,
    `ai-context.md`,
    `site-view-model.json`, and `site/index.html`. HTML uses the fixed reading
    order defined in [html-projection.md](references/html-projection.md); models fill content but do
    not invent or remove primary views.
14. **Publish immutably.** Update `current.json` only after canonical validation, semantic review,
    projection hashes, `current_coverage_status`, `history_coverage_status`, and aggregate status all
    agree. Publishing `partial` creates a checkpoint; immediately continue the first executable module
    in `next_module_ids`. Do not report overall completion while `project_completion_status` is not
    `complete`.

## Completion gate

`passed` means all important signals are explained, each business module has a dossier, confirmed
critical/high use cases have complete scenario narratives grounded in end-to-end flows, every atomic
step has an engineering mapping, stable engineering topics and change guides are answered or honestly
classified, detected calculations are modeled, required investigations are complete, verified
evidence is frozen, requested Git history uses the true reachable denominator, both product and
engineering closed-book reviews pass, and projections share the canonical hash.

Otherwise publish the exact `partial` result. Use `blocked` only when snapshot or canonical integrity
cannot be established.

Revision coverage and whole-project completion are separate. A revision may be `partial` and
publishable while `project_completion_status` remains `in_progress`; this is not task completion.

For schemas and confidence semantics read
[business-knowledge-model.md](references/business-knowledge-model.md),
[evidence-and-confidence.md](references/evidence-and-confidence.md), and
[coverage-and-completion.md](references/coverage-and-completion.md). For Java/Spring discovery and
real-project release gates read [java-spring-discovery.md](references/java-spring-discovery.md) and
[acceptance-scenarios.md](references/acceptance-scenarios.md).
