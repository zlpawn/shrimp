# End-to-End Flow Analysis

An end-to-end flow is a business journey from a verified trigger to a terminal outcome. It may cross
controllers, services, queues, callbacks, scheduled jobs, databases, indexes, and external systems.
Do not stop at a module boundary or the first asynchronous handoff.

## Closure criteria

For every important trigger:

1. Identify actor or business event, input, and preconditions.
2. Follow synchronous and asynchronous control/data flow across modules.
3. Record each business decision and the rule or configuration that drives it.
4. Record data changes, state changes, external effects, emitted events, and visible handoffs.
5. Continue through callback, polling, or consumer processing to the terminal outcome.
6. Trace rejection, failure, timeout, retry, compensation, manual repair, relink/replay, and permanent
   failure outcomes.
7. Record idempotency, duplicate suppression, locking, ordering, concurrency, and observability.
8. Backward-trace terminal writes/effects to find alternate triggers and missing variants.

## `end-to-end-flows.jsonl`

Each flow contains `id`, `title`, `business_goal`, actors, triggers, module dossiers, use cases, rules,
states, calculation models, terminal outcome, failure outcomes, repair paths, evidence, coverage, and
unknowns.

Each stage contains:

- `input` and `preconditions`
- `business_decisions` and `processing`
- `data_changes`, `state_changes`, and `external_effects`
- `success_output`, `rejections`, and `failures`
- `recovery`, `idempotency_or_concurrency`, and `observability`
- stage-specific `evidence_ids`

The flow is incomplete if it lacks a terminal outcome, ends at “submit task” without following async
completion, omits known callbacks/consumers, or describes only implementation order. Such flows remain
partial and cannot support a passed use case.

Examples of separate variants include normal/uploaded/pending/3D binding, callback success/failure,
automatic retry versus operational repair, and device/channel-specific paths. Merge them only after a
semantic comparison proves the goal, trigger, decisions, and outcome are the same.
