# Repository Investigation

## Purpose

Make model-led code investigation deep, repeatable, provider-neutral, and auditable. The model must
show what it searched and inspected, not merely state that analysis was thorough.

## Required Passes

Before semantic synthesis, run five independent repository-wide passes:

1. entries and externally triggered behavior;
2. business nouns, identifiers, entities, fields, and states;
3. persistence mutations, events, indexes, files, and external effects;
4. rejection, failure, retry, compensation, cancellation, and operational repair;
5. tests, configuration, SQL, current documents, and Git leads.

Each pass records exact queries, scope, provider, result count, truncation, accepted candidates,
rejected candidates with reasons, and the next investigation decision.

Begin with `discover_repository_signals.py`. It detects repository languages and runs every
applicable adapter, producing `discovery-observations.jsonl`, `inventory.jsonl`,
`use-case-candidates.jsonl`, and `discovery-summary.json`. Adapter output is a search denominator,
not confirmed business meaning. Unsupported detected languages and unsupported constructs remain
explicit diagnostics.

## Mandatory Investigation Kinds

Use these exact machine-readable IDs:

- `vocabulary_expansion`: expand business terms into code symbols, aliases, routes, tables, fields,
  states, events, errors, external operations, and historical names.
- `entry_search`: search HTTP/RPC routes, consumers, listeners, schedules, callbacks, CLI, batch,
  tests, and operational entry points.
- `forward_trace`: follow trigger through validation, decisions, orchestration, writes, external
  effects, outcomes, failures, retry, and compensation.
- `backward_trace`: start from business records, state writes, external calls, events, index sync,
  files, and terminal outcomes; find every reachable entry and writer.
- `alternate_entry_search`: search variants sharing a goal, object, identifier, table/entity, state,
  event, mutation, external operation, or outcome.
- `rule_search`: inspect constants, enums, comparisons, guards, validation, tenant/role selection,
  deduplication, time rules, configuration, and environment conditions.
- `contradiction_search`: challenge the candidate conclusion with tests, current documents,
  comments, Git history, parallel implementations, deprecated-looking code, and configuration.
- `source_verification`: reopen every load-bearing current file and verify exact symbols, branches,
  values, line locations, and snapshot hashes.

## Investigation Record

Every record contains:

```text
question_or_node_id
investigation_kind
provider and provider_version
queries
scope
files_and_symbols_inspected
candidate_results
accepted_results
rejected_results_and_reason
truncated
source_verified
repository_snapshot
status and completed_at
```

Empty queries or inspected-file lists are invalid. A result cap must be detected. A truncated search
is incomplete until narrowed, paginated, or explicitly retained as a partial gap.

## Tracing Discipline

Do not stop at a controller-service-repository happy path. Continue through interface
implementations, callbacks, events, external clients, persistence, index synchronization, error
handling, and repair paths. Detect cycles and record where tracing stops.

When an interface has multiple plausible implementations, inspect injection, bean selection,
configuration, caller type, tests, and runtime conditions. Keep unresolved candidate sets visible;
do not choose the most plausible implementation silently.

## Completion Gate

A confirmed use case needs all eight investigation kinds. A remembered, inferred, or tool-returned
relationship is not confirmed until current source verification is complete against the frozen
snapshot.

After semantic reconstruction, run an independent omission audit that starts from inventory,
mutation/state/effect anchors, family matrices, and reverse-writer searches. The reviewer must not
reuse the producing model's assurance that coverage is complete.

## Node and TypeScript Discovery Coverage

The `node-typescript` adapter scans `.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, and `.tsx` source while
excluding build output and vendored dependencies. It emits candidates for common Express-style and
server-route HTTP declarations, direct Node `createServer` handlers, ORM/database writes, fetch and
HTTP client calls, event producers and consumers, schedules, CLI commands, and repair/retry entries.

Package metadata and imports are discovery hints, not proof of runtime activation. Dynamic route
construction, computed event names, unknown decorator frameworks, generated clients, and runtime
registration remain explicit unsupported constructs. Any detected language without an applicable
adapter makes discovery coverage `partial`; an empty inventory is never treated as successful
coverage merely because no adapter ran.
