// Builds the JS payload injected into the Codex renderer process.
// The payload sets up CSS variables, injects a <style> tag, creates a
// decorative background layer, and uses a MutationObserver to tag DOM
// elements with data-ds-part attributes so CSS can target them.

import fs from "node:fs";
import path from "node:path";

const STYLE_TAG_ID = "shrimp-dream-skin-style";
const CHROME_LAYER_ID = "shrimp-dream-skin-chrome";
const ROOT_CLASS = "shrimp-dream-skin";

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
  let backgroundDataUri = "";
  if (theme.backgroundImage && typeof theme.backgroundImage === "string") {
    const imgPath = path.isAbsolute(theme.backgroundImage)
      ? theme.backgroundImage
      : path.resolve(path.dirname(themePath), theme.backgroundImage);
    backgroundDataUri = imageToDataUri(imgPath);
  }
  return { theme, backgroundDataUri };
}

// Builds the full injection script. This string is evaluated in the
// Codex renderer process via CDP Runtime.evaluate / addScriptToEvaluateOnNewDocument.
export function buildInjectionScript({ theme, backgroundDataUri = "" }) {
  const themeJson = JSON.stringify(theme);
  const artJson = JSON.stringify(backgroundDataUri);

  // The script runs as an IIFE to avoid polluting the global scope.
  // It is intentionally simple: set CSS variables, inject style, create
  // background layer, and observe DOM mutations to tag elements.
  return `
(() => {
  const theme = ${themeJson};
  const artDataUri = ${artJson};
  const STYLE_TAG_ID = ${JSON.stringify(STYLE_TAG_ID)};
  const CHROME_LAYER_ID = ${JSON.stringify(CHROME_LAYER_ID)};
  const ROOT_CLASS = ${JSON.stringify(ROOT_CLASS)};

  // Guard against double-injection.
  if (window.__SHRIMP_DREAM_SKIN_INSTALLED__) {
    // Re-apply theme in case it changed.
    window.__SHRIMP_DREAM_SKIN_APPLY__(theme, artDataUri);
    return true;
  }
  window.__SHRIMP_DREAM_SKIN_INSTALLED__ = true;

  function applyTheme(theme, artDataUri) {
    const root = document.documentElement;
    root.classList.add(ROOT_CLASS);

    // Set CSS custom properties from theme colors.
    const colors = theme.colors || {};
    const vars = {
      "--ds-bg": colors.background || "#1a1b2e",
      "--ds-panel": colors.panel || "#252640",
      "--ds-panel-alt": colors.panelAlt || "#2d2e4a",
      "--ds-accent": colors.accent || "#7c6ef0",
      "--ds-accent-alt": colors.accentAlt || "#9d8ff5",
      "--ds-secondary": colors.secondary || "#5a4d9e",
      "--ds-highlight": colors.highlight || "#a78bfa",
      "--ds-text": colors.text || "#e8e6f0",
      "--ds-muted": colors.muted || "#9b98ad",
      "--ds-line": colors.line || "rgba(124,110,240,0.18)",
      "--ds-bg-opacity": String(theme.backgroundOpacity ?? 0.85),
    };
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }

    // Inject or update the <style> tag.
    let style = document.getElementById(STYLE_TAG_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_TAG_ID;
      document.head.appendChild(style);
    }
    style.textContent = SKIN_CSS;

    // Create or update the background chrome layer.
    let chrome = document.getElementById(CHROME_LAYER_ID);
    if (!chrome) {
      chrome = document.createElement("div");
      chrome.id = CHROME_LAYER_ID;
      chrome.style.cssText = [
        "position: fixed",
        "inset: 0",
        "z-index: 0",
        "pointer-events: none",
        "background-size: cover",
        "background-position: center",
        "background-repeat: no-repeat",
      ].join("; ");
      document.body.insertBefore(chrome, document.body.firstChild);
    }
    if (artDataUri) {
      chrome.style.backgroundImage = "url(" + artDataUri + ")";
      chrome.style.opacity = vars["--ds-bg-opacity"];
    } else {
      chrome.style.backgroundImage = "none";
      chrome.style.opacity = "0";
    }

    // Tag DOM elements with data-ds-part for CSS targeting.
    tagElements();
  }

  // Map of CSS selectors -> data-ds-part attribute values.
  // These selectors match the Codex desktop app's DOM structure.
  const PART_MAP = {
    root: "html",
    sidebar: "aside.app-shell-left-panel",
    main: "main.main-surface, [role='main']",
    header: "header.app-header-tint",
    composer: ".composer-surface-chrome",
    "composer-toolbar": ".composer-surface-chrome [role='toolbar']",
  };

  function tagElements() {
    for (const [part, selector] of Object.entries(PART_MAP)) {
      for (const node of document.querySelectorAll(selector)) {
        node.setAttribute("data-ds-part", part);
      }
    }
  }

  // Observe DOM mutations to re-tag elements when the app navigates.
  let observer;
  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => tagElements());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // The skin CSS. Uses CSS variables set above so themes can change
  // colors without rewriting the stylesheet.
  const SKIN_CSS = \`
    .\${ROOT_CLASS} {
      background-color: var(--ds-bg) !important;
    }
    .\${ROOT_CLASS} body {
      background-color: var(--ds-bg) !important;
      color: var(--ds-text) !important;
    }
    .\${ROOT_CLASS} [data-ds-part="sidebar"] {
      background-color: var(--ds-panel) !important;
      border-color: var(--ds-line) !important;
    }
    .\${ROOT_CLASS} [data-ds-part="main"] {
      background-color: var(--ds-panel) !important;
      color: var(--ds-text) !important;
    }
    .\${ROOT_CLASS} [data-ds-part="header"] {
      background-color: var(--ds-panel-alt) !important;
      border-color: var(--ds-line) !important;
    }
    .\${ROOT_CLASS} [data-ds-part="composer"] {
      background-color: var(--ds-panel) !important;
      border-color: var(--ds-accent) !important;
    }
    .\${ROOT_CLASS} [data-ds-part="composer-toolbar"] button {
      color: var(--ds-muted) !important;
    }
    .\${ROOT_CLASS} [data-ds-part="composer-toolbar"] button:hover {
      color: var(--ds-accent) !important;
    }
    .\${ROOT_CLASS} button:hover {
      color: var(--ds-accent) !important;
    }
    .\${ROOT_CLASS} a {
      color: var(--ds-accent) !important;
    }
    .\${ROOT_CLASS} input,
    .\${ROOT_CLASS} textarea {
      background-color: var(--ds-panel-alt) !important;
      color: var(--ds-text) !important;
      border-color: var(--ds-line) !important;
    }
    .\${ROOT_CLASS} ::-webkit-scrollbar {
      width: 8px;
    }
    .\${ROOT_CLASS} ::-webkit-scrollbar-track {
      background: var(--ds-panel) !important;
    }
    .\${ROOT_CLASS} ::-webkit-scrollbar-thumb {
      background: var(--ds-secondary) !important;
      border-radius: 4px;
    }
    .\${ROOT_CLASS} ::-webkit-scrollbar-thumb:hover {
      background: var(--ds-accent) !important;
    }
  \`;

  window.__SHRIMP_DREAM_SKIN_APPLY__ = applyTheme;

  // Initial application. If the DOM isn't ready yet, wait for it.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      applyTheme(theme, artDataUri);
      startObserver();
    });
  } else {
    applyTheme(theme, artDataUri);
    startObserver();
  }

  return true;
})()
`;
}

// Builds a cleanup script that removes all injected elements.
export function buildCleanupScript() {
  return `
(() => {
  if (typeof window.__SHRIMP_DREAM_SKIN_CLEANUP__ === "function") {
    window.__SHRIMP_DREAM_SKIN_CLEANUP__();
    return true;
  }
  const root = document.documentElement;
  root.classList.remove(${JSON.stringify(ROOT_CLASS)});
  for (const [name] of Object.entries(root.style)) {
    if (name.startsWith("--ds-")) root.style.removeProperty(name);
  }
  document.getElementById(${JSON.stringify(STYLE_TAG_ID)})?.remove();
  document.getElementById(${JSON.stringify(CHROME_LAYER_ID)})?.remove();
  document.querySelectorAll("[data-ds-part]").forEach((node) => {
    node.removeAttribute("data-ds-part");
  });
  window.__SHRIMP_DREAM_SKIN_INSTALLED__ = false;
  return true;
})()
`;
}
