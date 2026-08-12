import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createThemeLibrary } from "../../lib/dream-skin/library/store.mjs";
import { resolveDreamSkinPaths } from "../../lib/dream-skin/paths.mjs";

const PNG = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00]);
function theme(id, name) {
  return { schemaVersion: 1, id, name, stylePreset: "", appearance: "auto",
    art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "ambient" },
    colors: { background:"#111318",panel:"#181b22",panelAlt:"#20242d",accent:"#8298a3",accentAlt:"#a8c0ca",secondary:"#6f8791",highlight:"#bfd4dc",text:"#edf2f4",muted:"#a4afb5",line:"rgba(130,152,163,0.28)" } };
}

function makeLib() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ds-auto-"));
  const paths = resolveDreamSkinPaths({ configFile: path.join(tmp, "gw.json") });
  return { lib: createThemeLibrary({ paths, logger: { warn() {}, log() {} } }), tmp };
}

test("createTheme with empty id auto-allocates slug from name", async () => {
  const { lib, tmp } = makeLib();
  try {
    await lib.initialize();
    const summary = await lib.createTheme({ theme: theme("", "Aurora Night"), imageBytes: PNG });
    assert.equal(summary.id, "aurora-night");
    assert.equal(summary.name, "Aurora Night");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("createTheme auto-allocated id avoids collisions", async () => {
  const { lib, tmp } = makeLib();
  try {
    await lib.initialize();
    await lib.createTheme({ theme: theme("", "My Theme"), imageBytes: PNG });
    // Pre-create the base slug so the second create must pick -2
    await lib.createTheme({ theme: theme("", "My Theme"), imageBytes: PNG });
    const list = await lib.listThemes();
    const ids = list.themes.map((t) => t.id);
    assert.ok(ids.includes("my-theme"));
    assert.ok(ids.includes("my-theme-2"), `expected my-theme-2 in ${ids}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("createTheme keeps explicit id when provided", async () => {
  const { lib, tmp } = makeLib();
  try {
    await lib.initialize();
    const summary = await lib.createTheme({ theme: theme("explicit-id", "Explicit"), imageBytes: PNG });
    assert.equal(summary.id, "explicit-id");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});