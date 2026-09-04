import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeSql, looksLikeSql } from '../../lib/skills/leo-live-inspector/scripts/common/sql-analysis.js';

const expected = (keyword, category, isWrite, guardRequired, hasTopLevelWhere, tableName = null) => ({
  keyword,
  category,
  isWrite,
  guardRequired,
  hasTopLevelWhere,
  tableName
});

test('classifies supported query, DML, and DDL statements', () => {
  assert.deepEqual(analyzeSql('SELECT 1'), expected('SELECT', 'QUERY', false, false, null));
  assert.deepEqual(analyzeSql('SHOW TABLES'), expected('SHOW', 'QUERY', false, false, null));
  assert.deepEqual(analyzeSql('DESC users'), expected('DESC', 'QUERY', false, false, null));
  assert.deepEqual(analyzeSql('EXPLAIN SELECT 1'), expected('EXPLAIN', 'QUERY', false, false, null));
  assert.deepEqual(analyzeSql('INSERT INTO users (name) VALUES (\'Ada\')'), expected('INSERT', 'DML', true, false, null));
  assert.deepEqual(analyzeSql('UPDATE users SET name = \'Ada\' WHERE id = 1'), expected('UPDATE', 'DML', true, true, true));
  assert.deepEqual(analyzeSql('DELETE FROM users WHERE id = 1'), expected('DELETE', 'DML', true, true, true));
  assert.deepEqual(analyzeSql('REPLACE INTO users (id) VALUES (1)'), expected('REPLACE', 'DML', true, false, null));
  assert.deepEqual(analyzeSql('CREATE TABLE users (id INT)'), expected('CREATE', 'DDL', true, false, null, 'users'));
  assert.deepEqual(analyzeSql('ALTER TABLE users ADD COLUMN active TINYINT'), expected('ALTER', 'DDL', true, false, null, 'users'));
  assert.deepEqual(analyzeSql('DROP TABLE IF EXISTS users'), expected('DROP', 'DDL', true, false, null, 'users'));
  assert.deepEqual(analyzeSql('TRUNCATE TABLE users'), expected('TRUNCATE', 'DDL', true, false, null, 'users'));
});

test('ignores leading whitespace and SQL comments before the statement', () => {
  const sql = `\n  /* UPDATE fake SET value = 1 */\n  -- DELETE FROM fake WHERE id = 1\n  UPDATE real_table SET value = 2 WHERE id = 7`;
  assert.deepEqual(analyzeSql(sql), expected('UPDATE', 'DML', true, true, true));
});

test('ignores keywords inside strings, quoted identifiers, and comments', () => {
  const sql = `UPDATE \`where_table\` SET note = 'DELETE FROM x WHERE id = 1'
    /* WHERE id = 2 */
    SET value = "UPDATE y WHERE id = 3"
    WHERE id = 4`;
  assert.equal(analyzeSql(sql).hasTopLevelWhere, true);

  const noGuard = `DELETE FROM \`where_table\` /* WHERE id = 2 */
    WHERELESS = 'WHERE id = 3'`;
  assert.deepEqual(analyzeSql(noGuard), expected('DELETE', 'DML', true, true, false));
});

test('recognizes guarded UPDATE and DELETE after multiple CTEs, including WITH RECURSIVE', () => {
  const update = `WITH first_cte AS (SELECT id FROM source WHERE enabled = 1),
    second_cte AS (SELECT id FROM first_cte)
    UPDATE target SET value = 1 WHERE target.id IN (SELECT id FROM second_cte)`;
  const recursiveDelete = `WITH RECURSIVE tree AS (
    SELECT id, parent_id FROM nodes WHERE parent_id IS NULL
    UNION ALL
    SELECT n.id, n.parent_id FROM nodes n JOIN tree t ON n.parent_id = t.id
  ), leaves AS (SELECT id FROM tree)
  DELETE FROM nodes WHERE id IN (SELECT id FROM leaves)`;

  assert.deepEqual(analyzeSql(update), expected('UPDATE', 'DML', true, true, true));
  assert.deepEqual(analyzeSql(recursiveDelete), expected('DELETE', 'DML', true, true, true));
});

test('does not count WHERE inside a nested subquery as a top-level guard', () => {
  const sql = 'UPDATE target SET value = 1 WHERELESS = (SELECT id FROM source WHERE active = 1)';
  assert.deepEqual(analyzeSql(sql), expected('UPDATE', 'DML', true, true, false));
});

test('reports indeterminate guarding when the statement has unbalanced syntax', () => {
  const sql = 'DELETE FROM users WHERE id IN (SELECT id FROM other';
  assert.deepEqual(analyzeSql(sql), expected('DELETE', 'DML', true, true, null));
});

test('reports guarded analysis as indeterminate when multiple top-level statements are supplied', () => {
  const sql = 'UPDATE users SET active = 1 WHERE id = 7; DELETE FROM users';
  assert.deepEqual(analyzeSql(sql), expected('UPDATE', 'DML', true, true, null));
});

test('accepts one trailing semicolon and ignores semicolons inside SQL text', () => {
  const sql = `UPDATE \`semi;table\` SET note = 'first;second' /* ; comment */ WHERE id = 7;`;
  assert.deepEqual(analyzeSql(sql), expected('UPDATE', 'DML', true, true, true));
});

test('extracts straightforward DDL table names without rewriting the input SQL', () => {
  const statements = [
    ['CREATE TABLE IF NOT EXISTS `iot_sms`.`tmp_table` (id INT)', 'iot_sms.tmp_table'],
    ['ALTER TABLE `tmp_table` ADD COLUMN value TEXT', 'tmp_table'],
    ['DROP TABLE IF EXISTS `tmp_table`', 'tmp_table'],
    ['TRUNCATE tmp_table', 'tmp_table']
  ];

  for (const [sql, tableName] of statements) {
    const original = sql;
    assert.equal(analyzeSql(sql).tableName, tableName);
    assert.equal(sql, original);
  }
});

test('looksLikeSql recognizes SQL after comments and all supported write keywords', () => {
  assert.equal(looksLikeSql(' /* note */ INSERT INTO users VALUES (1)'), true);
  assert.equal(looksLikeSql('UPDATE users SET value = 1'), true);
  assert.equal(looksLikeSql('CREATE TABLE users (id INT)'), true);
  assert.equal(looksLikeSql('WITH rows AS (SELECT 1) DELETE FROM users WHERE id = 1'), true);
  assert.equal(looksLikeSql('tenant0'), false);
  assert.equal(looksLikeSql('not actually sql'), false);
});

test('returns the exact unknown result shape for unsupported or empty input', () => {
  const unknown = expected('UNKNOWN', 'UNKNOWN', false, false, null);
  assert.deepEqual(analyzeSql(''), unknown);
  assert.deepEqual(analyzeSql('GRANT SELECT ON users TO app'), unknown);
});
