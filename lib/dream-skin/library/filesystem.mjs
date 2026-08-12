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
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new DreamSkinError("storage_error", `path must not be a symbolic link: ${targetPath}`);
  }
}

/**
 * Atomically write a file: write to temp, fsync, rename, sync dir.
 */
export async function atomicWriteFile(filePath, data) {
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

  try {
    const dirFd = await fs.promises.open(dir, "r");
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch {
    // directory sync is best-effort
  }
}

const KNOWN_NAMES = new Set([
  "theme.json",
  ".dream-skin-import.jpg",
  "theme.css",
  "manifest.json",
  "LICENSE.txt",
]);

function isKnownThemeFile(name) {
  if (KNOWN_NAMES.has(name)) return true;
  if ((name.startsWith("image.") || name.startsWith("background.")) && /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(name)) return true;
  return false;
}

export async function removeKnownThemeDirectory(directory) {
  let entries;
  try {
    entries = await fs.promises.readdir(directory);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry);
    const stat = await fs.promises.lstat(entryPath);
    if (stat.isSymbolicLink()) {
      throw new DreamSkinError("storage_error", `theme directory contains symlink: ${entry}`);
    }
    if (!stat.isFile()) {
      throw new DreamSkinError("storage_error", `theme directory contains non-file entry: ${entry}`);
    }
    if (!isKnownThemeFile(entry)) {
      throw new DreamSkinError("storage_error", `theme directory contains unknown file: ${entry}`);
    }
    await fs.promises.unlink(entryPath);
  }

  await fs.promises.rmdir(directory);
}

export async function commitThemeDirectory({ paths, themeId, writeStaging, replace = false, onCommit }) {
  const operationId = randomUUID();
  const stagingDir = path.join(paths.stagingDir, `${themeId}-${operationId}`);
  const targetDir = path.join(paths.themesDir, themeId);
  const backupDir = path.join(paths.themesDir, `${themeId}.backup-${operationId}`);

  await rejectSymlink(targetDir);

  await fs.promises.mkdir(stagingDir, { recursive: true });
  try {
    await writeStaging(stagingDir);
  } catch (error) {
    await removeKnownThemeDirectory(stagingDir).catch(() => {});
    throw error;
  }

  const targetExists = await fs.promises.access(targetDir).then(() => true).catch(() => false);

  if (replace && targetExists) {
    await fs.promises.rename(targetDir, backupDir);
    try {
      await fs.promises.rename(stagingDir, targetDir);
    } catch (error) {
      await fs.promises.rename(backupDir, targetDir).catch(() => {});
      throw new DreamSkinError("storage_error", `theme install failed: ${error.message}`, { cause: error });
    }

    if (onCommit) {
      try {
        await onCommit();
      } catch (error) {
        await removeKnownThemeDirectory(targetDir).catch(() => {});
        await fs.promises.rename(backupDir, targetDir).catch(() => {});
        throw error;
      }
    }

    await removeKnownThemeDirectory(backupDir).catch(() => {});
  } else if (!targetExists) {
    try {
      await fs.promises.rename(stagingDir, targetDir);
    } catch (error) {
      await removeKnownThemeDirectory(stagingDir).catch(() => {});
      throw new DreamSkinError("storage_error", `theme install failed: ${error.message}`, { cause: error });
    }

    if (onCommit) {
      try {
        await onCommit();
      } catch (error) {
        await removeKnownThemeDirectory(targetDir).catch(() => {});
        throw error;
      }
    }
  } else {
    await removeKnownThemeDirectory(stagingDir).catch(() => {});
    throw new DreamSkinError("theme_already_exists", `theme ${themeId} already exists.`);
  }
}

export async function removeThemeDirectory({ paths, themeId, onCommit }) {
  const targetDir = path.join(paths.themesDir, themeId);

  await rejectSymlink(targetDir);

  const exists = await fs.promises.access(targetDir).then(() => true).catch(() => false);
  if (!exists) {
    throw new DreamSkinError("theme_not_found", `theme ${themeId} not found.`);
  }

  const operationId = randomUUID();
  const backupDir = path.join(paths.themesDir, `${themeId}.backup-${operationId}`);

  await fs.promises.rename(targetDir, backupDir);

  if (onCommit) {
    try {
      await onCommit();
    } catch (error) {
      await fs.promises.rename(backupDir, targetDir).catch(() => {});
      throw error;
    }
  }

  await removeKnownThemeDirectory(backupDir);
}

export async function recoverThemeTransactions(paths, { logger = console } = {}) {
  const warnings = [];
  const now = Date.now();
  const STALE_MS = 24 * 60 * 60 * 1000;

  let stagingEntries = [];
  try {
    stagingEntries = await fs.promises.readdir(paths.stagingDir);
  } catch {}

  for (const entry of stagingEntries) {
    const stagingPath = path.join(paths.stagingDir, entry);
    const stat = await fs.promises.lstat(stagingPath).catch(() => null);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      warnings.push({ code: "stale_staging_symlink", message: `skipped symlink staging: ${entry}` });
      continue;
    }
    const age = now - stat.mtimeMs;
    if (age > STALE_MS) {
      await removeKnownThemeDirectory(stagingPath).catch(() => {});
      warnings.push({ code: "stale_staging_removed", message: `cleaned stale staging: ${entry}` });
    }
  }

  let themeEntries = [];
  try {
    themeEntries = await fs.promises.readdir(paths.themesDir);
  } catch {}

  for (const entry of themeEntries) {
    if (!entry.includes(".backup-")) continue;

    const backupPath = path.join(paths.themesDir, entry);
    const stat = await fs.promises.lstat(backupPath).catch(() => null);
    if (!stat || stat.isSymbolicLink()) continue;

    const themeId = entry.replace(/\.backup-[0-9a-f-]+$/, "");
    const formalPath = path.join(paths.themesDir, themeId);
    const formalExists = await fs.promises.access(formalPath).then(() => true).catch(() => false);

    if (!formalExists) {
      try {
        await fs.promises.rename(backupPath, formalPath);
        warnings.push({ code: "backup_restored", message: `restored theme backup: ${themeId}` });
      } catch {
        warnings.push({ code: "backup_restore_failed", message: `failed to restore theme backup: ${themeId}` });
      }
    } else {
      await removeKnownThemeDirectory(backupPath).catch(() => {});
      warnings.push({ code: "backup_removed", message: `cleaned theme backup: ${themeId}` });
    }
  }

  if (warnings.length > 0 && logger.warn) {
    logger.warn(`[dream-skin] recovery: ${warnings.length} item(s) processed`);
  }

  return { warnings };
}

export { rejectSymlink };