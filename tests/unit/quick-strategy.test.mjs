import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveQuickBinary,
  resolvePidFile,
  resolveLogFile,
  readPid,
  writePid,
  removePid,
  isPidAlive,
  DEFAULT_QUICK_PORT,
} from "../../lib/quick/supervisor.mjs";
import { quickStrategy } from "../../lib/models/strategies/quick.mjs";

test("resolveQuickBinary finds bundled binary in bin/quick", () => {
  const res = resolveQuickBinary();
  assert.ok(res.binaryPath, "bundled binary should be resolved");
  assert.equal(res.source, "bundled");
});

test("quick supervisor manages pid file lifecycle", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quick-test-"));
  const pidFile = path.join(tmpDir, "test.pid");
  try {
    assert.equal(readPid(pidFile), null);
    writePid(process.pid, pidFile);
    assert.equal(readPid(pidFile), process.pid);
    assert.equal(isPidAlive(process.pid), true);
    removePid(pidFile);
    assert.equal(readPid(pidFile), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("quickStrategy.supports detects quick type, provider, or port 8377", () => {
  assert.equal(quickStrategy.supports({ type: "quick" }), true);
  assert.equal(quickStrategy.supports({ provider: "quick" }), true);
  assert.equal(quickStrategy.supports({ base_url: "http://127.0.0.1:8377/v1" }), true);
  assert.equal(quickStrategy.supports({ base_url: "http://127.0.0.1:8377" }), true);
  assert.equal(quickStrategy.supports({ type: "openai", base_url: "http://api.openai.com/v1" }), false);
});

test("quickStrategy.discover invokes ensureReady and fetches models", async () => {
  let ensureReadyCalled = false;
  const mockEndpoint = {
    type: "quick",
    base_url: `http://127.0.0.1:${DEFAULT_QUICK_PORT}/v1`,
  };

  const mockContext = {
    ensureReady: async ({ port }) => {
      ensureReadyCalled = true;
      assert.equal(port, DEFAULT_QUICK_PORT);
    },
    fetchImpl: async (url, opts) => {
      assert.ok(url.includes("/v1/models"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "quick", object: "model" },
            { id: "quick-smart", object: "model" },
          ],
        }),
      };
    },
  };

  const result = await quickStrategy.discover(mockEndpoint, mockContext);
  assert.equal(ensureReadyCalled, true);
  assert.equal(result.strategy, "quick");
  assert.equal(result.source, "quick");
  assert.equal(result.models.length, 2);
  assert.equal(result.models[0].id, "quick");
  assert.equal(result.models[0].capabilities.reasoning, true);
  assert.equal(result.models[0].capabilities.tools, true);
});
