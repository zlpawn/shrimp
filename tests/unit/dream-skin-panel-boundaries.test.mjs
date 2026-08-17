import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const panel = fs.readFileSync("desktop/src/modules/dream-skin.ts", "utf8");
const html = fs.readFileSync("desktop/index.html", "utf8");
const css = fs.readFileSync("desktop/src/styles/panel.css", "utf8");
const app = fs.readFileSync("desktop/src/app.ts", "utf8");

test("panel has apply-to-Codex entry and no raw runtime implementation", () => {
  const sources = panel + html;
  // The panel now exposes an explicit apply action, but must not implement
  // CDP/WebSocket/launcher details itself.
  assert.match(sources, /应用到 Codex/);
  assert.match(panel, /data-action="apply"/);
  assert.match(panel, /applyDreamSkinTheme\(/);
  for (const re of [/Runtime\.evaluate/, /renderer-inject/, /new WebSocket/, /\/v1\/dream-skin\/(launch|inject|runtime|community|packages)/]) {
    assert.doesNotMatch(sources, re, `forbidden pattern ${re}`);
  }
});

test("no unescaped external-text interpolation in panel", () => {
  assert.doesNotMatch(panel, /innerHTML\s*=.*\$\{(?:theme|author|description|tagline|quote)\./);
  // All interpolations of external values go through escapeHtml
  const uses = (panel.match(/escapeHtml\(/g) || []).length;
  assert.ok(uses >= 8);
});

test("no direct remote theme asset URLs in panel", () => {
  assert.doesNotMatch(panel, /https?:\/\/.*(?:preview|theme|image)/);
  assert.doesNotMatch(fs.readFileSync("desktop/src/core/api.ts", "utf8"), /https?:\/\/.*(?:preview|theme|image)/);
});

test("app.ts changes stay minimal: lifecycle only", () => {
  // app.ts must not contain Dream Skin implementation
  assert.doesNotMatch(app, /renderLocalView|renderMarketView|renderEditorView|dreamSkinPanel/);
});

test("section-dream-skin exists with runtime copy", () => {
  assert.match(html, /id="section-dream-skin"/);
  assert.match(html, /id="dream-skin-root"/);
  assert.match(html, /主题皮肤/);
});

test("panel.css has no oversized card radius", () => {
  const dreamSection = css.split("/* --- Dream Skin panel --- */")[1] || "";
  const dreamCss = dreamSection.split(/\/\* ---|\/\* Remote Session|\/\* Command Apps|\/\* Session Kanban/)[0] || "";
  const radii = [...dreamCss.matchAll(/border-radius:\s*([\d.]+)px/g)].map((m) => parseFloat(m[1]));
  assert.ok(radii.every((r) => r <= 8), `radius too large: ${Math.max(...radii)}`);
});