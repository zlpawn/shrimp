// Engine registry: maps engine names to their asset files and placeholder specs.
// Each engine has a renderer-inject.js (with __PLACEHOLDER__ tokens) and a CSS file.
// The placeholder names differ per engine (dream-skin uses __DREAM_SKIN_*, snow uses
// __DREAM_*, glass-vision uses __GLASS_VISION_*), so we declare them explicitly.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENGINE_DEFS = {
  "dream-skin": {
    cssFile: "dream-skin.css",
    rendererFile: "renderer-inject.js",
    placeholders: {
      css: "__DREAM_SKIN_CSS_JSON__",
      art: "__DREAM_SKIN_ART_JSON__",
      theme: "__DREAM_SKIN_THEME_JSON__",
      version: "__DREAM_SKIN_VERSION_JSON__",
      styleRevision: "__DREAM_SKIN_STYLE_REVISION_JSON__",
      payloadRevision: "__DREAM_SKIN_PAYLOAD_REVISION_JSON__",
    },
    version: "1.2.0",
  },
  snow: {
    cssFile: "dream-skin.css",
    rendererFile: "renderer-inject.js",
    placeholders: {
      css: "__DREAM_CSS_JSON__",
      art: "__DREAM_ART_JSON__",
      theme: null, // snow engine reads theme from a global var, not a placeholder
      version: "__DREAM_VERSION_JSON__",
      styleRevision: null,
      payloadRevision: null,
    },
    version: "2.1.0-snow.1",
  },
  "glass-vision": {
    cssFile: "glass-vision.css",
    rendererFile: "renderer-inject.js",
    placeholders: {
      css: "__GLASS_VISION_CSS_JSON__",
      art: "__GLASS_VISION_ART_JSON__",
      theme: null,
      version: null,
      styleRevision: null,
      payloadRevision: null,
    },
    version: "1.0.0",
  },
  "cidala-tiger": {
    cssFile: "dream-skin.css",
    rendererFile: "renderer-inject.js",
    placeholders: {
      css: "__DREAM_SKIN_CSS_JSON__",
      art: "__DREAM_SKIN_ART_JSON__",
      theme: "__DREAM_SKIN_THEME_JSON__",
      version: "__DREAM_SKIN_VERSION_JSON__",
      styleRevision: "__DREAM_SKIN_STYLE_REVISION_JSON__",
      payloadRevision: "__DREAM_SKIN_PAYLOAD_REVISION_JSON__",
    },
    version: "1.2.0",
  },
};

// Resolve the style preset -> engine name, matching CodexPlusPlus dream_skin_target_assets.
// See assets.rs:92.
export function resolveEngine(stylePreset = "") {
  const preset = String(stylePreset || "").trim();
  if (preset === "codex-snow") return "snow";
  if (preset === "glass-vision") return "glass-vision";
  if (["midnight-aurora", "amber-dusk", "forest-mist", "cyber-neon", "sakura-dawn"].includes(preset)) {
    return "cidala-tiger";
  }
  return "dream-skin";
}

export function getEngineDir(engineName) {
  return path.join(__dirname, engineName);
}

export function loadEngineAssets(engineName) {
  const def = ENGINE_DEFS[engineName];
  if (!def) {
    throw new Error(`unknown dream-skin engine: ${engineName}`);
  }
  const engineDir = getEngineDir(engineName);
  const cssPath = path.join(engineDir, def.cssFile);
  const rendererPath = path.join(engineDir, def.rendererFile);
  if (!fs.existsSync(cssPath)) {
    throw new Error(`engine "${engineName}" CSS file not found: ${cssPath}`);
  }
  if (!fs.existsSync(rendererPath)) {
    throw new Error(`engine "${engineName}" renderer not found: ${rendererPath}`);
  }
  return {
    name: engineName,
    css: fs.readFileSync(cssPath, "utf8"),
    renderer: fs.readFileSync(rendererPath, "utf8"),
    placeholders: def.placeholders,
    version: def.version,
  };
}

// FNV-1a style hash, matching CodexPlusPlus dream_skin_content_signature (assets.rs:460).
function contentSignature(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  let hash = 2_166_136_261;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 16_777_619);
  }
  hash = hash >>> 0;
  return `${bytes.length}-${hash.toString(16)}`;
}

// Build the final injection script by replacing placeholders in the engine's
// renderer-inject.js with actual values. Mirrors CodexPlusPlus
// dream_skin_target_runtime_script (assets.rs:108).
export function buildEngineScript(engineName, { theme, artDataUri = "" }) {
  const assets = loadEngineAssets(engineName);
  const ph = assets.placeholders;

  // Combine base CSS with any managed community CSS (not yet implemented).
  const css = assets.css;

  // Compute style revision hash for hot-update comparison.
  const styleRevision = contentSignature(css);
  const payloadRevision = contentSignature(
    `${engineName}:${styleRevision}:${contentSignature(artDataUri)}:${JSON.stringify(theme)}`,
  );

  let script = assets.renderer;

  // Replace CSS placeholder with the CSS string as JSON.
  if (ph.css) {
    script = script.replaceAll(ph.css, JSON.stringify(css));
  }

  // Replace art placeholder. Some engines read art from a global var set by the
  // bootstrap; we inline it directly as a JSON string.
  if (ph.art) {
    script = script.replaceAll(ph.art, JSON.stringify(artDataUri));
  }

  // Replace theme placeholder.
  if (ph.theme) {
    script = script.replaceAll(ph.theme, JSON.stringify(theme));
  }

  // Replace version placeholder.
  if (ph.version) {
    script = script.replaceAll(ph.version, JSON.stringify(assets.version));
  }

  // Replace revision placeholders (for hot-update, not yet used but required
  // by the engine script to avoid syntax errors).
  if (ph.styleRevision) {
    script = script.replaceAll(ph.styleRevision, JSON.stringify(styleRevision));
  }
  if (ph.payloadRevision) {
    script = script.replaceAll(ph.payloadRevision, JSON.stringify(payloadRevision));
  }

  // Only these prefixes are renderer template placeholders. Engine state keys
  // such as __CODEX_DREAM_SKIN_STATE__ must remain as runtime string values.
  const remaining = script.match(/__(?:DREAM|GLASS_VISION)_[A-Z0-9_]+__/g);
  if (remaining) {
    throw new Error(
      `engine "${engineName}" has unresolved placeholders: ${[...new Set(remaining)].join(", ")}`,
    );
  }

  return script;
}

export { contentSignature };
