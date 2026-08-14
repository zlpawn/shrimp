# Coverage and Completion

## Purpose

Prevent shallow analysis from appearing complete.

## Independent Denominators

Track entry classification, business-entry mapping, required investigations, rule evidence,
mutation/state/external-effect anchors, branch/guard investigation, scenarios, state transitions,
and projection integrity.

For every metric persist raw numerator, denominator, unresolved IDs, and exclusions. Percentages
without denominators are invalid.

Inventory conservation:

```text
discovered entries
= mapped entries
+ explicitly excluded entries
+ unresolved entries
```

No inventory ID may disappear. Unknown and excluded items remain visible in denominators. High
confidence cannot increase coverage. Completing selected modules does not prove repository coverage.

## Required Investigation Signals

Every confirmed use case requires:

```text
vocabulary expansion
entry search
forward trace
backward trace
alternate-entry search
rule search
contradiction search
source verification
```

Each signal must resolve to an investigation record, not a model-authored Boolean.

## Required Business Dimensions

Confirmed use cases need actor, goal, trigger, main flow, success outcome, and evidence. Every other
required dimension needs substantive knowledge or a searched unknown attached to its exact canonical
address.

## Semantic Review

Score 0-2:

```text
business framing
main flow
rules and decisions
effects
failure and recovery
variants
evidence
unknown discipline
```

No dimension may be 0. Business framing, main flow, evidence, and unknown discipline must be 2.
Total must be at least 13/16 for real-repository acceptance. Review hashes must match the canonical
revision and generated answer.

## Gate

Pass only when inventory classification, business mapping, anchor mapping, required investigations,
evidence, unknown discipline, projection integrity, and the semantic business-first rubric pass.
Otherwise publish partial with exact gaps or blocked when snapshot/canonical integrity fails.
