# Business Discovery

## Purpose

Turn verified repository facts into business capabilities, actors, use cases, use-case families,
rules, lifecycle meaning, data meaning, outcomes, and explicit unknowns.

## Business Translation Questions

For each use case answer:

- Which actor acts or is affected?
- What business goal is pursued?
- What trigger and preconditions apply?
- What are the ordered business stages?
- Which rules and decision points change behavior?
- What data, state, files, indexes, events, and external systems change?
- What is the business outcome?
- Why can the action be rejected or fail?
- How do retry, compensation, cancellation, reconciliation, or manual repair work?
- What role, tenant, ownership, or permission boundary applies?
- Which variants and related paths share the same goal?
- What remains unknown or conflicted after completed searches?

## Business Flow Construction

Build `main_flow` from a participant action or business event, ordered business stages,
business-facing decisions, and a visible outcome or handoff. A reader must understand how the
scenario operates without expanding source evidence.

Do not use implementation order as the flow. Move technical facts to the dimension that preserves
their business meaning:

- tenant or ownership precedence belongs in permissions or decision points;
- duplicate keys and timing windows belong in business rules and rejection conditions;
- internal enums belong in evidence while their business category and consequence belong in
  decision points;
- field writes belong in data and state changes;
- database, queue, cache, index, and middleware actions belong in external effects, observability,
  or implementation evidence.

A technical term may remain when it is established product language and the statement still names
the participant, business object, decision, or visible effect. Never invent a business translation
that current evidence does not support.

## Use-Case Family Search

Group by shared business goal and lifecycle, not package layout. Search alternate channels,
background jobs, callbacks, operations, uploaded/pending variants, status checks, unbind/rebind,
retries, compensation, and repair before declaring a use-case family complete.

Represent every family candidate as confirmed, inferred, or searched unresolved. One endpoint is not
the family.

## Candidate Investigation

Start semantic work from `use-case-candidates.jsonl`, not from a hand-picked route. Investigate
critical/high candidates first, then complete capability waves without dropping normal/low items.
Preserve the seed signal and supporting basis signals. Candidate conservation requires every signal
to reach a candidate or an evidence-linked non-candidate disposition.

Candidate status changes require an explicit reason and the investigations that justify the
decision. Do not resolve two similar signals as duplicates merely because their method names match;
compare actor, goal, lifecycle, mutation, effect, outcome, and failure behavior.

## Family Matrix Investigation

Derive relevant action/channel axes from repository evidence. Search alternate application APIs,
operations/backdoors, consumers, schedules, callbacks, upload/pending flows, status checks,
unbind/rebind, retry, compensation, and repair. Record negative search results as
`searched_not_found`; reserve `not_applicable` for a proved scope exclusion. Unsearched cells remain
`unresolved`.

## Rule Translation

A rule states the business condition, decision, and effect. "The code checks `deviceType`" is
technical. "Device category selects which video-association workflow applies" is business
knowledge when current source proves the branches.

Fixed constants require explanation of their business effect. Enum lists alone do not prove a state
machine. Data-field names require usage evidence before assigning business meaning.

## Prohibited Substitutions

- Method-name translation presented as business knowledge.
- Framework components or module lists presented as business capabilities.
- CRUD narration presented as a business workflow.
- A one-controller answer when reverse writers or alternate entries exist.
- Technology names such as Redis, Kafka, Elasticsearch, MyBatis, or Feign presented as business
  rules without the decision or outcome they implement.
- Generic authorization, idempotency, validation, retry, or compensation invented from convention.
- Document or Git claims promoted over verified current behavior.

## Completion Gate

Technical narration without actor, goal, decisions, business outcome, variants, unknown discipline,
and evidence is invalid. A confirmed use case must be understandable before its technical trace is
expanded.
