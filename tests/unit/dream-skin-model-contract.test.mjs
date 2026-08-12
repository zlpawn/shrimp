import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("dream-skin-model.ts exports required helper names", () => {
  const source = fs.readFileSync("desktop/src/modules/dream-skin-model.ts", "utf8");
  for (const name of [
    "filterMarketThemes",
    "themeToDraft",
    "draftToSaveInput",
    "previewStyleModel",
  ]) {
    assert.match(source, new RegExp(`export function ${name}`), `${name} should be exported`);
  }
});

test("api.ts exposes Dream Skin API functions with /v1/dream-skin paths", () => {
  const source = fs.readFileSync("desktop/src/core/api.ts", "utf8");
  for (const fn of [
    "getDreamSkinCapabilities",
    "listDreamSkinThemes",
    "getDreamSkinTheme",
    "createDreamSkinTheme",
    "updateDreamSkinTheme",
    "duplicateDreamSkinTheme",
    "selectDreamSkinTheme",
    "deleteDreamSkinTheme",
    "importDreamSkinTheme",
    "loadDreamSkinMarket",
    "installDreamSkinMarketTheme",
    "updateDreamSkinMarketTheme",
  ]) {
    assert.match(source, new RegExp(`export function ${fn}`), `${fn} should be exported`);
  }
  assert.match(source, /\/v1\/dream-skin\/capabilities/);
  assert.match(source, /\/v1\/dream-skin\/themes/);
});

test("api.ts uses encodeURIComponent for dynamic IDs", () => {
  const source = fs.readFileSync("desktop/src/core/api.ts", "utf8");
  const occurrences = (source.match(/encodeURIComponent\(id\)/g) || []).length;
  assert.ok(occurrences >= 5, `expected at least 5 encodeURIComponent(id), got ${occurrences}`);
});

test("types.ts defines Dream Skin interfaces", () => {
  const source = fs.readFileSync("desktop/src/core/types.ts", "utf8");
  for (const name of [
    "DreamSkinCapabilities",
    "DreamSkinTheme",
    "DreamSkinThemeDetail",
    "DreamSkinLibraryResponse",
    "DreamSkinMarketTheme",
    "DreamSkinMarketResponse",
    "DreamSkinApiError",
    "DreamSkinPreviewScene",
  ]) {
    assert.match(source, new RegExp(`interface ${name}`), `${name} should be defined`);
  }
});

test("dream-skin-model.ts defines DreamSkinDraft interface", () => {
  const source = fs.readFileSync("desktop/src/modules/dream-skin-model.ts", "utf8");
  assert.match(source, /interface DreamSkinDraft/);
});

test("no API function accepts url/themeUrl/imageUrl/previewUrl/hash parameters", () => {
  const source = fs.readFileSync("desktop/src/core/api.ts", "utf8");
  const dreamSkinSection = source.split("// --- Dream Skin API ---")[1] || "";
  assert.doesNotMatch(dreamSkinSection, /url:|themeUrl:|imageUrl:|previewUrl:|hash/);
});
