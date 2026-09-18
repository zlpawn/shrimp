import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getServiceCiDeployMeta, resolveAppId } from '../scripts/common/services.js';
import { loadCloudCookie, saveCloudCookie } from '../scripts/common/credentials.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'ci_deploy.js');

test('resolveAppId should map smart-customer-service aliases', () => {
  assert.equal(resolveAppId('smart-customer-service'), 'smart-customer-service');
  assert.equal(resolveAppId('scs-service'), 'smart-customer-service');
  assert.equal(resolveAppId('scs-test'), 'smart-customer-service');
});

test('getServiceCiDeployMeta should return preset metadata for smart-customer-service', () => {
  const meta = getServiceCiDeployMeta('smart-customer-service');
  assert.ok(meta, 'Meta should exist');
  assert.equal(meta.serviceId, 'smart-customer-service');
  assert.equal(meta.ci?.workflowId, '6aa902005e698546c30e5ce6');
  assert.equal(meta.deploy?.test?.workloadId, 'env-smart-customer-service-test-d85');
});

test('ci_deploy CLI should block production deployments with safety advice', () => {
  try {
    execSync(`node ${SCRIPT_PATH} smart-customer-service --env prod`, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    assert.fail('Should have exited with non-zero status');
  } catch (err) {
    assert.ok(err.stdout.includes('安全红线拦截'), 'Should output safety intercept warning');
    assert.ok(err.stdout.includes('workloadnew'), 'Should output production portal link');
  }
});

test('ci_deploy CLI should run dry-run correctly when service metadata is known', () => {
  const output = execSync(`node ${SCRIPT_PATH} smart-customer-service --dry-run`, {
    encoding: 'utf8'
  });
  assert.ok(output.includes('Pre-flight 预检确认'), 'Should output pre-flight check');
  assert.ok(output.includes('6aa902005e698546c30e5ce6'), 'Should include builder workflow ID');
  assert.ok(output.includes('env-smart-customer-service-test-d85'), 'Should include workload ID');
});
