/**
 * Theme schema validation, normalization, and field rules.
 */

import { DreamSkinError } from "./errors.mjs";
import { assertThemeId } from "./theme-id.mjs";

export const SUPPORTED_STYLE_PRESETS = new Set([
  "",
  "codex-snow",
  "glass-vision",
  "midnight-aurora",
  "amber-dusk",
  "forest-mist",
  "cyber-neon",
  "sakura-dawn",
]);

const DEFAULT_TEXT = {
  brandSubtitle: "CODEX DREAM SKIN",
  tagline: "Make something wonderful.",
  projectPrefix: "\u9009\u62E9\u9879\u76EE \u00B7 ",
  projectLabel: "\u9009\u62E9\u9879\u76EE",
  statusText: "THEME READY",
  quote: "FOCUS",
};

const DEFAULT_ART = {
  focusX: 0.5,
  focusY: 0.5,
  safeArea: "auto",
  taskMode: "ambient",
};

const COLOR_KEYS = [
  "background",
  "panel",
  "panelAlt",
  "accent",
  "accentAlt",
  "secondary",
  "highlight",
  "text",
  "muted",
  "line",
];

const FIELD_LIMITS = {
  name: { min: 1, max: 100 },
  brandSubtitle: { min: 0, max: 100 },
  tagline: { min: 0, max: 200 },
  projectPrefix: { min: 0, max: 200 },
  projectLabel: { min: 0, max: 200 },
  statusText: { min: 0, max: 100 },
  quote: { min: 0, max: 100 },
};

const APPEARANCES = new Set(["auto", "light", "dark"]);
const SAFE_AREAS = new Set(["auto", "left", "right", "center", "none"]);
const TASK_MODES = new Set(["ambient", "banner", "off"]);

const FORBIDDEN_TOP_KEYS = new Set([
  "css",
  "javascript",
  "js",
  "script",
  "html",
  "url",
  "path",
  "href",
  "src",
]);

function clampFinite01(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateColor(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    return { field, code: "invalid_color", message: "\u989C\u8272\u503C\u4E0D\u80FD\u4E3A\u7A7A\u3002" };
  }
  const trimmed = value.trim();
  if (/;/i.test(trimmed) || /[\n\r]/.test(trimmed)) {
    return { field, code: "invalid_color", message: "\u989C\u8272\u503C\u5305\u542B\u975E\u6CD5\u5B57\u7B26\u3002" };
  }
  if (/url\s*\(/i.test(trimmed) || /var\s*\(/i.test(trimmed) || /expression\s*\(/i.test(trimmed)) {
    return { field, code: "invalid_color", message: "\u989C\u8272\u503C\u5305\u542B\u7981\u6B62\u51FD\u6570\u3002" };
  }
  if (/\\[0-9a-fA-F]/.test(trimmed)) {
    return { field, code: "invalid_color", message: "\u989C\u8272\u503C\u5305\u542B\u8F6C\u4E49\u5B57\u7B26\u3002" };
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) return null;
  const rgbMatch = trimmed.match(/^rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgbMatch) {
    const r = parseFloat(rgbMatch[1]);
    const g = parseFloat(rgbMatch[2]);
    const b = parseFloat(rgbMatch[3]);
    const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    if ([r, g, b].every((v) => v >= 0 && v <= 255) && a >= 0 && a <= 1) return null;
    return { field, code: "invalid_color", message: "\u989C\u8272\u901A\u9053\u503C\u8D85\u51FA\u8303\u56F4\u3002" };
  }
  return { field, code: "invalid_color", message: `\u65E0\u6548\u7684\u989C\u8272\u503C: ${value}` };
}

function validateTextField(value, field, limit) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    return { field, code: "invalid_text", message: `\u5B57\u6BB5 ${field} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u3002` };
  }
  if (value.length > limit.max) {
    return { field, code: "text_too_long", message: `\u5B57\u6BB5 ${field} \u8D85\u8FC7 ${limit.max} \u4E2A\u5B57\u7B26\u3002` };
  }
  return null;
}

function validateImageName(value) {
  if (typeof value !== "string") {
    return { field: "image", code: "invalid_image", message: "\u56FE\u7247\u540D\u79F0\u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u3002" };
  }
  if (value.length === 0) return null;
  if (/[/\\]/.test(value)) {
    return { field: "image", code: "invalid_image", message: "\u56FE\u7247\u540D\u79F0\u4E0D\u80FD\u5305\u542B\u8DEF\u5F84\u5206\u9694\u7B26\u3002" };
  }
  if (/^[a-z]+:\/\//i.test(value)) {
    return { field: "image", code: "invalid_image", message: "\u56FE\u7247\u540D\u79F0\u4E0D\u80FD\u662F URL\u3002" };
  }
  if (/[?#]/.test(value)) {
    return { field: "image", code: "invalid_image", message: "\u56FE\u7247\u540D\u79F0\u4E0D\u80FD\u5305\u542B\u67E5\u8BE2\u53C2\u6570\u3002" };
  }
  if (value.includes("\0")) {
    return { field: "image", code: "invalid_image", message: "\u56FE\u7247\u540D\u79F0\u5305\u542B NUL\u3002" };
  }
  return null;
}

export function normalizeTheme(input, { allowBuiltin = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DreamSkinError("invalid_theme", "\u4E3B\u9898\u914D\u7F6E\u5FC5\u987B\u662F\u5BF9\u8C61\u3002");
  }
  const raw = input;

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_TOP_KEYS.has(key)) {
      throw new DreamSkinError("invalid_theme", `\u4E0D\u652F\u6301\u7684\u4E3B\u9898\u5B57\u6BB5: ${key}`, {
        details: [{ field: key, code: "forbidden_field" }],
      });
    }
  }

  const schemaVersion = raw.schemaVersion ?? raw.schema_version;
  if (schemaVersion !== 1) {
    throw new DreamSkinError("invalid_theme", "\u4E3B\u9898\u914D\u7F6E\u7248\u672C\u4E0D\u652F\u6301\uFF0C\u53EA\u63A5\u53D7\u7248\u672C 1\u3002", {
      details: [{ field: "schemaVersion", code: "unsupported_version" }],
    });
  }

  const id = assertThemeId(raw.id, { allowBuiltin });

  const name = raw.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new DreamSkinError("invalid_theme", "\u4E3B\u9898\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u3002", {
      details: [{ field: "name", code: "required" }],
    });
  }

  const stylePreset = raw.stylePreset ?? raw.style_preset ?? "";
  if (!SUPPORTED_STYLE_PRESETS.has(stylePreset)) {
    throw new DreamSkinError("invalid_theme", `\u4E0D\u652F\u6301\u7684\u5F15\u64CE\u9884\u8BBE: ${stylePreset}`, {
      details: [{ field: "stylePreset", code: "unsupported_preset" }],
    });
  }

  const image = raw.image ?? raw.backgroundImage ?? "";
  const appearance = raw.appearance ?? "auto";

  const rawArt = raw.art ?? {};
  const art = {
    focusX: rawArt.focusX ?? DEFAULT_ART.focusX,
    focusY: rawArt.focusY ?? DEFAULT_ART.focusY,
    safeArea: rawArt.safeArea ?? DEFAULT_ART.safeArea,
    taskMode: rawArt.taskMode ?? DEFAULT_ART.taskMode,
  };

  const rawColors = raw.colors ?? {};
  const colors = {};
  for (const key of COLOR_KEYS) {
    colors[key] = rawColors[key] ?? "";
  }

  const text = {};
  for (const key of Object.keys(DEFAULT_TEXT)) {
    text[key] = raw[key] ?? DEFAULT_TEXT[key];
  }

  return {
    schemaVersion: 1,
    id,
    name,
    stylePreset,
    image,
    appearance,
    art,
    colors,
    brandSubtitle: text.brandSubtitle,
    tagline: text.tagline,
    projectPrefix: text.projectPrefix,
    projectLabel: text.projectLabel,
    statusText: text.statusText,
    quote: text.quote,
  };
}

export function validateTheme(input, options = {}) {
  const issues = [];

  let theme;
  try {
    theme = normalizeTheme(input, options);
  } catch (error) {
    if (error instanceof DreamSkinError) {
      return { ok: false, value: undefined, issues: error.details.length ? error.details : [{ field: "", code: error.code, message: error.message }] };
    }
    throw error;
  }

  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    const err = validateTextField(theme[field], field, limit);
    if (err) issues.push(err);
  }

  const imgErr = validateImageName(theme.image);
  if (imgErr) issues.push(imgErr);

  if (!APPEARANCES.has(theme.appearance)) {
    issues.push({ field: "appearance", code: "invalid_enum", message: `\u65E0\u6548\u7684\u5916\u89C2\u6A21\u5F0F: ${theme.appearance}` });
  }
  if (!SAFE_AREAS.has(theme.art.safeArea)) {
    issues.push({ field: "art.safeArea", code: "invalid_enum", message: `\u65E0\u6548\u7684\u5B89\u5168\u533A\u57DF: ${theme.art.safeArea}` });
  }
  if (!TASK_MODES.has(theme.art.taskMode)) {
    issues.push({ field: "art.taskMode", code: "invalid_enum", message: `\u65E0\u6548\u7684\u4EFB\u52A1\u6A21\u5F0F: ${theme.art.taskMode}` });
  }
  if (!clampFinite01(theme.art.focusX)) {
    issues.push({ field: "art.focusX", code: "out_of_range", message: "focusX \u5FC5\u987B\u5728 0 \u5230 1 \u4E4B\u95F4\u3002" });
  }
  if (!clampFinite01(theme.art.focusY)) {
    issues.push({ field: "art.focusY", code: "out_of_range", message: "focusY \u5FC5\u987B\u5728 0 \u5230 1 \u4E4B\u95F4\u3002" });
  }

  for (const key of COLOR_KEYS) {
    const err = validateColor(theme.colors[key], `colors.${key}`);
    if (err) issues.push(err);
  }

  if (issues.length === 0) {
    return { ok: true, value: theme, issues: [] };
  }
  return { ok: false, value: undefined, issues };
}

export function assertValidTheme(input, options = {}) {
  const result = validateTheme(input, options);
  if (!result.ok) {
    throw new DreamSkinError("invalid_theme", "\u4E3B\u9898\u914D\u7F6E\u65E0\u6548\u3002", {
      details: result.issues,
    });
  }
  return result.value;
}

export { COLOR_KEYS, DEFAULT_TEXT, DEFAULT_ART };