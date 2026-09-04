# Evidence and Confidence

## Source Authority

Current executable code, SQL, schema, and active configuration outrank tests/contracts, Git history,
documents/comments, naming, and model inference.

Use the hierarchy to answer "what happens now", while retaining conflicts:

1. current executable source, SQL, schema, and active configuration;
2. tests and current interface contracts;
3. Git history and commit messages;
4. requirements, design documents, README files, tickets, and comments;
5. naming, structural similarity, and model inference.

Tests may be stale and code may be conditional. Record configuration and runtime scope rather than
silently choosing.

## Evidence Levels

- `E3`: exact current source location and complete relevant path verified.
- `E2`: supporting current code exists but path or runtime condition is incomplete.
- `E1`: indirect evidence from naming, tests, history, documents, or structure.
- `E0`: unknown or dependent on runtime/business confirmation.

E3 requires exact file, symbol, line range, content hash, frozen snapshot, relevant path, selected
configuration scope, no unresolved dynamic dispatch, and no truncated provider result.

## Evidence Records

Record:

```text
id
source_kind
repository_relative_path
symbol
start_line and end_line
content_sha256
snapshot_id
observation
provider
source_verified
```

The observation states what the source proves, not what the model wishes it meant.

For current-source evidence, prefer the complete frozen file SHA-256 from
`repository_snapshot.files[path].sha256`. A line-fragment SHA-256 is allowed only when the canonical
repository root remains accessible and the Guard can recompute the exact inclusive line range.
Every verified path must exist in the snapshot file map, and every verified hash must match either
the frozen full-file hash or that recomputed fragment. Schema-3 fixtures or offline migration input
that predate the file map may remain readable for compatibility; a new schema-3 build must capture
`repository_snapshot.files` before claiming E3.

## Documents and History

Documents are `document_claim`; old commits are `historical`. They can explain intent or evolution
but cannot override current code. Preserve both sides of disagreement in a conflict node:

```text
current_behavior
historical_or_documented_intent
conflict_status
current evidence
historical evidence
business question
```

Git history uses a stricter separation:

- `historical-claims.jsonl` stores commit-message and other declared statements with verification
  status; a commit message never proves the change or its business reason.
- `git-change-facts.jsonl` stores observed before/after source facts.
- `business-evolution-events.jsonl` exists only when a verified business invariant changed.
- `reason_status` remains unknown unless independent evidence proves why the change was made.

Conservative grouping requires compatible verified outcomes, affected stable business targets,
direct ancestry, and a bounded time window. Message similarity is supporting evidence only.

## Independent Reviews

The independent omission audit receives the frozen inventory, candidates, families, and canonical
knowledge but not the producing analysis narrative. It names missing signals, writers, family
members, and dimensions with severity. The independent semantic review receives canonical artifacts
and rubric, not expected answers or source access. Review hashes must match the canonical revision.
For `main_flow`, the reviewer must not substitute implementation order, identifiers, storage
writes, middleware, or field inventories for participant action, business stages, decisions, and
visible outcomes. A flow that requires source-code knowledge to interpret scores at most 1.

For schema v3, also run the closed-book scenario protocol. The reviewer receives the published
scenario narrative, related canonical records, and frozen questions, but not the producer's notes,
expected answer, benchmark fixture, or source repository. The producer cannot satisfy this gate by
self-scoring. If an answer fails, only then open current source to classify the cause as knowledge
omission, source unknown, or conflict.

Historical evidence keeps behavior and reason separate. Before/after source facts may confirm when
a rule appeared and how previous/current behavior differs. A design reason remains unknown unless
independent evidence supports it; commit text alone is never an `已确认的设计原因`.

## Freshness

Keep `claim_status` separate from `lifecycle_status`. Changed or deleted evidence makes dependent
claims `stale` or `invalidated` and immediately prevents confirmed E3.

## Gate

No confirmed E3 claim without current-source evidence from the frozen snapshot.
