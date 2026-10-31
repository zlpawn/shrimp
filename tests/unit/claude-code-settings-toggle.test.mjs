import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncClaudeCodeSettingsIfEnabledInternal } from "./helpers/claude-code-sync-helper.mjs";

test("syncClaudeCodeSettingsIfEnabled skips sync when sync_settings is false or undefined", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-toggle-test-"));
  const settingsFile = path.join(tempDir, "settings.json");

  const configDisabled = {
    clients: {
      code: {
        sync_settings: false,
        endpoints: [{ id: "ep1", name: "ep1", is_default: true, models: ["claude-3-5-sonnet"] }],
      },
    },
  };

  const res1 = syncClaudeCodeSettingsIfEnabledInternal(configDisabled, { settingsPath: settingsFile });
  assert.equal(res1.updated, false);
  assert.equal(res1.reason, "disabled-by-client-config");
  assert.equal(fs.existsSync(settingsFile), false);

  const configUndefined = {
    clients: {
      code: {
        endpoints: [{ id: "ep1", name: "ep1", is_default: true, models: ["claude-3-5-sonnet"] }],
      },
    },
  };

  const res2 = syncClaudeCodeSettingsIfEnabledInternal(configUndefined, { settingsPath: settingsFile });
  assert.equal(res2.updated, false);
  assert.equal(res2.reason, "disabled-by-client-config");
  assert.equal(fs.existsSync(settingsFile), false);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("syncClaudeCodeSettingsIfEnabled proceeds when sync_settings is explicitly true", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-toggle-test-"));
  const settingsFile = path.join(tempDir, "settings.json");

  const configEnabled = {
    clients: {
      code: {
        sync_settings: true,
        endpoints: [{ id: "ep1", name: "ep1", is_default: true, models: ["claude-3-5-sonnet"] }],
      },
    },
  };

  const res = syncClaudeCodeSettingsIfEnabledInternal(configEnabled, { settingsPath: settingsFile });
  assert.equal(res.updated, true);
  assert.equal(fs.existsSync(settingsFile), true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
