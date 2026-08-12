/**
 * Runtime injector: builds injection/cleanup scripts as pure values.
 * No filesystem path loading, no CDP calls. Everything byte-based.
 */

import vm from "node:vm";

import { DreamSkinError } from "../domain/errors.mjs";
import { assertValidTheme } from "../domain/theme-schema.mjs";
import { inspectImage, imageDataUri } from "../domain/image-format.mjs";
import { resolveEngine, buildEngineScript, contentSignature, assertScriptParses } from "./engine-assets.mjs";

const MAX_THEME_JSON_BYTES = 256 * 1024;

export function loadRuntimeTheme({ themeJsonBytes, imageBytes }) {
  if (!themeJsonBytes || !Buffer.isBuffer(themeJsonBytes)) {
    throw new DreamSkinError("invalid_theme", "theme JSON bytes required");
  }
  if (themeJsonBytes.length === 0) {
    throw new DreamSkinError("invalid_theme", "theme JSON is empty");
  }
  if (themeJsonBytes.length > MAX_THEME_JSON_BYTES) {
    throw new DreamSkinError("invalid_theme", `theme JSON exceeds ${MAX_THEME_JSON_BYTES} bytes`);
  }

  let parsed;
  try {
    parsed = JSON.parse(themeJsonBytes.toString("utf8"));
  } catch {
    throw new DreamSkinError("invalid_theme", "theme JSON is not valid");
  }

  const theme = assertValidTheme(parsed);

  let imageFormat = null;
  let backgroundDataUri = "";
  if (imageBytes && Buffer.isBuffer(imageBytes) && imageBytes.length > 0) {
    imageFormat = inspectImage(imageBytes);
    if (theme.image) {
      // Validate the theme's declared image extension matches real bytes
      const declaredExt = theme.image.toLowerCase().split(".").pop();
      const actualExt = imageFormat.extension;
      const ok = declaredExt === actualExt || (declaredExt === "jpeg" && actualExt === "jpg");
      if (!ok) {
        throw new DreamSkinError("invalid_image", `theme image extension "${declaredExt}" does not match actual format "${actualExt}"`);
      }
    }
    backgroundDataUri = imageDataUri(imageBytes, imageFormat);
  }

  return { theme, imageFormat, backgroundDataUri };
}

export function buildInjectionScript({ theme, backgroundDataUri = "" }) {
  const engineName = resolveEngine(theme.stylePreset);
  const engineScript = buildEngineScript(engineName, { theme, artDataUri: backgroundDataUri });
  const sig = contentSignature(engineScript);

  const script = `
(() => {
  window.__CODEX_PLUS_EXTERNAL_DREAM_SKIN_RUNTIME__ = true;
  window.__CODEX_PLUS_CLEAR_DREAM_SKIN__?.();
  ${engineScript}
  const state = window.__CODEX_DREAM_SKIN_STATE__ || window.__CODEX_GLASS_VISION_SKIN_STATE__;
  if (state) {
    state.version = "codex-plus:macos:${engineName}:r${sig}";
  }
  return true;
})()
`;
  assertScriptParses(script);
  return script;
}

export function buildCleanupScript() {
  const script = `
(() => {
  if (typeof window.__CODEX_PLUS_CLEAR_DREAM_SKIN__ === "function") {
    window.__CODEX_PLUS_CLEAR_DREAM_SKIN__();
  }
  window.__CODEX_DREAM_SKIN_DISABLED__ = true;
  window.__CODEX_GLASS_VISION_SKIN_DISABLED__ = true;
  const state = window.__CODEX_DREAM_SKIN_STATE__ || window.__CODEX_GLASS_VISION_SKIN_STATE__;
  if (state?.cleanup) {
    state.cleanup();
  }
  const root = document.documentElement;
  for (const className of [...(root?.classList || [])]) {
    if (className === "codex-dream-skin" ||
        className === "codex-glass-vision-skin" ||
        className.startsWith("codex-theme-")) {
      root.classList.remove(className);
    }
  }
  document.querySelectorAll("[class]").forEach((node) => {
    for (const className of [...node.classList]) {
      if (/^theme-[a-z0-9-]+-(?:home|home-shell|task|task-shell)$/.test(className) ||
          /^glass-vision-(?:home|home-shell|task|task-shell)$/.test(className)) {
        node.classList.remove(className);
      }
    }
  });
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
  document.querySelectorAll("[data-ds-part]").forEach((node) => {
    node.removeAttribute("data-ds-part");
  });
  window.__CODEX_DREAM_SKIN_INSTALLED__ = false;
  return true;
})()
`;
  assertScriptParses(script);
  return script;
}

export function buildRuntimeEvaluateParams(expression, { awaitPromise = false } = {}) {
  return {
    expression,
    awaitPromise,
    allowUnsafeEvalBlockedByCSP: true,
    returnByValue: true,
  };
}

export function buildAddScriptParams(source) {
  return { source };
}