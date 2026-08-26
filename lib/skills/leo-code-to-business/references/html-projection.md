# Human and AI Projections

## Purpose

Render one canonical business revision into two business-first entry points:

- a human-readable offline business portal;
- a compact AI business orientation that can drill down to canonical records and source evidence.

The human and AI projections serve different reading contexts but never author separate business
facts.

## HTML Contract

Generate one `site/index.html` with business-first navigation, local search, hash routes, aliases,
open-question views, secondary analysis notes, and expandable implementation evidence. Use inline
CSS and classic JavaScript. Do not use modules, fetch/XHR, service workers, CDNs, remote fonts, or
network dependencies.

The HTML reading path is:

```text
business overview -> scenario cards -> use-case detail -> implementation evidence
```

The first reading layer answers who participates, what problem is solved, how the business flow
works, what rules constrain it, what result is produced, and how failure is handled. Repository
paths, canonical hashes, raw coverage status, coverage metrics, and empty-state taxonomy belong in
secondary analysis notes. Implementation evidence is collapsed by default.

Overview, the scenario index, use-case details, implementation evidence, and analysis notes remain
present without JavaScript. Scripts only enhance local search and hash routing.

`site-view-model.json` is the deterministic contract consumed by HTML. Build it only after canonical
validation. It always exposes fixed business views for overview, capability tree, use-case catalog
and details, workflows, states, rules, effects, actors/permissions, evolution, gaps, and coverage.

Each use-case detail keeps the fixed view-model order: summary; trigger/preconditions; main flow;
rules/decisions; effects; success; rejection/failure; recovery; permissions; variants; gaps;
evolution; evidence. The HTML renderer regroups those fixed sections into a business reading order
without changing the view model or discarding canonical statements.

Keep four empty meanings distinct: `confirmed_empty`, `searched_not_found`, `not_investigated`, and
`not_applicable`. Sort canonical records by semantic keys and stable IDs so shuffled input records
produce byte-identical view-model and HTML output.

## AI Contract

`ai-context.md` is a compact business orientation and retrieval entry point, not a full canonical
dump or a file-routing manual. Its reading path is:

```text
business orientation -> organized scope -> actors and goals -> capabilities and scenarios
-> rules, lifecycle, recovery, and unknowns -> new-requirement workflow
-> canonical retrieval -> current-source evidence
```

For new requirements, the default policy is: analyze business impact before implementation. AI
assesses knowledge coverage, identifies affected business dimensions and current behavior to
preserve, investigates unknowns, and only then retrieves implementation entries and source
evidence. Stable IDs, aliases, files, snapshot, repository, status, and canonical hash remain in the
final retrieval and revision sections.

This iteration does not change the task-context output protocol. `scripts/task_context.py` remains
the bounded retrieval pack; its results support location and expansion, while business conclusions
must still be checked against canonical records and current source.

## Gate

The HTML and AI projection must carry the same canonical revision hash. Projection files must match
their manifest hashes, remain deterministic for equivalent canonical input, and publish only after
canonical validation.
