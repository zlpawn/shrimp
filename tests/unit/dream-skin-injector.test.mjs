import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";

import {
  loadRuntimeTheme,
  buildInjectionScript,
  buildCleanupScript,
  buildRuntimeEvaluateParams,
  buildAddScriptParams,
} from "../../lib/dream-skin/runtime/injector.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const validThemeJson = Buffer.from(JSON.stringify({
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
}));

test("loadRuntimeTheme parses and validates bytes", () => {
  const result = loadRuntimeTheme({ themeJsonBytes: validThemeJson, imageBytes: PNG_BYTES });
  assert.equal(result.theme.id, "aurora-night");
  assert.equal(result.imageFormat.extension, "png");
  assert.match(result.backgroundDataUri, /^data:image\/png;base64,/);
});

test("loadRuntimeTheme normalizes aliases", () => {
  const json = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    id: "x",
    name: "X",
    style_preset: "codex-snow",
    backgroundImage: "bg.png",
    colors: {
      background: "#111318", panel: "#181b22", panelAlt: "#20242d",
      accent: "#8298a3", accentAlt: "#a8c0ca", secondary: "#6f8791",
      highlight: "#bfd4dc", text: "#edf2f4", muted: "#a4afb5",
      line: "rgba(130, 152, 163, 0.28)",
    },
  }));
  const result = loadRuntimeTheme({ themeJsonBytes: json, imageBytes: PNG_BYTES });
  assert.equal(result.theme.stylePreset, "codex-snow");
  assert.equal(result.theme.image, "bg.png");
});

test("loadRuntimeTheme rejects invalid theme JSON", () => {
  assert.throws(
    () => loadRuntimeTheme({ themeJsonBytes: Buffer.from("{bad"), imageBytes: PNG_BYTES }),
    (err) => err instanceof DreamSkinError && err.code === "invalid_theme",
  );
});

test("loadRuntimeTheme rejects oversized theme JSON", () => {
  const big = Buffer.alloc(300 * 1024, 32); // spaces
  assert.throws(
    () => loadRuntimeTheme({ themeJsonBytes: big, imageBytes: PNG_BYTES }),
    (err) => err instanceof DreamSkinError && err.code === "invalid_theme",
  );
});

test("loadRuntimeTheme rejects image extension mismatch", () => {
  const json = Buffer.from(JSON.stringify({
    schemaVersion: 1, id: "x", name: "X", image: "background.jpg",
    colors: {
      background: "#111318", panel: "#181b22", panelAlt: "#20242d",
      accent: "#8298a3", accentAlt: "#a8c0ca", secondary: "#6f8791",
      highlight: "#bfd4dc", text: "#edf2f4", muted: "#a4afb5",
      line: "rgba(130, 152, 163, 0.28)",
    },
  }));
  assert.throws(
    () => loadRuntimeTheme({ themeJsonBytes: json, imageBytes: PNG_BYTES }),
    (err) => err instanceof DreamSkinError && err.code === "invalid_image",
  );
});

test("buildInjectionScript sets runtime flag and calls clear first", () => {
  const theme = loadRuntimeTheme({ themeJsonBytes: validThemeJson, imageBytes: PNG_BYTES });
  const script = buildInjectionScript(theme);
  assert.match(script, /__CODEX_PLUS_EXTERNAL_DREAM_SKIN_RUNTIME__ = true/);
  assert.match(script, /__CODEX_PLUS_CLEAR_DREAM_SKIN__\?\.\(\)/);
  assert.match(script, /state\.version = "codex-plus:cidala-tiger:r/);
  assert.doesNotThrow(() => new vm.Script(script));
});

test("buildCleanupScript removes known classes and parses", () => {
  const script = buildCleanupScript();
  assert.match(script, /codex-dream-skin-style/);
  assert.match(script, /codex-glass-vision-skin-style/);
  assert.match(script, /__CODEX_DREAM_SKIN_DISABLED__ = true/);
  assert.match(script, /__CODEX_DREAM_SKIN_INSTALLED__ = false/);
  assert.doesNotThrow(() => new vm.Script(script));
});

test("buildRuntimeEvaluateParams has CDP-compatible shape", () => {
  const params = buildRuntimeEvaluateParams("1 + 1", { awaitPromise: true });
  assert.deepEqual(params, {
    expression: "1 + 1",
    awaitPromise: true,
    allowUnsafeEvalBlockedByCSP: true,
    returnByValue: true,
  });
});

test("buildAddScriptParams wraps source", () => {
  assert.deepEqual(buildAddScriptParams("const x = 1;"), { source: "const x = 1;" });
});