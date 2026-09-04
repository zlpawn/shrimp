# Hindsight Install and Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe one-click installation, local version detection, and updates for `hindsight-embed` in Command Apps.

**Architecture:** A focused infrastructure module owns all fixed uv commands and parsing. The Command Apps service coordinates daemon stop/restore and executable rediscovery, while dedicated HTTP routes and frontend state expose the feature without adding version checks to per-profile polling.

**Tech Stack:** Node.js ESM, TypeScript frontend, `node:child_process.execFile`, Node test runner, esbuild.

**Spec:** `docs/superpowers/specs/2026-09-04-hindsight-install-update-design.md`

## Global Constraints

- Manage only `hindsight-embed`; never install or update the separate `hindsight` CLI or `hindsight-api`.
- Install with exactly `uv tool install hindsight-embed`.
- Update with exactly `uv tool upgrade hindsight-embed`.
- Never execute a shell-composed command.
- Preserve `~/.hindsight` configuration and memory data.
- Restore profiles that were active before an update.

---

### Task 1: Hindsight uv tool manager

**Files:**
- Create: `lib/command-apps/infra/hindsight-tool.mjs`
- Modify: `lib/command-apps/index.mjs`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Produces: `parseUvToolList(output)`, `inspectHindsightTool(options)`, `installHindsightTool(options)`, `updateHindsightTool(options)`.

- [x] Write failing tests for parsing installed versions, uv absence, and fixed install/update arguments.
- [x] Run the focused tests and verify they fail because the module does not exist.
- [x] Implement the minimal execFile-based manager with bounded error output.
- [x] Run the focused tests and verify they pass.

### Task 2: Service coordination and HTTP routes

**Files:**
- Modify: `lib/command-apps/application/service.mjs`
- Modify: `lib/command-apps/http/routes.mjs`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Consumes: the Task 1 tool manager functions.
- Produces: `getHindsightToolStatus()`, `installHindsightTool()`, `updateHindsightTool()` and three `/v1/command-apps/hindsight/*` routes.

- [x] Write failing service and route tests for install rediscovery and update stop/restore behavior.
- [x] Run the focused tests and verify the missing methods/routes fail.
- [x] Add dependency-injected service methods and fixed routes.
- [x] Run the focused tests and verify they pass.

### Task 3: Command Apps UI

**Files:**
- Modify: `desktop/src/modules/command-apps.ts`
- Test: `tests/unit/config-panel.test.mjs`

**Interfaces:**
- Consumes: `GET /v1/command-apps/hindsight/tool`, `POST .../install`, and `POST .../update`.
- Produces: local version badge, install/update button, busy state, refreshed app states, and user feedback.

- [x] Write a failing source-level UI test for the new endpoint wiring and Chinese labels.
- [x] Run the focused test and verify it fails.
- [x] Add tool status state, rendering, load behavior, and action handlers.
- [x] Run panel build and focused UI tests.

### Task 4: Verification

**Files:**
- Verify all files above.

- [x] Run `node --test tests/unit/command-apps.test.mjs tests/unit/config-panel.test.mjs`.
- [x] Run `npm run build:panel`.
- [x] Run `npm run check`.
- [x] Review `git diff --check` and the final diff for unrelated changes.
