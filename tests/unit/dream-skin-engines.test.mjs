import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
import test from "node:test";

import {
  ENGINE_DEFINITIONS,
  resolveEngine,
  loadEngineAssets,
  contentSignature,
  buildEngineScript,
  validateEngineAssets,
  assertScriptParses,
} from "../../lib/dream-skin/runtime/engine-assets.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

test("engine definitions contain full metadata", () => {
  const names = Object.keys(ENGINE_DEFINITIONS);
  assert.deepEqual(names.sort(), ["cidala-tiger", "dream-skin", "glass-vision", "snow"]);
  for (const [name, def] of Object.entries(ENGINE_DEFINITIONS)) {
    assert.equal(def.name, name);
    assert.ok(def.rendererFile);
    assert.ok(def.cssFile);
    assert.ok(def.version);
    assert.ok(def.placeholders);
    assert.ok(Array.isArray(def.supportedPresets));
  }
});

test("preset mapping matches CodexPlusPlus exactly", () => {
  const cases = [
    ["codex-snow", "snow"],
    ["glass-vision", "glass-vision"],
    ["midnight-aurora", "cidala-tiger"],
    ["amber-dusk", "cidala-tiger"],
    ["forest-mist", "cidala-tiger"],
    ["cyber-neon", "cidala-tiger"],
    ["sakura-dawn", "cidala-tiger"],
    ["", "dream-skin"],
  ];
  for (const [preset, engine] of cases) {
    assert.equal(resolveEngine(preset), engine, `preset ${preset}`);
  }
});

test("unknown presets throw invalid_theme, not silent fallback", () => {
  assert.throws(
    () => resolveEngine("totally-unknown"),
    (err) => err instanceof DreamSkinError && err.code === "invalid_theme",
  );
});

test("loadEngineAssets loads renderer and css for every engine", () => {
  for (const name of Object.keys(ENGINE_DEFINITIONS)) {
    const assets = loadEngineAssets(name);
    assert.equal(assets.name, name);
    assert.ok(assets.renderer.length > 0);
    assert.ok(assets.css.length > 0);
  }
});

test("all engines have LICENSE files and notices reference CodexPlusPlus MIT", () => {
  const notice = fs.readFileSync("lib/dream-skin/THIRD_PARTY_NOTICES.md", "utf8");
  assert.match(notice, /CodexPlusPlus/);
  assert.match(notice, /BigPizzaV3/);
  assert.match(notice, /MIT/);
  for (const name of Object.keys(ENGINE_DEFINITIONS)) {
    const license = fs.readFileSync(`lib/dream-skin/engines/${name}/LICENSE`, "utf8");
    assert.match(license, /MIT License/);
  }
});

test("asset SHA-256 digests are pinned", () => {
  const expected = {
    "dream-skin/renderer-inject.js": "2704c39506c66554c3529bf0d15b876b4aec2dd9a36b1796ab43e19c33a046fc",
    "dream-skin/dream-skin.css": "ec3c3bc5f6e10e20a3f2307796bd1e1350e80e5d23d37318ee5468833c95a6df",
    "dream-skin/LICENSE": "18f8478d0f9efd45307e5f17790194593b116658145c758ced3166398eb05b21",
    "cidala-tiger/renderer-inject.js": "21faf1dc0a3ebe78d8d972182cace62bd93d5d0e5841725398a4a524ef2bc20b",
    "cidala-tiger/dream-skin.css": "5e149e9a13985961c5f3125296178acb2abf0b528974f1e616aa625970430562",
    "cidala-tiger/LICENSE": "7b0f1855e7e716bdb2069b9c8b834f8d07430e748a4abec9534b6bec48e61a98",
    "glass-vision/renderer-inject.js": "d14943e95db62db81bf29d9cf14fcaf1dd1ea9a9625245c020865127eea295a2",
    "glass-vision/glass-vision.css": "4c37c53544ee4f1cd93ba5d0dc3e174b05d4cb84ec9a436295d11d19f0bb04f1",
    "glass-vision/LICENSE": "26595abd1084ebbd7173a93998b5293bcf3647a22ccc1ac424c54be5d260ff57",
    "snow/renderer-inject.js": "0fcdff4aecd03eab2ca4ee923ccd20cb97eb5460f7c9f07351a2003ffa76e6fa",
    "snow/dream-skin.css": "0af2d20fbe3e3dd13f0be7f1e5a90366e1501084827b22c1d4815a421bfce823",
    "snow/LICENSE": "714d6a902a51867b0706f62ed2467d4332f787891c04a6bdfe660b1221643b86",
  };
  for (const [rel, digest] of Object.entries(expected)) {
    const bytes = fs.readFileSync(`lib/dream-skin/engines/${rel}`);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), digest, rel);
  }
});

test("buildEngineScript replaces all placeholders and parses", () => {
  const theme = { id: "test-theme", name: "Test Theme", stylePreset: "" };
  for (const name of Object.keys(ENGINE_DEFINITIONS)) {
    const script = buildEngineScript(name, {
      theme,
      artDataUri: "data:image/png;base64,AA==",
    });
    assert.doesNotMatch(script, /__(?:DREAM|GLASS_VISION)_[A-Z0-9_]+__/);
    assert.ok(script.length > 0);
    assert.doesNotThrow(() => new vm.Script(script));
  }
});

test("runtime globals survive placeholder substitution", () => {
  const script = buildEngineScript("dream-skin", {
    theme: { id: "x", name: "X" },
    artDataUri: "",
  });
  assert.match(script, /__CODEX_DREAM_SKIN_STATE__/);
});

test("build is deterministic across calls", () => {
  const theme = { id: "x", name: "X" };
  const a = buildEngineScript("dream-skin", { theme, artDataUri: "data:image/png;base64,AA==" });
  const b = buildEngineScript("dream-skin", { theme, artDataUri: "data:image/png;base64,AA==" });
  assert.equal(a, b);
});

test("content signatures match known upstream vectors", () => {
  assert.equal(contentSignature(""), "0-811c9dc5");
  assert.equal(contentSignature("hello"), "5-4f9f2cab");
});

test("validateEngineAssets returns four summaries", () => {
  const results = validateEngineAssets();
  assert.equal(results.length, 4);
  for (const r of results) {
    assert.ok(r.engine);
    assert.ok(r.scriptSignature);
    assert.ok(r.cssSignature);
  }
});

test("assertScriptParses validates without evaluating", () => {
  assert.equal(assertScriptParses("const x = 1;"), true);
  assert.throws(() => assertScriptParses("const = ;"), SyntaxError);
});