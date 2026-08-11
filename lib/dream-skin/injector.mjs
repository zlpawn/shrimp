// Builds the JS payload injected into the Codex renderer process.
// Delegates to engine renderer-inject.js (from CodexPlusPlus upstream assets)
// with placeholder substitution. Also provides image handling and cleanup.

import fs from "node:fs";
import path from "node:path";
import { buildEngineScript, resolveEngine, contentSignature } from "./engines/index.mjs";

const ROOT_CLASS = "codex-dream-skin";

// Reads an image file and returns a data URI string.
export function imageToDataUri(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const mimeMap = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
  };
  const mime = mimeMap[ext];
  if (!mime) return "";
  const bytes = fs.readFileSync(filePath);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

// Loads a theme JSON file and resolves the background image to a data URI.
export function loadTheme(themePath) {
  const raw = fs.readFileSync(themePath, "utf8");
  const theme = JSON.parse(raw);
  const image = typeof theme.image === "string"
    ? theme.image
    : typeof theme.backgroundImage === "string"
      ? theme.backgroundImage
      : "";
  if (!theme.image && image) theme.image = image;
  let backgroundDataUri = "";
  if (image) {
    // theme.image is a relative filename (e.g. "portal-hero.png") resolved
    // relative to the theme directory, or an absolute path. backgroundImage
    // remains supported for themes created by the initial Shrimp prototype.
    const imgPath = path.isAbsolute(image)
      ? image
      : path.resolve(path.dirname(themePath), image);
    backgroundDataUri = imageToDataUri(imgPath);
  }
  return { theme, backgroundDataUri };
}

// Build the injection script for a theme using the appropriate engine.
// Mirrors CodexPlusPlus dream_skin_target_runtime_script (assets.rs:108).
export function buildInjectionScript({ theme, backgroundDataUri = "" }) {
  const stylePreset = theme.stylePreset || theme.style_preset || "";
  const engineName = resolveEngine(stylePreset);

  // The engine script handles everything: CSS injection, chrome layer,
  // MutationObserver, image analysis, safe area detection, etc.
  // We just need to replace the placeholders with actual values.
  const script = buildEngineScript(engineName, { theme, artDataUri: backgroundDataUri });

  // Wrap in a bootstrap IIFE that sets global vars some engines expect,
  // then evaluates the engine script. This matches CodexPlusPlus
  // dream_skin_target_runtime_script wrapper (assets.rs:155).
  return `
(() => {
  window.__CODEX_PLUS_EXTERNAL_DREAM_SKIN_RUNTIME__ = true;
  window.__CODEX_PLUS_CLEAR_DREAM_SKIN__?.();
  ${script}
  const state = window.__CODEX_DREAM_SKIN_STATE__ || window.__CODEX_GLASS_VISION_SKIN_STATE__;
  if (state) {
    state.version = "codex-plus:macos:${engineName}:r${contentSignature(script)}";
  }
  return true;
})()
`;
}

// Cleanup script: removes all injected skin elements.
// Mirrors CodexPlusPlus cleanup_script (dream_skin_runtime.rs).
export function buildCleanupScript() {
  return `
(() => {
  // Try the engine's own cleanup if registered.
  if (typeof window.__CODEX_PLUS_CLEAR_DREAM_SKIN__ === "function") {
    window.__CODEX_PLUS_CLEAR_DREAM_SKIN__();
  }
  window.__CODEX_DREAM_SKIN_DISABLED__ = true;
  window.__CODEX_GLASS_VISION_SKIN_DISABLED__ = true;

  // Call engine cleanup if available.
  const state = window.__CODEX_DREAM_SKIN_STATE__ || window.__CODEX_GLASS_VISION_SKIN_STATE__;
  if (state?.cleanup) {
    state.cleanup();
  }

  // Remove root class and codex-theme classes.
  const root = document.documentElement;
  for (const className of [...(root?.classList || [])]) {
    if (className === ${JSON.stringify(ROOT_CLASS)} ||
        className === "codex-glass-vision-skin" ||
        className.startsWith("codex-theme-")) {
      root.classList.remove(className);
    }
  }

  // Remove skin-specific classes from all elements.
  document.querySelectorAll("[class]").forEach((node) => {
    for (const className of [...node.classList]) {
      if (/^theme-[a-z0-9-]+-(?:home|home-shell|task|task-shell)$/.test(className) ||
          /^glass-vision-(?:home|home-shell|task|task-shell)$/.test(className)) {
        node.classList.remove(className);
      }
    }
  });

  // Remove injected style/chrome elements.
  const ids = [
    "codex-dream-skin-style",
    "codex-glass-vision-skin-style",
    "codex-plus-dream-skin-style",
    "codex-dream-skin-chrome",
    "codex-glass-vision-skin-chrome",
    "codex-theme-chrome",
  ];
  for (const id of ids) {
    document.getElementById(id)?.remove();
  }

  // Remove data-ds-part attributes.
  document.querySelectorAll("[data-ds-part]").forEach((node) => {
    node.removeAttribute("data-ds-part");
  });

  // Reset global state.
  window.__CODEX_DREAM_SKIN_INSTALLED__ = false;
  return true;
})()
`;
}
