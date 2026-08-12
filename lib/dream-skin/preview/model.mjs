/**
 * Preview model: projects a validated theme into a controlled, safe
 * preview model for the web panel. No HTML, CSS rules, or scripts.
 */

export function buildPreviewModel(theme, { scene = "home" } = {}) {
  const appearance = theme.appearance === "auto" ? "dark" : theme.appearance;
  const focusX = Math.round((theme.art?.focusX ?? 0.5) * 100);
  const focusY = Math.round((theme.art?.focusY ?? 0.5) * 100);

  const colors = {};
  const colorKeys = [
    "background", "panel", "panelAlt", "accent", "accentAlt",
    "secondary", "highlight", "text", "muted", "line",
  ];
  for (const key of colorKeys) {
    colors[key] = theme.colors?.[key] ?? "";
  }

  return {
    scene,
    appearance,
    imageUrl: theme.image
      ? `/v1/dream-skin/themes/${encodeURIComponent(theme.id)}/image`
      : "",
    imagePosition: `${focusX}% ${focusY}%`,
    safeArea: theme.art?.safeArea ?? "auto",
    taskMode: theme.art?.taskMode ?? "ambient",
    colors,
    text: {
      brandSubtitle: theme.brandSubtitle ?? "",
      tagline: theme.tagline ?? "",
      projectPrefix: theme.projectPrefix ?? "",
      projectLabel: theme.projectLabel ?? "",
      statusText: theme.statusText ?? "",
      quote: theme.quote ?? "",
    },
  };
}