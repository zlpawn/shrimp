# Code-to-Knowledge Traceability

Candidate counts do not prove business coverage. The matrix is the independent reconciliation layer
between the discovered code surface and the business knowledge base.

## `code-knowledge-matrix.jsonl`

Create one row for every important signal and any lower-priority signal needed to explain a flow:

- `signal_id`
- `module_dossier_ids`, `flow_ids`, `use_case_ids`, `rule_ids`, `calculation_model_ids`
- `disposition`, `resolution_reason`
- `investigation_ids`, `evidence_ids`

Every important signal must have either a real business mapping or a specific investigated exclusion.
A mapped signal should normally reach a module dossier and at least one flow or use case.

## Semantic comparison for consolidation

A high/critical signal may be classified as supporting behavior, duplicate, or excluded only after a
semantic comparison records:

- compared trigger or actor event
- compared actor goal
- compared terminal outcome
- relevant decisions/state/effects
- conclusion and direct evidence

This prevents unrelated routes such as work-order creation, video binding, device unbinding, upload
callbacks, and retry jobs from being attached to one generic media use case merely because names or
fields overlap.

## Anti-gaming checks

- Reject generic reasons such as “supporting behavior”, “technical helper”, or repeated template text
  without source-specific facts.
- Flag excessive identical `resolution_reason` values and one use case absorbing many semantically
  unrelated routes.
- Reconcile module dossiers, end-to-end flows, calculations, candidates, and omission-audit findings.
- Any missing high/critical row, unresolved semantic comparison, or important row with no business
  destination forces partial coverage.

The independent reviewer uses this matrix to return to code, sample unexplained and consolidated
signals, and verify that the written knowledge has not drifted from the frozen source.
