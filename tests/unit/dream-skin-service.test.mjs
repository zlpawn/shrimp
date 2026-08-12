import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import { createDreamSkinService } from "../../lib/dream-skin/application/service.mjs";
import { resolveDreamSkinPaths } from "../../lib/dream-skin/paths.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const validTheme = {
  schemaVersion: 1,
  id: "aurora-night",
  name: "Aurora Night",
  stylePreset: "midnight-aurora",
  image: "background.png",
  appearance: "auto",
  art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "ambient" },
  colors: {
    background: "#111318", panel: "#181b22", panelAlt: "#20242d",
    accent: "#8298a3", accentAlt: "#a8c0ca", secondary: "#6f8791",
    highlight: "#bfd4dc", text: "#edf2f4", muted: "#a4afb5",
    line: "rgba(130, 152, 163, 0.28)",
  },
};

function makeService() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-svc-"));
  const paths = resolveDreamSkinPaths({ configFile: path.join(tmpDir, "gw.json") });

  // Fake request adapter
  const fakeRequest = async (url) => {
    throw new DreamSkinError("market_unavailable", "no network in tests");
  };

  const service = createDreamSkinService({
    paths,
    requestBinary: fakeRequest,
    logger: { warn() {}, log() {} },
  });

  return { service, cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
}

test("getCapabilities returns all-false flags", () => {
  const { service, cleanup } = makeService();
  try {
    const caps = service.getCapabilities();
    assert.deepEqual(caps, {
      packageImport: false,
      customCss: false,
      communityPublishing: false,
      codexRuntime: false,
    });
  } finally {
    cleanup();
  }
});

test("service initializes and lists builtin theme", async () => {
  const { service, cleanup } = makeService();
  try {
    await service.initialize();
    const list = await service.listThemes();
    assert.equal(list.themes.length, 1);
    assert.equal(list.themes[0].id, "shrimp-default");
  } finally {
    cleanup();
  }
});

test("service createTheme creates a stored theme", async () => {
  const { service, cleanup } = makeService();
  try {
    await service.initialize();
    const summary = await service.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    assert.equal(summary.id, "aurora-night");
    assert.equal(summary.kind, "stored");
  } finally {
    cleanup();
  }
});

test("service importTheme rejects CSS field", async () => {
  const { service, cleanup } = makeService();
  try {
    await service.initialize();
    await assert.rejects(
      service.importTheme({ theme: { ...validTheme, css: "body{}" }, imageBytes: PNG_BYTES }),
      (err) => err instanceof DreamSkinError && err.code === "unsupported_feature",
    );
  } finally {
    cleanup();
  }
});

test("service importTheme rejects JavaScript field", async () => {
  const { service, cleanup } = makeService();
  try {
    await service.initialize();
    await assert.rejects(
      service.importTheme({ theme: { ...validTheme, javascript: "alert(1)" }, imageBytes: PNG_BYTES }),
      (err) => err instanceof DreamSkinError,
    );
  } finally {
    cleanup();
  }
});

test("service getThemeImage returns bytes and mime", async () => {
  const { service, cleanup } = makeService();
  try {
    await service.initialize();
    await service.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const img = await service.getThemeImage("aurora-night");
    assert.ok(img.bytes);
    assert.equal(img.mime, "image/png");
  } finally {
    cleanup();
  }
});

test("service getThemeImage throws for builtin (no image)", async () => {
  const { service, cleanup } = makeService();
  try {
    await service.initialize();
    await assert.rejects(
      service.getThemeImage("shrimp-default"),
      (err) => err instanceof DreamSkinError,
    );
  } finally {
    cleanup();
  }
});

test("service deleteTheme removes theme", async () => {
  const { service, cleanup } = makeService();
  try {
    await service.initialize();
    await service.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    await service.deleteTheme("aurora-night");
    const list = await service.listThemes();
    assert.equal(list.themes.length, 1);
  } finally {
    cleanup();
  }
});

test("service selectTheme changes selection", async () => {
  const { service, cleanup } = makeService();
  try {
    await service.initialize();
    await service.createTheme({ theme: validTheme, imageBytes: PNG_BYTES });
    const result = await service.selectTheme("aurora-night");
    assert.equal(result.selectedThemeId, "aurora-night");
  } finally {
    cleanup();
  }
});

test("service has no apply/launch/inject/runtime methods", () => {
  const { service, cleanup } = makeService();
  try {
    assert.equal(typeof service.apply, "undefined");
    assert.equal(typeof service.launch, "undefined");
    assert.equal(typeof service.inject, "undefined");
    assert.equal(typeof service.runtime, "undefined");
  } finally {
    cleanup();
  }
});