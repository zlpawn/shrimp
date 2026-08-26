# HTML Projection

## Purpose

Render canonical business knowledge as a human-readable offline site.

## Contract

Generate one `site/index.html` with business-first navigation, local search, hash routes, aliases,
unknown/conflict views, coverage, and expandable evidence. Use inline CSS and classic JavaScript.
Do not use modules, fetch/XHR, service workers, CDNs, remote fonts, or network dependencies.

Overview, coverage, and the use-case index remain readable without JavaScript.

`site-view-model.json` is the deterministic contract consumed by HTML. Build it only after canonical
validation. It always exposes fixed business views for overview, capability tree, use-case catalog
and details, workflows, states, rules, effects, actors/permissions, evolution, gaps, and coverage.
Each use-case detail uses the fixed order: summary; trigger/preconditions; main flow;
rules/decisions; effects; success; rejection/failure; recovery; permissions; variants; gaps;
evolution; evidence.

Keep four empty meanings distinct: `confirmed_empty`, `searched_not_found`, `not_investigated`, and
`not_applicable`. Sort canonical records by semantic keys and stable IDs so shuffled input records
produce byte-identical view-model and HTML output. The AI context remains a compact orientation and
task retrieval entrypoint, not a full canonical dump.

## Gate

The HTML and AI projection must carry the same canonical revision hash.
