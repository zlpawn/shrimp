/**
 * Market index schema validation and normalization.
 */

import { DreamSkinError } from "../domain/errors.mjs";
import { assertThemeId } from "../domain/theme-id.mjs";

export const MAX_MARKET_INDEX_BYTES = 1024 * 1024; // 1 MiB
export const MAX_MARKET_THEMES = 200;

const FIELD_LIMITS = {
  name: 100,
  version: 100,
  author: 100,
  license: 100,
  description: 1000,
  sourceUrl: 2048,
  assetPath: 2048,
  tag: 40,
};

const MAX_TAGS = 12;

function validateSha256(value) {
  if (typeof value !== "string" || value.length !== 64 || !/^[0-9a-f]+$/.test(value)) {
    throw new DreamSkinError("market_manifest_invalid", `invalid SHA-256: ${value}`);
  }
  return value;
}

export function assertMarketAssetPath(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new DreamSkinError("market_manifest_invalid", `${field} is empty`);
  }
  if (value.length > FIELD_LIMITS.assetPath) {
    throw new DreamSkinError("market_manifest_invalid", `${field} exceeds ${FIELD_LIMITS.assetPath} chars`);
  }
  if (value.startsWith("/")) {
    throw new DreamSkinError("market_manifest_invalid", `${field} must not be absolute`);
  }
  if (value.includes("\\")) {
    throw new DreamSkinError("market_manifest_invalid", `${field} must not contain backslashes`);
  }
  if (value.includes("?") || value.includes("#") || value.includes("\0")) {
    throw new DreamSkinError("market_manifest_invalid", `${field} must not contain query/fragment/NUL`);
  }
  if (/^[a-z]+:\/\//i.test(value)) {
    throw new DreamSkinError("market_manifest_invalid", `${field} must not be a URL`);
  }
  for (const segment of value.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new DreamSkinError("market_manifest_invalid", `${field} contains invalid path segment`);
    }
    if (!/^[a-z0-9._-]+$/i.test(segment)) {
      throw new DreamSkinError("market_manifest_invalid", `${field} contains invalid characters`);
    }
  }
  return value;
}

export function joinMarketAssetUrl(rawBaseUrl, relativePath) {
  const validated = assertMarketAssetPath(relativePath, "asset path");
  const base = new URL(rawBaseUrl);
  const joined = new URL(validated, base);
  if (joined.origin !== base.origin) {
    throw new DreamSkinError("market_manifest_invalid", `asset URL escaped base origin`);
  }
  return joined.href;
}

export function assertMarketIndex(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DreamSkinError("market_manifest_invalid", "market index must be an object");
  }

  const schemaVersion = input.schemaVersion ?? input.schema_version;
  if (schemaVersion !== 1) {
    throw new DreamSkinError("market_manifest_invalid", `unsupported market schema version: ${schemaVersion}`);
  }

  const updatedAt = input.updatedAt ?? input.updated_at ?? "";
  if (typeof updatedAt !== "string" || updatedAt.length > 100) {
    throw new DreamSkinError("market_manifest_invalid", "invalid updatedAt");
  }

  const rawThemes = input.themes;
  if (!Array.isArray(rawThemes)) {
    throw new DreamSkinError("market_manifest_invalid", "themes must be an array");
  }
  if (rawThemes.length > MAX_MARKET_THEMES) {
    throw new DreamSkinError("market_manifest_invalid", `market index exceeds ${MAX_MARKET_THEMES} themes`);
  }

  const ids = new Set();
  const themes = [];

  for (const raw of rawThemes) {
    const id = assertThemeId(raw.id);

    if (ids.has(id)) {
      throw new DreamSkinError("market_manifest_invalid", `duplicate theme ID: ${id}`);
    }
    ids.add(id);

    const name = raw.name ?? "";
    const version = raw.version ?? "";
    const author = raw.author ?? "";
    const license = raw.license ?? "";
    const description = raw.description ?? "";
    const sourceUrl = raw.sourceUrl ?? raw.source_url ?? "";
    const tags = Array.isArray(raw.tags) ? raw.tags : [];

    for (const [field, value] of [
      ["name", name], ["version", version], ["author", author],
      ["license", license],
    ]) {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new DreamSkinError("market_manifest_invalid", `theme ${id} has empty ${field}`);
      }
      if (value.length > FIELD_LIMITS[field]) {
        throw new DreamSkinError("market_manifest_invalid", `theme ${id} ${field} exceeds limit`);
      }
    }

    if (license.trim().length === 0) {
      throw new DreamSkinError("market_manifest_invalid", `theme ${id} has empty license`);
    }

    if (tags.length > MAX_TAGS) {
      throw new DreamSkinError("market_manifest_invalid", `theme ${id} exceeds ${MAX_TAGS} tags`);
    }
    for (const tag of tags) {
      if (typeof tag !== "string" || tag.trim().length === 0 || tag.length > FIELD_LIMITS.tag) {
        throw new DreamSkinError("market_manifest_invalid", `theme ${id} has invalid tag`);
      }
    }

    // Validate source URL
    let parsedSource;
    try {
      parsedSource = new URL(sourceUrl);
    } catch {
      throw new DreamSkinError("market_manifest_invalid", `theme ${id} has invalid source URL`);
    }
    if (parsedSource.protocol !== "http:" && parsedSource.protocol !== "https:") {
      throw new DreamSkinError("market_manifest_invalid", `theme ${id} source URL must be HTTP/HTTPS`);
    }

    // Validate asset paths
    assertMarketAssetPath(raw.theme, `theme ${id} theme path`);
    assertMarketAssetPath(raw.image, `theme ${id} image path`);
    assertMarketAssetPath(raw.preview, `theme ${id} preview path`);

    // Validate hashes
    const themeSha256 = validateSha256(raw.themeSha256 ?? raw.theme_sha256);
    const imageSha256 = validateSha256(raw.imageSha256 ?? raw.image_sha256);

    themes.push({
      id,
      name,
      version,
      author,
      description,
      license,
      sourceUrl,
      tags: [...tags],
      theme: raw.theme,
      image: raw.image,
      preview: raw.preview,
      themeSha256,
      imageSha256,
    });
  }

  return {
    schemaVersion: 1,
    updatedAt,
    themes,
  };
}