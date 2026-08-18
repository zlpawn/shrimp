---
name: leo-code-to-business
description: Use when a user wants to translate a local code repository into current, evidence-linked business knowledge for AI retrieval and a human-readable offline HTML knowledge site. Reconstruct actors, goals, use-case families, workflows, rules, states, data meaning, external effects, failures, recovery, permissions, unknowns, and conflicts from current source. Trigger for questions such as "工单怎么创建", "工地和视频怎么绑定", "把代码翻译成业务知识", "生成业务知识库", or "code to business". Do not use for a shallow architecture summary, API list, ordinary code review, or interview-only project storytelling.
---

# Leo Code to Business

Translate current repository behavior into business knowledge that both AI and people can use.
Code is evidence. Business meaning is the product.

## Core Objective

Produce one canonical, evidence-linked knowledge revision and project it into:

- structured JSON/JSONL plus compact `ai-context.md` for AI;
- a searchable, single-file offline `site/index.html` for people.

Both projections must carry the same canonical revision hash.

## Non-Negotiable Rules

1. Begin with actors, goals, decisions, outcomes, and business lifecycle. Do not begin with classes.
2. Current source, SQL, schema, and active configuration outrank documents and Git history.
3. Always run `scripts/discover_entrypoints.py` to capture the entire repository entrypoint denominator. Never manually cherry-pick or omit entries.
4. Acceptance benchmark fixtures are regression calibration tests, never the boundary of repository discovery.
5. For large multi-module repositories, process knowledge extraction in Capability Waves (Domain-by-Domain) to avoid context exhaustion.
6. A route list or controller-service-repository trace is not business knowledge by itself.
7. Follow behavior forward to mutations, external effects, outcomes, failures, and recovery.
8. Trace backward from important writes, states, external calls, events, and terminal outcomes.
9. Search alternate entries and build use-case families. One controller is rarely the whole behavior.
10. Every confirmed claim must resolve to evidence from the frozen current repository snapshot.
11. Missing business dimensions become searched unknowns. Never silently omit or guess them.
12. Keep document claims, historical explanations, inferences, conflicts, and current behavior distinct.
13. Do not generate AI or HTML projections before canonical artifacts pass validation.

## Modes

- **Build**: inventory the selected repository scope, reconstruct business knowledge, validate, then publish.
- **Update**: compare snapshots, invalidate changed evidence, reanalyze impacted knowledge, publish a revision.
- **Query**: answer from canonical knowledge; trigger targeted investigation when evidence is stale or missing.
- **Audit**: recheck inventory, evidence, investigations, coverage, semantic quality, and projections.

Every invocation against an existing workspace starts with a repository snapshot comparison.

## Required Workflow

### 1. Freeze Scope

Record repository root, branch, HEAD, working-tree state, file hashes, included modules, exclusions,
configuration scope, available tests/SQL/docs, run mode, and output location.

Read [output-workspace.md](references/output-workspace.md). Default to
`<repository-root>/_leo_business/`; explicit absolute output paths take precedence. Use an
external directory for reference, acceptance, detached, or read-only repositories.
Use `scripts/repository_snapshot.py` when available. Do not analyze against a moving snapshot.

### 2. Load Core References

Always read:

- [business-knowledge-model.md](references/business-knowledge-model.md)
- [evidence-and-confidence.md](references/evidence-and-confidence.md)
- [coverage-and-completion.md](references/coverage-and-completion.md)
- [repository-investigation.md](references/repository-investigation.md)

Read [business-discovery.md](references/business-discovery.md) before semantic reconstruction.

### 3. Run Independent Discovery Passes

Run `scripts/discover_entrypoints.py --repo <repo-root> --output <run-dir>/inventory.jsonl` to establish the complete repository inventory denominator.

Record exact queries, scope, inspected files/symbols, candidates, rejected results, truncation, and
follow-up decisions for:

1. entries and externally triggered behavior;
2. business nouns, identifiers, entities, fields, and states;
3. persistence mutations, events, indexes, files, and external effects;
4. rejection, failure, retry, compensation, cancellation, and operational repair;
5. tests, configuration, SQL, current documents, and Git leads.

No discovered entry or effect may disappear from the inventory denominator.

### 4. Reconstruct Bidirectionally

For each candidate use case, perform and record:

- vocabulary expansion;
- entry search;
- forward trace;
- backward trace;
- alternate-entry search;
- rule search;
- contradiction search;
- current source verification.

Trace the business path:

```text
actor/trigger -> validation -> decision -> orchestration -> data/state change
-> external effect -> success/failure -> retry/compensation/manual repair
```

### 5. Translate Into Business Knowledge

For every confirmed use case, establish or explicitly investigate:

- actor, goal, trigger, and preconditions;
- main business stages and decision points;
- business rules and their effects;
- state and data changes;
- external effects and business-visible outcomes;
- rejection, failure, retry, compensation, cancellation, and repair;
- role, tenant, ownership, and permission boundaries;
- variants, related use cases, unknowns, conflicts, and evidence.

Do not translate method names into prose and call that a business explanation.

### 6. Reconcile Use-Case Families

Search behaviors sharing the same business object, goal, identifier, mutation, state, event, external
operation, or user-visible outcome. Represent every discovered candidate as confirmed, inferred, or
searched unresolved.

### 7. Validate and Publish

Use `scripts/business_knowledge_guard.py` to validate inventory conservation, relationships,
evidence, investigations, unknowns, coverage, semantic review, revision hashes, and projections.

Publish immutable revisions only. Atomically update only `current.json`; AI and people locate the
current `ai-context.md` and `site/index.html` through that pointer.

### 8. Render Projections

Read [html-projection.md](references/html-projection.md), then use
`scripts/render_business_site.py`. HTML is a projection, never an authoring source.

### 9. Evaluate Real Questions

Answer project questions in this order:

```text
Business purpose
Actor, trigger, and outcome
Main business flow
Rules and decisions
State, data, and external effects
Failure, retry, compensation, and repair
Variants and related use cases
Unknowns and conflicts
Evidence
```

Use [acceptance-scenarios.md](references/acceptance-scenarios.md) for calibration.

## Optional Code Intelligence

Read [optional-code-tools.md](references/optional-code-tools.md) when graph, MCP, IDE, LSP, AST, or
similar tools are available.

If `codebase-memory-mcp` or another code graph is available, use it for discovery after freshness
checks. If unavailable, continue with ordinary local tools. Never confirm a load-bearing business
claim from provider output without reopening current source.

For Java/Spring repositories, also read
[java-spring-discovery.md](references/java-spring-discovery.md). It is a discovery guide, not a
required parser or runtime dependency.

## Update and Completion

Read [incremental-update.md](references/incremental-update.md) for update/query/audit runs.

A run is `passed` only when:

- all inventory entries and anchors are mapped, excluded with evidence, or visibly unresolved;
- required investigations are complete and non-truncated;
- confirmed claims have current-source evidence;
- every required business dimension has a value or searched unknown;
- use-case families and reverse writers were checked;
- AI and HTML projection hashes match the canonical revision;
- the semantic review begins in business language and passes its frozen rubric.

Otherwise publish a useful `partial` revision with exact gaps, or `blocked` when snapshot or
canonical integrity cannot be established.
