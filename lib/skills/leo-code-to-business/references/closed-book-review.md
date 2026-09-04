# Closed-Book Scenario Review

## Isolation

The reviewer receives the published HTML/AI projection and canonical business records, but not the
source repository, producer notes, intended answer, benchmark fixture, or previous review. Source is
opened only after an answer fails, to classify the failure.

## Product questions per core scenario

1. Retell the scenario from trigger to terminal business result.
2. Given a boundary condition, choose the branch and explain the decision basis.
3. Identify where a named failure stops the process and how automatic recovery, manual repair, or
   degradation works.
4. Explain the data/state/external effects a new requirement must preserve or intentionally change.
5. State the current behavior, verified previous behavior, and whether the design reason is known.

## Engineering questions per core scenario

1. Starting from a named business step, identify its implementation entry and coordinating units.
2. Explain the important entities, identity, fields, stores, readers, writers, and resulting data
   lifecycle; identify any searched unknowns rather than guessing.
3. Explain relevant configuration and runtime behavior, including transaction, idempotency,
   deduplication, locking, concurrency, callback ordering, retry, consistency, and operational repair.
4. Explain external request/response or event contracts, success convergence, failure handling, and
   observable signals where applicable.
5. For one realistic requirement, identify affected business steps, implementation starting points,
   data/state impact, downstream risks, and observable verification targets.

For calculation scenarios also solve one worked example and explain missing-value, threshold,
rounding, and aggregation behavior. For async scenarios also explain task identity, started state,
callback convergence, retry replacement, and stale-task handling.

## Result classification

- `answered`: the knowledge base alone supports a precise answer.
- `knowledge_omission`: current source contains the answer but the knowledge base omitted or scattered it.
- `source_unknown`: the required fact cannot be confirmed after a documented source search.
- `conflict`: current sources support incompatible conclusions.

A confirmed critical/high scenario passes only when both product and engineering question classes are
answered or honestly classified as evidence-linked source unknown/conflict. Keywords, field counts,
producer self-scores, file inventories, and generic summaries cannot substitute for this review.
