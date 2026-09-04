# Engineering Drill-Down

## Outcome

Let an engineer start from the same current business scenario used by product readers, select one
atomic business step, and answer three questions without reconstructing the repository from scratch:

1. Which implementation units realize this step?
2. What data, state, external, configuration, and runtime behavior must a change preserve?
3. Where should a realistic change begin, what can it affect, and how can it be verified?

This artifact supplements the business narrative. It must not replace business language with code
language or create a disconnected engineering version of the scenario.

## Canonical artifact

Create one `engineering-views.jsonl` record per confirmed critical/high use case. Lower-priority use
cases may add the same record when engineering navigation is useful:

```text
id
use_case_id
step_mappings[]
engineering_topics[]
change_guides[]
```

The stable join is `use_case_id + step_id`. `step_id` must refer to an atomic step in that use case's
`scenario_narrative`; never join by display text, array position, method name, or file path.

## Step mappings

Map every atomic scenario step exactly once. A mapping contains:

```text
step_id
implementation_units[]
reads[]
writes[]
state_behavior[]
external_interactions[]
configuration[]
runtime_controls[]
evidence_ids[]
```

`implementation_units` identify the smallest useful implementation entry or coordination unit. Each
unit states its `name`, open-ended `kind`, `role`, and `locator`. Kinds are not a fixed enum: examples
include method, function, handler, consumer, SQL procedure, rule file, workflow node, serverless
function, scheduled job, or another repository-specific unit. A locator may be a qualified symbol,
route plus handler, SQL object, configuration key, or another stable source address.

Keep facts at the dimension that owns them:

- `reads` and `writes`: business entities, important fields or payloads, and stores when verified.
- `state_behavior`: transitions, guards, task identity, lifecycle convergence, and stale-state rules.
- `external_interactions`: request/response or event contract, ordering, timeout, and failure behavior.
- `configuration`: switches, thresholds, mappings, environment-dependent values, and defaults.
- `runtime_controls`: transaction boundary, idempotency, deduplication, locking, concurrency,
  callback ordering, retry, consistency, observability, and operational repair.

Do not pad empty dimensions with generic prose. Use the engineering topics for an explicit
`not_applicable` or `source_unknown` conclusion when a dimension matters at scenario level but cannot
be confirmed per step.

## Stable engineering topics

Every engineering view includes these stable topic kinds:

```text
data_lifecycle
state_lifecycle
runtime_safety
external_contracts
configuration
```

Each topic has `status`:

```text
confirmed | not_applicable | source_unknown
```

- `confirmed` requires source evidence.
- `source_unknown` requires one or more searched unknown IDs.
- `not_applicable` requires a concrete reason, not an empty placeholder.

These five kinds provide a predictable minimum reading surface. Additional topic kinds are allowed
when the repository needs them—for example `security_boundary`, `batch_partitioning`,
`media_processing`, `model_inference`, or `device_protocol`. Extension topics obey the same status and
evidence rules. Do not modify the base schema merely to add a domain-specific topic.

## Change guides

Add evidence-linked guides for realistic maintenance goals discovered from the scenario, rules,
unknowns, history, or important implementation seams. A guide contains:

```text
change_goal
affected_step_ids[]
implementation_units[]
data_and_state_impacts[]
downstream_risks[]
verification_targets[]
evidence_ids[]
```

A guide is an impact-analysis starting point, not a promise that only the listed files can change.
Name observable verification targets: business outcomes, persisted state, emitted events, external
requests, retry/idempotency behavior, metrics, logs, or representative tests. Include negative and
failure-path verification when the change can affect them.

## Separation discipline

- Business scenarios own actor intent, business decisions, stages, branches, outcomes, and failures.
- Engineering views own implementation navigation, technical lifecycle, runtime safety, and change
  guidance.
- Evidence owns source locations and frozen observations.
- Git history owns verified before/after behavior; commit messages remain historical claims.

Do not duplicate the full scenario, source files, or Git timeline inside engineering views. Link by
stable IDs so each layer can evolve independently while remaining traceable.
