/**
 * Dream Skin panel model helpers: filtering, draft conversion, preview styles.
 * Pure functions — no DOM access, no fetch.
 */

import type {
  DreamSkinMarketTheme,
  DreamSkinThemeDetail,
  DreamSkinPreviewScene,
} from "../core/types";

export interface DreamSkinDraft {
  id: string;
  name: string;
  stylePreset: string;
  appearance: "auto" | "light" | "dark";
  brandSubtitle: string;
  tagline: string;
  projectPrefix: string;
  projectLabel: string;
  statusText: string;
  quote: string;
  art: {
    focusX: number;
    focusY: number;
    safeArea: "auto" | "left" | "right" | "center" | "none";
    taskMode: "ambient" | "banner" | "off";
  };
  colors: Record<string, string>;
  imageUrl: string;
}

export interface DreamSkinPreviewStyle {
  scene: DreamSkinPreviewScene;
  appearance: "auto" | "light" | "dark";
  backgroundImage: string;
  backgroundPosition: string;
  safeArea: string;
  taskMode: string;
  customProperties: Record<string, string>;
}

export function filterMarketThemes(
  themes: DreamSkinMarketTheme[],
  { query = "", tag = "" }: { query?: string; tag?: string } = {},
): DreamSkinMarketTheme[] {
  const q = query.trim().toLowerCase();
  return themes.filter((theme) => {
    const matchesQuery =
      !q ||
      theme.name.toLowerCase().includes(q) ||
      theme.author.toLowerCase().includes(q) ||
      theme.description.toLowerCase().includes(q) ||
      theme.tags.some((t) => t.toLowerCase().includes(q));
    const matchesTag = !tag || theme.tags.includes(tag);
    return matchesQuery && matchesTag;
  });
}

export function themeToDraft(detail: DreamSkinThemeDetail): DreamSkinDraft {
  return {
    id: detail.id,
    name: detail.name,
    stylePreset: detail.stylePreset,
    appearance: detail.appearance,
    brandSubtitle: detail.brandSubtitle,
    tagline: detail.tagline,
    projectPrefix: detail.projectPrefix,
    projectLabel: detail.projectLabel,
    statusText: detail.statusText,
    quote: detail.quote,
    art: { ...detail.art },
    colors: { ...detail.colors },
    imageUrl: detail.imageUrl,
  };
}

export function draftToSaveInput(draft: DreamSkinDraft): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: draft.id,
    name: draft.name,
    stylePreset: draft.stylePreset,
    appearance: draft.appearance,
    brandSubtitle: draft.brandSubtitle,
    tagline: draft.tagline,
    projectPrefix: draft.projectPrefix,
    projectLabel: draft.projectLabel,
    statusText: draft.statusText,
    quote: draft.quote,
    art: {
      focusX: draft.art.focusX,
      focusY: draft.art.focusY,
      safeArea: draft.art.safeArea,
      taskMode: draft.art.taskMode,
    },
    colors: { ...draft.colors },
  };
}

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
] as const;

export function previewStyleModel(
  draft: DreamSkinDraft,
  scene: DreamSkinPreviewScene,
  panelAppearance: "auto" | "light" | "dark",
): DreamSkinPreviewStyle {
  const appearance = panelAppearance === "auto" ? "dark" : panelAppearance;
  const focusX = Math.round((draft.art.focusX ?? 0.5) * 100);
  const focusY = Math.round((draft.art.focusY ?? 0.5) * 100);

  const customProperties: Record<string, string> = {};
  for (const key of COLOR_KEYS) {
    customProperties[`--ds-color-${key}`] = draft.colors[key] || "";
  }
  customProperties["--ds-image-position"] = `${focusX}% ${focusY}%`;

  return {
    scene,
    appearance,
    backgroundImage: draft.imageUrl ? `url(${draft.imageUrl})` : "none",
    backgroundPosition: `${focusX}% ${focusY}%`,
    safeArea: draft.art.safeArea,
    taskMode: draft.art.taskMode,
    customProperties,
  };
}
