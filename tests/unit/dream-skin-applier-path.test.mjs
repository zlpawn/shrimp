import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveWildcardPath,
  wildcardToRegExp,
} from "../../lib/dream-skin/runtime/applier.mjs";

test("wildcardToRegExp matches package folders", () => {
  const re = wildcardToRegExp("OpenAI.Codex_*");
  assert.equal(re.test("OpenAI.Codex_1.0.0.0_neutral__abc123"), true);
  assert.equal(re.test("OpenAI.ChatGPT-Desktop_1.0.0.0_neutral__abc123"), false);
});

test("resolveWildcardPath walks multi-segment Windows package paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dream-skin-win-"));
  try {
    const windowsApps = path.join(root, "WindowsApps");
    const packageName = "OpenAI.Codex_1.0.0.0_neutral__abc123";
    const packageDir = path.join(windowsApps, packageName);
    const appDir = path.join(packageDir, "app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "Codex.exe"), "x");

    // Also create an older package to ensure newest-ish sort preference still resolves a match.
    const older = path.join(windowsApps, "OpenAI.Codex_0.9.0.0_neutral__abc123", "app");
    fs.mkdirSync(older, { recursive: true });

    const pattern = path.join(windowsApps, "OpenAI.Codex_*", "app");
    const resolved = await resolveWildcardPath(pattern);
    assert.ok(resolved);
    assert.match(String(resolved).replace(/\\/g, "/"), /OpenAI\.Codex_1\.0\.0\.0_neutral__abc123\/app$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("createDreamSkinApplier uses configured codexAppPath by default", async () => {
  const { createDreamSkinApplier } = await import("../../lib/dream-skin/runtime/applier.mjs");
  const applier = createDreamSkinApplier({
    platform: "darwin",
    codexAppPath: "/Applications/Codex.app",
    exists: async (p) => p === "/Applications/Codex.app",
    spawn: async () => ({ pid: 1, on() {} }),
    spawnSync: async () => ({ stdout: "false" }),
    listTargets: async () => { throw new Error("down"); },
    waitForDebugEndpoint: async () => {},
    requestJson: async () => [],
  });
  const launcher = applier.launcher;
  const resolved = await launcher.resolveCodexAppPath("");
  assert.equal(resolved, "/Applications/Codex.app");
});
