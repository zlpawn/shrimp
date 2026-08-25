# Java and Spring Discovery

## Purpose

Calibrate model-led discovery for Java/Spring without requiring a custom parser.

## Build and Scope

Inspect Maven/Gradle modules, source/test roots, resource directories, profiles, generated-source
configuration, and active property files. Do not assume every module or profile is active.

## Entry Discovery

Search:

```text
@RequestMapping and HTTP method mappings
custom composed route annotations
RPC/GraphQL/WebSocket adapters
@Scheduled and jobs
@EventListener
Kafka/RocketMQ/custom consumers
callbacks and webhooks
CLI, batch, migration, and repair commands
```

Compose class-level and method-level routes. Search important application-service methods that may
have no visible controller in the same repository.

## Relationship Discovery

Inspect controllers, services, providers, handlers, strategies, interfaces and implementations,
constructor/field injection, bean qualifiers, configuration selection, callers, tests, and runtime
conditions.

Do not silently choose an implementation when multiple candidates remain.

## Effects and Rules

Search Feign/HTTP clients, SDKs, producers, object/file storage, search-index synchronization,
mappers, repositories, XML/SQL, update wrappers, entity setters, status writes, constants, enums,
guards, validation, deduplication, tenant/role context, profiles, properties, and feature flags.

Reverse-search every important table/entity/status write and external call for alternate entries,
operations, retries, reconciliation, unbind/rebind, and repair.

## Tests and Documents

Tests expose scenarios, values, failures, and implementation selection but may be stale. Documents
and comments are leads until verified against current source.

Reflection, AOP, dynamic proxies, generated code, remote configuration, dynamic SQL, and
runtime-created routes become explicit limitations when unresolved.

## Gate

Framework component discovery is inventory, not business meaning.

## Deterministic Adapter Coverage

The `java-spring` adapter emits investigation candidates for:

- class- and method-level Spring MVC mappings;
- Spring events and Kafka, Rabbit, or RocketMQ listeners;
- scheduled jobs plus separately visible repair, retry, reconciliation, and compensation entries;
- repository, mapper, DAO, annotation SQL, XML mapper, and SQL-file writes;
- status setters and update-wrapper state writes;
- Feign mappings, client/gateway/SDK invocations, and payment/refund calls;
- application-event and producer calls.

These are structural signals, not confirmed use cases. Custom composed annotations, AOP-only
behavior, reflection, runtime-selected beans, dynamic SQL, and generated source are recorded as
unsupported constructs or investigation limits until current runtime evidence resolves them.
