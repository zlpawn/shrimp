# Evidence and Confidence

## Authority

Current executable code, SQL, schema, and active configuration outrank tests/contracts, Git history,
documents/comments, naming, and model inference.

## Levels

- `E3`: exact current source location and complete relevant path verified.
- `E2`: supporting current code exists but path or runtime condition is incomplete.
- `E1`: indirect evidence from naming, tests, history, documents, or structure.
- `E0`: unknown or dependent on runtime/business confirmation.

Keep `claim_status` separate from `lifecycle_status`. Changed evidence makes dependent claims stale
or invalidated.

## Gate

No confirmed E3 claim without current-source evidence from the frozen snapshot.
