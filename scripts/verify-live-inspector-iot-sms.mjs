#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const mysqlCli = path.join(
  repoRoot,
  'lib',
  'skills',
  'leo-live-inspector',
  'scripts',
  'test_mysql_query.js'
);

const service = 'iot-platform';
const database = 'iot_sms';
const suffix = crypto.randomBytes(4).toString('hex');
const tableName = `leo_inspector_verify_20260904_${suffix}`;

function runSql(sql, { json = true, allowFailure = false } = {}) {
  const args = [mysqlCli, service, '--database', database];
  if (json) args.push('--json');
  args.push(sql);

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      LEO_TEST_MYSQL_NO_PERSIST: '1'
    },
    encoding: 'utf8'
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `SQL verification command failed (exit ${result.status}): ${result.stderr.trim() || result.stdout.trim()}`
    );
  }

  if (!json || result.status !== 0) return { result, payload: null };

  try {
    return { result, payload: JSON.parse(result.stdout) };
  } catch (error) {
    throw new Error(`Verification command did not return JSON: ${error.message}\n${result.stdout}`);
  }
}

let primaryError = null;
let cleanupError = null;

console.log(`🧪 iot_sms 临时表验证开始: ${tableName}`);

try {
  const created = runSql(
    `CREATE TABLE \`${tableName}\` (` +
    '`id` BIGINT NOT NULL AUTO_INCREMENT, ' +
    '`note` VARCHAR(64) NOT NULL, ' +
    '`status` INT NOT NULL DEFAULT 0, ' +
    'PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  ).payload;
  assert.equal(created.operationType, 'DDL');
  console.log(`  ✅ CREATE: affectedRows=${created.affectedRows}`);

  const inserted = runSql(
    `INSERT INTO \`${tableName}\` (note, status) VALUES ('created', 0)`
  ).payload;
  assert.equal(inserted.operationType, 'DML');
  assert.ok(Number(inserted.insertId) > 0, 'INSERT must return a positive insertId');
  const insertId = Number(inserted.insertId);
  console.log(`  ✅ INSERT: insertId=${insertId}, affectedRows=${inserted.affectedRows}`);

  const updated = runSql(
    `UPDATE \`${tableName}\` SET note = 'updated', status = 1 WHERE id = ${insertId}`
  ).payload;
  assert.equal(updated.affectedRows, 1);
  console.log(`  ✅ UPDATE: affectedRows=${updated.affectedRows}, changedRows=${updated.changedRows}`);

  const selected = runSql(
    `SELECT id, note, status FROM \`${tableName}\` WHERE id = ${insertId}`
  ).payload;
  assert.equal(selected.total, 1);
  assert.equal(Number(selected.rows[0].id), insertId);
  assert.equal(selected.rows[0].note, 'updated');
  assert.equal(Number(selected.rows[0].status), 1);
  console.log(`  ✅ SELECT: id=${insertId}, note=${selected.rows[0].note}, status=${selected.rows[0].status}`);

  const deleted = runSql(
    `DELETE FROM \`${tableName}\` WHERE id = ${insertId}`
  ).payload;
  assert.equal(deleted.affectedRows, 1);
  console.log(`  ✅ DELETE: affectedRows=${deleted.affectedRows}`);

  const dropped = runSql(`DROP TABLE \`${tableName}\``).payload;
  assert.equal(dropped.operationType, 'DDL');
  console.log(`  ✅ DROP: affectedRows=${dropped.affectedRows}`);
} catch (error) {
  primaryError = error;
} finally {
  const cleanup = runSql(`DROP TABLE IF EXISTS \`${tableName}\``, { allowFailure: true });
  if (cleanup.result.status !== 0) {
    cleanupError = new Error(
      `Final DROP TABLE IF EXISTS failed: ${cleanup.result.stderr.trim() || cleanup.result.stdout.trim()}`
    );
  } else {
    try {
      const absence = runSql(
        `SELECT COUNT(*) AS remaining FROM information_schema.tables ` +
        `WHERE table_schema = '${database}' AND table_name = '${tableName}'`
      ).payload;
      assert.equal(Number(absence.rows?.[0]?.remaining), 0);
      console.log('  ✅ CLEANUP: information_schema remaining=0');
    } catch (error) {
      cleanupError = error;
    }
  }
}

if (primaryError || cleanupError) {
  if (primaryError) console.error(`❌ 主验证失败: ${primaryError.message}`);
  if (cleanupError) console.error(`❌ 清理验证失败: ${cleanupError.message}`);
  process.exit(1);
}

console.log(`🎉 iot_sms 临时表写入闭环验证通过: ${tableName}`);
