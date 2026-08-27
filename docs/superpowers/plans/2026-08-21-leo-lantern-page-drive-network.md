# Leo Lantern Page Drive + Network Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add wait/content/press/reload and task-scoped CDP network capture to Leo Lantern.

**Architecture:** Register new command handlers on the existing bridge/extension path. Keep network session state in `activeTask.extensions.network`.

**Tech Stack:** Node ESM CLI/MCP, Chrome MV3 extension, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-21-leo-lantern-page-drive-network-design.md`

## Tasks

### Task 1: Protocol + helper modules
- Add command constants
- Create `page-drive.mjs` helpers for wait/content/press matching
- Create `network-capture.mjs` helpers for request summary/filter
- Unit tests

### Task 2: Extension handlers
- Wire `dom.wait` / `dom.content` / `dom.press` / `tabs.reload`
- Wire `cdp.net-start` / `cdp.net-get` / `cdp.net-stop`
- Persist network session on task state

### Task 3: CLI + MCP adapters
- Expose commands/tools
- Mapping tests

### Task 4: Verify and push
- `npm run check && npm run test:leo-lantern`
- Push branch
