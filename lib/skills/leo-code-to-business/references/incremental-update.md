# Incremental Update

## Purpose

Keep knowledge aligned with an evolving repository.

## Workflow

Compare branch, HEAD, working-tree state, and file hashes. Added, modified, deleted, and renamed
evidence directly impacts dependent knowledge. Propagate impact through relationships until a fixed
point, reanalyze affected use cases/families/capabilities, regenerate projections, and freeze a new
review.

Matching Git HEAD is insufficient when tracked or untracked working-tree evidence changed.

## Gate

Deleted or changed evidence cannot remain confirmed E3 in the new revision.
