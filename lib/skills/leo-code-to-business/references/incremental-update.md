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

## Full Audit Triggers

Run a full audit when no prior snapshot exists, investigation/schema versions change, branch history
diverges, high-impact files change, or the previous revision is partial/stale.

## Gate

Deleted or changed evidence cannot remain confirmed E3 in the new revision.
