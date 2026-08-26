# Leo Code to Business: Business-First Projections Design

> Status: approved for implementation planning
> Date: 2026-08-26
> Skill: `leo-code-to-business`
> Managed source: `lib/skills/leo-code-to-business`

## 1. Goal

Correct the two primary knowledge entry points so that business meaning is the default and technical
evidence remains available on demand:

- people use an offline HTML business portal to understand the system and drill into a business
  use case;
- AI reads a business-oriented `ai-context.md` before retrieving canonical records and source
  evidence;
- when AI receives a new requirement, it first assesses business impact and preserves current
  business constraints before planning or changing code.

The long-term product goal remains a business knowledge foundation that helps both people understand
the project and AI develop new requirements. This iteration fixes the entry points only; it does not
redesign the canonical model or the task-context protocol.

## 2. Scope

### 2.1 In Scope

- Reorganize `site/index.html` as a business portal for business owners and product managers.
- Preserve progressive drill-down from business overview to use-case detail and then implementation
  evidence.
- Rewrite `ai-context.md` as a compact business orientation that still contains retrieval anchors.
- Add an explicit AI development policy: analyze business impact before code implementation.
- Make small, backward-compatible view-model additions only when required by the projections.
- Update projection documentation and tests.
- Preserve deterministic, offline, immutable publication behavior and matching canonical hashes.

### 2.2 Out of Scope

- Expanding the four currently modeled use cases in `utopia-scs-recorder`.
- Claiming the four modeled use cases are the complete or highest-priority system capabilities.
- Changing canonical schema `2.0` or canonical artifact formats.
- Replacing or substantially restructuring `task_context.py` output.
- Building a separate development-context document.
- Editing an already published immutable revision in place.

## 3. Product Principles

1. Business purpose, actor, flow, decision and outcome precede packages, endpoints and fields.
2. Technical details are never removed; they move to a lower disclosure layer.
3. Human and AI projections come from the same canonical revision and cannot author independent
   facts.
4. Partial knowledge is expressed honestly but calmly as the current organized scope.
5. A new requirement is understood in business terms before AI moves to implementation evidence.
6. Unknown knowledge is not guessed. AI requests or performs targeted investigation before relying
   on uncovered behavior.

## 4. Human HTML Projection

### 4.1 Audience and Page Job

The primary readers are business owners and product managers. The page's first job is to answer:

- who the system serves;
- which business problems are currently understood;
- how the main modeled business chains work;
- what results and constraints each modeled use case has.

The page's second job is to let technical readers verify a business claim against implementation
evidence.

### 4.2 Navigation

Replace the canonical-view navigation with five business-oriented destinations:

1. Business overview
2. Business scenarios
3. Key rules
4. Open questions
5. Analysis notes

Lifecycle, effects, actors, permissions and evolution remain represented, but are placed inside the
relevant use-case or analysis sections instead of appearing as equal top-level navigation items.
“Key rules” and “Open questions” are deterministic cross-scenario aggregate sections. Their entries
link to the relevant use-case detail when a relationship is available; scenario-local rule and gap
sections remain the authoritative detailed reading surface.

### 4.3 Overview

The first screen contains:

- a business-oriented title and short system description derived from the modeled capabilities;
- a calm current-scope statement such as “4 business scenarios are currently organized”;
- capability cards that state the business problem and outcome;
- a simple list of modeled business chains;
- scenario entry links.

The first screen must not display the repository path, canonical hash, snapshot ID, raw `partial`
status, coverage ratios or empty-state taxonomy.

The scope statement must not call the modeled use cases “the four core scenarios.” It must say that
they are the scenarios currently organized and that the page is not the complete business picture.

### 4.4 Scenario Cards and Drill-Down

Each scenario card answers:

- who participates;
- what problem is solved;
- what initiates the scenario in business language;
- what business result is produced.

Each card links to a normal hash anchor so drill-down works without network access or JavaScript.

Use-case detail follows this business reading order:

1. Business situation and goal
2. Participants and initiation conditions
3. Business flow
4. Key rules and decisions
5. Business results and downstream effects
6. Exceptions, rejection and recovery
7. Product questions still requiring confirmation
8. Implementation evidence, collapsed by default

Canonical section data may be regrouped for presentation, but no statements may be invented or
discarded.

### 4.5 Business-Language Transformation

The projection uses the existing business statements wherever possible. Technical strings embedded
in those statements remain truthful but are demoted when a corresponding business statement exists.
Examples:

- an HTTP route is implementation evidence; the default trigger is the user's submitted action;
- an Elasticsearch update is described as making the result available to video search, while the
  implementation name remains in the evidence layer;
- a raw status code remains in implementation evidence while its business failure meaning appears
  in the exception section.

The renderer must not use heuristic rewriting that could change meaning. If canonical data contains
only a technical statement, show it in a secondary technical style rather than invent a business
translation.

### 4.6 Analysis Notes

Analysis notes are collapsed or visually secondary and contain:

- current, history and aggregate coverage status translated into user-facing language;
- snapshot ID, canonical hash and repository path;
- deterministic coverage metrics;
- the four distinct empty-state meanings;
- publication and evidence limitations.

### 4.7 Offline and Accessibility Requirements

- One `site/index.html` file with inline CSS and classic JavaScript.
- No network dependencies, modules, fetch/XHR, service workers or remote fonts.
- Overview, scenario index, use-case details and analysis notes remain present without JavaScript.
- Keyboard-visible focus, semantic headings, usable details/summary controls and responsive layout.
- Technical evidence and analysis notes are closed by default.

## 5. AI Context Projection

### 5.1 Purpose

`ai-context.md` is the AI's compact business orientation and retrieval entry point. It is not a full
canonical dump and not primarily a file-routing manual.

### 5.2 Information Order

The document uses this order:

1. Project business orientation
2. Current organized scope and its limitations
3. Actors and their goals
4. Modeled capabilities and business problems
5. Modeled use-case summaries
6. Cross-scenario rules, lifecycle information and recovery behavior
7. Important unknowns and conflicts
8. New-requirement development policy
9. Retrieval and evidence guide
10. Revision metadata

The first sections must not be dominated by stable IDs, hashes, repository paths or file names.

### 5.3 Use-Case Summary Contract

Each modeled use case contains a compact summary of available canonical facts:

- participants;
- business goal;
- initiation conditions;
- main business flow;
- rules and decisions;
- successful outcome;
- rejection, failure and recovery behavior;
- important unknowns;
- the stable use-case ID as a drill-down anchor.

Technical identifiers are retained only where they help later retrieval.

### 5.4 AI Development Policy

The context instructs AI to use this default sequence for a new requirement:

1. Restate the requirement in business language.
2. Decide whether the current knowledge covers it fully, partially or not at all.
3. Identify affected capabilities, use cases, actors, rules, states, data, external systems,
   exception paths and recovery paths.
4. State current behavior that must be preserved.
5. Identify unknowns and investigate current source before relying on them.
6. Retrieve implementation entries and source evidence.
7. Plan or implement the change.
8. Derive tests and acceptance checks from business scenarios and constraints.
9. Reassess whether the business knowledge needs an update after development.

If knowledge coverage is insufficient, AI must say so and perform targeted investigation rather
than treating a keyword match as confirmed business knowledge.

### 5.5 Retrieval Guide

The existing canonical file routing, aliases, stable IDs, snapshot, canonical hash and status remain
available in the final sections. They support drill-down but do not define the document hierarchy.

## 6. View Model and Compatibility

`site-view-model.json` remains the deterministic HTML contract with the fixed v2 views and section
order. Existing consumers and tests that depend on those views remain compatible.

The renderer may derive presentation helpers from existing fields. If view-model additions are
necessary, they must be additive, deterministic and produced from canonical knowledge. No canonical
schema migration is introduced.

`task_context.py` keeps its current output contract in this iteration. The new AI development policy
can direct AI to use that retrieval pack without promising new semantic fields that do not yet
exist.

## 7. Validation

### 7.1 HTML Tests

Tests verify that:

- business overview and current-scope language precede analysis metadata;
- scenario cards link to use-case details;
- business goals, participants, flow, results, exceptions and unknowns are visible;
- technical evidence is inside a closed `details` element;
- repository path, hash and coverage metrics exist only in analysis notes;
- raw `partial` is not used as the primary visible status;
- technical use-case IDs are not used as visible effect or actor labels when titles are available;
- the output remains file-protocol safe and contains a no-script business index;
- equivalent shuffled canonical records produce byte-identical HTML.

### 7.2 AI Context Tests

Tests verify that:

- business orientation, scope, actors, goals and scenarios appear before file routing and metadata;
- modeled use cases include actionable business summaries;
- the new-requirement business-impact-first policy is present;
- unknown coverage is stated and unsupported completeness is not implied;
- stable IDs and file routing remain available for drill-down;
- the document stays compact and does not become a full canonical dump.

“Compact” retains the existing projection limit: generated `ai-context.md` remains below 8,000
characters for the representative fixture and contains summaries rather than serialized canonical
record bodies.

### 7.2.1 Compatibility Regression

Regression tests also verify that:

- `site-view-model.json` keeps view schema `2.0`, all fixed view IDs and the exact existing use-case
  section order;
- shuffled canonical records still produce byte-identical view-model and HTML output;
- `task_context.py` continues returning its existing top-level fields and retrieval metadata for the
  representative fixture.

### 7.3 Existing Gates

All existing projection gates remain:

- canonical hash equality across projections;
- projection file hashes;
- canonical validation before projection;
- offline single-file HTML;
- deterministic output;
- immutable revision publication.

## 8. Publication and Verification

1. Modify the managed skill source in `local-ai-gateway`.
2. Run focused projection and view-model tests.
3. Run the complete skill test suite and fixed v2 acceptance scenario.
4. Commit the managed source changes to `main`.
5. Synchronize the managed skill to `~/.agents/skills/leo-code-to-business`.
6. Verify the Antigravity skill path still resolves through its symlink to `~/.agents/skills`.
7. Copy the existing `utopia-scs-recorder` canonical revision to a new immutable revision directory,
   regenerate projections there, validate hashes and update `current.json` only after validation.
8. Preserve the project's existing unrelated working-tree changes.
9. Compare the old and new HTML and AI context to verify that canonical business facts are unchanged
   and only projection hierarchy and language changed.

## 9. Success Criteria

The iteration succeeds when:

- a business owner can understand the currently organized business scope and drill into details
  without encountering source metadata first;
- AI forms a business model before reading file-routing details;
- AI is explicitly instructed to analyze business impact before developing a new requirement;
- both human and AI can still trace a claim to canonical records and current-source evidence;
- no canonical schema or task-context breaking change is introduced;
- deterministic, offline and immutable publication guarantees continue to pass.
