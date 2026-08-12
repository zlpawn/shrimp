import assert from "node:assert/strict";
import test from "node:test";

import { createMarketClient } from "../../lib/dream-skin/market/client.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

function makeFakeRequest(calls) {
  return async function requestBinary(url, options) {
    calls.push({ url, options });
    // Simulate different responses based on URL
    if (url.includes("index.json")) {
      return {
        bytes: Buffer.from(JSON.stringify({
          schemaVersion: 1,
          updatedAt: "2026-01-01",
          themes: [],
        })),
        finalUrl: url,
        status: 200,
        headers: {},
      };
    }
    if (url.includes("theme.json")) {
      return { bytes: Buffer.from("{}"), finalUrl: url, status: 200, headers: {} };
    }
    if (url.includes("background")) {
      return { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), finalUrl: url, status: 200, headers: {} };
    }
    if (url.includes("preview")) {
      return { bytes: Buffer.from([0x89, 0x50]), finalUrl: url, status: 200, headers: {} };
    }
    throw new DreamSkinError("market_unavailable", `not found: x`);
  };
}

test("market client fetchIndexBytes calls adapter with correct URL and limits", async () => {
  const calls = [];
  const client = createMarketClient({
    requestBinary: makeFakeRequest(calls),
    indexUrl: "https://example.com/repo/index.json",
    rawBaseUrl: "https://example.com/repo/",
  });
  const result = await client.fetchIndexBytes();
  assert.equal(calls[0].url, "https://example.com/repo/index.json");
  assert.equal(calls[0].options.maxBytes, 1024 * 1024);
  assert.ok(result.bytes.length > 0);
});

test("market client fetchThemeBytes uses 256 KiB limit", async () => {
  const calls = [];
  const client = createMarketClient({
    requestBinary: makeFakeRequest(calls),
    indexUrl: "https://example.com/repo/index.json",
    rawBaseUrl: "https://example.com/repo/",
  });
  const entry = {
    theme: "themes/x/theme.json",
    image: "themes/x/background.webp",
    preview: "themes/x/preview.webp",
  };
  await client.fetchThemeBytes(entry);
  assert.equal(calls[0].options.maxBytes, 256 * 1024);
});

test("market client fetchImageBytes uses 16 MiB limit", async () => {
  const calls = [];
  const client = createMarketClient({
    requestBinary: makeFakeRequest(calls),
    indexUrl: "https://example.com/repo/index.json",
    rawBaseUrl: "https://example.com/repo/",
  });
  const entry = {
    theme: "themes/x/theme.json",
    image: "themes/x/background.webp",
    preview: "themes/x/preview.webp",
  };
  await client.fetchImageBytes(entry);
  assert.equal(calls[0].options.maxBytes, 16 * 1024 * 1024);
});

test("market client fetchPreviewBytes uses 16 MiB limit", async () => {
  const calls = [];
  const client = createMarketClient({
    requestBinary: makeFakeRequest(calls),
    indexUrl: "https://example.com/repo/index.json",
    rawBaseUrl: "https://example.com/repo/",
  });
  const entry = {
    theme: "themes/x/theme.json",
    image: "themes/x/background.webp",
    preview: "themes/x/preview.webp",
  };
  await client.fetchPreviewBytes(entry);
  assert.equal(calls[0].options.maxBytes, 16 * 1024 * 1024);
});

test("market client rejects non-2xx status", async () => {
  const client = createMarketClient({
    requestBinary: async () => {
      throw new DreamSkinError("market_unavailable", "HTTP 404");
    },
    indexUrl: "https://example.com/repo/index.json",
    rawBaseUrl: "https://example.com/repo/",
  });
  await assert.rejects(client.fetchIndexBytes(), DreamSkinError);
});

test("market client constructs asset URLs from base + relative path", async () => {
  const calls = [];
  const client = createMarketClient({
    requestBinary: makeFakeRequest(calls),
    indexUrl: "https://example.com/repo/index.json",
    rawBaseUrl: "https://example.com/repo/",
  });
  await client.fetchThemeBytes({
    theme: "themes/x/theme.json",
    image: "themes/x/bg.webp",
    preview: "themes/x/pv.webp",
  });
  assert.ok(calls[0].url.startsWith("https://example.com/repo/themes/x/theme.json"));
});