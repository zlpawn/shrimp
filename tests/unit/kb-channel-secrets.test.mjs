import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelSecretsStore, resolveSecretValue } from "../../lib/knowledge-base/channel-secrets.mjs";

describe("ChannelSecretsStore: Credential Isolation & Security", () => {
  it("loads default config and masks credentials properly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sec-test-"));
    try {
      const store = new ChannelSecretsStore({ dataDir: tmpDir, env: {} });
      const pub = store.getPublicConfig();

      assert.equal(pub.version, "1.0");
      assert.equal(pub.schedule.enabled, false);
      assert.equal(pub.schedule.mode, "daily");
      assert.equal(pub.schedule.daily_time, "04:00");
      assert.equal(pub.channels.weread.has_credentials, false);
      assert.equal(pub.channels.craft.has_credentials, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("saves and retrieves credentials without git leakage", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sec-test-"));
    try {
      const store = new ChannelSecretsStore({ dataDir: tmpDir, env: {} });

      store.updateChannel("weread", {
        credentials: { api_key: "wrk-secret-12345678" },
        settings: { sync_underlines: true },
      });

      assert.equal(store.getChannelCredential("weread", "api_key"), "wrk-secret-12345678");

      const pub = store.getPublicConfig();
      assert.equal(pub.channels.weread.has_credentials, true);
      assert.equal(pub.channels.weread.credentials_masked.api_key, "wrk-...5678");

      // Verify file exists in tmpDir (dataDir), completely outside git
      const raw = fs.readFileSync(path.join(tmpDir, "channel-secrets.json"), "utf8");
      assert.ok(raw.includes("wrk-secret-12345678"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("supports env:VAR fallback and environment variable overrides", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sec-test-"));
    const mockEnv = {
      WEREAD_API_KEY: "wrk-env-key-9999",
      CUSTOM_CRAFT_MCP: "https://mcp.custom.craft.do",
    };
    try {
      const store = new ChannelSecretsStore({ dataDir: tmpDir, env: mockEnv });

      // If empty, falls back to mockEnv.WEREAD_API_KEY
      assert.equal(store.getChannelCredential("weread", "api_key"), "wrk-env-key-9999");

      // Custom env: reference
      assert.equal(resolveSecretValue("env:CUSTOM_CRAFT_MCP", mockEnv), "https://mcp.custom.craft.do");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("updates schedule configuration", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sec-test-"));
    try {
      const store = new ChannelSecretsStore({ dataDir: tmpDir, env: {} });

      const updated = store.updateSchedule({
        enabled: true,
        mode: "interval",
        interval_hours: 6,
        daily_time: "02:30",
        target_collection_id: "col_reading",
      });

      assert.equal(updated.enabled, true);
      assert.equal(updated.mode, "interval");
      assert.equal(updated.interval_hours, 6);
      assert.equal(updated.daily_time, "02:30");
      assert.equal(updated.target_collection_id, "col_reading");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
