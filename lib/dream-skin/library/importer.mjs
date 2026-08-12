/**
 * Theme importer: accepts validated theme + image bytes, handles conflicts.
 */

import { DreamSkinError } from "../domain/errors.mjs";
import { assertValidTheme } from "../domain/theme-schema.mjs";
import { inspectImage } from "../domain/image-format.mjs";
import { allocateThemeId } from "../domain/theme-id.mjs";

export function createThemeImporter({ library, canReplace }) {
  async function importTheme({ theme, imageBytes, conflict = "error", requestedId }) {
    // Validate theme
    const validated = assertValidTheme(theme);

    // Validate image
    if (!imageBytes || !Buffer.isBuffer(imageBytes) || imageBytes.length === 0) {
      throw new DreamSkinError("invalid_image", "\u5BFC\u5165\u4E3B\u9898\u9700\u8981\u80CC\u666F\u56FE\u7247\u3002");
    }
    inspectImage(imageBytes);

    // Check for conflict
    let themeId = validated.id;
    let themeToStore = validated;

    if (conflict === "error") {
      // If theme already exists, throw
      try {
        await library.getTheme(themeId);
        throw new DreamSkinError("theme_already_exists", `\u4E3B\u9898 ${themeId} \u5DF2\u5B58\u5728\u3002`);
      } catch (err) {
        if (err.code === "theme_already_exists") throw err;
        // theme_not_found is expected, continue
      }
    } else if (conflict === "copy") {
      // Allocate new ID
      const list = await library.listThemes();
      const existingIds = new Set(list.themes.map((t) => t.id));
      themeId = requestedId || allocateThemeId(validated.name, (id) => existingIds.has(id));
      themeToStore = { ...validated, id: themeId };
    } else if (conflict === "replace-local") {
      const canReplaceResult = await canReplace(themeId);
      if (!canReplaceResult) {
        throw new DreamSkinError("theme_already_exists", `\u4E3B\u9898 ${themeId} \u5DF2\u5B58\u5728\uFF0C\u65E0\u6CD5\u66FF\u6362\u3002`);
      }
    } else {
      throw new DreamSkinError("invalid_request", `\u65E0\u6548\u7684\u51B2\u7A81\u5904\u7406\u6A21\u5F0F: ${conflict}`);
    }

    return library.putStoredTheme({
      theme: themeToStore,
      imageBytes,
      replace: conflict === "replace-local",
    });
  }

  return { importTheme };
}