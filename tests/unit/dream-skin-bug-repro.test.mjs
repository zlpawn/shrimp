import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createThemeLibrary } from "../../lib/dream-skin/library/store.mjs";
import { resolveDreamSkinPaths } from "../../lib/dream-skin/paths.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

const PNG = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00]);
function theme(id, name) {
  return { schemaVersion: 1, id, name, stylePreset: "", appearance: "auto",
    art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "ambient" },
    colors: { background:"#111318",panel:"#181b22",panelAlt:"#20242d",accent:"#8298a3",accentAlt:"#a8c0ca",secondary:"#6f8791",highlight:"#bfd4dc",text:"#edf2f4",muted:"#a4afb5",line:"rgba(130,152,163,0.28)" } };
}

test("deleting unselected theme keeps selection (regression)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ds-del-"));
  const paths = resolveDreamSkinPaths({ configFile: path.join(tmp, "gw.json") });
  const lib = createThemeLibrary({ paths, logger: { warn() {}, log() {} } });
  try {
    await lib.initialize();
    await lib.createTheme({ theme: theme("theme-a", "A"), imageBytes: PNG });
    await lib.createTheme({ theme: theme("theme-b", "B"), imageBytes: PNG });
    await lib.selectTheme("theme-b");
    await lib.deleteTheme("theme-a");
    const list = await lib.listThemes();
    assert.equal(list.selectedThemeId, "theme-b");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("deleting selected theme still throws theme_in_use", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ds-del-"));
  const paths = resolveDreamSkinPaths({ configFile: path.join(tmp, "gw.json") });
  const lib = createThemeLibrary({ paths, logger: { warn() {}, log() {} } });
  try {
    await lib.initialize();
    await lib.createTheme({ theme: theme("theme-a", "A"), imageBytes: PNG });
    await lib.selectTheme("theme-a");
    await assert.rejects(
      lib.deleteTheme("theme-a"),
      (err) => err instanceof DreamSkinError && err.code === "theme_in_use",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("duplicateTheme allocates a fresh id not colliding with existing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ds-dup-"));
  const paths = resolveDreamSkinPaths({ configFile: path.join(tmp, "gw.json") });
  const lib = createThemeLibrary({ paths, logger: { warn() {}, log() {} } });
  try {
    await lib.initialize();
    await lib.createTheme({ theme: theme("aurora", "Aurora"), imageBytes: PNG });
    // Pre-create the would-be duplicate id
    await lib.createTheme({ theme: theme("aurora-copy", "Aurora Copy"), imageBytes: PNG });
    const dup = await lib.duplicateTheme("aurora", { name: "Aurora Copy" });
    assert.notEqual(dup.id, "aurora");
    assert.notEqual(dup.id, "aurora-copy");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});