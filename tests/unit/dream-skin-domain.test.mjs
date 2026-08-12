import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTheme,
  validateTheme,
  assertValidTheme,
  SUPPORTED_STYLE_PRESETS,
  COLOR_KEYS,
} from "../../lib/dream-skin/domain/theme-schema.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

const validTheme = {
  schemaVersion: 1,
  id: "aurora-night",
  name: "Aurora Night",
  style_preset: "midnight-aurora",
  backgroundImage: "background.webp",
  appearance: "auto",
  art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "ambient" },
  colors: {
    background: "#111318",
    panel: "#181b22",
    panelAlt: "#20242d",
    accent: "#8298a3",
    accentAlt: "#a8c0ca",
    secondary: "#6f8791",
    highlight: "#bfd4dc",
    text: "#edf2f4",
    muted: "#a4afb5",
    line: "rgba(130, 152, 163, 0.28)",
  },
};

test("normalizeTheme converts snake_case and backgroundImage aliases to camelCase", () => {
  const theme = normalizeTheme(validTheme);
  assert.equal(theme.schemaVersion, 1);
  assert.equal(theme.id, "aurora-night");
  assert.equal(theme.stylePreset, "midnight-aurora");
  assert.equal(theme.image, "background.webp");
  // backgroundImage is normalized to image, not preserved
  assert.equal(theme.backgroundImage, undefined);
  assert.equal(theme.style_preset, undefined);
});

test("normalizeTheme applies default text fields", () => {
  const theme = normalizeTheme({
    schemaVersion: 1,
    id: "test-theme",
    name: "Test",
    stylePreset: "",
    image: "bg.png",
    appearance: "dark",
  });
  assert.equal(theme.brandSubtitle, "CODEX DREAM SKIN");
  assert.equal(theme.tagline, "Make something wonderful.");
  assert.equal(theme.statusText, "THEME READY");
  assert.equal(theme.quote, "FOCUS");
});

test("normalizeTheme applies default art fields", () => {
  const theme = normalizeTheme({
    schemaVersion: 1,
    id: "test-theme",
    name: "Test",
  });
  assert.equal(theme.art.focusX, 0.5);
  assert.equal(theme.art.focusY, 0.5);
  assert.equal(theme.art.safeArea, "auto");
  assert.equal(theme.art.taskMode, "ambient");
});

test("normalizeTheme applies empty color keys when colors absent", () => {
  const theme = normalizeTheme({
    schemaVersion: 1,
    id: "test-theme",
    name: "Test",
  });
  for (const key of COLOR_KEYS) {
    assert.equal(theme.colors[key], "");
  }
});

test("validateTheme accepts a valid theme", () => {
  const result = validateTheme(validTheme);
  assert.ok(result.ok);
  assert.equal(result.value.id, "aurora-night");
  assert.deepEqual(result.issues, []);
});

test("validateTheme rejects unsupported style preset", () => {
  const result = validateTheme({ ...validTheme, stylePreset: "unknown-preset" });
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.code.includes("preset") || i.code.includes("invalid")));
});

test("validateTheme rejects invalid appearance enum", () => {
  const result = validateTheme({ ...validTheme, appearance: "purple" });
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.field === "appearance"));
});

test("validateTheme rejects invalid safeArea enum", () => {
  const result = validateTheme({
    ...validTheme,
    art: { ...validTheme.art, safeArea: "diagonal" },
  });
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.field === "art.safeArea"));
});

test("validateTheme rejects invalid taskMode enum", () => {
  const result = validateTheme({
    ...validTheme,
    art: { ...validTheme.art, taskMode: "flashy" },
  });
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.field === "art.taskMode"));
});

test("validateTheme rejects out-of-range focusX", () => {
  const result = validateTheme({
    ...validTheme,
    art: { ...validTheme.art, focusX: 1.5 },
  });
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.field === "art.focusX"));
});

test("validateTheme rejects focusY < 0", () => {
  const result = validateTheme({
    ...validTheme,
    art: { ...validTheme.art, focusY: -0.1 },
  });
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.field === "art.focusY"));
});

test("validateTheme rejects url() in colors", () => {
  const result = validateTheme({
    ...validTheme,
    colors: { ...validTheme.colors, accent: "url(javascript:alert(1))" },
  });
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.field === "colors.accent"));
});

test("validateTheme rejects var() in colors", () => {
  const result = validateTheme({
    ...validTheme,
    colors: { ...validTheme.colors, panel: "var(--evil)" },
  });
  assert.ok(!result.ok);
});

test("validateTheme rejects semicolons in colors", () => {
  const result = validateTheme({
    ...validTheme,
    colors: { ...validTheme.colors, text: "#fff;}" },
  });
  assert.ok(!result.ok);
});

test("validateTheme rejects newlines in colors", () => {
  const result = validateTheme({
    ...validTheme,
    colors: { ...validTheme.colors, text: "#fff\n}" },
  });
  assert.ok(!result.ok);
});

test("validateTheme rejects CSS escape sequences in colors", () => {
  const result = validateTheme({
    ...validTheme,
    colors: { ...validTheme.colors, text: "\\41" },
  });
  assert.ok(!result.ok);
});

test("validateTheme rejects image with path separators", () => {
  const result = validateTheme({ ...validTheme, image: "../escape.png" });
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.field === "image"));
});

test("validateTheme rejects image with URL scheme", () => {
  const result = validateTheme({ ...validTheme, image: "https://evil.com/x.png" });
  assert.ok(!result.ok);
});

test("validateTheme rejects image with backslash", () => {
  const result = validateTheme({ ...validTheme, image: "dir\\bg.png" });
  assert.ok(!result.ok);
});

test("validateTheme rejects image with query params", () => {
  const result = validateTheme({ ...validTheme, image: "bg.png?x=1" });
  assert.ok(!result.ok);
});

test("validateTheme rejects forbidden top-level css field", () => {
  const result = validateTheme({ ...validTheme, css: "body{color:red}" });
  assert.ok(!result.ok);
});

test("validateTheme rejects forbidden top-level javascript field", () => {
  const result = validateTheme({ ...validTheme, javascript: "alert(1)" });
  assert.ok(!result.ok);
});

test("validateTheme accepts #RGB hex", () => {
  const result = validateTheme({
    ...validTheme,
    colors: { ...validTheme.colors, accent: "#abc" },
  });
  assert.ok(result.ok);
});

test("validateTheme accepts #RRGGBBAA hex", () => {
  const result = validateTheme({
    ...validTheme,
    colors: { ...validTheme.colors, accent: "#aabbccdd" },
  });
  assert.ok(result.ok);
});

test("validateTheme accepts rgb() with valid channels", () => {
  const result = validateTheme({
    ...validTheme,
    colors: { ...validTheme.colors, accent: "rgb(128, 200, 255)" },
  });
  assert.ok(result.ok);
});

test("validateTheme rejects rgb() with out-of-range channels", () => {
  const result = validateTheme({
    ...validTheme,
    colors: { ...validTheme.colors, accent: "rgb(300, 0, 0)" },
  });
  assert.ok(!result.ok);
});

test("validateTheme rejects unknown color keys in output", () => {
  const theme = normalizeTheme({
    ...validTheme,
    colors: { ...validTheme.colors, evilKey: "#f00" },
  });
  assert.equal(theme.colors.evilKey, undefined);
  assert.equal(Object.keys(theme.colors).length, COLOR_KEYS.length);
});

test("validateTheme rejects name over 100 chars", () => {
  const result = validateTheme({ ...validTheme, name: "x".repeat(101) });
  assert.ok(!result.ok);
});

test("validateTheme rejects schemaVersion != 1", () => {
  const result = validateTheme({ ...validTheme, schemaVersion: 2 });
  assert.ok(!result.ok);
});

test("assertValidTheme returns the normalized theme on success", () => {
  const theme = assertValidTheme(validTheme);
  assert.equal(theme.id, "aurora-night");
  assert.equal(theme.stylePreset, "midnight-aurora");
});

test("assertValidTheme throws DreamSkinError on failure", () => {
  assert.throws(
    () => assertValidTheme({ ...validTheme, css: "body{}" }),
    (err) => err instanceof DreamSkinError && err.code === "invalid_theme",
  );
});

test("normalizeTheme allows builtin with allowBuiltin option", () => {
  const theme = normalizeTheme({
    schemaVersion: 1,
    id: "shrimp-default",
    name: "Shrimp Default",
    stylePreset: "",
    image: "",
    appearance: "auto",
  }, { allowBuiltin: true });
  assert.equal(theme.id, "shrimp-default");
});

test("normalizeTheme allows empty stylePreset", () => {
  const theme = normalizeTheme({
    schemaVersion: 1,
    id: "test",
    name: "Test",
    stylePreset: "",
  });
  assert.equal(theme.stylePreset, "");
});

test("normalizeTheme allows empty image for builtin", () => {
  const theme = normalizeTheme({
    schemaVersion: 1,
    id: "shrimp-default",
    name: "Default",
    stylePreset: "",
    image: "",
  }, { allowBuiltin: true });
  assert.equal(theme.image, "");
});