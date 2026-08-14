# Optional Code Tools

## Purpose

Use graph, MCP, IDE, LSP, AST, or similar providers as accelerators without making them dependencies.

## Policy

Provider output supplies candidates. Verify load-bearing paths and rules in current source. Provider
absence never lowers completion status. Provider disagreement becomes a conflict or investigation.

For `codebase-memory-mcp`, inspect `index_status`, compare repository root/branch/HEAD, request
`index_repository` refresh, wait for ready, then use graph results for discovery. A watcher is not
proof of freshness, and a matching HEAD does not cover working-tree changes.

## Gate

Unrefreshed, truncated, ambiguous, stale, or source-unverified provider results cannot support E3.
