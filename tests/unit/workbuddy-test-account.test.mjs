import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { testAccount, pollAndSaveSession, getActiveLoginState } from "../../lib/workbuddy/supervisor.mjs";
import { routeWorkbuddyRequest } from "../../lib/workbuddy/routes.mjs";

test("testAccount returns error if account not found", async () => {
  const tmpDir = path.join(os.tmpdir(), "wb-test-account-missing-" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const res = await testAccount({ uid: "non_existent_uid", authDir: tmpDir });
    assert.equal(res.ok, false);
    assert.match(res.error, /未找到账号凭据文件/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("testAccount returns success on mock 200 SSE stream", async () => {
  const tmpDir = path.join(os.tmpdir(), "wb-test-account-ok-" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const authFile = path.join(tmpDir, "workbuddy-user123.json");
  fs.writeFileSync(
    authFile,
    JSON.stringify({
      auth: {
        accessToken: "test-token-abc",
        realm: "global",
        domain: "www.workbuddy.ai",
      },
      account: { uid: "user123", nickname: "testuser@example.com" },
    })
  );

  const mockFetch = async (url, opts) => {
    if (url.includes("/billing/meter/get-user-resource")) {
      return {
        ok: true,
        json: async () => ({
          data: { Response: { Data: { Accounts: [{ CapacityRemain: 180 }] } } },
        }),
      };
    }
    if (url.includes("/v2/chat/completions")) {
      const sseBody =
        'data: {"choices":[{"delta":{"content":"Hello! "}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"I am WorkBuddy."}}]}\n\n' +
        "data: [DONE]\n\n";
      return {
        ok: true,
        status: 200,
        text: async () => sseBody,
      };
    }
    throw new Error("Unhandled url: " + url);
  };

  try {
    const res = await testAccount({
      uid: "user123",
      prompt: "hello",
      authDir: tmpDir,
      fetchImpl: mockFetch,
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.reply, "Hello! I am WorkBuddy.");
    assert.equal(res.credits, 180);
    assert.equal(res.realm, "global");
    assert.ok(typeof res.latencyMs === "number");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("testAccount surfaces upstream error with displayMsg on 403 safety review", async () => {
  const tmpDir = path.join(os.tmpdir(), "wb-test-account-err-" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const authFile = path.join(tmpDir, "workbuddy-user456.json");
  fs.writeFileSync(
    authFile,
    JSON.stringify({
      auth: {
        accessToken: "test-token-xyz",
        realm: "global",
        domain: "www.workbuddy.ai",
      },
      account: { uid: "user456", nickname: "safetyuser@example.com" },
    })
  );

  const mockFetch = async (url) => {
    if (url.includes("/billing/meter/get-user-resource")) {
      return {
        ok: true,
        json: async () => ({
          data: { Response: { Data: { Accounts: [{ CapacityRemain: 250 }] } } },
        }),
      };
    }
    if (url.includes("/v2/chat/completions")) {
      return {
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({
            code: 11140,
            msg: "request illegal",
            displayMsg: { zh: "内容未通过安全审核，请调整后重试。" },
          }),
      };
    }
    throw new Error("Unhandled url: " + url);
  };

  try {
    const res = await testAccount({
      uid: "user456",
      prompt: "hello",
      authDir: tmpDir,
      fetchImpl: mockFetch,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 403);
    assert.equal(res.code, 11140);
    assert.equal(res.isRiskBlocked, true);
    assert.ok(res.advice && res.advice.includes("国内版"));
    assert.match(res.message, /内容未通过安全审核/);
    assert.equal(res.credits, 250);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("reviveAccount clears disabled state in state.json", async () => {
  const tmpDir = path.join(os.tmpdir(), "wb-test-revive-" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const stateFile = path.join(tmpDir, "state.json");
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      accounts: {
        "uid-banned-1": {
          credits: 100,
          disabled: true,
          reason: "account banned by upstream (11140 request illegal), re-login required",
          consecutive_fails: 5,
        },
      },
    })
  );

  try {
    const { reviveAccount } = await import("../../lib/workbuddy/supervisor.mjs");
    let stopped = false;
    let started = false;
    const res = await reviveAccount({
      uid: "uid-banned-1",
      stateFile,
      stopImpl: async () => { stopped = true; },
      startImpl: async () => { started = true; },
    });

    assert.equal(res.ok, true);
    assert.equal(res.found, true);

    const after = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(after.accounts["uid-banned-1"].disabled, false);
    assert.equal(after.accounts["uid-banned-1"].reason, "");
    assert.equal(after.accounts["uid-banned-1"].consecutive_fails, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("routes handle GET /v1/workbuddy/login/status, POST /v1/workbuddy/account/test, and POST /v1/workbuddy/account/revive", async () => {
  // Test GET /v1/workbuddy/login/status
  {
    const req = new EventEmitter();
    req.method = "GET";
    req.url = "/v1/workbuddy/login/status?state=non_existent_state";

    let statusCode = null;
    let responseData = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(data) { responseData = data; },
    };

    await routeWorkbuddyRequest(req, res, {}, "/v1/workbuddy/login/status");
    assert.equal(statusCode, 200);
    const parsed = JSON.parse(responseData);
    assert.equal(parsed.success, true);
    assert.equal(parsed.state, "non_existent_state");
    assert.equal(parsed.poller, null);
  }

  // Test POST /v1/workbuddy/account/test
  {
    const req = new EventEmitter();
    req.method = "POST";
    req.url = "/v1/workbuddy/account/test";

    let statusCode = null;
    let responseData = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(data) { responseData = data; },
    };

    const promise = routeWorkbuddyRequest(req, res, {}, "/v1/workbuddy/account/test");
    req.emit("data", Buffer.from(JSON.stringify({ uid: "mock_missing_uid", prompt: "hello" })));
    req.emit("end");
    await promise;

    assert.equal(statusCode, 200);
    const parsed = JSON.parse(responseData);
    assert.equal(parsed.success, true);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /未找到账号凭据文件/);
  }

  // Test POST /v1/workbuddy/account/revive
  {
    const req = new EventEmitter();
    req.method = "POST";
    req.url = "/v1/workbuddy/account/revive";

    let statusCode = null;
    let responseData = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(data) { responseData = data; },
    };

    const promise = routeWorkbuddyRequest(req, res, {}, "/v1/workbuddy/account/revive");
    req.emit("data", Buffer.from(JSON.stringify({ uid: "mock_uid" })));
    req.emit("end");
    await promise;

    assert.equal(statusCode, 200);
    const parsed = JSON.parse(responseData);
    assert.equal(parsed.success, true);
    assert.equal(parsed.ok, true);
  }
});
