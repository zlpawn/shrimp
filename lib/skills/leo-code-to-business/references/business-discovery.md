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

## Use-Case Family Search

Group by shared business goal and lifecycle, not package layout. Search alternate channels,
background jobs, callbacks, operations, uploaded/pending variants, status checks, unbind/rebind,
retries, compensation, and repair before declaring a use-case family complete.

Represent every family candidate as confirmed, inferred, or searched unresolved. One endpoint is not
the family.

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
