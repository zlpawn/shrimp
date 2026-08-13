import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("dream-skin module registers tab and renders three views", () => {
  const source = fs.readFileSync("desktop/src/modules/dream-skin.ts", "utf8");
  assert.match(source, /registerTab\("dream-skin"/);
  assert.match(source, /activeView: "local" \| "market" \| "editor"/);
  assert.match(source, /本地主题/);
  assert.match(source, /主题市场/);
  assert.match(source, /主题编辑器/);
});

test("dream-skin module escapes external strings", () => {
  const source = fs.readFileSync("desktop/src/modules/dream-skin.ts", "utf8");
  // theme name, author, description, tags are escaped via escapeHtml
  const escapeUses = (source.match(/escapeHtml\(/g) || []).length;
  assert.ok(escapeUses >= 8, `expected many escapeHtml calls, got ${escapeUses}`);
});

test("dream-skin panel exposes codex path settings", () => {
  const source = fs.readFileSync("desktop/src/modules/dream-skin.ts", "utf8");
  assert.match(source, /codexAppPath/);
  assert.match(source, /save-codex-path/);
  assert.match(source, /saveConfig\(/);
  assert.match(source, /getConfig\(\)/);
});

test("dream-skin module calls apply API but keeps runtime details out", () => {
  const source = fs.readFileSync("desktop/src/modules/dream-skin.ts", "utf8");
  // UI delegates runtime work to the backend via applyDreamSkinTheme
  assert.match(source, /applyDreamSkinTheme\(/);
  assert.match(source, /应用到 Codex/);
  // Restart is opt-in through window.confirm, never automatic
  assert.match(source, /window\.confirm/);
  assert.match(source, /applyDreamSkinTheme\(id, \{ restart: true \}\)/);
  // Restart is opt-in through window.confirm, never automatic
  assert.match(source, /window\.confirm/);
  assert.match(source, /applyDreamSkinTheme\(id, \{ restart: true \}\)/);
  // Raw CDP/WebSocket/launcher details stay out of the panel module
  assert.doesNotMatch(source, /renderer-inject/);
  assert.doesNotMatch(source, /Runtime\.evaluate/);
  assert.doesNotMatch(source, /new WebSocket/);
  assert.doesNotMatch(source, /\/v1\/dream-skin\/runtime/);
  assert.doesNotMatch(source, /启动 Codex/);
});

test("panel.css contains dream-skin scoped styles", () => {
  const css = fs.readFileSync("desktop/src/styles/panel.css", "utf8");
  for (const cls of [
    ".dream-skin-root",
    ".dream-skin-grid",
    ".dream-skin-card",
    ".dream-skin-editor",
    ".dream-skin-workspace-preview",
  ]) {
    assert.ok(css.includes(cls), `${cls} should be styled`);
  }
});

test("panel.css has responsive breakpoints", () => {
  const css = fs.readFileSync("desktop/src/styles/panel.css", "utf8");
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?dream-skin-editor/);
  assert.match(css, /@media \(max-width: 390px\)/);
});