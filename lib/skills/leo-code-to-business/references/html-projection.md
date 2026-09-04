# Human and AI Projections

## Purpose

Render one canonical business revision into two business-first entry points:

- a human-readable offline portal for product and engineering readers;
- a compact AI orientation that can drill down to business, engineering, and source evidence.

The human and AI projections serve different reading contexts but never author separate business
facts.

## HTML Contract

Generate one `site/index.html` with business-first navigation, local search, hash routes, aliases,
open-question views, secondary analysis notes, and expandable implementation evidence. Use inline
CSS and classic JavaScript. Do not use modules, fetch/XHR, service workers, CDNs, remote fonts, or
network dependencies.

For schema v3, the primary navigation represents three reader tasks and is fixed in this order:

```text
业务地图
核心业务场景
专题查询
```

The sequence is the product contract. Module dossiers, end-to-end flows, calculations, evolution,
evidence, and coverage remain available, but they are not equal-weight primary navigation items.
They appear inside a scenario when they explain that scenario, and under specialist topics for
cross-scenario lookup.

Within that fixed navigation, the HTML reading path is:

```text
business map -> one complete scenario -> specialist topics when needed
```

Each core scenario is one uninterrupted reading page in this order: business context and starting
state; staged atomic flow; branches; state/data/external effects; failure/recovery/degradation;
variants; worked examples; engineering navigation and change guidance; evolution; open questions;
collapsed implementation evidence. A reader
must not need to jump across separate top-level artifact pages to reconstruct one business story.
That scenario must在一个页面内连续讲清业务背景、开始状态、分阶段流程、分支、状态、数据与外部影响、失败恢复、实例和历史。

The first reading layer answers who participates, what problem is solved, how the business flow
works, what rules constrain it, what result is produced, and how failure is handled. Repository
paths, canonical hashes, raw coverage status, coverage metrics, and empty-state taxonomy belong in
secondary analysis notes. Implementation evidence is collapsed by default. Each atomic step may
expand a `研发实现` block from its `use_case_id + step_id` mapping. The same scenario page also
provides five stable engineering topics—data lifecycle, state lifecycle, runtime safety, external
contracts, and configuration—and evidence-linked change guides. Additional domain topics may appear
without changing the primary navigation. Do not create a separate engineering portal or repeat the
business story in technical language.

Coverage language distinguishes preservation from understanding. `已发现`、`已分类`、`已保留` and
`已建立映射` mean that code signals were accounted for; they不等于业务已经被完整理解. The
prominent readiness indicators are `已完成端到端追踪` and `已达到场景可读标准`. Never present a
conserved inventory such as 863/863 as complete business understanding when scenario readiness is
lower.

Overview, the scenario index, use-case details, implementation evidence, and analysis notes remain
present without JavaScript. Scripts only enhance local search and hash routing.

`site-view-model.json` is the deterministic contract consumed by HTML. Build it only after canonical
validation. It always exposes fixed business views for overview, capability tree, use-case catalog
and details, workflows, states, rules, effects, actors/permissions, evolution, gaps, and coverage.

Legacy use-case detail keeps its fixed view-model order. Schemas 3.1 and 3.2 scenario pages additionally carry
engineering drill-down and change-guide sections after worked examples; schema 3.0 remains readable
without fabricated empty engineering sections. The HTML renderer regroups fixed sections into a
business reading order without changing the view model or discarding canonical statements.

Schema 3.2 keeps the same three primary views. Whole-project status and the concrete next-module
queue appear inside `专题查询 -> 证据、未知与覆盖治理`; do not add a fourth primary navigation item.

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
