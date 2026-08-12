import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import { createThemeLibrary, BUILTIN_ID } from "../../lib/dream-skin/library/store.mjs";
import { resolveDreamSkinPaths } from "../../lib/dream-skin/paths.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function makeLib() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-lib-"));
  const paths = resolveDreamSkinPaths({
    configFile: path.join(tmpDir, "gateway.config.json"),
  });
  const lib = createThemeLibrary({ paths, logger: { warn() {}, log() {} } });
  return {
    lib,
    paths,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

const validTheme = {
  schemaVersion: 1,
  id: "aurora-night",
  name: "Aurora Night",
  stylePreset: "midnight-aurora",
  image: "background.png",
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

test("initialize returns builtin theme", async () => {
  const { lib, cleanup } = makeLib();
  try {
    const result = await lib.initialize();
    const list = await lib.listThemes();
    assert.equal(list.themes.length, 1);
    assert.equal(list.themes[0].id, BUILTIN_ID);
    assert.equal(list.themes[0].kind, "builtin");
    assert.equal(list.themes[0].builtin, true);
    assert.equal(list.selectedThemeId, BUILTIN_ID);
    assert.ok(result.warnings !== undefined);
  } finally {
    cleanup();
  }
});

test("initialize never writes builtin to themes/", async () => {
  const { lib, paths, cleanup } = makeLib();
  try {
    await lib.initialize();
    const themesDirExists = fs.existsSync(paths.themesDir);
    if (themesDirExists) {
      const entries = fs.readdirSync(paths.themesDir);
      assert.ok(!entries.includes(BUILTIN_ID));
    }
  } finally {
    cleanup();
  }
});

test("createTheme adds a stored theme", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    const summary = await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    assert.equal(summary.id, "aurora-night");
    assert.equal(summary.kind, "stored");
    assert.equal(summary.builtin, false);

    const list = await lib.listThemes();
    assert.equal(list.themes.length, 2);
    assert.ok(list.themes.some((t) => t.id === "aurora-night"));
  } finally {
    cleanup();
  }
});

test("createTheme summary does not expose local paths", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    const summary = await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const keys = Object.keys(summary);
    assert.ok(!keys.includes("themePath"));
    assert.ok(!keys.includes("imagePath"));
    assert.ok(!keys.includes("configDir"));
    assert.ok(!keys.includes("rootDir"));
  } finally {
    cleanup();
  }
});

test("createTheme rejects duplicate ID", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    await assert.rejects(
      lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES }),
      (err) => err instanceof DreamSkinError && err.code === "theme_already_exists",
    );
  } finally {
    cleanup();
  }
});

test("duplicateTheme allocates new ID", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const dup = await lib.duplicateTheme("aurora-night", { name: "Aurora Copy" });
    assert.equal(dup.name, "Aurora Copy");
    assert.notEqual(dup.id, "aurora-night");
  } finally {
    cleanup();
  }
});

test("updateTheme replaces existing theme", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const updated = await lib.updateTheme("aurora-night", {
      theme: { ...validTheme, name: "Aurora Updated" },
    });
    assert.equal(updated.name, "Aurora Updated");
    const list = await lib.listThemes();
    assert.ok(list.themes.some((t) => t.name === "Aurora Updated"));
  } finally {
    cleanup();
  }
});

test("updateTheme rejects builtin", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await assert.rejects(
      lib.updateTheme(BUILTIN_ID, { theme: validTheme }),
      (err) => err instanceof DreamSkinError && err.code === "builtin_theme_readonly",
    );
  } finally {
    cleanup();
  }
});

test("selectTheme changes selection", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const result = await lib.selectTheme("aurora-night");
    assert.equal(result.selectedThemeId, "aurora-night");
    assert.ok(result.themes.find((t) => t.id === "aurora-night").selected);
    assert.ok(!result.themes.find((t) => t.id === BUILTIN_ID).selected);
  } finally {
    cleanup();
  }
});

test("deleteTheme removes stored theme", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    await lib.deleteTheme("aurora-night");
    const list = await lib.listThemes();
    assert.equal(list.themes.length, 1);
    assert.equal(list.themes[0].id, BUILTIN_ID);
  } finally {
    cleanup();
  }
});

test("deleteTheme rejects builtin", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await assert.rejects(
      lib.deleteTheme(BUILTIN_ID),
      (err) => err instanceof DreamSkinError && err.code === "builtin_theme_readonly",
    );
  } finally {
    cleanup();
  }
});

test("deleteTheme rejects currently selected theme", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    await lib.selectTheme("aurora-night");
    await assert.rejects(
      lib.deleteTheme("aurora-night"),
      (err) => err instanceof DreamSkinError && err.code === "theme_in_use",
    );
  } finally {
    cleanup();
  }
});

test("getTheme returns theme detail", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const detail = await lib.getTheme("aurora-night");
    assert.equal(detail.theme.id, "aurora-night");
    assert.equal(detail.kind, "stored");
    assert.ok(detail.imageBytes);
    assert.ok(detail.imageFormat);
  } finally {
    cleanup();
  }
});

test("getTheme returns builtin with no image", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    const detail = await lib.getTheme(BUILTIN_ID);
    assert.equal(detail.theme.id, BUILTIN_ID);
    assert.equal(detail.kind, "builtin");
    assert.equal(detail.imageBytes, null);
    assert.equal(detail.imageFormat, null);
  } finally {
    cleanup();
  }
});

test("duplicateTheme of builtin without image throws", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await assert.rejects(
      lib.duplicateTheme(BUILTIN_ID, { name: "Copy" }),
      (err) => err instanceof DreamSkinError && err.code === "invalid_image",
    );
  } finally {
    cleanup();
  }
});

test("duplicateTheme of builtin with image succeeds", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    const dup = await lib.duplicateTheme(BUILTIN_ID, { name: "Custom", imageBytes: PNG_BYTES });
    assert.equal(dup.kind, "stored");
    assert.notEqual(dup.id, BUILTIN_ID);
  } finally {
    cleanup();
  }
});

test("createTheme requires image bytes", async () => {
  const { lib, cleanup } = makeLib();
  try {
    await lib.initialize();
    await assert.rejects(
      lib.createTheme({ theme: validTheme }),
      (err) => err instanceof DreamSkinError && err.code === "invalid_image",
    );
  } finally {
    cleanup();
  }
});

test("corrupt JSON theme is hidden from list", async () => {
  const { lib, paths, cleanup } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    // Corrupt the theme.json
    const themeDir = path.join(paths.themesDir, "aurora-night");
    await fs.promises.writeFile(path.join(themeDir, "theme.json"), "{ invalid json");
    const list = await lib.listThemes();
    assert.ok(!list.themes.some((t) => t.id === "aurora-night"));
    assert.ok(list.invalidEntries >= 1);
  } finally {
    cleanup();
  }
});