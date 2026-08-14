# Optional Code Tools

## Purpose

Use graph, MCP, IDE, LSP, AST, or similar providers as optional accelerators. The portable baseline
is the analysis model plus ordinary local file/search tools, Git, and repository-local evidence.
Provider absence never lowers completion status.

## Provider-Neutral Policy

1. Use an available provider to discover symbols, callers/callees, data flow, reverse writers,
   routes, events, cross-service links, omissions, and impact candidates.
2. Run independent local searches when coverage or provider truncation is uncertain.
3. Perform source verification by reopening current files for every accepted load-bearing path and
   rule.
4. Record ambiguous, conflicting, stale, or rejected provider results in the investigation ledger.

Provider output supplies candidates, not current-behavior truth.

## Provider Observation

Record one observation per provider and run:

```text
provider
available
version
project
canonical_root
status
indexed_branch
indexed_head_sha
indexed_base_sha
watch_state
refresh_requested
refresh_result
checked_at
source_verification_required
```

Pass observations through `provider_readiness(...)`. Provider absence produces no blocking error and
keeps the portable baseline available. An available provider is usable only when its canonical root
matches, it is ready, and this run requested and completed a ready refresh. When snapshot Git
metadata is available, indexed branch, HEAD, and base SHA must also match.

`source_verification_required` remains true even for a usable provider.

## `codebase-memory-mcp` Freshness Protocol

When available:

1. Discover whether the canonical repository root is indexed.
2. Call `index_status`; compare canonical root, ready status, branch, indexed HEAD/base SHA, and
   repository existence with the frozen snapshot.
3. Call `index_repository` before substantial graph use. An existing graph may refresh
   incrementally; a missing or invalid graph must rebuild.
4. Wait for ready status. Record refresh request/result and the observed provider version.
5. Record automatic watch state when observable, but never treat a running watcher as proof of
   freshness.
6. Use `search_graph`, `trace_path`, `get_code_snippet`, architecture, and code search only for
   discovery and cross-checking.
7. Reopen current repository source and complete source verification.
8. Recheck HEAD and the working-tree fingerprint before publication.

File watching is near-real-time and eventually consistent, not strongly consistent. Matching HEAD
does not cover uncommitted working-tree changes. File hashes and current-source inspection remain
authoritative.

## Failure and Fallback

If refresh fails, the root differs, results truncate, or the provider is unavailable, ignore its
unverified edges and continue with the portable baseline. Block only when the remaining
investigation cannot satisfy evidence or coverage gates; otherwise publish partial unknowns rather
than invented certainty.

Do not install, start, or require `codebase-memory-mcp` on behalf of a repository that does not
already expose it. Do not describe provider absence as reduced business-knowledge quality; quality
is determined by investigation, evidence, coverage, and semantic review.

## Gate

Unrefreshed, truncated, ambiguous, stale, or source-unverified provider results cannot support E3.
No wording may imply that `codebase-memory-mcp` is required to pass.
