import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDreamSkinService } from "../../lib/dream-skin/application/service.mjs";
import { routeDreamSkinRequest } from "../../lib/dream-skin/http/routes.mjs";
import { resolveDreamSkinPaths } from "../../lib/dream-skin/paths.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PNG_BASE64 = PNG_BYTES.toString("base64");

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

function makeReq(method, reqPath, body) {
  const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  return {
    method,
    url: reqPath,
    headers: {},
    on(event, handler) {
      if (event === "data" && bodyBuf.length > 0) handler(bodyBuf);
      if (event === "end") setTimeout(handler, 0);
    },
    destroy() {},
  };
}

function makeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      if (headers) this.headers = headers;
    },
    end(data) {
      this.body = data;
    },
  };
  return res;
}

function makeApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-api-"));
  const paths = resolveDreamSkinPaths({ configFile: path.join(tmpDir, "gw.json") });

  const marketThemeJson = JSON.stringify({
    schemaVersion: 1,
    id: "market-theme",
    name: "Market Theme",
    stylePreset: "glass-vision",
    image: "background.png",
    appearance: "auto",
    art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "ambient" },
    colors: {
      background: "#000000", panel: "#111111", panelAlt: "#222222",
      accent: "#ffffff", accentAlt: "#eeeeee", secondary: "#cccccc",
      highlight: "#dddddd", text: "#ffffff", muted: "#aaaaaa",
      line: "rgba(255,255,255,0.2)",
    },
  });

  const marketIndex = {
    schemaVersion: 1,
    updatedAt: "2026-08-11T00:00:00Z",
    themes: [{
      id: "market-theme",
      name: "Market Theme",
      version: "1.0.0",
      author: "Community",
      description: "A market theme",
      license: "MIT",
      sourceUrl: "https://example.com/theme",
      tags: ["dark"],
      theme: "themes/market-theme/theme.json",
      image: "themes/market-theme/background.png",
      preview: "themes/market-theme/preview.png",
      themeSha256: crypto.createHash("sha256").update(marketThemeJson).digest("hex"),
      imageSha256: crypto.createHash("sha256").update(PNG_BYTES).digest("hex"),
    }],
  };

  const service = createDreamSkinService({
    paths,
    logger: { warn() {}, log() {} },
    requestBinary: async (url) => {
      if (url.includes("index.json")) {
        return { bytes: Buffer.from(JSON.stringify(marketIndex)), finalUrl: url, status: 200, headers: {} };
      }
      if (url.includes("theme.json")) {
        return { bytes: Buffer.from(marketThemeJson), finalUrl: url, status: 200, headers: {} };
      }
      if (url.includes("background") || url.includes("preview")) {
        return { bytes: PNG_BYTES, finalUrl: url, status: 200, headers: {} };
      }
      throw new DreamSkinError("market_unavailable", `not found: ${url}`);
    },
  });

  const call = async (method, reqPath, body) => {
    const req = makeReq(method, reqPath, body);
    const res = makeRes();
    await routeDreamSkinRequest(req, res, {}, reqPath, { service });
    return res;
  };

  return {
    service, call, paths,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

test("integration: capabilities returns all-false", async () => {
  const app = makeApp();
  try {
    await app.service.initialize();
    const res = await app.call("GET", "/v1/dream-skin/capabilities");
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body, {
      packageImport: false, customCss: false,
      communityPublishing: false, codexRuntime: false,
    });
  } finally {
    app.cleanup();
  }
});

test("integration: local theme CRUD flow", async () => {
  const app = makeApp();
  try {
    await app.service.initialize();

    const createRes = await app.call("POST", "/v1/dream-skin/themes", {
      theme: validTheme,
      image: { name: "background.png", dataBase64: PNG_BASE64 },
    });
    assert.equal(createRes.statusCode, 201);
    const created = JSON.parse(createRes.body);
    assert.equal(created.id, "aurora-night");

    const listRes = await app.call("GET", "/v1/dream-skin/themes");
    assert.equal(listRes.statusCode, 200);
    const list = JSON.parse(listRes.body);
    assert.ok(list.themes.some((t) => t.id === "aurora-night"));

    const detailRes = await app.call("GET", "/v1/dream-skin/themes/aurora-night");
    assert.equal(detailRes.statusCode, 200);

    const imageRes = await app.call("GET", "/v1/dream-skin/themes/aurora-night/image");
    assert.equal(imageRes.statusCode, 200);
    assert.equal(imageRes.headers["Content-Type"], "image/png");

    const selectRes = await app.call("POST", "/v1/dream-skin/themes/aurora-night/select");
    assert.equal(selectRes.statusCode, 200);
    const selected = JSON.parse(selectRes.body);
    assert.equal(selected.selectedThemeId, "aurora-night");

    const dupRes = await app.call("POST", "/v1/dream-skin/themes/aurora-night/duplicate", { name: "Copy" });
    assert.equal(dupRes.statusCode, 201);

    await app.call("POST", "/v1/dream-skin/themes/shrimp-default/select");
    const delRes = await app.call("DELETE", "/v1/dream-skin/themes/aurora-night");
    assert.equal(delRes.statusCode, 204);
  } finally {
    app.cleanup();
  }
});

test("integration: import rejects CSS field", async () => {
  const app = makeApp();
  try {
    await app.service.initialize();
    const res = await app.call("POST", "/v1/dream-skin/import", {
      theme: { ...validTheme, css: "body{}" },
      image: { name: "background.png", dataBase64: PNG_BASE64 },
    });
    assert.equal(res.statusCode, 501);
    const body = JSON.parse(res.body);
    assert.equal(body.error.type, "unsupported_feature");
  } finally {
    app.cleanup();
  }
});

test("integration: market online list and install", async () => {
  const app = makeApp();
  try {
    await app.service.initialize();

    const marketRes = await app.call("GET", "/v1/dream-skin/market");
    assert.equal(marketRes.statusCode, 200);
    const market = JSON.parse(marketRes.body);
    assert.equal(market.themes.length, 1);
    assert.equal(market.themes[0].id, "market-theme");
    assert.equal(market.cached, false);

    const installRes = await app.call("POST", "/v1/dream-skin/market/themes/market-theme/install");
    assert.equal(installRes.statusCode, 201);

    const listRes = await app.call("GET", "/v1/dream-skin/themes");
    const list = JSON.parse(listRes.body);
    assert.ok(list.themes.some((t) => t.id === "market-theme"));

    const previewRes = await app.call("GET", "/v1/dream-skin/market/themes/market-theme/preview");
    assert.equal(previewRes.statusCode, 200);
    assert.equal(previewRes.headers["Content-Type"], "image/png");
  } finally {
    app.cleanup();
  }
});

test("integration: forbidden routes return 404", async () => {
  const app = makeApp();
  try {
    await app.service.initialize();
    for (const route of [
      "/v1/dream-skin/apply",
      "/v1/dream-skin/launch",
      "/v1/dream-skin/inject",
      "/v1/dream-skin/runtime/status",
      "/v1/dream-skin/community/themes",
      "/v1/dream-skin/packages/import",
    ]) {
      const res = await app.call("POST", route);
      assert.equal(res.statusCode, 404, `${route} should be 404`);
    }
  } finally {
    app.cleanup();
  }
});

test("integration: errors use standard envelope without path leakage", async () => {
  const app = makeApp();
  try {
    await app.service.initialize();
    const res = await app.call("GET", "/v1/dream-skin/themes/does-not-exist");
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.error.type, "theme_not_found");
    const serialized = res.body;
    assert.ok(!serialized.includes("C:\\"));
    assert.ok(!serialized.includes(os.tmpdir()));
  } finally {
    app.cleanup();
  }
});