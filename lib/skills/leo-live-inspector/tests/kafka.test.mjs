import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKafkaCatalog, resolveTopic, cleanBrokers } from '../scripts/common/kafka.js';

test('loadKafkaCatalog should load default kafka assets', () => {
  const catalog = loadKafkaCatalog(true);
  assert.ok(Object.keys(catalog).length > 0, 'Catalog should contain preset topics');
  assert.ok(catalog['beijia-reach-event'], 'Should contain beijia-reach-event');
});

test('resolveTopic should resolve topic by exact name', () => {
  const resolved = resolveTopic('beijia-reach-event', 'prod');
  assert.ok(resolved, 'Should resolve beijia-reach-event');
  assert.equal(resolved.targetTopic, 'beijia-reach-event');
  assert.ok(resolved.broker.length > 0, 'Should have broker list');
});

test('resolveTopic should resolve topic by alias or fuzzy keyword', () => {
  const resolved = resolveTopic('触达', 'prod');
  assert.ok(resolved, 'Should resolve by alias 触达');
  assert.equal(resolved.topicKey, 'beijia-reach-event');
});

test('cleanBrokers should parse comma-separated string', () => {
  const brokers = cleanBrokers('10.0.0.1:9092, 10.0.0.2:9092');
  assert.deepEqual(brokers, ['10.0.0.1:9092', '10.0.0.2:9092']);
});
