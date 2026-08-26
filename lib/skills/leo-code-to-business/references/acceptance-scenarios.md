# Acceptance Scenarios

## Mandatory Offline Real-Git Fixture

`tests/fixtures/real-git-history.bundle` is a release gate, not an optional example. Run
`run_v2_acceptance.py real-git-fixture --output <result.json>` without network access. The harness
must clone the checked-in bundle, freeze a snapshot, run applicable discovery, index Git history,
separate commit-message claims from verified before/after facts, group the two-step cancellation
change, recognize its revert, and validate deterministic Guard/view-model/HTML projections. A
missing bundle is a hard failure. Two runs must produce byte-identical result JSON.

The expected fixture records literal commit SHAs and parents, fact types, event IDs, claim
verification, and current effectiveness. Rename-only commit text such as `feat: add refund` remains
an unverifiable historical claim and must not create a refund fact or business event.

## Cross-Model Comparison

Compare observation and inventory ID sets exactly. Critical/high seed candidate recall must be
100%, including dispositions and family membership when those artifacts are supplied. Preserve
normal/low disagreements as an adjudication list; do not silently discard them. Missing a
critical/high candidate is a failed comparison.

## Fixed Extended Java Acceptance

Run `extended-java` against `/Users/pa/project/JZ/utopia-scs-recorder` at commit
`c6893715d0d52477849595e7ed7c8c5ec276f322`. The harness clones to a temporary detached checkout
and writes only to an explicit external output root. It must find work-order creation, the
`/app/video/relate` family, a reverse-writer/operational entry, a repair path, and a stratified Git
history sample. Repository or commit absence returns exit code `2` with a named unavailable
diagnostic; any present-but-failing scenario returns exit code `1` and cannot count as release
evidence.

## Work-Order Creation

The first benchmark repository is `/Users/pa/project/JZ/utopia-scs-recorder` at commit
`c6893715d0d52477849595e7ed7c8c5ec276f322`.

Required chain:

```text
POST /construction/site/work-order/add
-> ConstructionSiteController.addWorkOrder
-> ConstructionSiteRectificationService.addWorkOrder
-> ArtisanWorkOrderProvider.addWorkOrder
-> external workOrderApi.addWorkOrder2
```

Explain:

- `projectId` identifies the target project order;
- publisher and operator derive from the construction-site inspector;
- project order type is fixed to `HOME2`;
- work-order type is fixed to `TODO`;
- images are joined with commas;
- planned completion comes from input;
- actual creation occurs in the external work-order system;
- empty or failed external response produces false and an error record.

Do not invent authorization, missing-site behavior, duplicate prevention, image constraints, or
plan-time validation. Create field-specific searched unknowns unless new current-source evidence
resolves them.

## Construction-Site and Video Binding

Main entry:

```text
POST /app/video/relate
```

Explain:

- explicit tenant overrides context tenant; otherwise inherit context;
- deduplication key uses `projectId + acceptanceNode`;
- rapid repeated operations are rejected;
- `deviceType == LINJING` selects the 3D/head-mounted branch;
- other device types select the normal/ear-mounted branch;
- the evidenced branch expands selected videos to all videos in the same folders;
- binding writes project, acceptance node, address, foreman, inspector, operator, status, and time;
- database update is followed by Elasticsearch or index synchronization.

Represent the full family as confirmed, inferred, or searched unresolved:

```text
normal application binding
3D binding
uploaded-video binding
pending-upload binding
WXON binding
precheck/status check
unbind
operational relink
```

Record alternate-entry and backward-writer investigations.

## Gate

An answer limited to one controller method fails even when technically accurate. No semantic rubric
dimension may score 0 and the total must be at least 13/16.

Run deterministic acceptance with:

```text
business_knowledge_guard.py benchmark
  --revision <canonical-revision>
  --expectations tests/fixtures/expected
  --scenario work-order

business_knowledge_guard.py benchmark
  --revision <canonical-revision>
  --expectations tests/fixtures/expected
  --scenario video-binding
```

The expectation files are external calibration anchors, not content to copy into generated
knowledge. The producing model must discover and prove the behavior from the frozen repository.

Real-repository acceptance also requires a fresh independent semantic review that receives only the
canonical artifacts, frozen questions, and rubric. It must not receive expected answers, prior
analysis, or source-repository access. A provider-assisted run repeats the same benchmark after a
fresh index and current-source verification; provider absence remains non-blocking.
