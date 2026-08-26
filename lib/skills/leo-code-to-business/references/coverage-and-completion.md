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

V2 also enforces:

```text
observation discovered IDs = inventory IDs
inventory signals = candidate basis signals + evidenced non-candidate dispositions
critical/high candidates = resolved dispositions + visible unresolved failures
family matrix cells = evidenced dispositions + visible unresolved failures
```

Detected languages without an applicable adapter force partial current coverage even when the
supported-language inventory is non-empty.

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

## Independent Statuses

Persist `current_coverage_status` and `history_coverage_status` independently. Current is derived
from discovery, candidate conservation, family closure, investigations, evidence, omissions, and
semantic quality. History is `not_requested`, `passed`, `partial`, or `blocked` according to the
requested history scope. Aggregate status is blocked if either blocks, partial if either is partial,
and passed only when current passes and history is passed or not requested.

A partial history analysis must not stale otherwise valid current claims. A migrated v1 revision is
partial until current v2 discovery runs.

## Real Acceptance

The checked-in real-Git bundle is mandatory and offline. Fixed Java acceptance, when the repository
and commit are available, must exit 0 and verify named business scenarios. Cross-model comparison
requires exact observation/inventory IDs and 100% critical/high seed recall; normal/low differences
remain in adjudication output.

## Gate

Pass only when inventory classification, business mapping, anchor mapping, required investigations,
evidence, unknown discipline, projection integrity, and the semantic business-first rubric pass.
Otherwise publish partial with exact gaps or blocked when snapshot/canonical integrity fails.
