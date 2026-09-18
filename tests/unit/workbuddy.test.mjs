import test from "node:test";
import assert from "node:assert/strict";
import {
  checkHealth,
  DEFAULT_WORKBUDDY_PORT,
  getStatus,
  getActiveLoginState,
  openInBrowser,
  pollAndSaveSession,
  readSessionInfo,
  resolveBinary,
  resolveWorkbuddyBinary,
  checkLegacyCommands,
  cleanupLegacyCommands,
} from "../../lib/workbuddy/supervisor.mjs";
import { routeWorkbuddyRequest } from "../../lib/workbuddy/routes.mjs";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("supervisor resolves uv and workbuddy binaries", () => {
  const uvBin = resolveBinary("uv");
  assert.ok(uvBin, "uv binary should be resolved");
  const wb = resolveWorkbuddyBinary();
  assert.ok(wb.binaryPath, "workbuddy binary should be resolved");
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

test("readSessionInfo accepts millisecond expiry timestamps from current auth API", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workbuddy-session-"));
  const sessionFile = path.join(dir, "session.json");
  try {
    const futureMs = Date.now() + 60 * 60 * 1000;
    fs.writeFileSync(sessionFile, JSON.stringify({
      auth: { accessToken: "token", expiresAt: futureMs },
      account: { uid: "user-1", nickname: "Test User" },
    }));
    const info = readSessionInfo(sessionFile);
    assert.equal(info.authenticated, true);
    assert.equal(info.isExpired, false);
    assert.equal(info.expiresAt, futureMs);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readSessionInfo marks expired millisecond sessions as expired", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workbuddy-session-"));
  const sessionFile = path.join(dir, "session.json");
  try {
    const expiredMs = Date.now() - 60 * 60 * 1000;
    fs.writeFileSync(sessionFile, JSON.stringify({
      auth: { accessToken: "token", expiresAt: expiredMs },
      account: { uid: "user-1" },
    }));
    const info = readSessionInfo(sessionFile);
    assert.equal(info.authenticated, false);
    assert.equal(info.isExpired, true);
    assert.equal(info.expiresAt, expiredMs);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("openInBrowser launches Windows default browser without a console window", () => {
  const calls = [];
  openInBrowser("https://www.workbuddy.ai/login?platform=VSCode&state=state-1", {
    platform: "win32",
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { unref() {} };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "rundll32");
  assert.deepEqual(calls[0].args, ["url.dll,FileProtocolHandler", "https://www.workbuddy.ai/login?platform=VSCode&state=state-1"]);
  assert.equal(calls[0].options.windowsHide, true);
});

test("pollAndSaveSession writes token when account data is unavailable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workbuddy-login-"));
  const sessionFile = path.join(dir, "session.json");
  const state = `login-state-${Date.now()}`;
  try {
    const record = pollAndSaveSession({
      state,
      endpoint: "https://login.invalid",
      sessionFile,
      authDir: path.join(dir, "auths"),
      timeoutMs: 100,
      accountTimeoutMs: 10,
      stopImpl: async () => ({}),
      startImpl: async () => ({}),
      sleepImpl: async () => {},
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            accessToken: "access-token",
            refreshToken: "refresh-token",
            domain: "www.workbuddy.ai",
            expiresAt: Date.now() + 3600_000,
          },
        }),
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(fs.existsSync(sessionFile), true);
    const saved = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    assert.equal(saved.auth.accessToken, "access-token");
    assert.equal(getActiveLoginState(state)?.status, "success");
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

test("checkLegacyCommands returns structured inspection report", async () => {
  const report = await checkLegacyCommands();
  assert.equal(typeof report.detected, "boolean");
  assert.ok(Array.isArray(report.findings));
  assert.equal(typeof report.uv, "object");
  assert.equal(typeof report.pipx, "object");
  assert.equal(typeof report.externalBin, "object");
  assert.equal(typeof report.summary, "string");
});

test("routeWorkbuddyRequest handles POST /v1/workbuddy/check-legacy and /v1/workbuddy/cleanup-legacy", async () => {
  // Test check-legacy
  const checkReq = new EventEmitter();
  checkReq.method = "POST";
  checkReq.url = "/v1/workbuddy/check-legacy";

  let statusCode = null;
  let responseData = "";
  const checkRes = {
    writeHead(code) {
      statusCode = code;
    },
    end(data) {
      responseData = data;
    },
  };

  await routeWorkbuddyRequest(checkReq, checkRes, {}, "/v1/workbuddy/check-legacy");
  assert.equal(statusCode, 200);
  const parsedCheck = JSON.parse(responseData);
  assert.equal(parsedCheck.success, true);
  assert.equal(typeof parsedCheck.detected, "boolean");

  // Test cleanup-legacy
  const cleanReq = new EventEmitter();
  cleanReq.method = "POST";
  cleanReq.url = "/v1/workbuddy/cleanup-legacy";

  const cleanRes = {
    writeHead(code) {
      statusCode = code;
    },
    end(data) {
      responseData = data;
    },
  };

  await routeWorkbuddyRequest(cleanReq, cleanRes, {}, "/v1/workbuddy/cleanup-legacy");
  assert.equal(statusCode, 200);
  const parsedClean = JSON.parse(responseData);
  assert.equal(parsedClean.success, true);
  assert.equal(typeof parsedClean.ok, "boolean");
});
