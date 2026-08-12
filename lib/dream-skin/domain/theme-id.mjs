/**
 * Theme ID validation and allocation.
 */

import { DreamSkinError } from "./errors.mjs";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const RESERVED_IDS = new Set(["shrimp-default", "builtin"]);
const MAX_ID_BYTES = 64;

function utf8ByteLength(str) {
  return Buffer.byteLength(str, "utf8");
}

export function assertThemeId(value, { allowBuiltin = false } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    throw new DreamSkinError("invalid_theme_id", "主题 ID 不能为空。");
  }

  const byteLen = utf8ByteLength(value);
  if (byteLen > MAX_ID_BYTES) {
    throw new DreamSkinError("invalid_theme_id", `主题 ID 超过 ${MAX_ID_BYTES} 字节。`);
  }

  if (!ID_PATTERN.test(value)) {
    throw new DreamSkinError("invalid_theme_id", "主题 ID 只能包含小写字母、数字、-、_、.，且以字母或数字开头。");
  }

  if (!allowBuiltin && RESERVED_IDS.has(value)) {
    throw new DreamSkinError("invalid_theme_id", `主题 ID "${value}" 是保留 ID。`);
  }

  return value;
}

export function slugifyThemeId(name) {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug || !ID_PATTERN.test(slug)) {
    return "theme";
  }

  // Ensure within byte limit
  if (utf8ByteLength(slug) <= MAX_ID_BYTES) {
    return slug;
  }

  // Truncate at byte boundary
  const buf = Buffer.from(slug, "utf8").subarray(0, MAX_ID_BYTES);
  let truncated = buf.toString("utf8");
  // Remove trailing partial char / dashes
  truncated = truncated.replace(/[-._]+$/, "");
  return truncated || "theme";
}

export function allocateThemeId(name, exists) {
  const base = slugifyThemeId(name);
  let id = base;
  if (!exists(id)) return id;

  let suffix = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    id = `${base}-${suffix}`;
    if (!exists(id)) return id;
    suffix++;
  }
}

export { RESERVED_IDS, MAX_ID_BYTES };