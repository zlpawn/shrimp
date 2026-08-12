import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMarketIndex,
  assertMarketAssetPath,
  joinMarketAssetUrl,
  MAX_MARKET_INDEX_BYTES,
  MAX_MARKET_THEMES,
} from "../../lib/dream-skin/market/schema.mjs";
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

test("assertMarketIndex accepts a valid index", () => {
  const index = assertMarketIndex(validIndex);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.themes.length, 1);
  assert.equal(index.themes[0].id, "aurora-night");
  assert.equal(index.themes[0].themeSha256, "a".repeat(64));
});

test("assertMarketIndex normalizes snake_case aliases", () => {
  const index = assertMarketIndex({
    schema_version: 1,
    updated_at: "2026-08-11T00:00:00Z",
    themes: [{
      id: "aurora-night",
      name: "Aurora Night",
      version: "1.0.0",
      author: "Example",
      description: "Dark theme",
      license: "MIT",
      source_url: "https://example.com/theme",
      tags: ["dark"],
      theme: "themes/aurora-night/theme.json",
      image: "themes/aurora-night/background.webp",
      preview: "themes/aurora-night/preview.webp",
      theme_sha256: "a".repeat(64),
      image_sha256: "b".repeat(64),
    }],
  });
  assert.equal(index.themes[0].sourceUrl, "https://example.com/theme");
  assert.equal(index.themes[0].themeSha256, "a".repeat(64));
  assert.equal(index.themes[0].imageSha256, "b".repeat(64));
});

test("assertMarketIndex rejects duplicate IDs", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [...validIndex.themes, ...validIndex.themes],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects missing license", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [{ ...validIndex.themes[0], license: "" }],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects more than 12 tags", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [{ ...validIndex.themes[0], tags: Array(13).fill("tag") }],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects non-HTTP source URL", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [{ ...validIndex.themes[0], sourceUrl: "ftp://example.com" }],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects full URL in asset fields", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [{ ...validIndex.themes[0], theme: "https://evil.com/theme.json" }],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects absolute paths in asset fields", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [{ ...validIndex.themes[0], image: "/etc/passwd" }],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects .. in asset paths", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [{ ...validIndex.themes[0], preview: "../escape.webp" }],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects backslashes in asset paths", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [{ ...validIndex.themes[0], theme: "themes\\x\\theme.json" }],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects query strings in asset paths", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [{ ...validIndex.themes[0], theme: "themes/x/theme.json?evil=1" }],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects invalid SHA-256", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [{ ...validIndex.themes[0], themeSha256: "xyz" }],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects more than 200 themes", () => {
  const themes = Array(201).fill(null).map((_, i) => ({
    ...validIndex.themes[0],
    id: `theme-${i}`,
  }));
  assert.throws(
    () => assertMarketIndex({ ...validIndex, themes }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketIndex rejects reserved IDs", () => {
  assert.throws(
    () => assertMarketIndex({
      ...validIndex,
      themes: [{ ...validIndex.themes[0], id: "shrimp-default" }],
    }),
    (err) => err instanceof DreamSkinError,
  );
});

test("assertMarketAssetPath accepts valid relative paths", () => {
  assert.equal(assertMarketAssetPath("themes/x/theme.json", "test"), "themes/x/theme.json");
});

test("assertMarketAssetPath rejects traversal", () => {
  assert.throws(() => assertMarketAssetPath("../x", "test"), DreamSkinError);
  assert.throws(() => assertMarketAssetPath("/x", "test"), DreamSkinError);
  assert.throws(() => assertMarketAssetPath("https://x.com/y", "test"), DreamSkinError);
});

test("joinMarketAssetUrl joins valid relative paths", () => {
  const url = joinMarketAssetUrl("https://example.com/repo/main/", "themes/x/theme.json");
  assert.equal(url, "https://example.com/repo/main/themes/x/theme.json");
});

test("joinMarketAssetUrl rejects cross-origin paths", () => {
  assert.throws(
    () => joinMarketAssetUrl("https://example.com/repo/", "https://evil.com/x"),
    DreamSkinError,
  );
});