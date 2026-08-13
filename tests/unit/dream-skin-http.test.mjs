import assert from "node:assert/strict";
import test from "node:test";

import { routeDreamSkinRequest, sendDreamSkinError, readJsonBody } from "../../lib/dream-skin/http/routes.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

// Fake request/response objects
function makeReq(method, path, body) {
  const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  return {
    method,
    url: path,
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

// Fake service
function makeFakeService() {
  const themes = new Map();
  return {
    getCapabilities: () => ({
      packageImport: false, customCss: false,
      communityPublishing: false, codexRuntime: false,
    }),
    async listThemes() {
      return { selectedThemeId: "shrimp-default", themes: [...themes.values()], invalidEntries: 0, warnings: [] };
    },
    async getTheme(id) {
      if (!themes.has(id)) throw new DreamSkinError("theme_not_found", "not found");
      return { theme: themes.get(id), kind: "stored", imageBytes: Buffer.from([0x89, 0x50]), imageFormat: { mime: "image/png", extension: "png" } };
    },
    async getThemeImage(id) {
      return { bytes: Buffer.from([0x89, 0x50]), mime: "image/png" };
    },
    async createTheme({ theme, imageBytes }) {
      themes.set(theme.id, theme);
      return { id: theme.id, name: theme.name, kind: "stored", builtin: false, selected: false, stylePreset: theme.stylePreset, appearance: theme.appearance, imageUrl: `/v1/dream-skin/themes/${theme.id}/image` };
    },
    async updateTheme(id, input) {
      themes.set(id, input.theme);
      return { id, name: input.theme.name, kind: "stored", builtin: false, selected: false, stylePreset: "", appearance: "auto", imageUrl: "" };
    },
    async duplicateTheme(id, input) {
      return { id: "copy", name: "Copy", kind: "stored", builtin: false, selected: false, stylePreset: "", appearance: "auto", imageUrl: "" };
    },
    async selectTheme(id) {
      return { selectedThemeId: id, themes: [], invalidEntries: 0, warnings: [] };
    },
    async deleteTheme(id) {},
    async importTheme(input) {
      return { id: input.theme.id, name: input.theme.name, kind: "stored", builtin: false, selected: false, stylePreset: "", appearance: "auto", imageUrl: "" };
    },
    async loadMarket() {
      return { themes: [], updatedAt: "2026-01-01", cached: false, warning: null };
    },
    async installMarketTheme(id) {
      return { id, name: "Market", kind: "stored", builtin: false, selected: false, stylePreset: "", appearance: "auto", imageUrl: "" };
    },
    async updateMarketTheme(id) {
      return { id, name: "Market", kind: "stored", builtin: false, selected: false, stylePreset: "", appearance: "auto", imageUrl: "" };
    },
    async probeCodex() {
      return { available: true, codexRuntime: true, targets: [] };
    },
    async applyTheme(id, { restart = false } = {}) {
      return { ok: true, kind: "existing", target: "Codex", debugPort: 19222, restart };
    },
    async getMarketPreview(id) {
      return { bytes: Buffer.from([0x89, 0x50]), mime: "image/png", etag: "abc123" };
    },
  };
}

test("GET /capabilities returns capabilities", async () => {
  const req = makeReq("GET", "/v1/dream-skin/capabilities");
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/capabilities", { service: makeFakeService() });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.codexRuntime, false);
});

test("GET /themes returns theme list", async () => {
  const req = makeReq("GET", "/v1/dream-skin/themes");
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/themes", { service: makeFakeService() });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body.themes));
});

test("POST /themes creates a theme", async () => {
  const req = makeReq("POST", "/v1/dream-skin/themes", {
    theme: { id: "test", name: "Test", schemaVersion: 1, stylePreset: "", appearance: "auto" },
    image: { name: "bg.png", dataBase64: "iVBORw0KGgo=" },
  });
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/themes", { service: makeFakeService() });
  assert.equal(res.statusCode, 201);
});

test("POST /themes without image throws invalid_image", async () => {
  const req = makeReq("POST", "/v1/dream-skin/themes", {
    theme: { id: "test", name: "Test" },
  });
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/themes", { service: makeFakeService() });
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.error.type, "invalid_image");
});

test("DELETE /themes/:id returns 204", async () => {
  const req = makeReq("DELETE", "/v1/dream-skin/themes/test");
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/themes/test", { service: makeFakeService() });
  assert.equal(res.statusCode, 204);
});

test("POST /themes/:id/select selects theme", async () => {
  const req = makeReq("POST", "/v1/dream-skin/themes/aurora/select");
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/themes/aurora/select", { service: makeFakeService() });
  assert.equal(res.statusCode, 200);
});

test("GET /probe returns runtime status", async () => {
  const req = makeReq("GET", "/v1/dream-skin/probe");
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/probe", { service: makeFakeService() });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.available, true);
  assert.equal(body.codexRuntime, true);
});

test("POST /themes/:id/apply applies theme to Codex", async () => {
  const req = makeReq("POST", "/v1/dream-skin/themes/aurora/apply");
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/themes/aurora/apply", { service: makeFakeService() });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.restart, false);
});

test("POST /themes/:id/apply?restart=1 passes restart flag", async () => {
  const req = makeReq("POST", "/v1/dream-skin/themes/aurora/apply?restart=1");
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/themes/aurora/apply?restart=1", { service: makeFakeService() });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.restart, true);
});

test("GET /market returns market list", async () => {
  const req = makeReq("GET", "/v1/dream-skin/market");
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/market", { service: makeFakeService() });
  assert.equal(res.statusCode, 200);
});

test("POST /market/themes/:id/install installs theme", async () => {
  const req = makeReq("POST", "/v1/dream-skin/market/themes/aurora/install");
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/market/themes/aurora/install", { service: makeFakeService() });
  assert.equal(res.statusCode, 201);
});

test("forbidden routes return 404", async () => {
  for (const route of ["/v1/dream-skin/apply", "/v1/dream-skin/launch", "/v1/dream-skin/inject", "/v1/dream-skin/runtime/foo", "/v1/dream-skin/community/foo", "/v1/dream-skin/packages/foo"]) {
    const req = makeReq("POST", route);
    const res = makeRes();
    await routeDreamSkinRequest(req, res, {}, route, { service: makeFakeService() });
    assert.equal(res.statusCode, 404, `${route} should return 404`);
  }
});

test("unknown route returns 404", async () => {
  const req = makeReq("GET", "/v1/dream-skin/unknown");
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/unknown", { service: makeFakeService() });
  assert.equal(res.statusCode, 404);
});

test("DreamSkinError maps to correct HTTP status", () => {
  const res = makeRes();
  sendDreamSkinError(res, new DreamSkinError("theme_not_found", "not found"));
  assert.equal(res.statusCode, 404);

  const res2 = makeRes();
  sendDreamSkinError(res2, new DreamSkinError("theme_already_exists", "exists"));
  assert.equal(res2.statusCode, 409);

  const res3 = makeRes();
  sendDreamSkinError(res3, new DreamSkinError("market_unavailable", "down"));
  assert.equal(res3.statusCode, 503);
});

test("error response includes details when present", () => {
  const res = makeRes();
  const err = new DreamSkinError("invalid_theme", "bad", {
    details: [{ field: "name", code: "required" }],
  });
  sendDreamSkinError(res, err);
  const body = JSON.parse(res.body);
  assert.ok(body.error.details);
  assert.equal(body.error.details[0].field, "name");
});

test("runtime restart/inject errors map to explicit status codes", async () => {
  const { sendDreamSkinError } = await import("../../lib/dream-skin/http/routes.mjs");
  const { DreamSkinError } = await import("../../lib/dream-skin/domain/errors.mjs");

  function capture(error) {
    let status = null;
    let body = null;
    const res = {
      writeHead(code) { status = code; },
      end(payload) { body = JSON.parse(payload); },
    };
    sendDreamSkinError(res, error);
    return { status, body };
  }

  const restart = capture(new DreamSkinError("runtime_restart_required", "need restart"));
  assert.equal(restart.status, 409);
  assert.equal(restart.body.error.type, "runtime_restart_required");

  const inject = capture(new DreamSkinError("runtime_inject_failed", "inject failed"));
  assert.equal(inject.status, 500);
  assert.equal(inject.body.error.type, "runtime_inject_failed");
});
