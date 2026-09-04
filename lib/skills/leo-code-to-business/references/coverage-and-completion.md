# Coverage and Completion

## Purpose

Prevent shallow analysis from appearing complete.

## Independent Denominators

Track entry classification, business-entry mapping, required investigations, rule evidence,
mutation/state/external-effect anchors, branch/guard investigation, scenarios, state transitions,
and projection integrity.

For schema v3 also track `scenario_readiness_coverage` over confirmed critical/high scenarios. Its
denominator is the true set of important active/conditional scenarios, not every helper behavior and
not a hand-selected subset. Its unresolved IDs are exact `<use-case-id>#scenario_narrative`
addresses.

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

Keep the maturity levels separate:

```text
已发现 -> 已分类 -> 已保留/处置 -> 已建立业务映射
-> 已完成端到端追踪 -> 已达到场景可读标准
```

The first four levels prove conservation and traceability, not deep understanding. A 100% candidate,
inventory, or code-mapping metric must never be described as 100% business comprehension when
`scenario_readiness_coverage` or end-to-end flow coverage is lower.

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

Track `business_flow_semantic_quality` over confirmed use cases. Its unresolved IDs are exact
`<use-case-id>#main_flow/<local-id>` addresses with high-severity technical-narration diagnostics.
Any unresolved address prevents current coverage from passing, but does not block canonical
integrity or publication as an exact partial revision.

For v3, a structurally valid core narrative still fails readiness when it omits branch closure,
failure/recovery/degradation, a worked example, current-source evidence, or meaningful
state/data/external effects. Scenario-specific acceptance may impose higher stage and atomic-step
minima than the general Guard.

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

The closed-book scenario reviewer cannot be the producer self-scoring its own output. It receives
published knowledge and frozen questions, not expected answers or source access. Keyword matches and
field counts are deterministic prechecks only; they do not prove that a reader can retell the flow,
choose a branch, find recovery, compare history, or assess requirement impact.

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
evidence, unknown discipline, core scenario readiness, closed-book review, projection integrity, and
the semantic business-first rubric pass.
Otherwise publish partial with exact gaps or blocked when snapshot/canonical integrity fails.
