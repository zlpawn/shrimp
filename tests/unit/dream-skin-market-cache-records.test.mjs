import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import { createMarketCache } from "../../lib/dream-skin/market/cache.mjs";
import { createInstallRecords } from "../../lib/dream-skin/market/install-records.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

const validIndex = {
  schemaVersion: 1,
  updatedAt: "2026-08-11T00:00:00Z",
  themes: [{
    id: "aurora-night",
    name: "Aurora Night",
    version: "1.0.0",
    author: "Example",
    description: "Dark theme",
    license: "MIT",
    sourceUrl: "https://example.com/theme",
    tags: ["dark"],
    theme: "themes/aurora-night/theme.json",
    image: "themes/aurora-night/background.webp",
    preview: "themes/aurora-night/preview.webp",
    themeSha256: "a".repeat(64),
    imageSha256: "b".repeat(64),
  }],
};

function makeTempFile() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-cache-"));
  return {
    path: path.join(tmpDir, "index.json"),
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function makeFakeClient(shouldFail, indexData) {
  return {
    async fetchIndexBytes() {
      if (shouldFail) throw new DreamSkinError("market_unavailable", "network error");
      return { bytes: Buffer.from(JSON.stringify(indexData || validIndex)), finalUrl: "x", status: 200, headers: {} };
    },
  };
}

// --- Cache tests ---

test("cache loads from remote and writes cache file", async () => {
  const { path: indexPath, cleanup } = makeTempFile();
  try {
    const cache = createMarketCache({
      indexPath,
      client: makeFakeClient(false),
      logger: { warn() {} },
    });
    const result = await cache.load();
    assert.ok(!result.cached);
    assert.equal(result.index.themes[0].id, "aurora-night");
    assert.ok(fs.existsSync(indexPath));
  } finally {
    cleanup();
  }
});

test("cache falls back to local on network failure", async () => {
  const { path: indexPath, cleanup } = makeTempFile();
  try {
    // Write valid cache first
    fs.writeFileSync(indexPath, JSON.stringify(validIndex));
    const cache = createMarketCache({
      indexPath,
      client: makeFakeClient(true),
      logger: { warn() {} },
    });
    const result = await cache.load();
    assert.ok(result.cached);
    assert.equal(result.warning.code, "market_cache_fallback");
    assert.equal(result.index.themes[0].id, "aurora-night");
  } finally {
    cleanup();
  }
});

test("cache throws when both remote and cache fail", async () => {
  const { path: indexPath, cleanup } = makeTempFile();
  try {
    const cache = createMarketCache({
      indexPath,
      client: makeFakeClient(true),
      logger: { warn() {} },
    });
    await assert.rejects(cache.load(), (err) => err instanceof DreamSkinError && err.code === "market_unavailable");
  } finally {
    cleanup();
  }
});

test("cache forceRefresh ignores in-memory but still fetches remote", async () => {
  const { path: indexPath, cleanup } = makeTempFile();
  try {
    const cache = createMarketCache({
      indexPath,
      client: makeFakeClient(false),
      logger: { warn() {} },
    });
    await cache.load();
    const result = await cache.load({ forceRefresh: true });
    assert.ok(!result.cached);
  } finally {
    cleanup();
  }
});

test("cache getCurrent returns null before load", () => {
  const { path: indexPath, cleanup } = makeTempFile();
  try {
    const cache = createMarketCache({
      indexPath,
      client: makeFakeClient(false),
      logger: { warn() {} },
    });
    assert.equal(cache.getCurrent(), null);
  } finally {
    cleanup();
  }
});

// --- Install records tests ---

function makeTempRecords() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-rec-"));
  return {
    path: path.join(tmpDir, "installed.json"),
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

test("install records set and get", async () => {
  const { path: recordsPath, cleanup } = makeTempRecords();
  try {
    const records = createInstallRecords({ installedPath: recordsPath });
    await records.set("aurora", { version: "1.0.0" });
    const record = await records.get("aurora");
    assert.equal(record.version, "1.0.0");
    assert.equal(record.source, "market");
    assert.ok(record.installedAt);
    assert.ok(record.updatedAt);
  } finally {
    cleanup();
  }
});

test("install records update preserves installedAt", async () => {
  const { path: recordsPath, cleanup } = makeTempRecords();
  try {
    const records = createInstallRecords({ installedPath: recordsPath });
    await records.set("aurora", { version: "1.0.0" });
    await new Promise((r) => setTimeout(r, 10));
    await records.set("aurora", { version: "1.1.0" });
    const record = await records.get("aurora");
    assert.equal(record.version, "1.1.0");
    assert.notEqual(record.installedAt, record.updatedAt);
  } finally {
    cleanup();
  }
});

test("install records remove", async () => {
  const { path: recordsPath, cleanup } = makeTempRecords();
  try {
    const records = createInstallRecords({ installedPath: recordsPath });
    await records.set("aurora", { version: "1.0.0" });
    await records.remove("aurora");
    const record = await records.get("aurora");
    assert.equal(record, null);
  } finally {
    cleanup();
  }
});

test("install records snapshot and restore", async () => {
  const { path: recordsPath, cleanup } = makeTempRecords();
  try {
    const records = createInstallRecords({ installedPath: recordsPath });
    await records.set("a", { version: "1.0" });
    await records.set("b", { version: "2.0" });
    const snap = await records.snapshot();
    await records.remove("a");
    await records.remove("b");
    await records.restore(snap);
    const a = await records.get("a");
    const b = await records.get("b");
    assert.equal(a.version, "1.0");
    assert.equal(b.version, "2.0");
  } finally {
    cleanup();
  }
});