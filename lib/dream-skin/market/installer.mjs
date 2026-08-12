/**
 * Market installer: verified download, SHA-256 check, atomic install.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DreamSkinError } from "../domain/errors.mjs";
import { assertValidTheme } from "../domain/theme-schema.mjs";
import { inspectImage } from "../domain/image-format.mjs";

import { atomicWriteFile } from "../library/filesystem.mjs";

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function createMarketInstaller({ marketCache, marketClient, themeLibrary, installRecords, paths, logger = console }) {
  async function install(id) {
    return doInstall(id, false);
  }

  async function update(id) {
    return doInstall(id, true);
  }

  async function doInstall(id, isUpdate) {
    const index = marketCache.getCurrent() || (await marketCache.readValidated());
    const entry = index.themes.find((t) => t.id === id);
    if (!entry) {
      throw new DreamSkinError("theme_not_found", `\u5E02\u573A\u4E3B\u9898 $glm_5.2_ark_toC \u4E0D\u5B58\u5728\u3002`);
    }

    // Download theme JSON
    const themeBytes = await marketClient.fetchThemeBytes(entry);
    const themeHash = sha256Hex(themeBytes);
    if (themeHash !== entry.themeSha256) {
      throw new DreamSkinError("hash_mismatch", `\u4E3B\u9898\u914D\u7F6E SHA-256 \u6821\u9A8C\u5931\u8D25\u3002`);
    }

    // Parse and validate theme
    let theme;
    try {
      theme = JSON.parse(themeBytes.toString("utf8"));
    } catch {
      throw new DreamSkinError("market_asset_invalid", `\u5E02\u573A\u4E3B\u9898\u914D\u7F6E\u4E0D\u662F\u6709\u6548 JSON\u3002`);
    }
    const validated = assertValidTheme(theme);

    // Verify identity
    if (validated.id !== entry.id || validated.name !== entry.name) {
      throw new DreamSkinError("market_asset_invalid", `\u5E02\u573A\u4E3B\u9898\u914D\u7F6E\u4E0E\u6E05\u5355\u8EAB\u4EFD\u4E0D\u4E00\u81F4\u3002`);
    }

    // Download image
    const imageBytes = await marketClient.fetchImageBytes(entry);
    const imageHash = sha256Hex(imageBytes);
    if (imageHash !== entry.imageSha256) {
      throw new DreamSkinError("hash_mismatch", `\u4E3B\u9898\u56FE\u7247 SHA-256 \u6821\u9A8C\u5931\u8D25\u3002`);
    }

    // Verify image format
    const imageFormat = inspectImage(imageBytes);

    // Rewrite theme.image to canonical name
    const canonicalImage = `background.${imageFormat.extension}`;
    const themeToStore = { ...validated, image: canonicalImage };

    // Snapshot install records for rollback
    const snapshot = await installRecords.snapshot();

    // Install through library with onCommit callback
    try {
      const summary = await themeLibrary.putStoredTheme({
        theme: themeToStore,
        imageBytes,
        replace: isUpdate,
        onCommit: async () => {
          await installRecords.set(id, { version: entry.version, source: "market" });
        },
      });
      return summary;
    } catch (error) {
      // Restore install records on failure
      await installRecords.restore(snapshot).catch(() => {});
      throw error;
    }
  }

  async function uninstall(id) {
    // Remove theme, then remove install record
    await themeLibrary.deleteTheme(id, {
      onCommit: async () => {
        await installRecords.remove(id);
      },
    });
  }

  async function getPreview(id) {
    const index = marketCache.getCurrent() || (await marketCache.readValidated());
    const entry = index.themes.find((t) => t.id === id);
    if (!entry) {
      throw new DreamSkinError("theme_not_found", `\u5E02\u573A\u4E3B\u9898 $glm_5.2_ark_toC \u4E0D\u5B58\u5728\u3002`);
    }

    // Check local cache first
    const previewDir = paths.previewsDir;
    const candidates = await fs.promises.readdir(previewDir).catch(() => []);
    const cached = candidates.find((f) => f.startsWith(`${id}.`));
    if (cached) {
      const cachedPath = path.join(previewDir, cached);
      const bytes = await fs.promises.readFile(cachedPath);
      const format = inspectImage(bytes);
      return { bytes, mime: format.mime, etag: sha256Hex(bytes).slice(0, 16) };
    }

    // Download preview
    const previewBytes = await marketClient.fetchPreviewBytes(entry);
    const format = inspectImage(previewBytes);

    // Cache to disk
    await fs.promises.mkdir(previewDir, { recursive: true });
    const previewPath = path.join(previewDir, `${id}.${format.extension}`);
    await atomicWriteFile(previewPath, previewBytes);

    return { bytes: previewBytes, mime: format.mime, etag: sha256Hex(previewBytes).slice(0, 16) };
  }

  async function mergeMarketState(index, localThemes) {
    const records = await installRecords.load();
    const localIds = new Set(localThemes.map((t) => t.id));

    return index.themes.map((entry) => {
      const record = records.themes[entry.id];
      const installed = localIds.has(entry.id);
      const installedVersion = record ? record.version : "";
      const updateAvailable = installed && installedVersion && installedVersion !== entry.version;

      return {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        author: entry.author,
        description: entry.description,
        license: entry.license,
        sourceUrl: entry.sourceUrl,
        tags: entry.tags,
        previewUrl: `/v1/dream-skin/market/themes/${encodeURIComponent(entry.id)}/preview`,
        installed,
        installedVersion,
        updateAvailable,
      };
    });
  }

  return { install, update, uninstall, getPreview, mergeMarketState };
}