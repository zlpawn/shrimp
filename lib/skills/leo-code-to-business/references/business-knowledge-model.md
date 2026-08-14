# Business Knowledge Model

## Purpose

Define the canonical concepts shared by AI and HTML projections.

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

Preconditions, decisions, state/data/external effects, failures, compensation, permissions, and
observability require either substantive values or a `has_unknown` relationship from the exact
dimension address to a searched unknown.

## Unknown Contract

Unknowns are useful knowledge, not failure text. Record the precise question, business importance,
reason, completed search envelope, inspected evidence, and resolution state. Never create a generic
"not found" unknown without recording what was searched.

## Gate

Canonical nodes and `relationships.jsonl` must validate before any projection is generated.
