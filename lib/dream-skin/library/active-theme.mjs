/**
 * Active theme state persistence.
 */

import fs from "node:fs";
import path from "node:path";

import { atomicWriteFile } from "./filesystem.mjs";
import { DreamSkinError } from "../domain/errors.mjs";

const BUILTIN_ID = "shrimp-default";

export function createActiveThemeStore({ statePath, clock = () => new Date().toISOString() }) {
  async function load(validThemeIds) {
    let state = null;
    try {
      const raw = await fs.promises.readFile(statePath, "utf8");
      state = JSON.parse(raw);
    } catch {
      // missing or corrupt
    }

    const warnings = [];

    if (!state || typeof state !== "object") {
      state = { schemaVersion: 1, selectedThemeId: BUILTIN_ID, selectedAt: clock() };
      warnings.push({ code: "selected_theme_repaired", message: "\u4E3B\u9898\u72B6\u6001\u5DF2\u4FEE\u590D\u4E3A\u9ED8\u8BA4\u503C\u3002" });
      await atomicWriteFile(statePath, JSON.stringify(state, null, 2));
    } else if (state.schemaVersion !== 1) {
      state = { schemaVersion: 1, selectedThemeId: BUILTIN_ID, selectedAt: clock() };
      warnings.push({ code: "selected_theme_repaired", message: "\u4E3B\u9898\u72B6\u6001\u7248\u672C\u4E0D\u652F\u6301\uFF0C\u5DF2\u4FEE\u590D\u3002" });
      await atomicWriteFile(statePath, JSON.stringify(state, null, 2));
    } else {
      const ids = new Set(validThemeIds);
      ids.add(BUILTIN_ID);
      if (!ids.has(state.selectedThemeId)) {
        state.selectedThemeId = BUILTIN_ID;
        state.selectedAt = clock();
        warnings.push({ code: "selected_theme_repaired", message: "\u9009\u5B9A\u4E3B\u9898\u4E0D\u5B58\u5728\uFF0C\u5DF2\u56DE\u9000\u5230\u9ED8\u8BA4\u3002" });
        await atomicWriteFile(statePath, JSON.stringify(state, null, 2));
      }
    }

    return {
      selectedThemeId: state.selectedThemeId,
      selectedAt: state.selectedAt,
      warnings,
    };
  }

  async function select(themeId) {
    const state = {
      schemaVersion: 1,
      selectedThemeId: themeId,
      selectedAt: clock(),
    };
    await atomicWriteFile(statePath, JSON.stringify(state, null, 2));
    return { selectedThemeId: state.selectedThemeId, selectedAt: state.selectedAt };
  }

  async function read() {
    try {
      const raw = await fs.promises.readFile(statePath, "utf8");
      const state = JSON.parse(raw);
      if (state && typeof state === "object" && state.selectedThemeId) {
        return { selectedThemeId: state.selectedThemeId, selectedAt: state.selectedAt || "" };
      }
    } catch {
      // missing or corrupt — caller decides
    }
    return { selectedThemeId: BUILTIN_ID, selectedAt: "" };
  }

  return { load, select, read };
}