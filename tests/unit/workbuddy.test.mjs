import test from "node:test";
import assert from "node:assert/strict";
import { getStatus, resolveBinary, checkHealth, DEFAULT_WORKBUDDY_PORT } from "../../lib/workbuddy/supervisor.mjs";
import { routeWorkbuddyRequest } from "../../lib/workbuddy/routes.mjs";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("supervisor resolves uv and workbuddy2api binaries", () => {
  const uvBin = resolveBinary("uv");
  assert.ok(uvBin, "uv binary should be resolved");
  const wbBin = resolveBinary("workbuddy2api");
  assert.ok(wbBin, "workbuddy2api binary should be resolved");
});

test("resolveBinary detects Windows executable extensions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workbuddy-bin-"));
  try {
    const bin = path.join(dir, "workbuddy2api.exe");
    fs.writeFileSync(bin, "", "utf8");
    assert.equal(resolveBinary("workbuddy2api", {
      platform: "win32",
      home: dir,
      pathValue: dir,
    }), bin);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("getStatus returns comprehensive environment report", async () => {
  const status = await getStatus({ port: DEFAULT_WORKBUDDY_PORT });
  assert.equal(typeof status.uv_installed, "boolean");
  assert.equal(typeof status.installed, "boolean");
  assert.equal(typeof status.running, "boolean");
  assert.equal(typeof status.port, "number");
  assert.equal(status.port, DEFAULT_WORKBUDDY_PORT);
  assert.equal(typeof status.has_session, "boolean");
  assert.ok(status.session_path.includes(".codebuddy-session.json"));
});

test("routeWorkbuddyRequest handles GET /v1/workbuddy/status", async () => {
  const req = new EventEmitter();
  req.method = "GET";
  req.url = "/v1/workbuddy/status";

  let statusCode = null;
  let headers = null;
  let responseData = "";

  const res = {
    writeHead(code, h) {
      statusCode = code;
      headers = h;
    },
    end(data) {
      responseData = data;
    },
  };

  await routeWorkbuddyRequest(req, res, {}, "/v1/workbuddy/status");

  assert.equal(statusCode, 200);
  assert.match(headers["Content-Type"], /application\/json/);
  const parsed = JSON.parse(responseData);
  assert.equal(parsed.success, true);
  assert.equal(typeof parsed.installed, "boolean");
});

test("routeWorkbuddyRequest returns 404 for unknown subpath", async () => {
  const req = new EventEmitter();
  req.method = "GET";

  let statusCode = null;
  const res = {
    writeHead(code) {
      statusCode = code;
    },
    end() {},
  };

  await routeWorkbuddyRequest(req, res, {}, "/v1/workbuddy/non-existent");
  assert.equal(statusCode, 404);
});
