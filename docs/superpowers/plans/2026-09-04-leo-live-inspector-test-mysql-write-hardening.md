# Leo Live Inspector Test MySQL Write Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make test-environment MySQL writes reliably guarded, automatically tested, and verified with a disposable table in `iot_sms`.

**Architecture:** Add a side-effect-free SQL lexer/analyzer in `scripts/common/`, then replace the CLI's regex inspection with the analyzer. Exercise the analyzer directly and the CLI through child processes using an explicitly injected fake `mysql2` module; use a separate one-shot verification harness for the real `iot_sms` lifecycle and cleanup.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, `mysql2/promise`.

**Spec:** `docs/superpowers/specs/2026-09-04-leo-live-inspector-test-mysql-write-hardening-design.md`

## Global Constraints

- Real writes are limited to a uniquely named disposable table in the `iot_sms` test database.
- Existing business tables are never modified.
- Guarded SQL analysis fails closed when an `UPDATE`/`DELETE` may be present but top-level `WHERE` cannot be determined.
- The SQL text passed to MySQL remains byte-for-byte unchanged.
- No credentials may appear in code, tests, logs, diffs, or documentation.
- Unrelated LangBot and gateway files are out of scope.

---

### Task 1: SQL analyzer and safety semantics

**Files:**
- Create: `lib/skills/leo-live-inspector/scripts/common/sql-analysis.js`
- Create: `tests/unit/leo-live-inspector-sql-analysis.test.mjs`

**Interfaces:**
- Produces: `analyzeSql(sql)` returning `{ keyword, category, isWrite, guardRequired, hasTopLevelWhere, tableName }`.
- Produces: `looksLikeSql(sql)` for datasource-vs-SQL positional parsing.

- [ ] **Step 1: Write failing analyzer tests**

Cover plain and comment-prefixed statements, strings/comments/backticks containing fake `WHERE`, nested subqueries, multiple CTEs, `WITH RECURSIVE`, and DDL table extraction using literal expected objects.

- [ ] **Step 2: Run the focused test and confirm red**

Run: `node --test tests/unit/leo-live-inspector-sql-analysis.test.mjs`

Expected: FAIL because `scripts/common/sql-analysis.js` does not exist.

- [ ] **Step 3: Implement the lexer and analyzer**

Tokenize words, quoted identifiers, punctuation, and parenthesis depth while skipping quoted strings and comments. Find the effective top-level statement after optional CTEs, inspect only top-level tokens after guarded operations for `WHERE`, and extract simple DDL table names.

- [ ] **Step 4: Run the focused test and confirm green**

Run: `node --test tests/unit/leo-live-inspector-sql-analysis.test.mjs`

Expected: all analyzer cases pass.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-live-inspector/scripts/common/sql-analysis.js tests/unit/leo-live-inspector-sql-analysis.test.mjs
git commit -m "feat(leo-live-inspector): harden SQL write analysis"
```

### Task 2: CLI integration and observable behavior tests

**Files:**
- Modify: `lib/skills/leo-live-inspector/scripts/test_mysql_query.js`
- Create: `tests/fixtures/leo-live-inspector/fake-mysql.mjs`
- Create: `tests/unit/leo-live-inspector-test-mysql-cli.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `analyzeSql(sql)` and `looksLikeSql(sql)` from Task 1.
- Produces: unchanged CLI command shape plus optional test-only `LEO_TEST_MYSQL_MODULE` dependency injection.

- [ ] **Step 1: Write a failing CLI guard test**

Spawn the CLI with a temporary `HOME`, explicit host/database/password values, and the fake adapter. Assert that `UPDATE` with `WHERE` only inside comments or nested queries exits 1 without recording a fake connection.

- [ ] **Step 2: Run the CLI test and confirm red**

Run: `node --test tests/unit/leo-live-inspector-test-mysql-cli.test.mjs`

Expected: the current regex implementation misclassifies at least one safety case or lacks fake-module injection.

- [ ] **Step 3: Integrate analyzer and fake-module seam**

Use `looksLikeSql()` for positional parsing, reject guarded statements when `hasTopLevelWhere !== true` unless `--force`, and load `process.env.LEO_TEST_MYSQL_MODULE` only when explicitly present. Preserve original SQL for execution.

- [ ] **Step 4: Add vertical CLI output cases**

Use the fake adapter to return literal query, insert, update, and DDL results. Assert text and JSON metrics and contextual DDL table messages. Verify `--force` reaches the adapter and read-query formatting remains compatible.

- [ ] **Step 5: Run focused tests and confirm green**

Run: `node --test tests/unit/leo-live-inspector-sql-analysis.test.mjs tests/unit/leo-live-inspector-test-mysql-cli.test.mjs`

Expected: all tests pass with no live network access.

- [ ] **Step 6: Add repeatable npm command and commit**

Add `test:live-inspector-mysql` to `package.json`, then commit the CLI, fixtures, tests, and script entry.

### Task 3: Documentation, real `iot_sms` validation, and installation sync

**Files:**
- Modify: `lib/skills/leo-live-inspector/SKILL.md`
- Create: `scripts/verify-live-inspector-iot-sms.mjs`

**Interfaces:**
- Consumes: production `test_mysql_query.js` CLI.
- Produces: one-shot verification process with a unique table and unconditional cleanup.

- [ ] **Step 1: Add the verification harness**

Generate `leo_inspector_verify_20260904_<random>`; call the production CLI for `CREATE`, `INSERT --json`, `UPDATE WHERE --json`, `SELECT --json`, `DELETE WHERE --json`, and `DROP`; wrap all calls in `try/finally`; in `finally`, run `DROP TABLE IF EXISTS` and query `information_schema.tables` for zero remaining rows.

- [ ] **Step 2: Update Skill documentation**

Document comment/CTE-aware fail-closed protection and contextual DDL feedback without changing production-write policy.

- [ ] **Step 3: Run static and focused verification**

Run:

```bash
npm run test:live-inspector-mysql
node --check lib/skills/leo-live-inspector/scripts/common/sql-analysis.js
node --check lib/skills/leo-live-inspector/scripts/test_mysql_query.js
node --check scripts/verify-live-inspector-iot-sms.mjs
git diff --check
```

- [ ] **Step 4: Run real `iot_sms` lifecycle**

Run: `node scripts/verify-live-inspector-iot-sms.mjs`

Expected: six lifecycle operations succeed and the final absence check reports zero tables. If connection or permission fails, preserve cleanup evidence and report the exact external blocker.

- [ ] **Step 5: Audit and synchronize installed Skill**

Inspect the diff for credential material and unrelated files. Copy only changed Skill runtime/docs files into `~/.agents/skills/leo-live-inspector`, compare each with `cmp`, then rerun the focused tests against the repository copy.

- [ ] **Step 6: Commit**

```bash
git add lib/skills/leo-live-inspector/SKILL.md scripts/verify-live-inspector-iot-sms.mjs
git commit -m "test(leo-live-inspector): verify guarded MySQL writes"
```
