# Remote Session UI Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group remote-session catalog cards and make official-link and peer modals spacious and responsive.

**Architecture:** Keep the existing string-template UI in `remote-session.ts`. Add reusable modal shell classes and make both dialog renderers consume them. Merge the two catalog grids into one `endpoints-grid` without changing navigation handlers or API contracts.

**Tech Stack:** TypeScript string templates, existing panel CSS design tokens, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-27-remote-session-ui-layout-design.md`

## Global Constraints

- No behavior, route, state, or API changes.
- Preserve click-outside close, Enter/Space activation, and focus-visible styling.
- Reuse `node-card`, `endpoints-grid`, form controls, and existing CSS variables.
- No new dependencies.

---

### Task 1: Spacious shared modal shell

**Files:**

- Modify: `desktop/src/modules/remote-session.ts`
- Modify: `desktop/src/styles/panel.css`
- Test: `tests/unit/remote-session-official-links.test.mjs`

**Interfaces:**

- Produces CSS classes: `rs-modal-shell`, `rs-modal-header`, `rs-modal-body`, `rs-modal-footer`, and `rs-modal-wide`.
- Consumes existing `form-group`, `rs-form-grid`, and `rs-col-2` classes.

- [ ] Add a failing static test requiring official-link and peer modals to use `rs-modal-shell rs-modal-wide` with header/body/footer regions.
- [ ] Run only that test and confirm it fails for missing structure.
- [ ] Refactor both modal renderers and add the CSS shell.
- [ ] Run the official-link test file and confirm it passes.

### Task 2: Grouped remote-session catalog

**Files:**

- Modify: `desktop/src/modules/remote-session.ts`
- Test: `tests/unit/remote-session-official-links.test.mjs`

**Interfaces:**

- Produces one catalog-level `endpoints-grid` containing both remote-session `node-card` entries.
- Preserves existing `window.__rsOpenScene` handlers and card content.

- [ ] Extend the failing static test to require exactly one catalog grid containing both card titles.
- [ ] Run the test and confirm the catalog assertion fails.
- [ ] Remove the duplicate wrapper so both cards share one grid.
- [ ] Run `npm run test:remote-session`, `npm run check`, and `npm run build:panel`.
