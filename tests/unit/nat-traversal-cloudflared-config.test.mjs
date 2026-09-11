import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  defaultNatTraversalConfig,
  normalizeNatTraversalConfig,
} from "../../lib/nat-traversal/domain/config-schema.mjs";
import { createNatTraversalSecretStore } from "../../lib/nat-traversal/infra/secret-store.mjs";

test("defaultNatTraversalConfig includes cloudflared defaults", () => {
  const cfg = defaultNatTraversalConfig();
  assert.equal(cfg.activeProvider, "frpc");
  assert.ok(cfg.cloudflared);
  assert.equal(cfg.cloudflared.mode, "quick");
  assert.equal(cfg.cloudflared.localUrl, "http://127.0.0.1:8787");
  assert.equal(cfg.cloudflared.logLevel, "info");
  assert.equal(cfg.cloudflared.publicUrl, "");
});

test("normalizeNatTraversalConfig normalizes cloudflared values", () => {
  const normalized = normalizeNatTraversalConfig({
    activeProvider: "cloudflared",
    cloudflared: {
      mode: "TOKEN",
      localUrl: "http://localhost:9000",
      logLevel: "debug",
      publicUrl: "https://shrimp.myorg.com",
    },
  });
  assert.equal(normalized.activeProvider, "cloudflared");
  assert.equal(normalized.cloudflared.mode, "token");
  assert.equal(normalized.cloudflared.localUrl, "http://localhost:9000");
  assert.equal(normalized.cloudflared.logLevel, "debug");
  assert.equal(normalized.cloudflared.publicUrl, "https://shrimp.myorg.com");
});

test("secretStore loads and saves cloudflared token without touching model secrets", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nat-secrets-"));
  const secretsPath = path.join(tmpDir, "nat-traversal.secrets.json");

  try {
    const store = createNatTraversalSecretStore({ secretsPath });
    assert.equal(store.load().cloudflared.token, "");
    assert.equal(store.meta().cloudflaredTokenConfigured, false);

    store.save({ cloudflared: { token: "cf-token-12345" } });
    assert.equal(store.load().cloudflared.token, "cf-token-12345");
    assert.equal(store.meta().cloudflaredTokenConfigured, true);

    // Verify file content is nested and does not overwrite existing frpc
    const onDisk = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
    assert.equal(onDisk.cloudflared.token, "cf-token-12345");
    assert.equal(typeof onDisk.frpc, "object");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("secretStore respects CLOUDFLARE_TUNNEL_TOKEN environment override", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nat-secrets-env-"));
  const secretsPath = path.join(tmpDir, "nat-traversal.secrets.json");

  const originalEnv = process.env.CLOUDFLARE_TUNNEL_TOKEN;
  try {
    process.env.CLOUDFLARE_TUNNEL_TOKEN = "env-token-override";
    const store = createNatTraversalSecretStore({ secretsPath });
    assert.equal(store.load().cloudflared.token, "env-token-override");
    assert.equal(store.meta().cloudflaredTokenConfigured, true);
  } finally {
    if (originalEnv === undefined) {
      delete process.env.CLOUDFLARE_TUNNEL_TOKEN;
    } else {
      process.env.CLOUDFLARE_TUNNEL_TOKEN = originalEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
