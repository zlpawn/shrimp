/**
 * Local theme library: CRUD, selection, listing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DreamSkinError } from "../domain/errors.mjs";
import { assertThemeId, slugifyThemeId, allocateThemeId } from "../domain/theme-id.mjs";
import { assertValidTheme, COLOR_KEYS } from "../domain/theme-schema.mjs";
import { inspectImage, MAX_THEME_IMAGE_BYTES } from "../domain/image-format.mjs";
import { resolveEngine } from "../engines/index.mjs";

import {
  ensureDreamSkinDirectories,
  commitThemeDirectory,
  removeThemeDirectory,
  recoverThemeTransactions,
  atomicWriteFile,
  removeKnownThemeDirectory,
} from "./filesystem.mjs";
import { createActiveThemeStore } from "./active-theme.mjs";
import { createMutationQueue } from "./mutation-queue.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_THEME_PATH = path.join(__dirname, "..", "themes", "default.json");
const BUILTIN_ID = "shrimp-default";
const THEME_CONFIG_FILE = "theme.json";
const THEME_CONFIG_LIMIT = 256 * 1024;

const SUPPORTED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

function isSupportedImage(name) {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!ext) return false;
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext[1]);
}

export function createThemeLibrary({
  paths,
  builtinThemePath = BUILTIN_THEME_PATH,
  mutationQueue = createMutationQueue(),
  clock = () => new Date().toISOString(),
  logger = console,
}) {
  const activeStore = createActiveThemeStore({ statePath: paths.statePath, clock });

  async function loadBuiltinTheme() {
    const raw = await fs.promises.readFile(builtinThemePath, "utf8");
    const theme = assertValidTheme(JSON.parse(raw), { allowBuiltin: true });
    return theme;
  }

  async function initialize() {
    await ensureDreamSkinDirectories(paths);
    const recovery = await recoverThemeTransactions(paths, { logger });
    return { warnings: recovery.warnings };
  }

  async function readStoredTheme(directory) {
    const stat = await fs.promises.lstat(directory).catch(() => null);
    if (!stat || stat.isSymbolicLink()) return null;
    if (!stat.isDirectory()) return null;

    const id = path.basename(directory);
    try {
      assertThemeId(id);
    } catch {
      return null;
    }

    const configPath = path.join(directory, THEME_CONFIG_FILE);
    const configStat = await fs.promises.lstat(configPath).catch(() => null);
    if (!configStat || !configStat.isFile() || configStat.isSymbolicLink()) return null;
    if (configStat.size > THEME_CONFIG_LIMIT) return null;

    const configRaw = await fs.promises.readFile(configPath, "utf8");
    let theme;
    try {
      theme = assertValidTheme(JSON.parse(configRaw));
    } catch {
      return null;
    }

    if (theme.id !== id) return null;

    // Find exactly one image
    const entries = await fs.promises.readdir(directory);
    const imageFiles = entries.filter((e) => isSupportedImage(e) && !e.startsWith("."));
    if (imageFiles.length !== 1) return null;

    const imagePath = path.join(directory, imageFiles[0]);
    const imgStat = await fs.promises.lstat(imagePath);
    if (!imgStat.isFile() || imgStat.isSymbolicLink()) return null;
    if (imgStat.size > MAX_THEME_IMAGE_BYTES) return null;

    const imageBytes = await fs.promises.readFile(imagePath);
    let imageFormat;
    try {
      imageFormat = inspectImage(imageBytes);
    } catch {
      return null;
    }

    // Verify image extension matches real format
    const expectedExt = imageFiles[0].toLowerCase().match(/\.([a-z0-9]+)$/)[1];
    const actualExt = imageFormat.extension;
    if (expectedExt !== actualExt && !(expectedExt === "jpeg" && actualExt === "jpg")) {
      return null;
    }

    return { theme, imageBytes, imageFormat };
  }

  async function listThemes() {
    const builtin = await loadBuiltinTheme();
    const storedThemes = new Map();

    let entries = [];
    try {
      entries = await fs.promises.readdir(paths.themesDir);
    } catch {
      // dir doesn't exist
    }

    let invalidEntries = 0;
    for (const entry of entries) {
      // Skip backup/staging dirs
      if (entry.includes(".backup-") || entry.startsWith(".")) continue;

      const dir = path.join(paths.themesDir, entry);
      const result = await readStoredTheme(dir);
      if (!result) {
        // Check if it looks like a theme dir but is invalid
        const stat = await fs.promises.lstat(dir).catch(() => null);
        if (stat && stat.isDirectory() && !stat.isSymbolicLink()) {
          invalidEntries++;
        }
        continue;
      }
      storedThemes.set(entry, result);
    }

    // Build valid theme IDs set
    const validIds = new Set([BUILTIN_ID, ...storedThemes.keys()]);

    // Load/repair active state
    const state = await activeStore.load(validIds);

    // Build summary list
    const themes = [];

    // Built-in first
    themes.push({
      id: builtin.id,
      name: builtin.name,
      kind: "builtin",
      builtin: true,
      selected: state.selectedThemeId === builtin.id,
      stylePreset: builtin.stylePreset,
      appearance: builtin.appearance,
      imageUrl: "",
    });

    // Stored themes sorted by name
    const sorted = [...storedThemes.entries()].sort((a, b) => {
      const an = a[1].theme.name.toLowerCase();
      const bn = b[1].theme.name.toLowerCase();
      return an.localeCompare(bn) || a[0].localeCompare(b[0]);
    });

    for (const [id, result] of sorted) {
      themes.push({
        id,
        name: result.theme.name,
        kind: "stored",
        builtin: false,
        selected: state.selectedThemeId === id,
        stylePreset: result.theme.stylePreset,
        appearance: result.theme.appearance,
        imageUrl: `/v1/dream-skin/themes/${encodeURIComponent(id)}/image`,
      });
    }

    return {
      selectedThemeId: state.selectedThemeId,
      themes,
      invalidEntries,
      warnings: state.warnings,
    };
  }

  async function getTheme(id) {
    assertThemeId(id, { allowBuiltin: true });

    if (id === BUILTIN_ID) {
      const theme = await loadBuiltinTheme();
      return { theme, kind: "builtin", imageBytes: null, imageFormat: null };
    }

    const dir = path.join(paths.themesDir, id);
    const result = await readStoredTheme(dir);
    if (!result) {
      throw new DreamSkinError("theme_not_found", `\u4E3B\u9898 ${id} \u4E0D\u5B58\u5728\u3002`);
    }
    return { theme: result.theme, kind: "stored", imageBytes: result.imageBytes, imageFormat: result.imageFormat };
  }

  async function putStoredTheme({ theme, imageBytes, replace = false, onCommit }) {
    const validated = assertValidTheme(theme);

    // For stored themes, image is required
    if (!imageBytes || !Buffer.isBuffer(imageBytes) || imageBytes.length === 0) {
      // Check if this is a duplicate of builtin (which has no image)
      if (validated.id === BUILTIN_ID) {
        throw new DreamSkinError("invalid_image", "\u5B58\u50A8\u4E3B\u9898\u9700\u8981\u80CC\u666F\u56FE\u7247\u3002");
      }
      throw new DreamSkinError("invalid_image", "\u4E3B\u9898\u9700\u8981\u80CC\u666F\u56FE\u7247\u3002");
    }

    // Validate image format
    const imageFormat = inspectImage(imageBytes);
    const imageFileName = `background.${imageFormat.extension}`;

    // Write staging
    await commitThemeDirectory({
      paths,
      themeId: validated.id,
      replace,
      writeStaging: async (stagingDir) => {
        // Write theme.json once with the canonical stored image name
        const themedWithImage = { ...validated, image: imageFileName };
        const themedJson = JSON.stringify(themedWithImage, null, 2);
        if (Buffer.byteLength(themedJson, "utf8") > THEME_CONFIG_LIMIT) {
          throw new DreamSkinError("invalid_theme", "主题配置超过 256 KiB。");
        }
        await fs.promises.writeFile(path.join(stagingDir, THEME_CONFIG_FILE), themedJson);
        await fs.promises.writeFile(path.join(stagingDir, imageFileName), imageBytes);
      },
      onCommit,
    });

    return {
      id: validated.id,
      name: validated.name,
      kind: "stored",
      builtin: false,
      selected: false,
      stylePreset: validated.stylePreset,
      appearance: validated.appearance,
      imageUrl: `/v1/dream-skin/themes/${encodeURIComponent(validated.id)}/image`,
    };
  }

  async function createTheme({ theme, imageBytes }) {
    return mutationQueue.run(() => putStoredTheme({ theme, imageBytes, replace: false }));
  }

  async function updateTheme(id, { theme, imageBytes }) {
    return mutationQueue.run(async () => {
      assertThemeId(id, { allowBuiltin: true });
      if (id === BUILTIN_ID) {
        throw new DreamSkinError("builtin_theme_readonly", "\u5185\u7F6E\u4E3B\u9898\u4E0D\u53EF\u7F16\u8F91\u3002");
      }

      // If no new image, load existing image bytes
      let bytes = imageBytes;
      if (!bytes) {
        const existing = await getTheme(id);
        bytes = existing.imageBytes;
        if (!bytes) {
          throw new DreamSkinError("invalid_image", "\u4E3B\u9898\u9700\u8981\u80CC\u666F\u56FE\u7247\u3002");
        }
      }

      const updatedTheme = { ...theme, id };
      return putStoredTheme({ theme: updatedTheme, imageBytes: bytes, replace: true });
    });
  }

  async function duplicateTheme(id, { name, requestedId, imageBytes } = {}) {
    return mutationQueue.run(async () => {
      assertThemeId(id, { allowBuiltin: true });
      const source = await getTheme(id);

      let bytes = imageBytes;
      if (!bytes && source.imageBytes) {
        bytes = source.imageBytes;
      }
      if (!bytes) {
        throw new DreamSkinError("invalid_image", "\u590D\u5236\u4E3B\u9898\u9700\u8981\u80CC\u666F\u56FE\u7247\u3002");
      }

      const newName = name || `${source.theme.name} Copy`;
      const existingIds = new Set();
      try {
        const entries = await fs.promises.readdir(paths.themesDir);
        for (const e of entries) existingIds.add(e);
      } catch {}
      existingIds.add(BUILTIN_ID);

      const newId = requestedId || allocateThemeId(newName, (checkId) => existingIds.has(checkId));
      const newTheme = { ...source.theme, id: newId, name: newName };

      return putStoredTheme({ theme: newTheme, imageBytes: bytes, replace: false });
    });
  }

  async function deleteTheme(id, { onCommit } = {}) {
    return mutationQueue.run(async () => {
      assertThemeId(id, { allowBuiltin: true });
      if (id === BUILTIN_ID) {
        throw new DreamSkinError("builtin_theme_readonly", "\u5185\u7F6E\u4E3B\u9898\u4E0D\u53EF\u5220\u9664\u3002");
      }

      // Check if it's the selected theme (read-only, never repairs state)
      const state = await activeStore.read();
      if (state.selectedThemeId === id) {
        throw new DreamSkinError("theme_in_use", "\u5F53\u524D\u9009\u4E2D\u7684\u4E3B\u9898\u4E0D\u53EF\u5220\u9664\uFF0C\u8BF7\u5148\u9009\u62E9\u5176\u4ED6\u4E3B\u9898\u3002");
      }

      await removeThemeDirectory({ paths, themeId: id, onCommit });
    });
  }

  async function selectTheme(id) {
    return mutationQueue.run(async () => {
      assertThemeId(id, { allowBuiltin: true });

      // Verify theme exists
      await getTheme(id);

      await activeStore.select(id);
      return listThemes();
    });
  }

  return {
    initialize,
    listThemes,
    getTheme,
    createTheme,
    updateTheme,
    duplicateTheme,
    putStoredTheme,
    deleteTheme,
    selectTheme,
    get mutationQueue() {
      return mutationQueue;
    },
  };
}

export { BUILTIN_ID, BUILTIN_THEME_PATH };