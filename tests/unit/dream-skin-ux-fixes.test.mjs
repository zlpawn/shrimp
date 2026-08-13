import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("dream-skin apply button uses brand tokens with contrast", () => {
  const css = fs.readFileSync("desktop/src/styles/panel.css", "utf8");
  const block = css.split("/* --- Dream Skin panel --- */")[1] || "";
  assert.doesNotMatch(block, /\.dream-skin-card-actions \.btn \{[^}]*color:/);
  assert.match(block, /\.dream-skin-apply-btn \{[^}]*background: var\(--brand-primary\)/);
  assert.match(block, /\.dream-skin-apply-btn \{[^}]*color: var\(--brand-text\)/);
  assert.match(block, /\.dream-skin-card \{[\s\S]*?background: var\(--surface/);
});

test("dream-skin market loads automatically on entry and on view switch", () => {
  const ts = fs.readFileSync("desktop/src/modules/dream-skin.ts", "utf8");
  assert.match(ts, /loadDreamSkinMarket\(\)\s*\.catch/);
  assert.match(ts, /state\.activeView === "market" && !state\.market/);
});