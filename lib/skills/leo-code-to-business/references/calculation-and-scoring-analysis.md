# Calculation and Scoring Analysis

Use whenever discovery finds score/scoring, calculate, formula, aggregate, weight, threshold, rank,
quota, price, percentage, duration, quality grade, or equivalent domain language. A one-line statement
such as “the system calculates a score” is insufficient.

## Required reconstruction

Trace the calculation from source data to persisted/presented output:

- business purpose and applicability
- inputs, source data, joins, filters, eligibility, exclusions, and time windows
- missing value policy, default values, null handling, and invalid-data behavior
- formula or algorithm, intermediate values, weights, thresholds, branches, lookup tables, and units
- rounding/precision, caps and floors, normalization, ordering, and tie-breaking
- version/configuration source, feature flags, and effective dates
- output meaning, persistence, presentation, and downstream consumers
- recalculation triggers, caching, correction/backfill, and concurrency/idempotency
- examples or tests that demonstrate boundary values
- verified history events and unknown design reasons

## `calculation-models.jsonl`

Each model requires `id`, `title`, `business_purpose`, `inputs`, `source_data`, `applicability`,
`filters`, `missing_value_policy`, `formula_or_algorithm`, `weights`, `thresholds`, `rounding`,
`caps_and_floors`, `version_source`, `output`, `recalculation_triggers`, `examples_or_tests`,
`evidence_ids`, `history_event_ids`, `unknown_ids`, and `snapshot_id`.

Empty weights or thresholds are valid only when evidence confirms they are not part of the algorithm.
Use an unknown when the behavior cannot be established. Never invent a formula from names, comments,
commit messages, or sample output.

Every detected calculation/scoring signal must map to a model or an investigated evidence-linked
non-calculation disposition. Otherwise calculation coverage is partial.
