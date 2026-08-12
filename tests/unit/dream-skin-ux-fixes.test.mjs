import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("dream-skin card buttons use theme text color", () => {
  const css = fs.readFileSync("desktop/src/styles/panel.css", "utf8");
  const block = css.split("/* --- Dream Skin panel --- */")[1] || "";
  assert.match(block, /\.dream-skin-card-actions \.btn \{[\s\S]*?color: var\(--text-primary\)/);
  assert.match(block, /\.dream-skin-card \{[\s\S]*?background: var\(--surface/);
});

test("dream-skin market loads automatically on entry and on view switch", () => {
  const ts = fs.readFileSync("desktop/src/modules/dream-skin.ts", "utf8");
  assert.match(ts, /loadDreamSkinMarket\(\)\.catch/);
  assert.match(ts, /state\.activeView === "market" && !state\.market/);
});