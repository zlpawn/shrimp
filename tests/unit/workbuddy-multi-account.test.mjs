import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import {
  resolveSessionFile,
  resolvePidFile,
  resolveLogFile,
  readSessionInfo,
  DEFAULT_WORKBUDDY_PORT,
  DEFAULT_SESSION_FILE,
  DEFAULT_PID_FILE,
  DEFAULT_LOG_FILE,
} from "../../lib/workbuddy/supervisor.mjs";
import { routeWorkbuddyRequest } from "../../lib/workbuddy/routes.mjs";

test("multi-account path resolution isolates port 7863 and port 7864", () => {
  // Default port 7863 uses backward-compatible legacy paths
  const session7863 = resolveSessionFile(7863);
  assert.equal(session7863, DEFAULT_SESSION_FILE);
  const pid7863 = resolvePidFile(7863);
  assert.equal(pid7863, DEFAULT_PID_FILE);
  const log7863 = resolveLogFile(7863);
  assert.equal(log7863, DEFAULT_LOG_FILE);

  // Secondary port 7864 uses isolated session/pid/log files
  const session7864 = resolveSessionFile(7864);
  assert.ok(session7864.endsWith("sessions/session-7864.json"));
  assert.notEqual(session7864, session7863);

  const pid7864 = resolvePidFile(7864);
  assert.ok(pid7864.endsWith("supervisor-7864.pid"));
  assert.notEqual(pid7864, pid7863);

  const log7864 = resolveLogFile(7864);
  assert.ok(log7864.endsWith("supervisor-7864.log"));
  assert.notEqual(log7864, log7863);
});

test("readSessionInfo handles custom session file per account node", () => {
  const tmpDir = path.join(os.tmpdir(), "wb-session-test-" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const customSessionFile = path.join(tmpDir, "session-7864.json");

  try {
    // Non-existent file
    const missing = readSessionInfo(customSessionFile);
    assert.equal(missing.authenticated, false);
    assert.equal(missing.reason, "session_file_missing");

    // Write valid mock session
    fs.writeFileSync(
      customSessionFile,
      JSON.stringify({
        auth: { accessToken: "mock-token-acc-2", expiresAt: Math.floor(Date.now() / 1000) + 3600 },
        account: { uid: "acc_2_uid", nickname: "Account 2" },
      })
    );

    const valid = readSessionInfo(customSessionFile);
    assert.equal(valid.authenticated, true);
    assert.equal(valid.user, "Account 2");
    assert.equal(valid.path, customSessionFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("routeWorkbuddyRequest parses port from query string in GET /v1/workbuddy/status?port=7864", async () => {
  const req = new EventEmitter();
  req.method = "GET";
  req.url = "/v1/workbuddy/status?port=7864";

  let statusCode = null;
  let responseData = "";

  const res = {
    writeHead(code) {
      statusCode = code;
    },
    end(data) {
      responseData = data;
    },
  };

  await routeWorkbuddyRequest(req, res, {}, "/v1/workbuddy/status");

  assert.equal(statusCode, 200);
  const parsed = JSON.parse(responseData);
  assert.equal(parsed.success, true);
  assert.equal(parsed.port, 7864);
  assert.ok(parsed.session_path.includes("session-7864.json"));
});
