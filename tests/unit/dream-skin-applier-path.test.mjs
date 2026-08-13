import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createDreamSkinApplier,
  resolveWildcardPath,
  supportsDreamSkinRuntime,
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

test("supportsDreamSkinRuntime only enables macOS and Windows", () => {
  assert.equal(supportsDreamSkinRuntime("darwin"), true);
  assert.equal(supportsDreamSkinRuntime("win32"), true);
  assert.equal(supportsDreamSkinRuntime("linux"), false);
});

test("createDreamSkinApplier replaces the previous new-document script for a target", async () => {
  const calls = [];
  let registration = 0;
  const target = {
    type: "page",
    title: "Codex",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:19222/devtools/page/codex",
  };
  const createSession = () => ({
    async connect() { calls.push(["connect"]); },
    async removeScriptFromNewDocuments(identifier) {
      calls.push(["remove", identifier]);
    },
    async addScriptToNewDocuments() {
      registration++;
      const identifier = `script-${registration}`;
      calls.push(["add", identifier]);
      return { identifier };
    },
    async evaluate() {
      calls.push(["evaluate"]);
      return { result: { value: true } };
    },
    close() { calls.push(["close"]); },
  });
  const applier = createDreamSkinApplier({
    platform: "darwin",
    requestJson: async () => [target],
    exists: async () => "/Applications/Codex.app",
    spawn: async () => ({ pid: 1, on() {} }),
    spawnSync: async () => ({ stdout: "false" }),
    createSession,
  });
  const themeJsonBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    id: "shrimp-default",
    name: "Shrimp Default",
    stylePreset: "",
    image: "",
    appearance: "auto",
    art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "ambient" },
    colors: {
      background: "#111318",
      panel: "#181b22",
      panelAlt: "#20242d",
      accent: "#8298a3",
      accentAlt: "#a8c0ca",
      secondary: "#6f8791",
      highlight: "#bfd4dc",
      text: "#edf2f4",
      muted: "#a4afb5",
      line: "rgba(130, 152, 163, 0.28)",
    },
  }));

  await applier.applyTheme({ themeJsonBytes });
  await applier.applyTheme({ themeJsonBytes });

  assert.deepEqual(
    calls.filter(([kind]) => kind === "add" || kind === "remove"),
    [["add", "script-1"], ["remove", "script-1"], ["add", "script-2"]],
  );
});
