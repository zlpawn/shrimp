import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDreamSkinService } from "../../lib/dream-skin/application/service.mjs";
import { routeDreamSkinRequest } from "../../lib/dream-skin/http/routes.mjs";
import { resolveDreamSkinPaths } from "../../lib/dream-skin/paths.mjs";

const PNG = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00]);
function makeReq(method, reqPath, body) {
  const buf = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  return { method, url: reqPath, headers: {},
    on(ev, h) { if (ev === "data" && buf.length) h(buf); if (ev === "end") setTimeout(h, 0); },
    destroy() {} };
}
function makeRes() {
  return { statusCode: null, headers: {}, body: null,
    writeHead(s, h) { this.statusCode = s; if (h) this.headers = h; },
    end(d) { this.body = d; } };
}

test("first HTTP create works without explicit service.initialize (server.js path)", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-first-"));
  const paths = resolveDreamSkinPaths({ configFile: path.join(tmpDir, "gw.json") });
  const service = createDreamSkinService({ paths, logger: { warn() {}, log() {} } });
  // NO initialize() — mimics server.js which never calls it
  const theme = { schemaVersion: 1, id: "first-theme", name: "First", stylePreset: "", appearance: "auto",
    art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "ambient" },
    colors: { background:"#111318",panel:"#181b22",panelAlt:"#20242d",accent:"#8298a3",accentAlt:"#a8c0ca",secondary:"#6f8791",highlight:"#bfd4dc",text:"#edf2f4",muted:"#a4afb5",line:"rgba(130,152,163,0.28)" } };
  const req = makeReq("POST", "/v1/dream-skin/themes", { theme, image: { name: "bg.png", dataBase64: PNG.toString("base64") } });
  const res = makeRes();
  await routeDreamSkinRequest(req, res, {}, "/v1/dream-skin/themes", { service });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});