import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEngineScript,
  contentSignature,
  resolveEngine,
} from "../../lib/dream-skin/engines/index.mjs";

const CASES = [
  { preset: "", engine: "dream-skin" },
  { preset: "codex-snow", engine: "snow" },
  { preset: "glass-vision", engine: "glass-vision" },
  { preset: "midnight-aurora", engine: "cidala-tiger" },
];

test("style presets select the same renderer engines as CodexPlusPlus", () => {
  for (const { preset, engine } of CASES) {
    assert.equal(resolveEngine(preset), engine);
  }
});

test("all renderer engines replace their template placeholders", () => {
  for (const { engine } of CASES) {
    const script = buildEngineScript(engine, {
      theme: { id: "test-theme", name: "Test Theme" },
      artDataUri: "data:image/png;base64,AA==",
    });

    assert.doesNotMatch(script, /__(?:DREAM|GLASS_VISION)_[A-Z0-9_]+__/);
    assert.match(script, /__CODEX_(?:DREAM|GLASS_VISION)_SKIN_/);
  }
});

test("content signatures match the upstream 32-bit FNV-1a algorithm", () => {
  assert.equal(contentSignature(""), "0-811c9dc5");
  assert.equal(contentSignature("hello"), "5-4f9f2cab");
});
