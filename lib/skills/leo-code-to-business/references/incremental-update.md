# Incremental Update

## Purpose

Keep knowledge aligned with an evolving repository.

## Snapshot Comparison

Compare branch, HEAD, working-tree state, and file hashes. Added, modified, deleted, and renamed
files are the direct change set. Matching Git HEAD is insufficient when tracked or untracked
working-tree evidence changed.

## Impact Propagation

Changed evidence directly impacts linked semantic nodes. Propagate through relationship policies
until a fixed point:

```text
contains, participates_in, variant_of, uses_rule, writes, transitions,
emits, consumes, calls_external, fails_to, compensates, has_unknown,
conflicts_with: bidirectional

reads and evidenced_by: evidence/target toward dependent source
```

Visit cycles once per node ID. Shared route prefixes, constants, state enums, schemas,
authorization/configuration, and cross-cutting clients force capability-level reanalysis.

Use `compute_direct_impacts(change_set, evidence_index)` to map added, modified, deleted, and renamed
paths to evidence IDs. A rename contributes both its old and new path. Include explicitly forced
semantic IDs for shared infrastructure whose effect cannot be represented by one evidence path.

Use `propagate_impacts(...)` to calculate the fixed point. Persist the result in
`change-impact.json`; do not rely on a transient explanation in chat.

## Claim Invalidation

Before reanalysis, use `invalidate_stale_claims(...)` on the new working revision:

- a changed evidence record makes dependent confirmed claims `stale`;
- a deleted evidence record and its direct evidence relationships become `invalidated`;
- stale or invalidated claims lose E3 confidence until current-source verification completes;
- retain the previous claim status so reviewers can understand what changed;
- never silently carry a confirmed statement forward because its prose still sounds plausible.

Reanalysis may restore a claim only with evidence from the new frozen snapshot and a new
`source_verification` investigation.

## Update Workflow

1. Capture the new snapshot.
2. Detect added, modified, deleted, and renamed evidence.
3. Mark dependent claims stale or invalidated.
4. Reinventory changed repository facts.
5. Reanalyze impacted use cases, families, rules, states, entities, and capabilities.
6. Revalidate neighboring unchanged knowledge affected by shared constants or conditions.
7. Regenerate AI and HTML projections.
8. Recalculate coverage and run a fresh semantic review.
9. Publish a new immutable revision and atomically replace `current.json`.

Query mode creates a targeted gap record and runs the required investigations before answering when
knowledge is stale or insufficient.

## Query Gaps

Use `build_query_gap(question, revision)` when the current canonical revision does not prove the
requested dimension. Persist:

```text
question
candidate_node_ids
missing_dimensions
required_investigations
status = reanalyze_before_answer
```

Questions about "other entries", "ways", or variants require alternate-entry and backward tracing.
Questions about rules, lifecycle, failure/recovery, or permission require their corresponding
targeted searches. Resolve the gap against the current snapshot before writing final business prose.

## Review Freshness

Use `review_is_stale(reviewed_snapshot, current_snapshot)` before accepting a semantic review or
answer. Matching Git HEAD is not sufficient: a changed file hash, dirty working tree, root change,
or snapshot hash change invalidates the frozen review.

## Full Audit Triggers

Run a full audit when no prior snapshot exists, investigation/schema versions change, branch history
diverges, high-impact files change, or the previous revision is partial/stale.

## Gate

Deleted or changed evidence cannot remain confirmed E3 in the new revision.
