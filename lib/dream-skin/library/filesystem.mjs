/**
 * Atomic filesystem operations for dream-skin theme storage.
 * Staging -> fsync -> rename -> rollback pattern.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { DreamSkinError } from "../domain/errors.mjs";

/**
 * Ensure the dream-skin directory structure exists.
 */
export async function ensureDreamSkinDirectories(paths) {
  const dirs = [
    paths.rootDir,
    paths.themesDir,
    paths.marketDir,
    paths.previewsDir,
    paths.stagingDir,
  ];
  for (const dir of dirs) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
}

/**
 * Reject symbolic links.
 */
async function rejectSymlink(targetPath) {
  let stat;
  try {
    stat = await fs.promises.lstat(targetPath);
  } catch {
    return; // path doesn't exist, that's fine
  }
  if (stat.isSymbolicLink()) {
    throw new DreamSkinError("storage_error", `\u8DEF\u5F84\u4E0D\u80FD\u662F\u7B26\u53F7\u94FE\u63A5: ${targetPath}`);
  }
}

/**
 * Atomically write a file: write to temp, fsync, rename, sync dir.
 */
async function atomicWriteFile(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const fd = await fs.promises.open(tmpPath, "w");
  try {
    await fd.writeFile(data);
    await fd.sync();
  } finally {
    await fd.close();
  }

  await fs.promises.rename(tmpPath, filePath);

  // Best-effort directory sync
  try {
    const dirFd = await fs.promises.open(dir, "r");
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch {
    // directory sync is best-effort on some platforms
  }
}

/**
 * Remove a directory and all its contents, but only if it contains
 * known safe files (theme.json, image.*, .dream-skin-import.jpg,
 * theme.css, manifest.json, LICENSE.txt).
 */
async function removeKnownThemeDirectory(directory) {
  let entries;
  try {
    entries = await fs.promises.readdir(directory);
  } catch {
    return; // already gone
  }

  const knownNames = new Set([
    "theme.json",
    ".dream-skin-import.jpg",
    "theme.css",
    "manifest.json",
    "LICENSE.txt",
  ]);

  for (const entry of entries) {
    const entryPath = path.join(directory, entry);
    const stat = await fs.promises.lstat(entryPath);
    if (stat.isSymbolicLink()) {
      throw new DreamSkinError("storage_error", `\u4E3B\u9898\u76EE\u5F55\u5305\u542B\u7B26\u53F7\u94FE\u63A5: ${entry}`);
    }
    if (!stat.isFile()) {
      throw new DreamSkinError("storage_error", `\u4E3B\u9898\u76EE\u5F55\u5305\u542B\u975E\u6587\u4EF6\u6761\u76EE: ${entry}`);
    }
    const isKnown =
      knownNames.has(entry) ||
      (entry.startsWith("image.") && /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(entry));
    if (!isKnown) {
      throw new DreamSkinError("storage_error", `\u4E3B\u9898\u76EE\u5F55\u5305\u542B\u672A\u77E5\u6587\u4EF6: ${entry}`);
    }
    await fs.promises.unlink(entryPath);
  }

  await fs.promises.rmdir(directory);
}

/**
 * Commit a theme directory using staging + atomic rename with rollback.
 *
 * @param {object} params
 * @param {object} params.paths - DreamSkinPaths
 * @param {string} params.themeId - Theme ID
 * @param {function} params.writeStaging - async (stagingDir) => void
 * @param {boolean} params.replace - Whether to replace existing theme
 * @param {function} [params.onCommit] - async () => void, called after rename with backup available
 */
export async function commitThemeDirectory({ paths, themeId, writeStaging, replace = false, onCommit }) {
  const operationId = randomUUID();
  const stagingDir = path.join(paths.stagingDir, `${themeId}-${operationId}`);
  const targetDir = path.join(paths.themesDir, themeId);
  const backupDir = path.join(paths.themesDir, `${themeId}.backup-${operationId}`);

  // Reject symlinks on existing paths
  await rejectSymlink(targetDir);

  // Create staging and write contents
  await fs.promises.mkdir(stagingDir, { recursive: true });
  try {
    await writeStaging(stagingDir);
  } catch (error) {
    await removeKnownThemeDirectory(stagingDir).catch(() => {});
    throw error;
  }

  // Replace or create
  const targetExists = await fs.promises.access(targetDir).then(() => true).catch(() => false);

  if (replace && targetExists) {
    // Rename existing to backup
    await fs.promises.rename(targetDir, backupDir);
    // Rename staging to target
    try {
      await fs.promises.rename(stagingDir, targetDir);
    } catch (error) {
      // Rollback: restore backup
      await fs.promises.rename(backupDir, targetDir).catch(() => {});
      throw new DreamSkinError("storage_error", `\u4E3B\u9898\u5B89\u88C5\u5931\u8D25: ${error.message}`, { cause: error });
    }

    // Call onCommit while backup is still available
    if (onCommit) {
      try {
        await onCommit();
      } catch (error) {
        // Rollback: remove failed target, restore backup
        await removeKnownThemeDirectory(targetDir).catch(() => {});
        await fs.promises.rename(backupDir, targetDir).catch(() => {});
        throw error;
      }
    }

    // Clean up backup
    await removeKnownThemeDirectory(backupDir).catch(() => {});
  } else if (!targetExists) {
    // Simple rename
    try {
      await fs.promises.rename(stagingDir, targetDir);
    } catch (error) {
      await removeKnownThemeDirectory(stagingDir).catch(() => {});
      throw new DreamSkinError("storage_error", `\u4E3B\u9898\u5B89\u88C5\u5931\u8D25: ${error.message}`, { cause: error });
    }

    if (onCommit) {
      try {
        await onCommit();
      } catch (error) {
        // Remove the newly created theme
        await removeKnownThemeDirectory(targetDir).catch(() => {});
        throw error;
      }
    }
  } else {
    // Target exists but replace is false
    await removeKnownThemeDirectory(stagingDir).catch(() => {});
    throw new DreamSkinError("theme_already_exists", `\u4E3B\u9898 ${themeId} \u5DF2\u5B58\u5728\u3002`);
  }
}

/**
 * Remove a theme directory permanently.
 */
export async function removeThemeDirectory({ paths, themeId, onCommit }) {
  const targetDir = path.join(paths.themesDir, themeId);

  await rejectSymlink(targetDir);

  const exists = await fs.promises.access(targetDir).then(() => true).catch(() => false);
  if (!exists) {
    throw new DreamSkinError("theme_not_found", `\u4E3B\u9898 ${themeId} \u4E0D\u5B58\u5728\u3002`);
  }

  const operationId = randomUUID();
  const backupDir = path.join(paths.themesDir, `${themeId}.backup-${operationId}`);

  // Move to backup first
  await fs.promises.rename(targetDir, backupDir);

  if (onCommit) {
    try {
      await onCommit();
    } catch (error) {
      // Restore
      await fs.promises.rename(backupDir, targetDir).catch(() => {});
      throw error;
    }
  }

  await removeKnownThemeDirectory(backupDir);
}

/**
 * Recover incomplete transactions on startup.
 * - Remove stale staging directories (>24h old)
 * - Restore backup directories when formal directory is missing
 * - Remove backup directories when formal directory is present
 */
export async function recoverThemeTransactions(paths, { logger = console } = {}) {
  const warnings = [];
  const now = Date.now();
  const STALE_MS = 24 * 60 * 60 * 1000;

  // Clean up staging
  let stagingEntries = [];
  try {
    stagingEntries = await fs.promises.readdir(paths.stagingDir);
  } catch {
    // staging dir doesn't exist yet
  }

  for (const entry of stagingEntries) {
    const stagingPath = path.join(paths.stagingDir, entry);
    const stat = await fs.promises.lstat(stagingPath).catch(() => null);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      warnings.push({ code: "stale_staging_symlink", message: `\u8DF3\u8FC7\u7B26\u53F7\u94FE\u63A5 staging: ${entry}` });
      continue;
    }
    const age = now - stat.mtimeMs;
    if (age > STALE_MS) {
      await removeKnownThemeDirectory(stagingPath).catch(() => {});
      warnings.push({ code: "stale_staging_removed", message: `\u6E05\u7406\u8FC7\u671F staging: ${entry}` });
    }
  }

  // Check for backup directories
  let themeEntries = [];
  try {
    themeEntries = await fs.promises.readdir(paths.themesDir);
  } catch {
    // themes dir doesn't exist yet
  }

  for (const entry of themeEntries) {
    if (!entry.includes(".backup-")) continue;

    const backupPath = path.join(paths.themesDir, entry);
    const stat = await fs.promises.lstat(backupPath).catch(() => null);
    if (!stat || stat.isSymbolicLink()) continue;

    // Extract the theme ID from backup dir name: "<id>.backup-<uuid>"
    const themeId = entry.replace(/\.backup-[0-9a-f-]+$/, "");
    const formalPath = path.join(paths.themesDir, themeId);
    const formalExists = await fs.promises.access(formalPath).then(() => true).catch(() => false);

    if (!formalExists) {
      // Restore backup
      try {
        await fs.promises.rename(backupPath, formalPath);
        warnings.push({ code: "backup_restored", message: `\u6062\u590D\u4E3B\u9898\u5907\u4EFD: ${themeId}` });
      } catch {
        warnings.push({ code: "backup_restore_failed", message: `\u6062\u590D\u4E3B\u9898\u5907\u4EFD\u5931\u8D25: ${themeId}` });
      }
    } else {
      // Formal dir exists, remove backup
      await removeKnownThemeDirectory(backupPath).catch(() => {});
      warnings.push({ code: "backup_removed", message: `\u6E05\u7406\u4E3B\u9898\u5907\u4EFD: ${themeId}` });
    }
  }

  if (warnings.length > 0 && logger.warn) {
    logger.warn(`[dream-skin] recovery: ${warnings.length} item(s) processed`);
  }

  return { warnings };
}

export { atomicWriteFile, rejectSymlink, removeKnownThemeDirectory };