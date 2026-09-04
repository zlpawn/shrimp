# Leo Live Inspector Test MySQL Write Hardening Design

Date: 2026-09-04
Status: Approved in conversation; pending written-spec review

## Goal

Complete the existing `leo-live-inspector` test-environment MySQL DML/DDL capability so its destructive-operation guard is testable and resistant to common SQL formatting tricks, its write results are explicit, and the implementation is verified both with automated tests and with a disposable table in the `iot_sms` test database.

## Scope and safety boundary

- This capability remains limited to `scripts/test_mysql_query.js` and test/line-network database connections.
- Existing business tables must never be used for write verification.
- Real-database verification must use a uniquely named disposable table in `iot_sms`.
- The verification lifecycle is `CREATE -> INSERT -> UPDATE WHERE -> SELECT -> DELETE WHERE -> DROP`.
- Cleanup must run in a `finally` path using `DROP TABLE IF EXISTS`, including after an intermediate failure.
- Existing connection credentials may be read through the script's normal configuration/cache discovery. Credentials must not be printed, copied into tests, committed, or added to documentation.
- No remote push is part of this implementation unless separately requested.

## Public seams

Automated tests cover two agreed public seams:

1. An exported SQL-analysis module with this stable contract:

   ```js
   analyzeSql(sql) => {
     keyword,          // normalized main statement keyword or "UNKNOWN"
     category,         // "QUERY" | "DML" | "DDL" | "UNKNOWN"
     isWrite,          // true for recognized DML/DDL
     guardRequired,    // true when the effective statement is UPDATE/DELETE
     hasTopLevelWhere, // true | false | null; null means indeterminate
     tableName         // extracted table name or null
   }
   ```

   The analyzer never mutates or rewrites the supplied SQL.
2. The `test_mysql_query.js` CLI, observed through exit status, stdout, and stderr with a fake MySQL adapter or injected execution dependency.

Tests must describe user-visible behavior and must not assert private implementation steps.

## SQL analysis

Move statement inspection out of the CLI orchestration file into a small side-effect-free module under `scripts/common/`.

The analyzer must:

- Ignore leading whitespace and SQL comments when locating the effective statement.
- Ignore keywords found inside single-quoted strings, double-quoted strings, backtick identifiers, line comments, and block comments.
- Classify the supported query statements: `SELECT`, `SHOW`, `DESC`/`DESCRIBE`, and `EXPLAIN`.
- Classify the supported DML statements: `INSERT`, `UPDATE`, `DELETE`, and `REPLACE`.
- Classify the supported DDL statements: `CREATE`, `ALTER`, `DROP`, and `TRUNCATE`.
- Recognize a top-level `UPDATE` or `DELETE` following MySQL 8 common-table expressions, including multiple CTEs and `WITH RECURSIVE`.
- For guarded `UPDATE` and `DELETE`, recognize only an effective top-level `WHERE`, not `WHERE` text inside a string, comment, identifier, or nested subquery.
- Extract a table name for straightforward `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, and `TRUNCATE TABLE` statements when possible. Failure to extract a name must not prevent execution.

The analyzer is deliberately not a complete SQL parser. Unsupported statements that do not lexically resolve to a guarded `UPDATE` or `DELETE` remain executable as generic queries. If lexical analysis indicates that the effective statement may be `UPDATE` or `DELETE` but the main statement or top-level-`WHERE` result is indeterminate, execution fails closed unless `--force` is present.

## Guard behavior

- `UPDATE` and `DELETE` without an effective top-level `WHERE` must exit before loading `mysql2`, opening a connection, or persisting credentials.
- A potentially guarded statement with `hasTopLevelWhere: null` is treated the same as a missing `WHERE` and rejected unless `--force` is present.
- The rejection message must identify the operation and explain that `--force` is required for an intentional full-table operation.
- `--force` bypasses only this guard; it does not alter connection selection, SQL text, or output mode.
- `WHERE 1=1` counts as a syntactic `WHERE` and is allowed. The tool protects against accidental omission, not semantically broad predicates.
- DDL remains directly executable in the test environment, consistent with the previously approved capability.

## Execution and output

The CLI continues to pass the original SQL text unchanged to `mysql2`.

For DML/DDL results, human-readable output includes:

- operation category;
- elapsed time;
- `affectedRows`;
- `insertId` for inserts when provided;
- `changedRows` for updates/replaces when provided;
- warning count when non-zero;
- a contextual success line containing the extracted table name for supported DDL statements when available.

JSON output keeps the current connection metadata and operation type. Write results use the exact keys `affectedRows`, `insertId`, `changedRows`, and `warningStatus`, retaining current compatibility.

SELECT/SHOW/DESC/EXPLAIN output and existing datasource selection behavior must remain compatible.

## Test design

Use Node's built-in `node:test` and `node:assert/strict`.

Analyzer tests cover:

- supported query, DML, and DDL classification;
- leading comments and whitespace;
- CTE-prefixed updates/deletes;
- real top-level `WHERE` acceptance;
- string/comment/backtick/nested-subquery `WHERE` rejection;
- DDL table-name extraction.

CLI tests cover:

- guarded statements fail before a database connection;
- `--force` permits an otherwise guarded statement;
- datasource-vs-SQL positional parsing accepts DML and DDL;
- structured text output for insert/update/DDL;
- structured JSON output;
- existing read-query output remains intact.

Each behavior is implemented in a red-green vertical slice. The tests may use an explicit environment-selected fake MySQL module so the production command stays a normal CLI while tests control connection results without a real server.

## Real `iot_sms` verification

After automated tests pass, run the production CLI against the configured `iot_sms` test database with a unique table name shaped like:

```text
leo_inspector_verify_20260904_<random-suffix>
```

The full lifecycle must be controlled by one Node verification harness. It may be a checked-in manual verification script or a one-shot stdin script, but it must contain a single `try/finally` around all CLI invocations. The `finally` block always invokes the production CLI with `DROP TABLE IF EXISTS`, then queries `information_schema.tables` to prove that the generated table name is absent. A series of unrelated terminal commands is not sufficient evidence.

Verification steps inside that harness:

1. `CREATE TABLE` with a numeric primary key, text value, and integer status.
2. `INSERT` one row and record the returned insert ID.
3. `UPDATE ... WHERE id = <insertId>` and verify one affected/changed row.
4. `SELECT` the row and verify the new value.
5. `DELETE ... WHERE id = <insertId>` and verify one affected row.
6. `DROP TABLE`.
7. In all cases, execute `DROP TABLE IF EXISTS` from `finally` and verify the table no longer exists.

The validation report may include the temporary table name, operation results, and timings, but no password or secret-bearing connection configuration.

## Documentation and local installation

- Update `SKILL.md` only where behavior has materially changed, especially the safety explanation and DDL feedback.
- Add a focused npm test command for the inspector MySQL tests if that improves repeatability.
- After repository verification, synchronize only the changed `leo-live-inspector` files to `~/.agents/skills/leo-live-inspector` and compare them byte-for-byte, including `SKILL.md` whenever it changes.

## Completion criteria

The work is complete when:

1. Focused analyzer and CLI tests pass with zero failures.
2. Static syntax checks pass for every changed JavaScript file.
3. The disposable-table lifecycle succeeds in `iot_sms`, or an external connection/permission failure is reported precisely without claiming full completion.
4. Cleanup is verified and no disposable table remains.
5. Repository and installed Skill copies match for changed runtime files.
6. The final diff contains no credential material and no unrelated LangBot changes.

## Non-goals

- Building a complete MySQL grammar parser.
- Adding production-database write support.
- Adding interactive confirmations for ordinary test-environment writes.
- Protecting users from deliberately broad predicates such as `WHERE 1=1`.
- Refactoring unrelated database discovery, Apollo, logging, browser-extension, or LangBot code.
