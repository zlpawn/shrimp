import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const panel = fs.readFileSync("desktop/src/modules/dream-skin.ts", "utf8");
const html = fs.readFileSync("desktop/index.html", "utf8");
const css = fs.readFileSync("desktop/src/styles/panel.css", "utf8");
const app = fs.readFileSync("desktop/src/app.ts", "utf8");

test("no runtime action UI in panel", () => {
  const sources = panel + html;
  const forbidden = [
    /应用到 Codex/,
    /启动 Codex/,
    /注入/,
    /Runtime\.evaluate/,
    /renderer-inject/,
    /new WebSocket/,
    /\/v1\/dream-skin\/(apply|launch|inject|runtime|community|packages)/,
  ];
  for (const re of forbidden) {
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

test("section-dream-skin exists with copy explaining no Codex application", () => {
  assert.match(html, /id="section-dream-skin"/);
  assert.match(html, /id="dream-skin-root"/);
  assert.match(html, /不会修改 Codex 桌面界面/);
});

test("panel.css has no oversized card radius", () => {
  const dreamCss = css.split("/* --- Dream Skin panel --- */")[1] || "";
  const radii = [...dreamCss.matchAll(/border-radius:\s*([\d.]+)px/g)].map((m) => parseFloat(m[1]));
  assert.ok(radii.every((r) => r <= 8), `radius too large: ${Math.max(...radii)}`);
});