# Leo Code to Business v2 Design

> Status: proposed and practice-calibrated
> Date: 2026-08-25
> Skill: `leo-code-to-business`
> Managed source: `lib/skills/leo-code-to-business`
> Supersedes for new work: `2026-08-14-leo-code-to-business-design.md`

## 1. Product Goal

`leo-code-to-business` is a persistent business-knowledge system for legacy repositories. It
translates current source into evidence-linked business knowledge, reconstructs meaningful business
evolution from Git history, and projects one canonical revision into forms optimized for AI and
people.

It is not a code summary, API catalog, or one-time report. It must help people and AI:

- understand an unfamiliar historical project from a business perspective;
- find complete use-case families rather than a few obvious endpoints;
- explain current workflows, rules, states, data meaning, external effects, failures, and recovery;
- distinguish current truth from historical intent and historical behavior;
- understand when and how important business behavior changed;
- locate the business impact of a proposed or completed code change;
- continue developing the project without repeatedly rediscovering the same knowledge;
- keep the knowledge aligned with later source changes.

The product invariant is:

```text
current code is the authority for current behavior
+ verified snapshot differences explain historical behavior changes
+ canonical knowledge serves AI and people
+ deterministic completeness gates prevent silent omission
```

## 2. Problems v2 Must Solve

### 2.1 Silent Use-Case Omission

Version 1 validates the depth of use cases already marked `confirmed`, but its main investigation
denominator is derived from those confirmed use cases. A model can produce a small number of
well-formed use cases while omitting other core use cases entirely.

Version 2 establishes independent discovery denominators before semantic modeling and requires
every discovered candidate to receive an explicit disposition.

### 2.2 Unstable Human Presentation

Version 1 has a fixed renderer, but record order and optional model-authored content still affect
the page. Version 2 generates HTML through a versioned deterministic view model with fixed
navigation, fixed section contracts, stable ordering, and precise empty states.

### 2.3 Untrustworthy Historical Narration

Commit messages, issues, PR descriptions, comments, and documents may be incomplete, stale,
careless, or wrong. They describe claims or intent; they do not prove what code did. Version 2
derives `what changed` from verified before-and-after repository evidence.

## 3. Evidence Authority and Separation

For current behavior, authority is:

```text
current executable source, SQL, schema, and active configuration
> current tests and interface contracts
> verified historical snapshots and diffs
> issue, PR, ADR, document, comment, and commit-message claims
> naming and model inference
```

History keeps three concepts separate:

1. `declared_change`: what a commit, issue, PR, document, or comment claimed.
2. `observed_change`: what verified parent and child snapshots prove changed.
3. `current_effectiveness`: whether that historical change remains active now.

A change reason is `confirmed`, `corroborated`, `inferred`, or `unknown`. A commit message alone
cannot produce `confirmed` or `corroborated`.

## 4. Design Principles

1. Discovery denominators are created before business synthesis.
2. No discovered signal or candidate may disappear.
3. Models translate verified behavior; scripts enforce conservation, identity, hashes, and gates.
4. Current business knowledge is the primary path. History uses progressive disclosure.
5. Git commits are evidence containers, not business knowledge objects.
6. Business evolution events, not commit logs, are the historical knowledge product.
7. A model may classify uncertainty but may not hide it.
8. AI and HTML projections come from the same immutable canonical revision.
9. Equivalent canonical knowledge produces byte-identical view models and HTML.
10. `passed` means high-risk omission was mechanically challenged.

## 5. Architecture

```text
repository snapshot
├── deterministic discovery adapters
├── model-led investigation and business reconstruction
├── Git index, verified change facts, and evolution events
├── canonical current and historical knowledge
├── deterministic guards and independent omission review
└── AI, task-context, and offline HTML projections
```

Optional graph, MCP, LSP, IDE, and AST providers remain discovery accelerators. Their freshness,
scope exclusions, unsupported languages, and truncation are recorded. Provider output never
replaces source verification.

## 6. Independent Discovery Denominators

Version 2 uses these mandatory signal classes:

### 6.1 Trigger Entries

- HTTP, RPC, GraphQL, WebSocket, and framework routes;
- message consumers and event listeners;
- scheduled and batch jobs;
- callbacks, webhooks, CLI, migrations, repair, reconciliation, and administration;
- public application-service entries not represented by a local adapter.

### 6.2 Mutation and Data Anchors

- inserts, updates, deletes, upserts, and bulk writes;
- repository, mapper, ORM, SQL, and migration writes;
- meaningful cache, file, object-storage, and search-index writes;
- writes to important identifiers and business fields.

### 6.3 State and Lifecycle Anchors

- state definitions and persisted status fields;
- assignments, transition guards, and terminal outcomes;
- cancel, close, reject, restore, retry, compensate, reconcile, and repair paths.

An enum alone proves a vocabulary, not a state machine.

### 6.4 External-Effect Anchors

- external APIs and SDKs;
- payment, approval, order, notification, identity, file, and search operations;
- event and message production;
- externally visible response and callback contracts.

### 6.5 Event and Operational Anchors

- produced and consumed domain events;
- retry and dead-letter handlers;
- maintenance, replay, reindex, migration, reconciliation, and repair workflows.

### 6.6 Supporting Scenario Evidence

Tests, SQL, schema, active configuration, interface specifications, documents, and Git history
contribute candidates and contradictions but cannot replace current-source verification.

## 7. Discovery Adapter Contract

`discover_entrypoints.py` becomes a compatibility wrapper around
`discover_repository_signals.py`. Each adapter reports its ID and version, claimed languages and
frameworks, scopes and file counts inspected, supported signal kinds, findings, ambiguous or
unsupported constructs, truncation, and diagnostics.

Missing adapter support produces `partial`; it must never produce a misleadingly small successful
inventory.

Initial required adapters are:

- Java/Spring: HTTP mappings, events, MQ, schedules, commands, persistence and state writes,
  Feign/HTTP clients, and producers;
- JavaScript/TypeScript Node: common HTTP frameworks, routes, handlers, jobs, CLI, database writes,
  events, external clients, producers, and consumers;
- a provider-neutral adapter manifest for later languages.

Regex may generate candidates, but semantic completeness cannot depend on regex alone.

## 8. Canonical Artifacts

Version 2 uses schema `2.0` and immutable revisions:

```text
revisions/<revision-id>/
├── manifest.json
├── ai-context.md
├── site-view-model.json
├── site/index.html
├── inventory.jsonl
├── discovery-observations.jsonl
├── use-case-candidates.jsonl
├── capabilities.json, actors.json, use-case-families.json
├── use-cases.jsonl, business-rules.jsonl, workflows.jsonl
├── state-machines.json, domain-events.jsonl, entities.json
├── glossary.json, aliases.json, relationships.jsonl
├── investigations.jsonl, evidence.jsonl, conflicts.jsonl, unknowns.jsonl
├── git-commits.jsonl, git-change-facts.jsonl
├── business-evolution-events.jsonl, lineage-links.jsonl
├── omission-audit.json, semantic-review.json
├── coverage.json
└── change-impact.json
```

`site-view-model.json` is a projection artifact, not an authoring source. It carries the canonical
hash and its own view-schema version and is excluded from the canonical semantic hash to avoid a
hash cycle.

## 9. Inventory and Candidate Models

Every inventory signal records:

```text
id, signal_class, kind, name, source_location, discovered_by,
structural_importance, classification, resolution_status,
mapped_node_ids, resolution_reason, snapshot_id
```

`signal_class` is `trigger_entry`, `mutation_anchor`, `state_anchor`,
`external_effect_anchor`, `event_anchor`, `operational_anchor`, or `scenario_evidence`.

Structural importance is `critical`, `high`, `normal`, or `low`. It reflects code-observable impact
such as terminal states, high-fan-in writes, money/approval/order effects, and compensation. It is
not assumed business priority. An optional `.leo-business.yaml` may supplement discovery with known
critical objects and questions but may never restrict discovery.

Every possible business use case is recorded in `use-case-candidates.jsonl` before synthesis:

```text
id, title, candidate_basis_signal_ids, candidate_status,
resolved_use_case_id, resolved_family_id, structural_importance,
business_priority, resolution_reason, investigation_ids, snapshot_id
```

Candidate status is exactly one of:

- `confirmed`: independent business use case;
- `variant`: variant of an existing use case or family;
- `supporting_behavior`: internal stage, not an independent actor goal;
- `duplicate`: equivalent to another candidate;
- `excluded`: verified as non-business or out of scope;
- `unresolved`: investigation cannot decide.

Candidate conservation is mandatory. Every disposition requires a target or evidence-linked reason.
Critical and high candidates may not remain unresolved in a `passed` revision.

## 10. Use-Case Family Closure

Each family records an applicability matrix across lifecycle actions and trigger channels.

Default actions include create, submit, modify, approve, reject, bind, unbind, cancel, close,
restore, retry, compensate, reconcile, repair, and status/query. Default channels include web, app,
RPC, message, callback, schedule, batch, administration, and operations.

Each cell is `confirmed`, `variant`, `not_applicable`, `searched_not_found`, or `unresolved`.
Non-applicable cells require reasons. A family involving writes, states, or external effects cannot
be complete without alternate-entry and backward-writer investigation.

## 11. Current Knowledge Additions

Existing business node types remain. Version 2 additionally requires:

- deterministic stable sort keys;
- use-case links to candidate IDs;
- capability coverage of every resolved family in scope;
- reverse writers and lifecycle anchors for important entities;
- separation of state vocabulary from verified transitions;
- explicit searched unknown, confirmed absence, or non-applicability for empty dimensions;
- links from current nodes to relevant evolution events.

New relationship types include `derived_from_candidate`, `evolved_by`, `precedes`, `succeeds`,
`possible_predecessor`, `possible_successor`, `declares`, `observes_change`, and `affects`.

## 12. Git History Model

### 12.1 Lightweight Commit Index

All reachable commits in the selected history scope are indexed with SHA, parents, author and
commit time, author identity, subject, changed paths, rename facts, change statistics, refs, merge
status, and initial classification.

Default traversal uses all locally reachable history. Shallow clones, missing objects, submodules,
and unavailable remote branches are explicit coverage limits.

### 12.2 Deep-Analysis Screening

A commit enters deep analysis when deterministic changes touch entries, contracts, rules, guards,
constants, permissions, tenant selection, states, writes, schema, external effects, events,
failure, retry, compensation, reconciliation, repair, or business test expectations.

Commit-message terms may raise recall but may not determine final classification.

### 12.3 Verified Change Facts

`git-change-facts.jsonl` uses fixed fact types including:

```text
entry_added, entry_removed, entry_contract_changed,
condition_added, condition_removed, condition_changed, constant_changed,
state_added, state_removed, state_transition_changed, state_write_changed,
field_added, field_removed, field_constraint_changed, data_write_changed,
external_call_added, external_call_removed, external_payload_changed,
event_added, event_removed, failure_path_changed, retry_policy_changed,
compensation_changed, permission_changed,
symbol_moved, symbol_renamed, code_extracted, implementation_replaced,
test_expectation_changed, configuration_changed
```

Every confirmed fact cites before and after snapshot evidence. A commit message is never sufficient
evidence for a change fact.

### 12.4 Business-Invariant Comparison

Historical analysis compares normalized use-case dimensions rather than source text:

```text
trigger, precondition, decision, state change, data change, external effect,
outcome, failure, compensation, permission
```

Renames, moves, method extraction, formatting, and implementation replacement do not create a
business evolution event when all relevant business invariants remain equivalent.

### 12.5 Business Evolution Events

One event may group several commits; one commit may contribute facts to several events. Required
fields are:

```text
id
title
change_type
before_summary
after_summary
business_effects
reason_status
reason_statement
declared_claim_ids
change_fact_ids
commit_ids
affected_node_ids
introduced_at
current_effectiveness
grouping_status
confidence
```

`current_effectiveness` is `active`, `superseded`, `reverted`, `partially_active`,
`historical_only`, or `unknown`.

`grouping_status` is `confirmed_group`, `probable_group`, `independent_commit`, or
`grouping_unknown`.

### 12.6 Commit Claim Verification

A declared commit statement is `verified`, `partially_verified`, `misleading`, `contradicted`, or
`unverifiable`. This is diagnostic and appears to ordinary readers only inside expanded technical
history evidence.

### 12.7 Lineage

Use-case identity is based on actor goal, business object, outcome, state/data effects, and external
effects rather than class or method names. Uncertain lineage remains `possible_*`; it is never
silently merged.

## 13. Coverage and Release Gates

Coverage stores raw counts, denominators, unresolved IDs, exclusions, and ratios. Ratios alone are
invalid.

Required current-behavior metrics are:

```text
language_adapter_coverage
trigger_entry_conservation
mutation_anchor_conservation
state_anchor_conservation
external_effect_conservation
event_operational_anchor_conservation
candidate_conservation
high_importance_candidate_resolution
business_entry_mapping
reverse_writer_coverage
family_closure_coverage
required_investigation_coverage
rule_evidence_coverage
scenario_coverage
unknown_discipline
projection_integrity
```

Required history metrics are:

```text
commit_index_coverage
deep_analysis_classification
before_after_evidence_coverage
business_event_mapping
reason_evidence_discipline
current_effectiveness_checks
history_unknown_visibility
```

A revision is `passed` only when:

1. all detected languages have an adapter or explicit excluded scope;
2. mandatory signal ledgers conserve their denominators;
3. every candidate has a valid disposition;
4. no critical or high candidate remains unresolved;
5. no critical or high write, state, external effect, event, or repair anchor is unexplained;
6. every confirmed use case passes the existing eight investigations;
7. applicable family closure cells have searched dispositions;
8. reverse writers and alternate entries were checked for significant effects;
9. independent omission audit has no unresolved critical or high finding;
10. current facts have verified current-source evidence;
11. confirmed history facts have before-and-after evidence independent of commit messages;
12. reason claims obey their evidence status;
13. canonical, AI, view-model, and HTML hashes match their contracts;
14. semantic review meets the frozen business-first rubric.

Current and history coverage have separate statuses. Incomplete history must not make current
knowledge appear stale; rich history must not hide incomplete current knowledge.

## 14. Independent Omission Audit

After primary synthesis, an independent reviewer receives frozen signal ledgers, canonical
artifacts, investigations, and denominators, but no expected answers or producing-model narrative.

It searches for unexplained entries, writes, states, external calls, events, repair paths,
incorrectly excluded candidates, missing variants, missing reverse writers, and technical narration
presented as business meaning.

Findings are stored in `omission-audit.json` with severity, signal IDs, candidate IDs, evidence, and
resolution. Findings reopen candidates and investigations; the reviewer does not directly author
canonical business knowledge.

## 15. AI Projection and Task Context Packs

`ai-context.md` remains a compact orientation document containing revision identity, project
purpose, capability map, retrieval instructions, current gaps, and history limits.

For a question or development task, query mode creates an ephemeral `task-context-pack` containing:

```text
question or task
matched capabilities and primary use cases
same-family variants
rules and states
entities and reverse writers
external effects, failures, and repairs
permissions and configuration conditions
important active historical events
unknowns, conflicts, and coverage warnings
evidence references
```

Task packs are run artifacts unless explicitly published and do not alter canonical knowledge.

## 16. Deterministic HTML View Model

HTML generation becomes:

```text
canonical revision
→ deterministic site-view-model.json
→ fixed renderer
→ site/index.html
```

The view model has fixed top-level views:

```text
overview
capability_tree
use_case_catalog
use_case_details
workflow_views
state_views
rule_catalog
effect_catalog
actor_permission_views
evolution_views
gap_views
coverage_dashboard
```

The renderer never decides which business sections exist. It only renders the validated view
model.

### 16.1 Fixed Navigation

The site always shows:

1. 首页
2. 业务能力
3. 用例目录
4. 业务流程
5. 生命周期与状态
6. 业务规则
7. 数据与外部影响
8. 角色与权限
9. 业务演进
10. 未知与冲突
11. 覆盖率与证据

Empty sections remain visible with accurate empty-state explanations.

### 16.2 Use-Case Detail Contract

Every use case uses the same order:

1. goal, actor, trigger, result, family, status, confidence;
2. trigger and preconditions;
3. ordered main flow;
4. rules and decisions;
5. state, data, event, and external effects;
6. success outcomes;
7. rejection and failure;
8. retry, compensation, reconciliation, and repair;
9. permissions and boundaries;
10. variants and related use cases;
11. current unknowns and conflicts;
12. compact evolution summary;
13. expandable source and investigation evidence.

Default evolution summary contains only the most recent important change, important change count,
history confidence summary, and a link to the full timeline. Full before/after details, reasons,
commits, and diffs are progressively disclosed.

### 16.3 Stable Ordering

All collections are normalized and sorted before view-model generation. Default order is:

```text
business priority
→ structural importance
→ capability stable key
→ family stable key
→ lifecycle order
→ normalized title
→ stable ID
```

Relationships, evidence, unknowns, and history events use explicit stable sort tuples. Input
JSON/JSONL order must not affect view-model or HTML bytes.

### 16.4 Empty-State Semantics

Missing content is one of:

- `confirmed_empty`: investigation established that no behavior applies;
- `searched_not_found`: required search completed without evidence;
- `not_investigated`: work remains incomplete;
- `not_applicable`: the dimension does not apply, with a reason.

The HTML must never collapse these into a generic “none”.

### 16.5 Offline Contract

The site remains a single HTML file with inline CSS and classic JavaScript, no fetch/XHR, modules,
service workers, CDN, remote fonts, or network dependency. Overview, use-case index, gaps, and
coverage remain readable without JavaScript.

## 17. Development-Support Workflows

### 17.1 Onboarding

```text
project purpose → capabilities → core objects → use-case families → workflows and states
→ failures and repair → important evolution → source evidence
```

### 17.2 Requirement Location

Query mode uses aliases, objects, actors, goals, families, rules, states, writes, external effects,
history, and code symbols. It does not rely on title keyword search alone.

### 17.3 Business Impact Analysis

Impact is `confirmed`, `probable`, `possible`, or `unknown`. It traverses families, shared rules,
reverse writers, states, events, external systems, failures, and repair paths. Code-call adjacency
alone does not prove business impact.

### 17.4 Test Suggestions

Knowledge may project positive, rejection, failure, recovery, variant, permission, and historically
changed boundary scenarios. Suggestions link to current rules and unknowns and do not invent generic
authorization, idempotency, or retry behavior.

### 17.5 Incremental Update

Source changes invalidate dependent claims before reanalysis. Unchanged semantics update evidence
locations without history noise. Changed semantics create verified change facts and candidate
evolution events. Deleted behavior becomes invalidated or historical. New signals enter all relevant
denominators. Projections regenerate only after canonical validation.

## 18. Migration from Version 1

Version 1 revisions remain immutable and readable. Version 2 does not rewrite them.

A migration command may import v1 nodes and evidence into v2 staging, but the result remains
`partial` until it completes new discovery, candidate creation, family closure, coverage,
view-model generation, and omission audit.

V1 `passed` cannot be carried forward automatically because its denominators are not equivalent.
`current.json` retains `ai_path` and `html_path` for compatibility while adding schema and projection
metadata.

## 19. Practical Validation Strategy

Implementation is not accepted on unit tests alone.

### 19.1 Deterministic Fixtures

Create fixtures covering:

- Java/Spring routes, events, jobs, writes, states, external clients, retry, and repair;
- Node/TypeScript routes, handlers, jobs, writes, events, and external calls;
- alternate entries writing the same entity;
- a core use case discoverable only from reverse writes or external effects;
- misleading and nearly empty commit messages;
- pure rename, move, and extract-method refactors;
- real business-condition changes;
- multi-commit business events;
- revert and superseding changes;
- unknown reasons and missing historical objects.

### 19.2 Omission Mutation Tests

Starting from a valid revision, deliberately remove a high-importance candidate, write mapping,
alternate entry, family disposition, reverse writer, or source-verification investigation. Every
mutation must fail the Guard or downgrade to `partial` with the exact missing ID.

### 19.3 HTML Contract Tests

Tests prove:

- reversing or shuffling every input collection yields identical view-model and HTML bytes;
- all fixed navigation views exist;
- all use-case sections use the required order;
- every empty-state category renders distinctly;
- history is compact by default and expands on demand;
- state, event, entity, actor, conflict, and evidence data are genuinely rendered;
- output is file-protocol safe and readable without JavaScript;
- view-schema, canonical, view-model, and HTML hashes are mutually consistent.

### 19.4 Real Repository Practice

Use at least:

1. `/Users/pa/project/JZ/utopia-scs-recorder` for Java/Spring, known scenarios, alternate entries,
   repair paths, external integrations, and long Git history;
2. `/Users/pa/project/AI/local-ai-gateway` for Node/TypeScript and proof that missing adapter support
   cannot produce a misleadingly small successful inventory.

Tests record exact snapshot IDs, use external temporary workspaces, and never modify analyzed
repositories.

For the Java repository, validate work-order creation, the full video-binding family, one use case
found primarily through reverse writers, one repair/retry path, and a stratified Git sample with
meaningful, generic, merge, refactor, and revert-like commits.

### 19.5 Cross-Model Stability

Run the same frozen snapshot with at least two model configurations. Compare signal denominators,
candidate recall and dispositions, critical/high unresolved items, family membership, normalized
view-model structure, and semantic-review scores.

Model prose may vary. Denominators, stable IDs, required sections, unresolved omissions, and HTML
structure must not.

## 20. Baseline Evidence Collected

Non-mutating practice on August 25, 2026 found:

- all 50 existing skill unit tests passed;
- the current Java scanner reported 623 entries in the Java acceptance repository, all unresolved;
- direct calibration found 683 Spring HTTP mapping annotations, three Spring event listeners, six
  MQ listeners, and 34 Feign clients, showing that the current scanner is not a complete repository
  signal denominator;
- the scanner reported only two entries for the predominantly Node/TypeScript gateway repository
  because its orchestrator currently activates only Java discovery;
- the Java repository has 3,472 reachable commits, with at least 30 nearly empty messages such as
  `fix`, `优化`, or `调整`, confirming commit messages cannot support business reasons;
- reversing list order in the sample revision changed HTML bytes, confirming the need for
  deterministic normalization and a view model;
- the refreshed code graph excluded this skill's scripts from its default index, confirming that
  provider coverage must be observed and cannot replace source inspection.

These are calibration observations, not permanent acceptance constants.

## 21. Delivery Scope

### 21.1 Required for v2

- multi-signal discovery with Java/Spring and Node/TypeScript adapters;
- candidate ledger and conservation;
- structural importance and high-risk gates;
- family closure;
- expanded coverage and Guard;
- deterministic view model and fixed HTML information architecture;
- lightweight full Git index;
- verified before/after change facts;
- evolution events with commit-message distrust;
- v1-to-v2 partial migration;
- synthetic and real-repository validation.

### 21.2 Deferred

- hosted collaborative service;
- background daemon and remote synchronization;
- automatic private issue-tracker access;
- automatic confirmation of business reasons without evidence;
- automatic business-priority assignment;
- complete cross-repository business transactions;
- adapters for every language in the first implementation;
- application-code modification from the HTML site.

## 22. Implementation Boundary

This specification authorizes changes only to the managed skill, its tests and fixtures, catalog
metadata when needed, and its design/plan documentation. It does not authorize changes to analyzed
application repositories or publication of generated knowledge into them during acceptance.

Implementation planning should split work into:

1. schemas and v2 artifact loader;
2. discovery framework and adapters;
3. candidate and family completeness guards;
4. deterministic view model and HTML renderer;
5. Git index, change facts, and evolution events;
6. migration and incremental update;
7. synthetic and real-repository acceptance.

## 23. Definition of Done

Version 2 is ready only when:

- a deliberately omitted core use case cannot silently pass;
- an unexplained high-impact write, state change, external effect, event, or repair path cannot pass;
- Java/Spring and Node/TypeScript repositories receive honest discovery coverage reports;
- the same semantic revision produces identical HTML bytes regardless of input record order;
- the site has a stable business-first reading path with compact history;
- AI can retrieve current facts, variants, impact context, and verified evolution without treating
  historical claims as current truth;
- a `fix` or misleading commit message cannot independently create a confirmed event or reason;
- pure refactors do not pollute business timelines;
- changed business invariants create evidence-linked evolution events;
- current and history coverage are independently visible;
- deterministic, mutation, projection, history, and real-repository tests pass.
