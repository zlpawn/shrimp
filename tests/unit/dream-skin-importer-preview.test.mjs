import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import { createThemeImporter } from "../../lib/dream-skin/library/importer.mjs";
import { buildPreviewModel } from "../../lib/dream-skin/preview/model.mjs";
import { createThemeLibrary, BUILTIN_ID } from "../../lib/dream-skin/library/store.mjs";
import { normalizeTheme } from "../../lib/dream-skin/domain/theme-schema.mjs";
import { resolveDreamSkinPaths } from "../../lib/dream-skin/paths.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const validTheme = {
  schemaVersion: 1,
  id: "aurora-night",
  name: "Aurora Night",
  stylePreset: "midnight-aurora",
  image: "background.png",
  appearance: "auto",
  art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "ambient" },
  colors: {
    background: "#111318", panel: "#181b22", panelAlt: "#20242d",
    accent: "#8298a3", accentAlt: "#a8c0ca", secondary: "#6f8791",
    highlight: "#bfd4dc", text: "#edf2f4", muted: "#a4afb5",
    line: "rgba(130, 152, 163, 0.28)",
  },
};

const normalized = normalizeTheme(validTheme);

function makeLib() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-imp-"));
  const paths = resolveDreamSkinPaths({ configFile: path.join(tmpDir, "gw.json") });
  const lib = createThemeLibrary({ paths, logger: { warn() {}, log() {} } });
  return { lib, cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
}

// --- Importer ---

test("importer imports valid theme with image", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    const importer = createThemeImporter({ library: lib, canReplace: async () => false });
    const summary = await importer.importTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    assert.equal(summary.id, "aurora-night");
    assert.equal(summary.kind, "stored");
  } finally {
    cleanup();
  }
});

test("importer rejects absent image", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    const importer = createThemeImporter({ library: lib, canReplace: async () => false });
    await assert.rejects(
      importer.importTheme({ theme: validTheme }),
      (err) => err instanceof DreamSkinError && err.code === "invalid_image",
    );
  } finally {
    cleanup();
  }
});

test("importer rejects CSS/JavaScript keys in theme", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    const importer = createThemeImporter({ library: lib, canReplace: async () => false });
    await assert.rejects(
      importer.importTheme({ theme: { ...validTheme, css: "body{}" }, imageBytes: PNG_BYTES }),
      (err) => err instanceof DreamSkinError,
    );
  } finally {
    cleanup();
  }
});

test("importer duplicate ID with error mode throws", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const importer = createThemeImporter({ library: lib, canReplace: async () => false });
    await assert.rejects(
      importer.importTheme({ theme: validTheme, imageBytes: PNG_BYTES, conflict: "error" }),
      (err) => err instanceof DreamSkinError && err.code === "theme_already_exists",
    );
  } finally {
    cleanup();
  }
});

test("importer duplicate ID with copy mode allocates new ID", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const importer = createThemeImporter({ library: lib, canReplace: async () => false });
    const summary = await importer.importTheme({
      theme: validTheme, imageBytes: PNG_BYTES, conflict: "copy",
    });
    assert.notEqual(summary.id, "aurora-night");
  } finally {
    cleanup();
  }
});

test("importer replace-local refuses when canReplace is false", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const importer = createThemeImporter({ library: lib, canReplace: async () => false });
    await assert.rejects(
      importer.importTheme({ theme: validTheme, imageBytes: PNG_BYTES, conflict: "replace-local" }),
      (err) => err instanceof DreamSkinError && err.code === "theme_already_exists",
    );
  } finally {
    cleanup();
  }
});

test("importer replace-local succeeds when canReplace is true", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const importer = createThemeImporter({ library: lib, canReplace: async (id) => id === "aurora-night" });
    const summary = await importer.importTheme({
      theme: { ...validTheme, name: "Updated" }, imageBytes: PNG_BYTES, conflict: "replace-local",
    });
    assert.equal(summary.id, "aurora-night");
  } finally {
    cleanup();
  }
});

// --- Preview model ---

test("buildPreviewModel returns controlled values for home scene", () => {
  const model = buildPreviewModel(normalized, { scene: "home" });
  assert.equal(model.scene, "home");
  assert.equal(model.appearance, "dark");
  assert.equal(model.imageUrl, "/v1/dream-skin/themes/aurora-night/image");
  assert.equal(model.imagePosition, "50% 50%");
  assert.equal(model.safeArea, "auto");
  assert.equal(model.taskMode, "ambient");
  assert.equal(model.colors.background, "#111318");
  assert.equal(model.colors.accent, "#8298a3");
  assert.equal(model.text.brandSubtitle, "CODEX DREAM SKIN");
});

test("buildPreviewModel returns controlled values for chat scene", () => {
  const model = buildPreviewModel(normalized, { scene: "chat" });
  assert.equal(model.scene, "chat");
});

test("buildPreviewModel resolves auto appearance to dark", () => {
  const model = buildPreviewModel({ ...normalized, appearance: "auto" });
  assert.equal(model.appearance, "dark");
});

test("buildPreviewModel preserves explicit light appearance", () => {
  const model = buildPreviewModel({ ...normalized, appearance: "light" });
  assert.equal(model.appearance, "light");
});

test("buildPreviewModel converts focus to percentages", () => {
  const model = buildPreviewModel({
    ...normalized, art: { ...normalized.art, focusX: 0, focusY: 1 },
  });
  assert.equal(model.imagePosition, "0% 100%");
});

test("buildPreviewModel does not emit HTML, CSS, or scripts", () => {
  const model = buildPreviewModel(normalized);
  const json = JSON.stringify(model);
  assert.ok(!json.includes("<"));
  assert.ok(!json.includes("selector"));
  assert.ok(!json.includes("renderer"));
  assert.ok(!json.includes("script"));
});

test("buildPreviewModel handles empty image for builtin", () => {
  const model = buildPreviewModel({ ...normalized, id: BUILTIN_ID, image: "" });
  assert.equal(model.imageUrl, "");
});

test("buildPreviewModel encodes theme ID in URL", () => {
  const model = buildPreviewModel({ ...normalized, id: "my-cool-theme" });
  assert.equal(model.imageUrl, "/v1/dream-skin/themes/my-cool-theme/image");
});