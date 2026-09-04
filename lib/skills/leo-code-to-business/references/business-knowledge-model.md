# Business Knowledge Model

## Purpose

Define the canonical concepts shared by AI and HTML projections.

Schema v3 preserves the v2 separation between discovery signals, candidate decisions, authored
business knowledge, and requested Git history, then adds deep module, end-to-end flow,
calculation, code-to-knowledge, and scenario-narrative contracts. Schema v3.1 adds a separately
extensible engineering view joined to atomic business steps. Schema v3.2 adds repository-wide
project progress so a publishable checkpoint cannot be mistaken for completion. The canonical hash covers semantic
artifacts but excludes coverage, reviews, publication status, and projections.

## Discovery and Candidate Layer

`discovery-observations.jsonl` records what each adapter inspected and emitted. `inventory.jsonl`
is the immutable signal denominator for the snapshot. `use-case-candidates.jsonl` records one stable
seed candidate per repository-lineage/signal pair; adding supporting signals must not change its ID.

Candidate dispositions are `confirmed`, `variant`, `supporting_behavior`, `duplicate`, `excluded`,
or `unresolved`. Confirmed candidates point to a use case, variants point to a family and variant,
supporting behavior points to the candidate/use case it supports, and excluded/duplicate records
retain their reason. Critical/high unresolved candidates prevent current coverage from passing.

## Node Types

Represent capabilities, actors, use cases, use-case families, business rules, workflows, states,
domain events, entities, glossary terms, unknowns, conflicts, evidence, investigations, and typed
relationships.

Independent nodes:

```text
capability
actor
use_case
use_case_family
business_rule
workflow
state_machine
domain_event
entity
glossary_term
unknown
conflict
```

Structured values owned by a use case:

```text
goal
trigger
precondition
workflow_step
decision_point
state_change
data_change
external_effect
success_outcome
rejection_condition
failure_path
compensation_path
permission
observability_signal
```

Every structured value has `local_id`, `statement`, `claim_status`, `lifecycle_status`, and
`confidence`. Its canonical address is `<node-id>#<collection>/<local-id>`.

## Common Status

Use:

```text
claim_status:
confirmed | inferred | document_claim | historical | conflicted | unknown

lifecycle_status:
active | conditional | stale | invalidated | expired

confidence:
E3 | E2 | E1 | E0
```

Confidence is evidence strength, not coverage.

## Relationship Authority

`relationships.jsonl` is the only authoritative cross-node relationship source. Use:

```text
contains
initiates
participates_in
variant_of
uses_rule
reads
writes
transitions
emits
consumes
calls_external
fails_to
compensates
has_unknown
conflicts_with
evidenced_by
```

Do not duplicate `actor_ids`, `rule_ids`, `evidence_ids`, `capability_id`, family IDs, or related
use-case IDs inside nodes.

## Use-Case Contract

A business use case describes an actor pursuing a goal through decisions and outcomes. It is not an
endpoint or method. Confirmed use cases require:

```text
actor relationship
goal
trigger
main_flow
success_outcome
verified current-source evidence
all eight required investigation kinds
```

Confirmed critical/high use cases additionally require `scenario_narrative`. Importance comes from
the use-case fields when present and otherwise from the resolved candidate. Older revisions and
pre-narrative v3 records remain readable, but render as `summary_only`; a new v3 revision cannot pass
scenario readiness for those core scenarios.

`scenario_narrative` owns:

```text
business_context
starting_state
stages[] -> atomic steps
branch_matrix
failure_recovery_matrix
variants
worked_examples
history_event_ids
open_question_ids
```

Every atomic step names the actor or event, business action, business result, inputs, decision basis,
data/state/external effects, and current-source evidence. Every branch, failure/recovery row,
variant, and worked example also carries evidence. `main_flow` is a short synopsis only and cannot
substitute for the independently readable narrative.

## Engineering View Contract

Schema v3.1 adds `engineering-views.jsonl`, one record per use case. It does not create a second
scenario. It joins to `scenario_narrative` by `use_case_id + step_id` and owns:

```text
step_mappings
engineering_topics
change_guides
```

Every atomic step maps exactly once to one or more open-kind implementation units plus verified
reads, writes, state behavior, external interactions, configuration, runtime controls, and evidence.
Required topic kinds are `data_lifecycle`, `state_lifecycle`, `runtime_safety`,
`external_contracts`, and `configuration`; additional domain topics are allowed. A topic is
`confirmed`, `not_applicable`, or `source_unknown`, with evidence or searched unknowns as required.
Change guides identify affected steps, implementation starting points, data/state impact, downstream
risk, and observable verification targets. Read
[engineering-drilldown.md](engineering-drilldown.md) for the authoring rules.

## Project progress contract

Schema v3.2 adds `project-progress.json`. It inventories the whole repository as business modules,
tracks completed and unfinished knowledge destinations, and records the active and next modules.
Revision publication status remains independent: `partial` may be published as a truthful
checkpoint, while `project_completion_status = in_progress` requires continued execution. Read
[project-completion.md](project-completion.md) for state transitions and the completion gate.

The `main_flow` must describe participant actions or business events, ordered business stages,
business-facing decisions, and a visible result or handoff. Source identifiers and implementation order,
persistence operations, field inventories, queues, caches, indexes, and middleware cannot substitute
for those stages. Preserve those verified facts in decisions, rules, permissions, data/state
changes, external effects, observability, and evidence.

Preconditions, decisions, state/data/external effects, failures, compensation, permissions, and
observability require either substantive values or a `has_unknown` relationship from the exact
dimension address to a searched unknown.

## Use-Case Family Contract

A family owns a closure matrix over relevant actions and channels. Each cell is `confirmed`,
`variant`, `not_applicable`, `searched_not_found`, or `unresolved`, with a reason and investigation
evidence. Record reverse-writer investigations separately. A route catalog cannot stand in for
family closure.

## Current and History Artifacts

Current nodes describe behavior at the frozen snapshot. Optional history adds `git-commits.jsonl`,
`historical-claims.jsonl`, `git-change-facts.jsonl`, `business-evolution-events.jsonl`, and
`lineage-links.jsonl`. Commit messages remain claims. Business evolution requires verified
before/after invariants; rename-only facts do not create business events. Event effectiveness is
`active`, `superseded`, `reverted`, `partially_active`, `historical_only`, or `unknown`.

## Migration

`migrate_business_revision.py` copies a complete v1 revision into a new v2 run, preserves legacy
IDs, marks legacy inventory with `id_scheme = legacy_v1`, and leaves current coverage partial until
fresh v2 discovery establishes exact signals. Migration never edits the source revision or current
publication pointer.

Schema compatibility is readable, not equivalent in depth. A legacy or pre-narrative revision may
still support evidence lookup and historical comparison, but the HTML and AI projection must label
its core scenarios `summary_only` and must not imply that discovery or mapping equals complete
business understanding.

## Unknown Contract

Unknowns are useful knowledge, not failure text. Record the precise question, business importance,
reason, completed search envelope, inspected evidence, and resolution state. Never create a generic
"not found" unknown without recording what was searched.

## Gate

Canonical nodes and `relationships.jsonl` must validate before any projection is generated.
