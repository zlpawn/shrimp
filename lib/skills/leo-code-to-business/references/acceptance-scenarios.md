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
`/app/video/relate` family, uploaded-3D relation, Linjing device upload, concatenation callback,
concatenation coordinator and retry, Linjing score orchestration, all four score calculators, total
score recalculation, a reverse-writer/operational entry, a repair path, and a stratified Git history
sample. Repository or commit absence returns exit code `2` with a named unavailable
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

The canonical business flow must explain:

- a video operator selects site footage and the project acceptance node it should support;
- the system checks duplicate submission and association eligibility;
- capture mode determines whether only selected footage or related footage from the same capture
  session is associated;
- the footage is assigned to the acceptance node with site and responsible-party context;
- acceptance staff can search and use the associated footage.

Preserve the following implementation facts outside `main_flow`:

- explicit tenant precedence and context inheritance in permissions, decision points, or evidence;
- the `projectId + acceptanceNode` deduplication key in a rule, rejection condition, or evidence;
- `deviceType == LINJING` in decision evidence while the flow uses the business category
  "head-mounted capture";
- project, acceptance-node, address, responsible-party, operator, status, and time writes in data or
  state changes;
- Elasticsearch or index synchronization in external effects or evidence.

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

## Linjing Device Upload and Video Concatenation

This is an independent golden scenario. It must not be collapsed into the video-binding use case or
a generic media-processing scenario.

Required entries and anchors include:

```text
POST /3d/app/device/upload/video
POST /3d/app/device/uploaded/video/nonrelated
POST /linjing/video/concat/callback
VideoContactTaskServiceImpl.contactVideoByFolder
VideoContactTaskServiceImpl.retryContactVideoByFolder
VideoContactTaskServiceImpl.lowReplaceHigh
VideoContactTaskServiceImpl.updateTaskSuccess
CeleryProvider.contactVideoHigh / contactVideoLow / contactVideo
```

The end-to-end flow must establish, with current-source evidence:

1. how a Linjing device upload or upload confirmation creates or updates video records;
2. how `folderName + hwSn` defines the footage group eligible for concatenation;
3. which uploaded/stabilized files are included or excluded before a task starts;
4. how an absent or invalid bitrate selection creates high- and low-bitrate tasks, while an explicit
   selection creates the corresponding single task;
5. how the Celery request, generated task ID, persisted `VideoContactTask`, and `VIDEO_CONCAT`
   started event represent one business stage rather than four unrelated use cases;
6. how `POST /linjing/video/concat/callback` identifies the task, validates the result, advances
   success or failure state, and updates the videos in the same folder;
7. what becomes queryable or usable after success, including any subsequent video relation or
   downstream synchronization;
8. how pending, started, failure, and single-task retry paths select tasks and preserve retry count;
9. how `retryContactVideoByFolder` creates a new task, invalidates the old task, and emits a retry
   state event;
10. when `lowReplaceHigh`, failure-reason synchronization, started-time synchronization, retry-limit
    notification, and task-failure notification act as operational repair or fallback behavior.

Missing callback, state transition, retry, or terminal-use analysis is a failed scenario even if the
initial upload route and concatenation request were found.

## Linjing Strategy Scoring

This is a calculation-model golden scenario, not a brief use-case paragraph. Required orchestration
and calculators include:

```text
LinjingScoreServiceV2.triggerCalculateScore
StrategyScoreCalculationService.calculateAcceptanceScoreItem
SpeechScoreCalculator
ToolScoreCalculator
CustomerScoreCalculator
DurationScoreCalculator
LinjingWindowDetectionService.calDrainageScore
LinjingScoreServiceV2.recalculateTotalScore
```

The calculation model must explain:

- applicability gates such as tenant/config switches, mirror-score behavior, construction stage,
  strategy availability, and module weight;
- the source and version of the active strategy configuration;
- inputs used by speech, tool, customer, duration, basic acceptance, and additional acceptance;
- missing-value behavior for absent video, strategy, modules, detected values, or weights;
- weighted, percentage, and step-ladder calculations, including threshold boundaries;
- duration conversion and rounding, two-segment behavior, interpolation, and 0/100 outcomes;
- edited-versus-detected tool selection, full-score threshold behavior, and the installed-stage
  drainage specialization through `calDrainageScore`;
- speech cheating or exclusion handling where present in current source;
- how module results roll into acceptance items and how `calculateAcceptanceScoreItem` rounds both
  score and percent score;
- how `recalculateTotalScore` combines basic and additional acceptance, including rounding;
- recalculation/repair entries, database persistence, edited score/tool fields, and search/index or
  presentation refresh where applicable.

Each distinct detected scoring/calculation signal must map through `code-knowledge-matrix.jsonl` to
one or more explicit `calculation-models.jsonl` records. One generic “weighted score” model cannot
stand in for all calculators.

## Gate

An answer limited to one controller method fails even when technically accurate. No semantic rubric
dimension may score 0 and the total must be at least 13/16. `main_flow = 2` also requires that a
product or operations reader can understand the scenario without source-code knowledge.

Keyword completeness is only a precheck. The named Utopia core scenarios must also satisfy these
independent narrative depth floors:

```text
UC-create-work-order:              >= 2 stages, >= 5 atomic steps
UC-bind-site-video:                >= 4 stages, >= 9 atomic steps
UC-bind-headmounted-video:         >= 4 stages, >= 9 atomic steps
UC-upload-linjing-video:           >= 3 stages, >= 7 atomic steps
UC-concat-linjing-video:           >= 5 stages, >= 12 atomic steps
UC-calculate-linjing-score:        >= 4 stages, >= 10 atomic steps
```

Every named scenario also requires branch closure, failure/recovery/degradation closure, and at least
one current-source-grounded worked example. These counts are calibration floors, not permission to
compress multiple business advances into one step.

Frozen closed-book questions must cover trigger-to-terminal retelling, a branch choice, a named
failure and recovery path, state/data/external effects relevant to a new requirement, and verified
previous/current behavior with reason status. The Linjing scoring set additionally asks for one
worked calculation and missing-value/threshold/rounding behavior; video concatenation additionally
asks for task identity, callback convergence, retry replacement, stale-task handling, and low-bitrate
degradation.

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

business_knowledge_guard.py benchmark
  --revision <canonical-revision>
  --expectations tests/fixtures/expected
  --scenario video-concat

business_knowledge_guard.py benchmark
  --revision <canonical-revision>
  --expectations tests/fixtures/expected
  --scenario linjing-scoring
```

The expectation files are external calibration anchors, not content to copy into generated
knowledge. The producing model must discover and prove the behavior from the frozen repository.

Real-repository acceptance also requires a fresh independent semantic review that receives only the
canonical artifacts, frozen questions, and rubric. It must not receive expected answers, prior
analysis, or source-repository access. A provider-assisted run repeats the same benchmark after a
fresh index and current-source verification; provider absence remains non-blocking.
