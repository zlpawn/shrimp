/**
 * Engine asset metadata and offline script builder.
 * This module is pure: it reads asset files, replaces placeholders,
 * computes FNV-1a signatures. It never spawns processes, opens
 * sockets, or talks to Codex.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { DreamSkinError } from "../domain/errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ENGINE_DEFINITIONS = {
  "dream-skin": {
    name: "dream-skin",
    rendererFile: "renderer-inject.js",
    cssFile: "dream-skin.css",
    version: "1.2.0",
    placeholders: {
      css: "__DREAM_SKIN_CSS_JSON__",
      art: "__DREAM_SKIN_ART_JSON__",
      theme: "__DREAM_SKIN_THEME_JSON__",
      version: "__DREAM_SKIN_VERSION_JSON__",
      styleRevision: "__DREAM_SKIN_STYLE_REVISION_JSON__",
      payloadRevision: "__DREAM_SKIN_PAYLOAD_REVISION_JSON__",
    },
    supportedPresets: [""],
  },
  snow: {
    name: "snow",
    rendererFile: "renderer-inject.js",
    cssFile: "dream-skin.css",
    version: "2.1.0-snow.1",
    placeholders: {
      css: "__DREAM_CSS_JSON__",
      art: "__DREAM_ART_JSON__",
      theme: null,
      version: "__DREAM_VERSION_JSON__",
      styleRevision: null,
      payloadRevision: null,
    },
    supportedPresets: ["codex-snow"],
  },
  "glass-vision": {
    name: "glass-vision",
    rendererFile: "renderer-inject.js",
    cssFile: "glass-vision.css",
    version: "1.0.0",
    placeholders: {
      css: "__GLASS_VISION_CSS_JSON__",
      art: "__GLASS_VISION_ART_JSON__",
      theme: null,
      version: null,
      styleRevision: null,
      payloadRevision: null,
    },
    supportedPresets: ["glass-vision"],
  },
  "cidala-tiger": {
    name: "cidala-tiger",
    rendererFile: "renderer-inject.js",
    cssFile: "dream-skin.css",
    version: "1.2.0",
    placeholders: {
      css: "__DREAM_SKIN_CSS_JSON__",
      art: "__DREAM_SKIN_ART_JSON__",
      theme: "__DREAM_SKIN_THEME_JSON__",
      version: "__DREAM_SKIN_VERSION_JSON__",
      styleRevision: "__DREAM_SKIN_STYLE_REVISION_JSON__",
      payloadRevision: "__DREAM_SKIN_PAYLOAD_REVISION_JSON__",
    },
    supportedPresets: ["midnight-aurora", "amber-dusk", "forest-mist", "cyber-neon", "sakura-dawn"],
  },
};

const PRESET_TO_ENGINE = new Map();
for (const [engineName, def] of Object.entries(ENGINE_DEFINITIONS)) {
  for (const preset of def.supportedPresets) {
    PRESET_TO_ENGINE.set(preset, engineName);
  }
}

export function resolveEngine(stylePreset = "") {
  const preset = String(stylePreset ?? "").trim();
  if (PRESET_TO_ENGINE.has(preset)) return PRESET_TO_ENGINE.get(preset);
  // Unknown presets must NOT silently fall back per plan; base dream-skin is
  // only for empty preset.
  if (preset === "") return "dream-skin";
  throw new DreamSkinError(
    "invalid_theme",
    `unsupported style preset: ${preset}`,
    { details: [{ field: "stylePreset", code: "unsupported_preset" }] },
  );
}

export function getEngineDir(engineName) {
  return path.join(__dirname, "..", "engines", engineName);
}

export function loadEngineAssets(engineName) {
  const def = ENGINE_DEFINITIONS[engineName];
  if (!def) {
    throw new DreamSkinError("invalid_request", `unknown dream-skin engine: ${engineName}`);
  }
  const engineDir = getEngineDir(engineName);
  const cssPath = path.join(engineDir, def.cssFile);
  const rendererPath = path.join(engineDir, def.rendererFile);
  if (!fs.existsSync(cssPath)) {
    throw new DreamSkinError("storage_error", `engine "${engineName}" CSS file not found: ${cssPath}`);
  }
  if (!fs.existsSync(rendererPath)) {
    throw new DreamSkinError("storage_error", `engine "${engineName}" renderer not found: ${rendererPath}`);
  }
  return {
    name: engineName,
    css: fs.readFileSync(cssPath, "utf8"),
    renderer: fs.readFileSync(rendererPath, "utf8"),
    placeholders: def.placeholders,
    version: def.version,
    supportedPresets: def.supportedPresets,
  };
}

// FNV-1a 32-bit, matching CodexPlusPlus dream_skin_content_signature (assets.rs:460).
export function contentSignature(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  let hash = 2_166_136_261;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 16_777_619);
  }
  hash = hash >>> 0;
  return `${bytes.length}-${hash.toString(16)}`;
}

export function buildEngineScript(engineName, { theme, artDataUri = "" }) {
  const assets = loadEngineAssets(engineName);
  const ph = assets.placeholders;

  const css = assets.css;
  const styleRevision = contentSignature(css);
  const payloadRevision = contentSignature(
    `${engineName}:${styleRevision}:${contentSignature(artDataUri)}:${JSON.stringify(theme)}`,
  );

  let script = assets.renderer;

  if (ph.css) script = script.replaceAll(ph.css, JSON.stringify(css));
  if (ph.art) script = script.replaceAll(ph.art, JSON.stringify(artDataUri));
  if (ph.theme) script = script.replaceAll(ph.theme, JSON.stringify(theme));
  if (ph.version) script = script.replaceAll(ph.version, JSON.stringify(assets.version));
  if (ph.styleRevision) script = script.replaceAll(ph.styleRevision, JSON.stringify(styleRevision));
  if (ph.payloadRevision) script = script.replaceAll(ph.payloadRevision, JSON.stringify(payloadRevision));

  // Declared placeholders must all be gone; runtime globals like
  // __CODEX_DREAM_SKIN_STATE__ are not placeholders and must remain.
  const remaining = script.match(/__(?:DREAM|GLASS_VISION)_[A-Z0-9_]+__/g);
  if (remaining) {
    throw new DreamSkinError(
      "invalid_theme",
      `engine "${engineName}" has unresolved placeholders: ${[...new Set(remaining)].join(", ")}`,
    );
  }

  return script;
}

export function validateEngineAssets() {
  const results = [];
  for (const engineName of Object.keys(ENGINE_DEFINITIONS)) {
    const assets = loadEngineAssets(engineName);
    const scriptSignature = contentSignature(assets.renderer);
    const cssSignature = contentSignature(assets.css);
    results.push({ engine: engineName, scriptSignature, cssSignature });
  }
  return results;
}

export function assertScriptParses(script) {
  // Parse only — never evaluate.
  new vm.Script(script, { filename: "dream-skin-injection.js" });
  return true;
}