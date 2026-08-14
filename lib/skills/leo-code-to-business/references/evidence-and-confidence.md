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

## Freshness

Keep `claim_status` separate from `lifecycle_status`. Changed or deleted evidence makes dependent
claims `stale` or `invalidated` and immediately prevents confirmed E3.

## Gate

No confirmed E3 claim without current-source evidence from the frozen snapshot.
