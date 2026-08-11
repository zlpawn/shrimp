import assert from "node:assert/strict";
import test from "node:test";

import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";
import {
  assertThemeId,
  slugifyThemeId,
  allocateThemeId,
  RESERVED_IDS,
} from "../../lib/dream-skin/domain/theme-id.mjs";

// --- Error class ---

test("DreamSkinError carries code, details, and cause", () => {
  const cause = new Error("root");
  const err = new DreamSkinError("invalid_theme", "bad theme", {
    details: [{ field: "name", code: "too_short" }],
    cause,
  });
  assert.equal(err.code, "invalid_theme");
  assert.equal(err.message, "bad theme");
  assert.equal(err.name, "DreamSkinError");
  assert.deepEqual(err.details, [{ field: "name", code: "too_short" }]);
  assert.equal(err.cause, cause);
  assert.ok(err instanceof Error);
});

test("DreamSkinError works without options", () => {
  const err = new DreamSkinError("storage_error", "disk full");
  assert.equal(err.code, "storage_error");
  assert.deepEqual(err.details, []);
  assert.equal(err.cause, undefined);
});

// --- assertThemeId ---

test("assertThemeId accepts valid IDs", () => {
  assert.equal(assertThemeId("aurora-night"), "aurora-night");
  assert.equal(assertThemeId("my.theme.2"), "my.theme.2");
  assert.equal(assertThemeId("a"), "a");
  assert.equal(assertThemeId("theme_1"), "theme_1");
});

test("assertThemeId rejects empty values", () => {
  assert.throws(() => assertThemeId(""), { code: "invalid_theme_id" });
  assert.throws(() => assertThemeId(null), { code: "invalid_theme_id" });
  assert.throws(() => assertThemeId(undefined), { code: "invalid_theme_id" });
});

test("assertThemeId rejects uppercase, slashes, and path traversal", () => {
  assert.throws(() => assertThemeId("Aurora"), { code: "invalid_theme_id" });
  assert.throws(() => assertThemeId("../escape"), { code: "invalid_theme_id" });
  assert.throws(() => assertThemeId("a/b"), { code: "invalid_theme_id" });
  assert.throws(() => assertThemeId("a\\b"), { code: "invalid_theme_id" });
});

test("assertThemeId rejects leading punctuation", () => {
  assert.throws(() => assertThemeId("-foo"), { code: "invalid_theme_id" });
  assert.throws(() => assertThemeId(".bar"), { code: "invalid_theme_id" });
  assert.throws(() => assertThemeId("_baz"), { code: "invalid_theme_id" });
});

test("assertThemeId rejects IDs over 64 bytes", () => {
  const long = "a".repeat(65);
  assert.throws(() => assertThemeId(long), { code: "invalid_theme_id" });
});

test("assertThemeId accepts exactly 64 bytes", () => {
  const id = "a".repeat(64);
  assert.equal(assertThemeId(id), id);
});

test("assertThemeId rejects reserved IDs by default", () => {
  assert.throws(() => assertThemeId("shrimp-default"), { code: "invalid_theme_id" });
  assert.throws(() => assertThemeId("builtin"), { code: "invalid_theme_id" });
});

test("assertThemeId accepts reserved IDs with allowBuiltin", () => {
  assert.equal(assertThemeId("shrimp-default", { allowBuiltin: true }), "shrimp-default");
  assert.equal(assertThemeId("builtin", { allowBuiltin: true }), "builtin");
});

// --- slugifyThemeId ---

test("slugifyThemeId converts names to slugs", () => {
  assert.equal(slugifyThemeId("Aurora Night"), "aurora-night");
  assert.equal(slugifyThemeId("My Theme!"), "my-theme");
  assert.equal(slugifyThemeId("  spaced  "), "spaced");
});

test("slugifyThemeId returns theme for empty or symbol-only names", () => {
  assert.equal(slugifyThemeId(""), "theme");
  assert.equal(slugifyThemeId("!!!"), "theme");
  assert.equal(slugifyThemeId("---"), "theme");
});

// --- allocateThemeId ---

test("allocateThemeId returns base slug when not taken", () => {
  assert.equal(
    allocateThemeId("Aurora Night", () => false),
    "aurora-night",
  );
});

test("allocateThemeId appends -2, -3 on conflict", () => {
  assert.equal(
    allocateThemeId("Aurora Night", (id) => id === "aurora-night"),
    "aurora-night-2",
  );
  assert.equal(
    allocateThemeId("Aurora Night", (id) => id === "aurora-night" || id === "aurora-night-2"),
    "aurora-night-3",
  );
});

test("allocateThemeId handles empty name", () => {
  assert.equal(allocateThemeId("", () => false), "theme");
  assert.equal(allocateThemeId("", (id) => id === "theme"), "theme-2");
});