# Leo Code to Business: Business Flow Semantic Quality Design

> Status: approved direction, pending written-spec review
> Date: 2026-08-26
> Skill: `leo-code-to-business`
> Managed source: `lib/skills/leo-code-to-business`

## 1. Goal

Prevent implementation sequences from being published as business flows.

The failure observed in `utopia-scs-recorder` described tenant resolution, a deduplication key,
an internal device enum, database field writes, and Elasticsearch synchronization as the
`main_flow` of video association. Those statements were supported by source, but they answered
"how the code executes" rather than "how the business scenario proceeds."

This change strengthens the skill at the knowledge-production and validation layers. It does not
rewrite technical prose in the renderer.

## 2. Scope

### 2.1 In Scope

- Define a stricter canonical contract for `main_flow`.
- Define where technical facts belong when they are removed from `main_flow`.
- Add deterministic semantic-quality diagnostics for confirmed use cases.
- Make unresolved high-severity flow diagnostics prevent `current_coverage_status = passed`.
- Strengthen the independent semantic-review rubric for non-technical comprehensibility.
- Add focused unit tests, fixture regressions, and a real-project acceptance check.
- Rebuild the affected `utopia-scs-recorder` business knowledge from verified source evidence.

### 2.2 Out of Scope

- Changing the v2 canonical schema or adding a new canonical field.
- Automatically rewriting canonical statements in HTML or AI projections.
- Treating individual words such as "tenant," "device," or "index" as universally forbidden.
- Removing technical evidence from canonical knowledge.
- Inventing business terminology that current source, existing product language, or explicit
  business evidence does not support.
- Editing an immutable published revision in place.

## 3. Business Flow Contract

A confirmed `main_flow` is an ordered account of an actor pursuing a business goal. A reader who
does not know the codebase should be able to answer:

1. Who initiates or participates in the scenario?
2. What business action begins it?
3. Which business stages or decisions occur?
4. What business object or responsibility changes?
5. What result becomes visible or usable?

Each flow should normally contain:

- at least one participant action or business event;
- ordered business stages rather than method, persistence, or infrastructure operations;
- business-facing branch meaning when behavior differs;
- a visible outcome or handoff by the final stage.

The flow may include a technical term only when that term is also the established business
language and the statement still explains the actor, decision, or business effect. For example,
"the selected tenant determines which organization owns the association" may be valid; "explicit
tenant overrides context tenant" is a technical precedence rule and belongs outside the flow.

## 4. Information Placement

Technical facts remain available, but move to the canonical dimension matching their meaning:

| Technical observation | Canonical placement | Business-facing expression |
| --- | --- | --- |
| Explicit tenant overrides context tenant | `permissions` or `decision_points` | Which organization owns the operation |
| `projectId+acceptanceNode` short-lived key | `business_rule` and `rejection_conditions` | Rapid duplicate submissions are rejected |
| `deviceType == LINJING` | `decision_points` | Head-mounted capture and ear-mounted capture follow different association scopes |
| Expand to all videos in one folder | `decision_points` or flow stage | Related footage from the same capture session is associated together |
| Write project, node, people, status, time | `data_changes` and `state_changes` | The videos are assigned to the selected acceptance node with responsible-party context |
| Synchronize Elasticsearch | `external_effects` and implementation evidence | The new association becomes available to downstream search |

Source-level names, conditions, paths, fields, stores, queues, indexes, and middleware remain in
evidence observations and the collapsed implementation-evidence projection.

## 5. Deterministic Flow Diagnostics

### 5.1 Design Principle

The Guard must not decide business meaning from one keyword. It produces a diagnostic only when a
flow step combines strong technical narration signals with weak business narration signals.

The diagnostic is deterministic, explainable, and conservative. It identifies suspicious steps;
it does not generate replacement prose.

### 5.2 Technical Narration Signals

Signals include:

- code-shaped identifiers or expressions such as camelCase, snake_case, `==`, `+`, request paths,
  enum constants, or method-like tokens;
- infrastructure and persistence operations such as database updates, cache keys, queue
  operations, index synchronization, HTTP calls, or framework component names;
- implementation sequencing such as "call X, then write Y, then sync Z";
- raw field-write inventories;
- source-specific constants presented without their business category or consequence.

One signal alone is not sufficient. A statement such as "the order becomes searchable after
indexing" contains a technical concept but still states a business-visible effect.

### 5.3 Business Narration Signals

Signals include:

- an actor or role taking an action;
- a business object such as an order, acceptance record, selected video, claim, invoice, or
  approval;
- a business verb such as submit, select, approve, associate, inspect, publish, reject, retry,
  replace, reconcile, or view;
- a business decision expressed by consequence rather than code condition;
- a user-visible outcome, handoff, availability, responsibility, or recovery result.

### 5.4 Diagnostic Result

The validator returns diagnostics containing:

```text
use_case_id
flow_step_address
severity
reason_codes
statement
```

Initial reason codes:

```text
code_shaped_expression
infrastructure_sequence
field_write_inventory
internal_constant_without_business_meaning
missing_actor_or_business_event
missing_business_effect
```

A high-severity diagnostic requires at least one strong technical signal and a missing business
anchor. Multiple high-severity steps, or a flow dominated by high-severity steps, make the use case
fail the `main_flow` semantic gate.

The validation error reports exact canonical addresses and reason codes so the analyst can revise
the canonical knowledge instead of debugging a generic score failure.

## 6. Coverage and Publication Behavior

The existing schema remains unchanged. Flow diagnostics become an input to current semantic
coverage:

- no high-severity diagnostics: continue with existing semantic-review and coverage gates;
- high-severity diagnostics present: current coverage is at most `partial`;
- malformed or missing canonical flow data: existing validation failure behavior remains;
- canonical integrity is still valid, so technical narration alone does not make the revision
  `blocked`.

Publication may persist an exact `partial` revision for inspection, but it cannot claim `passed`.
The HTML and AI projections continue to display canonical text faithfully.

## 7. Independent Semantic Review

The semantic-review instructions strengthen the `main_flow = 2` definition:

- the reviewer reads canonical artifacts without source code or the producing analysis narrative;
- a score of 2 requires the scenario to be understandable to a product or operations reader;
- implementation order, identifiers, storage writes, middleware, and field lists cannot substitute
  for actor action, business stages, decisions, and visible outcomes;
- technical facts are acceptable in the appropriate rule, effect, data, evidence, or analysis
  dimension;
- any use case whose main flow requires source-code knowledge to interpret receives at most 1.

The review remains independent and hash-bound. The deterministic Guard supplements the review; it
does not replace human/model semantic judgment.

## 8. Example Correction

The video-association scenario should be reconstructed approximately as:

1. A video operator selects site footage and the project acceptance node it should support.
2. The system verifies that the request is not a rapid duplicate and that the selected footage can
   be associated.
3. The system determines the association scope from the capture mode: ordinary footage uses the
   selected videos, while head-mounted capture includes related footage from the same session.
4. The footage is assigned to the selected acceptance node together with site and responsible-party
   context.
5. The association becomes available to acceptance staff for search and use; related integrated
   media is refreshed when that capture mode requires it.

This wording is illustrative, not a source of truth. The actual reconstructed record must be
verified against the frozen repository snapshot. Duplicate prevention, tenant precedence, internal
device constants, database fields, and index synchronization remain in their proper dimensions and
evidence.

## 9. Components and Data Flow

### 9.1 Documentation

- `SKILL.md`: add the business-flow invariant and route analysts to detailed guidance.
- `references/business-discovery.md`: define flow construction and technical-fact placement.
- `references/business-knowledge-model.md`: strengthen the canonical use-case contract.
- `references/coverage-and-completion.md`: define diagnostic effects on semantic coverage.
- `references/evidence-and-confidence.md`: strengthen independent-review instructions.

### 9.2 Guard

`business_knowledge_guard.py` gains isolated helpers:

```text
analyze_flow_statement(statement) -> reason codes and signal evidence
validate_business_flow_quality(use_case) -> diagnostics
validate_business_flows(use_cases) -> diagnostics
```

The helpers are pure and deterministic. `validate_revision_v2()` incorporates their result when
deriving current coverage and returns diagnostics in its validation output. Existing valid fixtures
must continue to pass.

### 9.3 Acceptance

The expected `utopia-video-binding` concepts are revised so acceptance requires business meaning
without requiring raw code expressions in the flow. Source facts remain required through evidence,
rules, decisions, data changes, and external effects.

## 10. Error Handling

- Diagnostics name the exact flow step and reasons.
- Ambiguous individual terms do not fail validation without corroborating signals.
- A valid business statement containing a technical noun is accepted when it has an actor,
  business object, decision, or visible effect.
- The validator never mutates canonical statements.
- A failed rewrite remains publishable only as `partial`, preserving evidence and gaps for another
  analysis pass.

## 11. Testing

### 11.1 Unit Tests

Add tests that:

- reject the observed six-step technical video flow;
- reject a field-write inventory presented as a workflow stage;
- reject an internal enum comparison without business meaning;
- accept a business flow that mentions search availability or tenant ownership as an effect;
- accept established technical product language when actor, goal, and outcome remain clear;
- return stable diagnostic addresses and reason codes;
- keep valid sample revisions passing.

### 11.2 Contract Tests

Tests verify that:

- references define the strengthened flow contract;
- high-severity diagnostics prevent `passed`;
- the independent semantic rubric defines non-technical comprehensibility;
- projections remain faithful and deterministic rather than rewriting content.

### 11.3 Full Acceptance

Run:

- the complete `leo-code-to-business` unit suite;
- mandatory fixed real-Git acceptance;
- extended Java acceptance against the pinned `utopia-scs-recorder` commit;
- deterministic projection comparison;
- a new canonical rebuild of the target project;
- Guard, omission audit, semantic review, hashes, and immutable publication checks.

The target acceptance must show that:

- the video-association flow is understandable without source-code knowledge;
- tenant precedence, duplicate prevention, capture-mode branching, field updates, and search
  synchronization remain traceable in canonical knowledge and evidence;
- other confirmed use cases are reviewed for the same defect;
- a new semantic canonical hash produces a new immutable revision;
- the prior revision and `current.json` are not mutated until the new revision passes its declared
  status and publication checks.

## 12. Rollout

1. Commit the reviewed specification.
2. Implement documentation and failing tests.
3. Implement deterministic diagnostics and coverage integration.
4. Run the complete skill suite and acceptance scenarios.
5. Synchronize managed files to `~/.agents/skills/leo-code-to-business`.
6. Verify the Antigravity symlink resolves to the synchronized skill.
7. Reconstruct and publish the target project's next immutable revision.
8. Open the new HTML projection and compare the affected flow with its technical evidence.

