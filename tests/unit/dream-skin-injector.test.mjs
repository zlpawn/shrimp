import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadTheme } from "../../lib/dream-skin/injector.mjs";

test("loadTheme supports the initial Shrimp backgroundImage field", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dream-skin-theme-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(path.join(dir, "background.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const themePath = path.join(dir, "theme.json");
  writeFileSync(themePath, JSON.stringify({
    id: "legacy-theme",
    backgroundImage: "background.png",
  }));

  const result = loadTheme(themePath);
  assert.equal(result.theme.image, "background.png");
  assert.match(result.backgroundDataUri, /^data:image\/png;base64,/);
});
