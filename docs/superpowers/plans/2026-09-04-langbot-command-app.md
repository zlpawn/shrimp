# LangBot Command App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LangBot as a gateway-managed HTTP daemon with fixed data ownership, lifecycle controls, persistent installation, and updates.

**Architecture:** Keep Shrimp's static app definition in the Command Apps registry and user-mutable control-plane state in `gateway.db`. Add a small LangBot daemon adapter instead of reusing Hindsight's env/profile logic. The service orchestrates launch/stop/status/install/update, while the existing Command Apps REST/UI shell renders and invokes those actions.

**Tech Stack:** Node.js ESM, `node:sqlite`, `node:http` health probing, `uv tool install/upgrade`, existing TypeScript desktop bundle.

**Spec:** `docs/superpowers/specs/2026-09-04-langbot-command-app-design.md`

## Global Constraints

- LangBot owns all application data under `~/.langbot/data`.
- Launch with `cwd=$HOME/.langbot` and `LANGBOT_DATA_ROOT=$HOME/.langbot/data`.
- Static defaults stay in the registry; user-mutable control-plane settings stay in `gateway.db`.
- Never write LangBot application data or secrets from Shrimp.
- Installation is persistent via `uv tool install langbot`; updates use `uv tool upgrade langbot`.
- Updates stop the managed process first and preserve `~/.langbot` on every failure.
- Health endpoint is `/login`; default port is `5300`.
- The existing Hindsight behavior and public response shape must remain backward compatible.

---

### Task 1: Registry, settings schema, and SQLite persistence

**Files:**
- Modify: `lib/command-apps/domain/registry.mjs`
- Modify: `lib/command-apps/domain/schema.mjs`
- Modify: `lib/command-apps/infra/sqlite-store.mjs`
- Modify: `lib/command-apps/index.mjs`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Produces app definition `getCommandApp("langbot")` with `type: "cli-daemon"`, `executableName: "langbot"`, `defaultPort: 5300`, `healthPath: "/login"`, and `daemonKind: "langbot"`.
- Produces config shape `config.daemons.langbot` normalized as `{ executablePath, cwd, dataRoot, port, lastLaunchedAt, manuallyConfigured }`.
- Produces store behavior: existing rows survive save; invalid daemon JSON falls back to defaults; missing rows read as normalized defaults.

- [ ] Write failing tests for LangBot registry defaults, normalization, invalid persisted JSON, and store round-trip.
- [ ] Implement registry fields, normalization/validation, and SQLite daemon settings persistence.
- [ ] Run `node --test tests/unit/command-apps.test.mjs`.

### Task 2: LangBot HTTP daemon adapter

**Files:**
- Create: `lib/command-apps/infra/langbot-daemon.mjs`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- `langbotDaemonUrl(app, settings) -> { port, healthUrl, appUrl, mcpUrl }`
- `probeLangBotHealth(app, settings, options) -> Promise<boolean>`
- `inspectLangBotDaemon(app, settings, options) -> Promise<{ status, pid }>`
- `startLangBotDaemon(app, settings, options) -> Promise<{ pid, alreadyRunning, ...urls }>`
- `stopLangBotDaemon(app, settings, options) -> Promise<{ stopped, ...urls }>`
- `sanitizeLangBotEnv(source, overrides) -> env`

- [ ] Write failing tests for URL resolution, health checks, startup environment/cwd, managed PID tracking, stop, and process-exit reporting.
- [ ] Implement the adapter using detached spawn, HTTP probe, process-liveness checks, and process-tree termination.
- [ ] Run focused tests.

### Task 3: Service integration and REST routes

**Files:**
- Modify: `lib/command-apps/application/service.mjs`
- Modify: `lib/command-apps/http/routes.mjs`
- Modify: `lib/command-apps/index.mjs`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Existing `list/get/discover/launch/stop/restart/config` routes accept `langbot`.
- Adds `POST /v1/command-apps/apps/langbot/install` and `POST /v1/command-apps/apps/langbot/update`.
- Public status includes `cwd`, `dataRoot`, `endpoints.appUrl`, `version`, and `installable: true`.

- [ ] Write failing service/route tests for path discovery, launch settings, config update, install, and update safety.
- [ ] Integrate the LangBot adapter and add install/update routes without changing Hindsight branches.
- [ ] Run focused tests.

### Task 4: Persistent install and update controls

**Files:**
- Create: `lib/command-apps/infra/langbot-package.mjs`
- Modify: `lib/command-apps/application/service.mjs`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- `findUv({ commandExists, platform }) -> string | null`
- `installLangBotTool(options) -> { executablePath, version }`
- `upgradeLangBotTool(options) -> { executablePath, version }`
- `langbotVersion({ executablePath, execFile }) -> string | null`

- [ ] Write failing tests showing install uses `uv tool install langbot`, update stops first and uses `uv tool upgrade langbot`, failures retain prior path/data, and version discovery succeeds after upgrade.
- [ ] Implement with promisified `execFile`, sanitized env, explicit timeouts, non-destructive error handling, and post-install discovery.
- [ ] Run focused tests.

### Task 5: Desktop LangBot card

**Files:**
- Modify: `desktop/src/modules/command-apps.ts`
- Test: `npm run build:panel`

**Interfaces:**
- Adds LangBot card actions: open app, start, stop, restart, detect, install, update, edit path.
- Renders port, app/data URLs, data root, executable path, version, and status.
- Keeps Hindsight-specific labels and profile UI out of the LangBot card.

- [ ] Extend status/action types and state.
- [ ] Render a LangBot-specific card and LLM guidance.
- [ ] Add browser handlers and busy-state handling.
- [ ] Run `npm run build:panel`.

### Task 6: Full verification and handoff

**Files:**
- Modify: tests and implementation files as needed from failures.
- Verify: `npm run check`

- [ ] Run `node --test tests/unit/command-apps.test.mjs`.
- [ ] Run `npm run build:panel`.
- [ ] Run `npm run check`.
- [ ] Inspect git diff and ensure no unrelated workspace files are modified.

## Execution Note

Subagent execution tools are unavailable in this session, so this plan is executed inline with test-first checkpoints as allowed by the writing-plans skill.
