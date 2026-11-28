import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import http2 from "node:http2";

import {
  DEFAULT_CHAT_MODEL,
  resolveSkillConfigPath,
  resolveSessionsDir,
  normalizeConfig,
  loadSkillConfig,
  saveSkillConfig,
  updateSkillAuth,
  registerModel,
  importSecretsFromFile,
  maskSecret,
} from "../../lib/skills/leo-antigravity-chat/scripts/lib/config.mjs";
import {
  resolveProxyInfo,
  resolveProxyUrl,
  parseScutilProxyOutput,
  parseWindowsRegProxyOutput,
  isBypassedHost,
  toImagePart,
} from "../../lib/skills/leo-antigravity-chat/scripts/lib/proxy.mjs";
import {
  encodeGenerateContentRequest,
  encodeGenerateContentResponse,
  decodeGenerateContentResponse,
  decodeUserQuotaSummary,
  normalizeUserQuotaSummary,
} from "../../lib/skills/leo-antigravity-chat/scripts/lib/proto.mjs";
import {
  SCOPES,
  extractCredentialsFromText,
  ensureFreshAuth,
} from "../../lib/skills/leo-antigravity-chat/scripts/lib/oauth.mjs";
import {
  loadSession,
  saveSession,
  listSessions,
  clearSession,
  sanitizeSessionId,
} from "../../lib/skills/leo-antigravity-chat/scripts/lib/session.mjs";
import {
  parseCliArgs,
  runCli,
} from "../../lib/skills/leo-antigravity-chat/scripts/leo_antigravity_chat.mjs";

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-ag-chat-test-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function encodeVarintLocal(n) {
  const bytes = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n & 0x7f);
  return Buffer.from(bytes);
}

function makeQuotaGroupBuf({ id, title, window, remainingFloat, description }) {
  const parts = [];
  const pushStr = (f, s) => {
    const b = Buffer.from(s, "utf8");
    parts.push(Buffer.from([(f << 3) | 2]), encodeVarintLocal(b.length), b);
  };
  if (id) pushStr(1, id);
  if (title) pushStr(2, title);
  if (window) pushStr(3, window);
  if (remainingFloat != null) {
    const fl = Buffer.alloc(4);
    fl.writeFloatLE(remainingFloat, 0);
    parts.push(Buffer.from([(4 << 3) | 5]), fl);
  }
  if (description) pushStr(7, description);
  return Buffer.concat(parts);
}

function makeQuotaSummaryBuf(groups) {
  const parts = [];
  for (const g of groups) {
    const gb = makeQuotaGroupBuf(g);
    parts.push(Buffer.from([(1 << 3) | 2]), encodeVarintLocal(gb.length), gb);
  }
  return Buffer.concat(parts);
}

test("config: defaults to ~/.shrimp/skills/leo-antigravity-chat/config.json and enforces strict credential isolation", () => {
  const defaultPath = resolveSkillConfigPath({});
  assert.ok(defaultPath.endsWith(path.join(".shrimp", "skills", "leo-antigravity-chat", "config.json")));

  const defaultSessions = resolveSessionsDir({});
  assert.ok(defaultSessions.endsWith(path.join(".shrimp", "skills", "leo-antigravity-chat", "sessions")));

  const cfg = normalizeConfig({});
  assert.equal(cfg.default_model, DEFAULT_CHAT_MODEL);
  assert.deepEqual(cfg.models, ["gemini-3.8-flash-high"]);
  assert.equal(cfg.proxy, "");
  assert.deepEqual(cfg.auth, {});

  withTempDir((dir) => {
    // Even if sibling files exist in fake HOME, loadSkillConfig and importSecretsFromFile("") must NOT read them.
    const fakeHome = path.join(dir, "home");
    const imagineCfg = path.join(fakeHome, ".shrimp", "skills", "leo-antigravity-imagine", "config.json");
    fs.mkdirSync(path.dirname(imagineCfg), { recursive: true });
    fs.writeFileSync(imagineCfg, JSON.stringify({ auth: { refresh_token: "1//should-not-leak" } }));

    const cfgPath = path.join(dir, "chat-config.json");
    const env = { HOME: fakeHome, LEO_ANTIGRAVITY_CHAT_CONFIG_PATH: cfgPath };

    assert.deepEqual(loadSkillConfig(env).auth, {});
    assert.throws(() => importSecretsFromFile("", env), /--from/);

    const explicitFile = path.join(dir, "explicit.json");
    fs.writeFileSync(
      explicitFile,
      JSON.stringify({
        client_id: "123456-abcdef.apps.googleusercontent.com",
        client_secret: "FAKESEC-secretvalue123456789012",
        access_token: "ya29.mock_access",
        refresh_token: "1//mock_refresh",
        expires_at: 1890000000,
        account_id: "chat@example.com",
      }),
    );

    const imported = importSecretsFromFile(explicitFile, env);
    assert.equal(imported.auth.account_id, "chat@example.com");
    assert.equal(imported.auth.refresh_token, "1//mock_refresh");

    if (process.platform !== "win32") {
      const mode = fs.statSync(cfgPath).mode & 0o777;
      assert.equal(mode, 0o600);
    }

    assert.equal(registerModel("gemini-4-hydrogen-sonar", env), true);
    assert.equal(registerModel("gemini-4-hydrogen-sonar", env), false);
    assert.equal(maskSecret("1//mock_refresh"), "1//m...resh");
  });
});

test("proxy: 4-tier precedence and image loading", async () => {
  assert.equal(
    parseScutilProxyOutput("HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7897\n"),
    "http://127.0.0.1:7897",
  );
  assert.equal(
    parseWindowsRegProxyOutput("ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ 127.0.0.1:7890\n"),
    "http://127.0.0.1:7890",
  );
  assert.equal(resolveProxyUrl({ noProxy: true, cliProxy: "127.0.0.1:8888" }), "");
  assert.equal(
    resolveProxyInfo({ cliProxy: "127.0.0.1:9090", configProxy: "http://127.0.0.1:8888" }).url,
    "http://127.0.0.1:9090",
  );
  assert.equal(isBypassedHost("localhost"), true);
  assert.equal(isBypassedHost("daily-cloudcode-pa.googleapis.com"), false);

  await withTempDir(async (dir) => {
    const imgPath = path.join(dir, "sample.png");
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(imgPath, pngBytes);
    const part = await toImagePart(imgPath);
    assert.equal(part.inlineData.mimeType, "image/png");
    assert.equal(part.inlineData.data, pngBytes.toString("base64"));
  });
});

test("proto: encodes generationConfig + thinkingConfig and decodes text, thought, usage, and quota", () => {
  const reqBuf = encodeGenerateContentRequest({
    project: "proj-chat",
    requestId: "agent/antigravity/12345678/1",
    model: "gemini-3.8-flash-high",
    userAgent: "antigravity",
    requestType: "agent",
    enabledCreditTypes: ["GOOGLE_ONE_AI"],
    request: {
      systemInstruction: { role: "user", parts: [{ text: "Be helpful" }] },
      generationConfig: {
        temperature: 0.5,
        topP: 0.9,
        maxOutputTokens: 2048,
        thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 },
      },
      sessionId: "123456789",
      contents: [{ role: "user", parts: [{ text: "hello world" }] }],
    },
  });
  assert.ok(reqBuf.includes(Buffer.from("proj-chat", "utf8")));
  assert.ok(reqBuf.includes(Buffer.from("hello world", "utf8")));

  const respBuf = encodeGenerateContentResponse({
    traceId: "trace-chat-1",
    remainingCredits: 88,
    response: {
      modelVersion: "gemini-3.8-flash-high",
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 9,
        totalTokenCount: 24,
        thoughtsTokenCount: 4,
      },
      candidates: [
        {
          finishReason: "STOP",
          content: {
            role: "model",
            parts: [
              { text: "let me think", thought: true },
              { text: "final answer", thoughtSignature: Buffer.from("sig123").toString("base64") },
            ],
          },
        },
      ],
    },
  });

  const decoded = decodeGenerateContentResponse(respBuf);
  assert.equal(decoded.remainingCredits, 88);
  assert.equal(decoded.response.modelVersion, "gemini-3.8-flash-high");
  assert.equal(decoded.response.usageMetadata.totalTokenCount, 24);
  assert.equal(decoded.response.usageMetadata.thoughtsTokenCount, 4);
  assert.equal(decoded.response.candidates[0].content.parts[0].thought, true);
  assert.equal(decoded.response.candidates[0].content.parts[1].text, "final answer");

  const quotaBuf = makeQuotaSummaryBuf([
    {
      id: "gemini-weekly",
      title: "Gemini Weekly",
      window: "weekly",
      remainingFloat: 0.85,
      description: "refresh in 6 days, 20 hours.",
    },
    {
      id: "3p-5h",
      title: "3P 5h",
      window: "5h",
      remainingFloat: 1.0,
      description: "",
    },
  ]);
  const quota = normalizeUserQuotaSummary(decodeUserQuotaSummary(quotaBuf));
  assert.equal(quota.available, true);
  assert.equal(quota.limits.length, 2);
  assert.equal(Math.round(quota.remaining_percent), 85);
  assert.equal(quota.limits[0].reset_after, "6 天 20 小时");
});

test("oauth: ensureFreshAuth rejects missing credentials without scanning desktop and refreshes expired token", async () => {
  assert.ok(SCOPES.includes("https://www.googleapis.com/auth/aicode"));
  const pair = extractCredentialsFromText(
    "noise 1234567890-abcdefghijkl.apps.googleusercontent.com mid FAKESEC-AbCdEfGhIjKlMnOpQrStUvWx tail",
  );
  assert.equal(pair.client_id, "1234567890-abcdefghijkl.apps.googleusercontent.com");

  await withTempDir(async (dir) => {
    const cfgPath = path.join(dir, "config.json");
    const env = { LEO_ANTIGRAVITY_CHAT_CONFIG_PATH: cfgPath };

    await assert.rejects(() => ensureFreshAuth({ env }), /login/);

    const tokenServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c.toString("utf8"); });
      req.on("end", () => {
        assert.match(body, /grant_type=refresh_token/);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: "ya29.chat_refreshed", expires_in: 3600 }));
      });
    });
    await new Promise((r) => tokenServer.listen(0, "127.0.0.1", r));
    const port = tokenServer.address().port;

    try {
      saveSkillConfig(
        {
          auth: {
            client_id: "123456-abc.apps.googleusercontent.com",
            client_secret: "FAKESEC-secret1234567890123456",
            access_token: "ya29.old",
            refresh_token: "1//chat_refresh",
            expires_at: 100,
            account_id: "chat@example.com",
          },
        },
        env,
      );

      const auth = await ensureFreshAuth({ env, tokenUrl: `http://127.0.0.1:${port}/token` });
      assert.equal(auth.access_token, "ya29.chat_refreshed");
      assert.equal(loadSkillConfig(env).auth.access_token, "ya29.chat_refreshed");
    } finally {
      tokenServer.close();
    }
  });
});

test("session: sanitizeSessionId and CRUD round-trip", () => {
  assert.equal(sanitizeSessionId("review/task 1"), "review_task_1");
  assert.throws(() => sanitizeSessionId("..."), /无效/);

  withTempDir((dir) => {
    const env = { LEO_ANTIGRAVITY_CHAT_SESSIONS_DIR: path.join(dir, "sessions") };
    const s = loadSession("demo-1", env);
    s.model = "gemini-3.8-flash-high";
    s.turns.push({ role: "user", parts: [{ text: "hi" }] });
    s.turns.push({ role: "model", parts: [{ text: "hello" }] });
    saveSession(s, env);

    const list = listSessions(env);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "demo-1");
    assert.equal(list[0].turn_count, 2);

    assert.equal(clearSession("demo-1", env), 1);
    assert.equal(listSessions(env).length, 0);
  });
});

test("client + CLI: end-to-end ask, multi-turn session, streaming, list --remote --sync, and quota over mock h2c gRPC", async () => {
  await withTempDir(async (dir) => {
    const cfgPath = path.join(dir, "config.json");
    const sessionsDir = path.join(dir, "sessions");
    const restServer = http.createServer((req, res) => {
      if (req.url?.includes(":loadCodeAssist")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ cloudaicompanionProject: "chat-mock-proj" }));
        return;
      }
      if (req.url?.includes(":fetchAvailableModels")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          models: {
            "gemini-3.8-flash-high": { displayName: "Gemini 3.8 Flash (High)" },
            "gemini-4-hydrogen-sonar": { displayName: "Gemini 4 Hydrogen Sonar" },
            "gemini-3.1-flash-image": { displayName: "Gemini 3.1 Flash Image" },
          },
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => restServer.listen(0, "127.0.0.1", r));
    const restPort = restServer.address().port;

    const receivedRequests = [];
    const grpcServer = http2.createServer();
    grpcServer.on("stream", (stream, headers) => {
      const reqPath = headers[":path"];
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        const body = Buffer.concat(chunks);
        if (reqPath.endsWith("RetrieveUserQuotaSummary")) {
          const qBuf = makeQuotaSummaryBuf([
            { id: "gemini-weekly", title: "Gemini Weekly", window: "weekly", remainingFloat: 0.9, description: "" },
          ]);
          const frame = Buffer.alloc(5 + qBuf.length);
          frame.writeUInt32BE(qBuf.length, 1);
          qBuf.copy(frame, 5);
          stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
          stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
          stream.end(frame);
          return;
        }

        receivedRequests.push(body);
        const turnNum = receivedRequests.length;
        const respProto = encodeGenerateContentResponse({
          response: {
            modelVersion: "gemini-3.8-flash-high",
            usageMetadata: { promptTokenCount: 10 * turnNum, candidatesTokenCount: 5, totalTokenCount: 10 * turnNum + 5 },
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  role: "model",
                  parts: [
                    { text: "step-thought", thought: true },
                    { text: `reply-${turnNum}` },
                  ],
                },
              },
            ],
          },
        });
        const frame = Buffer.alloc(5 + respProto.length);
        frame.writeUInt32BE(respProto.length, 1);
        respProto.copy(frame, 5);

        stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
        stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
        stream.end(frame);
      });
    });
    await new Promise((r) => grpcServer.listen(0, "127.0.0.1", r));
    const grpcPort = grpcServer.address().port;

    const env = {
      LEO_ANTIGRAVITY_CHAT_CONFIG_PATH: cfgPath,
      LEO_ANTIGRAVITY_CHAT_SESSIONS_DIR: sessionsDir,
      ANTIGRAVITY_REST_BASE_URL: `http://127.0.0.1:${restPort}/v1internal`,
      ANTIGRAVITY_GRPC_HOST: "127.0.0.1",
      ANTIGRAVITY_GRPC_PORT: String(grpcPort),
      ANTIGRAVITY_GRPC_INSECURE: "1",
    };

    saveSkillConfig(
      {
        auth: {
          client_id: "123456-abc.apps.googleusercontent.com",
          client_secret: "FAKESEC-secret1234567890123456",
          access_token: "ya29.valid",
          refresh_token: "1//valid",
          expires_at: Math.floor(Date.now() / 1000) + 7200,
          account_id: "tester@example.com",
        },
      },
      env,
    );

    try {
      // 1. JSON ask with session (turn 1)
      const logs1 = [];
      await runCli(
        ["--prompt", "first question", "--session", "s1", "--json"],
        { env, log: (m) => logs1.push(m) },
      );
      const json1 = JSON.parse(logs1.join("\n"));
      assert.equal(json1.ok, true);
      assert.equal(json1.text, "reply-1");
      assert.equal(json1.thinking, "step-thought");
      assert.equal(json1.session_id, "s1");

      // 2. Follow-up turn 2 via stdin with --session s1
      const streamed = [];
      await runCli(
        ["--prompt", "-", "--session", "s1", "--stream"],
        { env, stdinText: "second question", writeStdout: (c) => streamed.push(c) },
      );
      assert.equal(streamed.join("").trim(), "reply-2");
      // Second request payload must carry turn 1 question & reply
      assert.ok(receivedRequests[1].includes(Buffer.from("first question", "utf8")));
      assert.ok(receivedRequests[1].includes(Buffer.from("reply-1", "utf8")));
      assert.ok(receivedRequests[1].includes(Buffer.from("second question", "utf8")));

      // 3. list --remote --sync excludes image model from chat models
      const listLogs = [];
      await runCli(["list", "--remote", "--sync", "--json"], { env, log: (m) => listLogs.push(m) });
      const listJson = JSON.parse(listLogs.join("\n"));
      assert.ok(listJson.local_models.includes("gemini-4-hydrogen-sonar"));
      assert.ok(!listJson.remote_chat_models.some((m) => m.id === "gemini-3.1-flash-image"));

      // 4. quota command
      const quotaLogs = [];
      await runCli(["quota", "--json"], { env, log: (m) => quotaLogs.push(m) });
      const quotaJson = JSON.parse(quotaLogs.join("\n"));
      assert.equal(quotaJson.ok, true);
      assert.equal(Math.round(quotaJson.remaining_percent), 90);
    } finally {
      restServer.close();
      grpcServer.close();
    }
  });
});

test("skill contract: standalone SKILL.md, package.json, and managed-catalog.json", () => {
  const ROOT = path.resolve(import.meta.dirname, "../..");
  const skillDir = path.join(ROOT, "lib", "skills", "leo-antigravity-chat");
  const skillMd = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(skillDir, "package.json"), "utf8"));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "lib", "skills", "managed-catalog.json"), "utf8"));

  assert.match(skillMd, /name: leo-antigravity-chat/);
  assert.match(skillMd, /\.shrimp\/skills\/leo-antigravity-chat\/config\.json/);
  assert.doesNotMatch(skillMd, /127\.0\.0\.1:8787/);
  assert.equal(pkg.dependencies, undefined);
  assert.ok(catalog.skills.some((s) => s.id === "leo-antigravity-chat"));

  const parsed = parseCliArgs(["--prompt", "hi", "-m", "gemini-4-hydrogen-sonar", "--stream", "--json"]);
  assert.equal(parsed.command, "ask");
  assert.equal(parsed.model, "gemini-4-hydrogen-sonar");
  assert.equal(parsed.stream, true);
  assert.equal(parsed.json, true);
});
