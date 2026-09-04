# Module Archaeology

Use this phase after complete surface discovery and before deriving final use cases. It prevents
thousands of routes, methods, consumers, and writes from being collapsed into a few generic scenarios.

## Unit of work

Create one dossier per business module. A module is a cohesive business responsibility connected by
entries, control flow, shared entities/state, writes, integrations, and operational ownership. Folder
layout is only one signal. Split a folder when it contains distinct responsibilities; merge folders
when one business lifecycle crosses them.

Every discovered business module needs one dossier per business module or an explicit evidenced
exclusion. Work module by module and checkpoint coverage before moving on.

## Investigation recipe

For each module:

1. Enumerate HTTP/RPC entries, event consumers, schedulers, jobs, callbacks, commands, and operational
   tools.
2. Trace control flow forward to writes, state transitions, events, external calls, results, and error
   handling.
3. Trace backward from persistence writes, messages, callbacks, and terminal outcomes to every
   reachable trigger.
4. Inspect entities, DTOs, schemas, enums, configuration, feature flags, caches, queues, and external
   contracts that change business behavior.
5. Extract business rules, validation, state fields, calculations, concurrency/idempotency behavior,
   failure paths, retry/compensation, and manual repair paths.
6. Reopen the load-bearing source and attach snapshot-bound evidence.
7. Record searched unknowns for any missing trigger, outcome, rule, state, calculation, or repair path.

## `module-dossiers.jsonl`

Each record contains:

- `id`, `title`, `business_purpose`, `module_paths`, `snapshot_id`
- entry, job, consumer, data-store, configuration, and external-integration signal IDs
- `key_entities`, `control_flow_summary`, `business_rules`, `state_fields`, `calculations`
- `failure_paths`, `repair_paths`, `evidence_ids`, `coverage_status`, `unknown_ids`

`control_flow_summary` explains the complete control flow in business language, including how entry
conditions reach business-visible effects. File/class inventories are supporting evidence, not the
summary.

`coverage_status: complete` requires all important module signals to be accounted for and failure and
repair investigations to have been performed. A missing module, generic summary, or unexplained
high/critical signal forces partial coverage.
