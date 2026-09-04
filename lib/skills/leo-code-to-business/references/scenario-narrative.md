# Scenario Narrative

## Outcome

Create one independently readable current-business story per confirmed critical/high use case. A
product reader, engineer, or AI that does not yet know the code must understand why the scenario
exists, how it starts, what advances it, which decisions change the route, what succeeds or fails,
how it recovers, and what changed over time. Source identifiers and engineering detail remain
drill-down layers.

## Required structure

Populate `scenario_narrative` inside the use-case record:

- `business_context`: the actor problem and business value.
- `starting_state`: observable business state before the trigger.
- `stages`: business-purpose stages containing atomic steps.
- `branch_matrix`: condition, decision basis, route, business result, evidence.
- `failure_recovery_matrix`: failure point, impact, stopped state, automatic recovery, manual repair,
  degradation, evidence.
- `variants`: only real channel/device/lifecycle differences; do not restate the main flow.
- `worked_examples`: concrete input-to-result examples derived from verified rules. Use illustrative
  values, label them illustrative, and never invent production facts.
- `history_event_ids`: only evolution events whose before/after behavior was verified.
- `open_question_ids`: unresolved facts that matter to understanding or changing the scenario.

## Atomic step

Each step contains:

```text
step_id
actor_or_event
business_action
business_result
inputs
decision_basis
data_changes
state_changes
external_effects
evidence_ids
```

Use one step for one meaningful advance. Do not join upload, task creation, callback, retry, and
repair into one sentence. Every step needs current-source evidence and must describe a visible
business advance, not only a method call, storage write, or framework action.

`step_id` is also the stable join key used by `engineering-views.jsonl`. Keep it stable while the
business meaning remains the same; do not derive it from method names, files, or display order.

## Closure rules

- Synchronous external calls include request preparation, external confirmation, success terminal,
  failure terminal, and retry/repair policy.
- Async flows include submission, durable task identity, started state, callback/consumer,
  success/failure convergence, timeout/retry, old/new task relationship, and degradation.
- Calculation flows link applicability, missing values, selected inputs, thresholds, weights,
  rounding, aggregation, persistence, recalculation, and a worked example.
- Multi-entry families explain what is shared and what actually differs by entry, device, channel,
  or lifecycle stage.

No fixed word count or universal step count replaces judgment. The Guard minimum prevents extreme
compression; the independent review decides whether the narrative is genuinely answerable.
