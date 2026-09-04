# Project completion and continuation

Schema 3.2 separates a publishable revision from completion of the whole repository.

## Two statuses

- Revision status (`passed | partial | blocked`) says whether the current immutable checkpoint is
  internally truthful and publishable.
- Project completion status (`complete | in_progress | blocked`) says whether the repository-wide
  business knowledge task is finished.

A `partial` revision is a checkpoint, never permission to stop. After publishing it, continue with
the first executable module in `next_module_ids`. Stop only when the project is `complete`, or when
missing authority/input makes it genuinely `blocked`.

## Repository-wide module queue

Create `project-progress.json` immediately after full-surface discovery and before deep modeling.
Partition the entire discovered surface into business-responsibility modules. Each module keeps its
priority, state, linked signals/candidates, completed knowledge destinations, gaps, history status,
and one concrete `next_action`.

States are `pending`, `in_progress`, `complete`, `excluded`, and `blocked`.

- `pending`, `in_progress`, and `blocked` require a concrete next action.
- `complete` requires a dossier and, where applicable, end-to-end flows, readable scenarios,
  engineering mappings, and history work matching the requested scope.
- `excluded` requires an evidenced non-business disposition in the canonical traceability artifacts.
- A newly discovered important surface or omission must be attached to an unfinished module or
  create a new queued module before publication.

## Completion gate

`complete` requires all repository modules to be `complete` or evidenced `excluded`, no critical or
high unresolved omission detached from the queue, no active module, and an empty `next_module_ids`.

`in_progress` requires unfinished work, a non-empty `next_module_ids`, and an active module that is
the first queued item. The published report must name completed scope, unfinished scope, and the
next concrete module; never summarize an in-progress project as “completed”.

Incremental updates reopen or add modules when changed code introduces a new business surface. A
previously complete project becomes `in_progress` until that surface reaches the same completion
standard.
