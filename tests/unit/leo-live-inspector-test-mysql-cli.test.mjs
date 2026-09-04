import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..');
const cliPath = path.join(repoRoot, 'lib', 'skills', 'leo-live-inspector', 'scripts', 'test_mysql_query.js');
const fakeMysqlUrl = pathToFileURL(path.join(repoRoot, 'tests', 'fixtures', 'leo-live-inspector', 'fake-mysql.mjs')).href;

function runCli(sql, options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leo-live-inspector-mysql-'));
  const home = path.join(tempRoot, 'home');
  const cwd = path.join(tempRoot, 'cwd');
  const eventFile = path.join(tempRoot, 'mysql-events.jsonl');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  const args = [
    cliPath,
    'fixture-service',
    '--host', 'fixture-host',
    '--database', 'fixture_db',
    '--password', 'test-only-placeholder',
    ...(options.beforeSql || []),
    sql,
    ...(options.afterSql || [])
  ];

  const result = spawnSync(process.execPath, args, {
    cwd,
    env: {
      HOME: home,
      LEO_TEST_MYSQL_MODULE: fakeMysqlUrl,
      LEO_TEST_MYSQL_EVENT_FILE: eventFile,
      ...(options.env || {})
    },
    encoding: 'utf8'
  });

  const events = fs.existsSync(eventFile)
    ? fs.readFileSync(eventFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : [];

  return { ...result, events, home, tempRoot };
}

function assertConnectedWithOriginalSql(result, sql) {
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.events.some(event => event.type === 'connect'));
  assert.deepEqual(result.events.find(event => event.type === 'query'), { type: 'query', sql });
}

test('rejects comment, string, and nested-subquery fake WHERE before loading MySQL', () => {
  const statements = [
    'UPDATE accounts SET active = 0 /* WHERE id = 7 */',
    "DELETE FROM accounts WHERELESS = 'WHERE id = 7'",
    'UPDATE accounts SET owner_id = (SELECT id FROM owners WHERE active = 1)'
  ];

  for (const sql of statements) {
    const result = runCli(sql);
    assert.equal(result.status, 1, `expected rejection for: ${sql}`);
    assert.match(result.stderr, /安全拦截/);
    assert.match(result.stderr, /--force/);
    assert.deepEqual(result.events, [], `MySQL loaded or connected for: ${sql}`);
  }
});

test('rejects unsafe multi-statement analysis before loading MySQL', () => {
  const sql = 'UPDATE accounts SET active = 1 WHERE id = 7; DELETE FROM accounts';
  const result = runCli(sql);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /安全拦截/);
  assert.match(result.stderr, /--force/);
  assert.deepEqual(result.events, []);
});

test('allows a real top-level WHERE and passes the original SQL unchanged', () => {
  const sql = "\n/* keep this comment */\nUPDATE accounts\nSET note = 'WHERE remains data'\nWHERE id = 7";
  const result = runCli(sql);
  assertConnectedWithOriginalSql(result, sql);
});

test('--force allows an otherwise guarded full-table operation unchanged', () => {
  const sql = 'DELETE FROM accounts /* intentional full-table cleanup */';
  const result = runCli(sql, { beforeSql: ['--force'] });
  assertConnectedWithOriginalSql(result, sql);
});

test('uses SQL analysis rather than prefix matching for positional SQL detection', () => {
  const sql = '/* leading comment */ INSERT INTO audit_log (message) VALUES (\'ok\')';
  const result = runCli(sql, { afterSql: ['unused-second-positional'] });
  assertConnectedWithOriginalSql(result, sql);
});

test('prints analyzer-driven INSERT and UPDATE text results', () => {
  const insert = runCli("INSERT INTO audit_log (message) VALUES ('created')");
  assert.equal(insert.status, 0, insert.stderr);
  assert.match(insert.stdout, /DML \(数据写入\)/);
  assert.match(insert.stdout, /affectedRows\) \| 1 \|/);
  assert.match(insert.stdout, /insertId\) \| 42 \|/);

  const updateSql = 'UPDATE audit_log SET message = \'updated\' WHERE id = 42';
  const update = runCli(updateSql);
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, /DML \(数据写入\)/);
  assert.match(update.stdout, /changedRows\) \| 1 \|/);
  assert.match(update.stdout, /warnings\) \| 2 \|/);
});

test('prints contextual DDL success messages with extracted table names', () => {
  const statements = [
    ['CREATE TABLE `fixture_db`.`tmp_records` (id INT)', 'CREATE', 'fixture_db.tmp_records'],
    ['ALTER TABLE `tmp_records` ADD COLUMN name VARCHAR(20)', 'ALTER', 'tmp_records'],
    ['DROP TABLE IF EXISTS `tmp_records`', 'DROP', 'tmp_records'],
    ['TRUNCATE TABLE tmp_records', 'TRUNCATE', 'tmp_records']
  ];

  for (const [sql, keyword, tableName] of statements) {
    const result = runCli(sql);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DDL \(结构变更\)/);
    assert.match(result.stdout, new RegExp(`${keyword}.*${tableName.replace('.', '\\.')}`));
    assertConnectedWithOriginalSql(result, sql);
  }
});

test('write JSON retains metadata and exact write-result keys', () => {
  const sql = "INSERT INTO audit_log (message) VALUES ('json')";
  const result = runCli(sql, { beforeSql: ['--json'] });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);

  assert.deepEqual(Object.keys(payload), [
    'service', 'datasource', 'host', 'port', 'database', 'sql', 'costMs', 'operationType',
    'affectedRows', 'insertId', 'changedRows', 'warningStatus'
  ]);
  assert.equal(payload.operationType, 'DML');
  assert.equal(payload.sql, sql);
  assert.deepEqual({
    affectedRows: payload.affectedRows,
    insertId: payload.insertId,
    changedRows: payload.changedRows,
    warningStatus: payload.warningStatus
  }, {
    affectedRows: 1,
    insertId: 42,
    changedRows: 0,
    warningStatus: 0
  });
});

test('preserves existing SELECT table output', () => {
  const sql = 'SELECT id, name FROM people';
  const result = runCli(sql);
  assertConnectedWithOriginalSql(result, sql);
  assert.match(result.stdout, /状态: 查询成功/);
  assert.match(result.stdout, /\| id \| name \|/);
  assert.match(result.stdout, /\| 7 \| Ada \|/);
});

test('can disable credential-cache persistence for disposable verification runs', () => {
  const result = runCli('SELECT id, name FROM people', {
    env: { LEO_TEST_MYSQL_NO_PERSIST: '1' }
  });
  assertConnectedWithOriginalSql(result, 'SELECT id, name FROM people');
  assert.equal(
    fs.existsSync(path.join(result.home, '.shrimp', 'skills', 'live-inspector', 'test_databases.json')),
    false
  );
});
