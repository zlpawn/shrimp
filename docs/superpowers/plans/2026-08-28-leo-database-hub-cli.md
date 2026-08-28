# Leo Database Hub CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Build an independent, extensible Skill + CLI replacement path for database operations currently exposed by database-hub MCP.

**Architecture:** Command handlers never import concrete drivers. They resolve versioned connection configs, select adapters through a registry, enforce family-agnostic operation policy, and emit normalized JSON/table output. Built-in MySQL, SQLite, and Redis adapters implement stable SQL/KV contracts.

**Tech Stack:** Node.js ESM, node:test, node:sqlite, mysql2, ioredis.

**Spec:** docs/superpowers/specs/2026-08-28-leo-database-hub-cli-design.md

## Global Constraints

- CLI and MCP remain independent code/configuration paths.
- Credential values are never accepted as command arguments and never rendered by connection listing.
- Default output is JSON; default query row cap is 50; maximum is 1000.
- SQL query is read-only; execute and Redis writes require policy authorization.
- Adapter family/capability dispatch must survive adding future adapters without command grammar changes.

## Task 1: Configuration and policy foundation

Create `clis/leo-database-hub/lib/config/store.mjs`, `resolver.mjs`, `core/registry.mjs`, `policy.mjs`, and `sql/splitter.mjs`.

Tests in `tests/unit/leo-database-hub-core.test.mjs` must cover:

- Resolve connection config from JSON file, `LEO_DB_<ID>_URL`, structured fields, and `env:` values.
- Reject unknown adapters and invalid access modes.
- Enforce directory 700 and file 600.
- Mask credentials in connection summaries.
- Classify SQL and Redis operations into read/write/destructive and enforce flags.
- Split SQL scripts while respecting quotes and comments.

## Task 2: Adapters and manager

Create:

-`lib/adapters/sqlite.mjs`
- `lib/adapters/mysql.mjs`
- `lib/adapters/redis.mjs`
- `lib/core/connection-manager.mjs`

Tests use temporary SQLite databases and injected fake MySQL/Redis factories. They must verify schema introspection, typed Redis reads, read-only query enforcement, script execution/rollback behavior, and credential-safe errors.

## Task 3: CLI, formatter, discovery, and Skill

Create `lib/cli.mjs`, `lib/output.mjs`, `index.mjs`, `README.md`, and `package.json`. Add managed Skill `lib/skills/leo-database-hub/SKILL.md` and catalog metadata.

Tests must verify:

- In-repo CLI discovery.
- Connections/adapters/help commands.
- JSON and table output.
- Missing authorization exits 1 with actionable errors.
- Managed Skill is discoverable/installable.
- npm package includes only this new CLI path.

## Task 4: Rename Wendao Skill

Move `lib/skills/wendao` to `lib/skills/leo-xiecheng-wendao`, update frontmatter/catalog/tests. Keep executable and in-repo CLI id `wendao`.

## Task 5: Verification

Run:

```bash
node --test tests/unit/leo-database-hub-*.test.mjs tests/unit/wendao-cli.test.mjs tests/unit/package-release.test.mjs tests/unit/skills-library.test.mjs
npm run check
npm pack --dry-run
```

Review diff for credential leaks, accidental package expansion, and missing files. Commit each completed task.
