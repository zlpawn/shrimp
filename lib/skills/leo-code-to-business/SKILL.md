---
name: leo-code-to-business
description: Use when translating a local code repository into current, evidence-linked business knowledge for AI task context and a human-readable offline HTML site. Reconstruct actors, goals, use-case families, rules, states, effects, failures, recovery, permissions, history, unknowns, and conflicts. Do not use for shallow architecture summaries, API inventories, ordinary code review, or interview-only storytelling.
---

# Leo Code to Business

Create one canonical business-knowledge revision from a frozen repository snapshot. Code is
evidence; business meaning is the product. Publish compact `ai-context.md` and deterministic
`site-view-model.json` / `site/index.html` projections carrying the same canonical revision hash.

## Invariants

- Start with actors, goals, decisions, lifecycle, outcomes, and business-visible effects—not
  packages or classes.
- A confirmed `main_flow` must be understandable without source-code knowledge: describe
  participant actions or business events, ordered business stages, business-facing decisions, and
  a visible outcome or handoff. Move identifiers, storage operations, middleware, and field writes
  to rules, effects, data/state changes, or evidence.
- Current source, SQL, schema, and active configuration outrank tests, documents, Git history, and
  inference.
- Use both forward trace and backward trace. Search alternate entries, use-case families, reverse
  writers, repair paths, and terminal outcomes.
- Every discovered signal must remain visible through candidate conservation: it supports a record
  in `use-case-candidates.jsonl` or has an evidence-linked non-candidate disposition.
- Missing dimensions become searched unknowns. Do not silently omit or guess them.
- Keep current facts, document claims, inference, conflicts, and `historical-claims.jsonl` separate.
  A commit message is a claim, never proof of behavior or reason.
- Unsupported detected languages force partial current coverage. Projections cannot be generated
  before canonical validation.

## Required Workflow

1. **Freeze snapshot and lineage.** Read
   [output-workspace.md](references/output-workspace.md), resolve `_leo_business`, and run
   `scripts/repository_snapshot.py`. Reference, acceptance, detached, and read-only repositories
   require an external workspace.
2. **Discover all applicable signals.** Read
   [repository-investigation.md](references/repository-investigation.md), detect languages, and run
   `scripts/discover_repository_signals.py`. Preserve `discovery-observations.jsonl`,
   `inventory.jsonl`, and `use-case-candidates.jsonl`; an empty adapter run is not successful
   coverage.
3. **Validate observations and the inventory denominator.** Enforce bidirectional observation ↔
   signal conservation and candidate conservation before semantic synthesis.
4. **Investigate seed candidates in capability waves.** Read
   [business-discovery.md](references/business-discovery.md). For each candidate record vocabulary
   expansion, entry search, forward trace, backward trace, alternate-entry search, rule search,
   contradiction search, and current source verification.
5. **Close use-case families and reverse writers.** Complete each family action/channel matrix.
   Every cell needs a confirmed, variant, not-applicable, searched-not-found, or unresolved
   disposition with evidence and reasoning.
6. **Build and validate current canonical knowledge.** Follow
   [business-knowledge-model.md](references/business-knowledge-model.md) and
   [evidence-and-confidence.md](references/evidence-and-confidence.md). Run
   `scripts/business_knowledge_guard.py` before any projection.
7. **Analyze requested history without trusting messages.** Use
   `scripts/git_business_history.py` to separate commits, historical claims, verified before/after
   facts, grouped business evolution, and current effectiveness. History is optional unless the
   request requires it, but its status remains independently visible.
8. **Run independent reviews.** Perform an independent omission audit and independent semantic
   review using only frozen canonical artifacts and the relevant rubric. Critical/high omissions
   prevent a passed revision.
9. **Build retrieval and human projections.** Use `scripts/task_context.py` for bounded task context,
   then `scripts/site_view_model.py` and `scripts/render_business_site.py`. Read
   [html-projection.md](references/html-projection.md).
10. **Validate hashes and publish immutably.** Track `current_coverage_status`,
    `history_coverage_status`, and aggregate status separately. Update only `current.json` after the
    immutable revision and all projections validate.

## Modes and References

- Build, update, query, and audit all begin with snapshot comparison. For update/query behavior,
  migration, staleness, and targeted gaps, read
  [incremental-update.md](references/incremental-update.md).
- For coverage denominators, status rules, and completion gates, read
  [coverage-and-completion.md](references/coverage-and-completion.md).
- For managed real-Git, cross-model, and fixed Java release evidence, read
  [acceptance-scenarios.md](references/acceptance-scenarios.md) and run
  `scripts/run_v2_acceptance.py`.
- If `codebase-memory-mcp` or another graph/AST/LSP provider is available, read
  [optional-code-tools.md](references/optional-code-tools.md). Check freshness and reopen current
  source for every load-bearing claim; provider absence is non-blocking.
- For Java/Spring-specific discovery, read
  [java-spring-discovery.md](references/java-spring-discovery.md).

A revision is `passed` only when current denominators conserve, required investigations and family
closure complete, confirmed claims have frozen current-source evidence, independent reviews pass,
and projection hashes match. Otherwise publish an exact `partial` result, or `blocked` when snapshot
or canonical integrity cannot be established.
