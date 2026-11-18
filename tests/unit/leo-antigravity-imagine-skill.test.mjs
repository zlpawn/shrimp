import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import http2 from "node:http2";

import {
  DEFAULT_IMAGE_MODEL,
  resolveSkillConfigPath,
  normalizeConfig,
  loadSkillConfig,
  saveSkillConfig,
  updateSkillAuth,
  registerModel,
  importSecretsFromFile,
  maskSecret,
} from "../../lib/skills/leo-antigravity-imagine/scripts/lib/config.mjs";
import {
  resolveProxyInfo,
  resolveProxyUrl,
  parseScutilProxyOutput,
  parseWindowsRegProxyOutput,
  isBypassedHost,
  toImagePart,
} from "../../lib/skills/leo-antigravity-imagine/scripts/lib/proxy.mjs";
import {
  encodeGenerateContentRequest,
  encodeGenerateContentResponse,
  decodeGenerateContentResponse,
} from "../../lib/skills/leo-antigravity-imagine/scripts/lib/proto.mjs";
import {
  extractCredentialsFromText,
  ensureFreshAuth,
} from "../../lib/skills/leo-antigravity-imagine/scripts/lib/oauth.mjs";
import {
  buildImageGenerateRequest,
  generateImageViaGrpc,
} from "../../lib/skills/leo-antigravity-imagine/scripts/lib/client.mjs";
import {
  parseCliArgs,
  slugifyPrompt,
  generateSemanticFilename,
  detectBufferExt,
  resolveTargetOutputDir,
  runCli,
} from "../../lib/skills/leo-antigravity-imagine/scripts/leo_antigravity_imagine.mjs";

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-ag-imagine-test-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("config: defaults to gemini-3.1-flash-image and ~/.shrimp/skills/leo-antigravity-imagine/config.json", () => {
  const defaultPath = resolveSkillConfigPath({});
  assert.ok(defaultPath.endsWith(path.join(".shrimp", "skills", "leo-antigravity-imagine", "config.json")));

  const cfg = normalizeConfig({});
  assert.equal(cfg.default_model, DEFAULT_IMAGE_MODEL);
  assert.deepEqual(cfg.models, ["gemini-3.1-flash-image"]);
  assert.equal(cfg.proxy, "");
  assert.deepEqual(cfg.auth, {});
});

test("config: saveSkillConfig writes 0600 JSON, supports importSecretsFromFile, registerModel, and maskSecret", () => {
  withTempDir((dir) => {
    const cfgPath = path.join(dir, "config.json");
    const env = { LEO_ANTIGRAVITY_CONFIG_PATH: cfgPath };

    const secretsFile = path.join(dir, "antigravity.secrets.json");
    fs.writeFileSync(
      secretsFile,
      JSON.stringify({
        client_id: "123456-abcdef.apps.googleusercontent.com",
        client_secret: "GOC" + "SPX-secretvalue1234567890",
        access_token: "ya29.mock_access_token_value",
        refresh_token: "1//mock_refresh_token_value",
        expires_at: 1890000000,
        account_id: "tester@example.com",
      }),
      "utf8",
    );

    const imported = importSecretsFromFile(secretsFile, env);
    assert.equal(imported.auth.account_id, "tester@example.com");
    assert.equal(imported.auth.expires_at, 1890000000);
    assert.equal(imported.default_model, "gemini-3.1-flash-image");

    if (process.platform !== "win32") {
      const mode = fs.statSync(cfgPath).mode & 0o777;
      assert.equal(mode, 0o600);
    }

    assert.equal(registerModel("gemini-3-pro-image", env), true);
    assert.equal(registerModel("gemini-3-pro-image", env), false);

    updateSkillAuth({ project: "companion-proj-123" }, env);
    const loaded = loadSkillConfig(env);
    assert.deepEqual(loaded.models, ["gemini-3.1-flash-image", "gemini-3-pro-image"]);
    assert.equal(loaded.auth.project, "companion-proj-123");
    assert.equal(loaded.auth.refresh_token, "1//mock_refresh_token_value");

    assert.equal(maskSecret(""), "");
    assert.equal(maskSecret("short"), "********");
    assert.equal(maskSecret("1//mock_refresh_token_value"), "1//m...alue");
  });
});

test("proxy: 4-tier precedence (noProxy > cliProxy > configProxy > env > system scutil/reg)", () => {
  const scutilOut = `
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
}
`;
  assert.equal(parseScutilProxyOutput(scutilOut), "http://127.0.0.1:7897");

  const regOut = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7890
`;
  assert.equal(parseWindowsRegProxyOutput(regOut), "http://127.0.0.1:7890");

  // 1. noProxy wins over everything
  assert.equal(
    resolveProxyUrl({
      noProxy: true,
      cliProxy: "http://127.0.0.1:9999",
      configProxy: "http://127.0.0.1:8888",
      env: { HTTPS_PROXY: "http://127.0.0.1:7897" },
      systemProxyDetector: () => "http://127.0.0.1:7897",
    }),
    "",
  );

  // 2. cliProxy wins over config/env/system (and auto-prefixes http:// if missing)
  const cliInfo = resolveProxyInfo({
    cliProxy: "127.0.0.1:9090",
    configProxy: "http://127.0.0.1:8888",
    env: { HTTPS_PROXY: "http://127.0.0.1:7897" },
    systemProxyDetector: () => "http://127.0.0.1:7897",
  });
  assert.equal(cliInfo.url, "http://127.0.0.1:9090");
  assert.equal(cliInfo.source, "cli");

  // 3. configProxy wins over env/system
  const cfgInfo = resolveProxyInfo({
    configProxy: "http://127.0.0.1:8888",
    env: { HTTPS_PROXY: "http://127.0.0.1:7897" },
    systemProxyDetector: () => "http://127.0.0.1:7897",
  });
  assert.equal(cfgInfo.url, "http://127.0.0.1:8888");
  assert.equal(cfgInfo.source, "config");

  // 4. env wins over system
  const envInfo = resolveProxyInfo({
    env: { https_proxy: "http://127.0.0.1:7897" },
    systemProxyDetector: () => "http://127.0.0.1:1080",
  });
  assert.equal(envInfo.url, "http://127.0.0.1:7897");
  assert.equal(envInfo.source, "env");

  // 5. system fallback when env is empty
  const sysInfo = resolveProxyInfo({
    env: {},
    systemProxyDetector: () => "http://127.0.0.1:7897",
  });
  assert.equal(sysInfo.url, "http://127.0.0.1:7897");
  assert.equal(sysInfo.source, "system");

  assert.equal(isBypassedHost("127.0.0.1"), true);
  assert.equal(isBypassedHost("localhost"), true);
  assert.equal(isBypassedHost("daily-cloudcode-pa.googleapis.com"), false);
});

test("proxy: toImagePart converts local file and data URI to inlineData", async () => {
  await withTempDir(async (dir) => {
    const imgPath = path.join(dir, "ref.png");
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(imgPath, fakePng);

    const part = await toImagePart(imgPath);
    assert.equal(part.inlineData.mimeType, "image/png");
    assert.equal(part.inlineData.data, fakePng.toString("base64"));

    const fromData = await toImagePart(`data:image/webp;base64,${fakePng.toString("base64")}`);
    assert.equal(fromData.inlineData.mimeType, "image/webp");
    assert.equal(fromData.inlineData.data, fakePng.toString("base64"));
  });
});

test("proto: encodes responseModalities=IMAGE (field 21) and ImageConfig aspectRatio/imageSize (field 30) and decodes inlineData", () => {
  const reqBuf = encodeGenerateContentRequest({
    project: "proj-1",
    requestId: "agent/antigravity/12345678/1",
    model: "gemini-3.1-flash-image",
    userAgent: "antigravity",
    requestType: "agent",
    enabledCreditTypes: ["GOOGLE_ONE_AI"],
    request: {
      systemInstruction: { role: "user", parts: [{ text: "You are Antigravity" }] },
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "2K",
        },
      },
      sessionId: "123456789",
      contents: [
        {
          role: "user",
          parts: [{ text: "cyberpunk skyline" }],
        },
      ],
    },
  });

  // Field 21 packed IMAGE=2 -> tag (21 << 3) | 2 = 170 = 0xaa 0x01, len 1, val 0x02
  assert.ok(reqBuf.includes(Buffer.from([0xaa, 0x01, 0x01, 0x02])), "expected packed responseModalities IMAGE");
  // Field 30 (image_config) -> tag (30 << 3) | 2 = 242 = 0xf2 0x01, containing aspect_ratio (field 2 = 0x12) "16:9" and image_size (field 4 = 0x22) "2K"
  assert.ok(reqBuf.includes(Buffer.from("16:9", "utf8")), "expected aspect_ratio 16:9 in encoded request");
  assert.ok(reqBuf.includes(Buffer.from("2K", "utf8")), "expected image_size 2K in encoded request");

  const fakeImgB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString("base64");
  const respBuf = encodeGenerateContentResponse({
    traceId: "trace-abc",
    consumedCredits: 10,
    remainingCredits: 990,
    response: {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            role: "model",
            parts: [
              { inlineData: { mimeType: "image/png", data: fakeImgB64 } },
            ],
          },
        },
      ],
    },
  });

  const decoded = decodeGenerateContentResponse(respBuf);
  assert.equal(decoded.traceId, "trace-abc");
  assert.equal(decoded.remainingCredits, 990);
  const inline = decoded.response.candidates[0].content.parts[0].inlineData;
  assert.equal(inline.mimeType, "image/png");
  assert.equal(inline.data, fakeImgB64);
});

test("oauth: extractCredentialsFromText extracts client_id and client_secret, and ensureFreshAuth refreshes expired token", async () => {
  const sampleBinary = `noise 1234567890-abcdefghijkl.apps.googleusercontent.com mid ${"GOC" + "SPX-AbCdEfGhIjKlMnOpQrStUvWx"} tail`;
  const pair = extractCredentialsFromText(sampleBinary);
  assert.equal(pair.client_id, "1234567890-abcdefghijkl.apps.googleusercontent.com");
  assert.equal(pair.client_secret, "GOC" + "SPX-AbCdEfGhIjKlMnOpQrStUvWx");

  await withTempDir(async (dir) => {
    const cfgPath = path.join(dir, "config.json");
    const env = { LEO_ANTIGRAVITY_CONFIG_PATH: cfgPath };

    const tokenServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c.toString("utf8"); });
      req.on("end", () => {
        assert.match(body, /grant_type=refresh_token/);
        assert.match(body, /refresh_token=1%2F%2Fold_refresh/);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          access_token: "ya29.fresh_token_999",
          expires_in: 3600,
          token_type: "Bearer",
        }));
      });
    });
    await new Promise((r) => tokenServer.listen(0, "127.0.0.1", r));
    const port = tokenServer.address().port;

    try {
      saveSkillConfig(
        {
          auth: {
            client_id: "123456-abc.apps.googleusercontent.com",
            client_secret: "GOC" + "SPX-secret1234567890123456",
            access_token: "ya29.expired",
            refresh_token: "1//old_refresh",
            expires_at: 100, // expired
            account_id: "user@example.com",
          },
        },
        env,
      );

      const auth = await ensureFreshAuth({
        env,
        tokenUrl: `http://127.0.0.1:${port}/token`,
      });
      assert.equal(auth.access_token, "ya29.fresh_token_999");

      const reloaded = loadSkillConfig(env);
      assert.equal(reloaded.auth.access_token, "ya29.fresh_token_999");
      assert.ok(reloaded.auth.expires_at > Math.floor(Date.now() / 1000) + 3000);
    } finally {
      tokenServer.close();
    }
  });
});

test("client + CLI: standalone end-to-end image generation over HTTP/2 gRPC saves image and registers model", async () => {
  await withTempDir(async (dir) => {
    const cfgPath = path.join(dir, "config.json");
    const outDir = path.join(dir, "out");
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

    // 1. Mock v1internal REST server for loadCodeAssist
    const restServer = http.createServer((req, res) => {
      if (req.url?.includes(":loadCodeAssist")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ cloudaicompanionProject: "companion-mock-proj" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => restServer.listen(0, "127.0.0.1", r));
    const restPort = restServer.address().port;

    // 2. Mock HTTP/2 h2c gRPC server for PredictionService/GenerateContent
    let receivedPath = "";
    let receivedPayload = Buffer.alloc(0);
    const grpcServer = http2.createServer();
    grpcServer.on("stream", (stream, headers) => {
      receivedPath = headers[":path"];
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        receivedPayload = Buffer.concat(chunks);
        const respProto = encodeGenerateContentResponse({
          traceId: "trace-e2e",
          remainingCredits: 500,
          response: {
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  role: "model",
                  parts: [
                    { inlineData: { mimeType: "image/png", data: fakePng.toString("base64") } },
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
        stream.on("wantTrailers", () => {
          stream.sendTrailers({ "grpc-status": "0" });
        });
        stream.end(frame);
      });
    });
    await new Promise((r) => grpcServer.listen(0, "127.0.0.1", r));
    const grpcPort = grpcServer.address().port;

    const env = {
      LEO_ANTIGRAVITY_CONFIG_PATH: cfgPath,
      ANTIGRAVITY_REST_BASE_URL: `http://127.0.0.1:${restPort}/v1internal`,
      ANTIGRAVITY_GRPC_HOST: "127.0.0.1",
      ANTIGRAVITY_GRPC_PORT: String(grpcPort),
      ANTIGRAVITY_GRPC_INSECURE: "1",
    };

    saveSkillConfig(
      {
        auth: {
          client_id: "123456-abc.apps.googleusercontent.com",
          client_secret: "GOC" + "SPX-secret1234567890123456",
          access_token: "ya29.valid_token",
          refresh_token: "1//valid_refresh",
          expires_at: Math.floor(Date.now() / 1000) + 7200,
          account_id: "artist@example.com",
        },
      },
      env,
    );

    const logs = [];
    try {
      await runCli(
        [
          "--prompt", "neon futuristic city",
          "--aspect-ratio", "16:9",
          "--image-size", "2K",
          "--model", "gemini-3-pro-image",
          "--output-dir", outDir,
          "--filename", "city.png",
        ],
        { env, log: (msg) => logs.push(msg) },
      );

      assert.equal(receivedPath, "/google.internal.cloud.code.v1internal.PredictionService/GenerateContent");
      assert.ok(receivedPayload.includes(Buffer.from("neon futuristic city", "utf8")));
      assert.ok(receivedPayload.includes(Buffer.from("16:9", "utf8")));
      assert.ok(receivedPayload.includes(Buffer.from("2K", "utf8")));

      const savedImg = path.join(outDir, "city.png");
      assert.ok(fs.existsSync(savedImg), "expected output PNG to exist on disk");
      assert.deepEqual(fs.readFileSync(savedImg), fakePng);

      const outputText = logs.join("\n");
      assert.match(outputText, /!\[Generated Image\]\(.*city\.png\)/);

      const updatedCfg = loadSkillConfig(env);
      assert.equal(updatedCfg.auth.project, "companion-mock-proj");
      assert.ok(updatedCfg.models.includes("gemini-3-pro-image"));
    } finally {
      restServer.close();
      grpcServer.close();
    }
  });
});

test("CLI: SKILL.md is standalone and parseCliArgs / helpers work as expected", () => {
  const ROOT = path.resolve(import.meta.dirname, "../..");
  const skillPath = path.join(ROOT, "lib", "skills", "leo-antigravity-imagine", "SKILL.md");
  const content = fs.readFileSync(skillPath, "utf8");
  assert.match(content, /name: leo-antigravity-imagine/);
  assert.match(content, /\.shrimp\/skills\/leo-antigravity-imagine\/config\.json/);
  assert.doesNotMatch(content, /127\.0\.0\.1:8787\/v1\/media\/image/);

  const parsed = parseCliArgs([
    "--prompt", "gemini image",
    "--images", "/a.jpg,/b.jpg",
    "--aspect-ratio", "9:16",
    "--image-size", "4K",
    "--proxy", "127.0.0.1:7897",
  ]);
  assert.equal(parsed.command, "generate");
  assert.equal(parsed.prompt, "gemini image");
  assert.deepEqual(parsed.imagePaths, ["/a.jpg", "/b.jpg"]);
  assert.equal(parsed.aspectRatio, "9:16");
  assert.equal(parsed.imageSize, "4K");
  assert.equal(parsed.proxy, "127.0.0.1:7897");

  assert.equal(slugifyPrompt("Hello 世界! 2026"), "hello_世界_2026");
  const d = new Date(2026, 10, 18, 14, 45, 57);
  const filename = generateSemanticFilename("末日废土雨夜求生，12格电影感短剧分镜", "png", null, {
    topic: "末日废土雨夜求生",
    style: "12格电影感短剧分镜",
    date: d,
  });
  assert.equal(filename, "末日废土雨夜求生_12格电影感短剧分镜_20261118_144557.png");

  const inferredFilename = generateSemanticFilename("极简现代玻璃山顶建筑，日落金色云海，建筑摄影高清细节", "jpg", null, { date: d });
  assert.equal(inferredFilename, "极简现代玻璃山顶建筑_建筑摄影高清细节_20261118_144557.jpg");
  assert.equal(detectBufferExt(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "png");
  assert.equal(detectBufferExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpg");
});

test("proto: Reader.skip(2) handles multi-byte varint unknown/thoughtSignature fields preceding inlineData", () => {
  // Build a Part manually with field 11 (tag 0x5a, wireType 2) length 20000 (3-byte varint) BEFORE field 2 (inlineData)
  const bigSig = Buffer.alloc(20000, 0xab);
  const encodeVarintLocal = (n) => {
    const out = [];
    while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    out.push(n & 0x7f);
    return Buffer.from(out);
  };
  const field11 = Buffer.concat([Buffer.from([0x5a]), encodeVarintLocal(bigSig.length), bigSig]);

  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const mime = Buffer.from("image/jpeg", "utf8");
  const blob = Buffer.concat([
    Buffer.from([0x0a, mime.length]), mime,
    Buffer.from([0x12, jpegBytes.length]), jpegBytes,
  ]);
  const field2 = Buffer.concat([Buffer.from([0x12]), encodeVarintLocal(blob.length), blob]);
  const part = Buffer.concat([field11, field2]);
  const content = Buffer.concat([Buffer.from([0x12]), encodeVarintLocal(part.length), part]);
  const candidate = Buffer.concat([Buffer.from([0x12]), encodeVarintLocal(content.length), content]);
  const master = Buffer.concat([Buffer.from([0x12]), encodeVarintLocal(candidate.length), candidate]);
  const root = Buffer.concat([Buffer.from([0x0a]), encodeVarintLocal(master.length), master]);

  const decoded = decodeGenerateContentResponse(root);
  const inline = decoded.response.candidates[0].content.parts[0].inlineData;
  assert.equal(inline.mimeType, "image/jpeg");
  assert.equal(inline.data, jpegBytes.toString("base64"));
});

test("outputDir: category/YYYY-MM-DD two-level archive under leo-imagine-router config.json or ./images", () => {
  withTempDir((dir) => {
    const fakeHome = path.join(dir, "home");
    const routerCfg = path.join(fakeHome, ".shrimp", "skills", "leo-imagine-router", "config.json");
    fs.mkdirSync(path.dirname(routerCfg), { recursive: true });
    const d = new Date(2026, 10, 18, 14, 45, 57);

    // Tier 3: no router config -> ./images/通用出图/2026-11-18
    assert.equal(
      resolveTargetOutputDir("", { HOME: fakeHome }, { date: d }),
      path.join(path.resolve("./images"), "通用出图", "2026-11-18"),
    );

    // Tier 2: leo-imagine-router config.json with ~/素材/imagine + --cat 影视分镜 -> ~/素材/imagine/影视分镜/2026-11-18
    fs.writeFileSync(routerCfg, JSON.stringify({ output_dir: "~/素材/imagine", folder_structure: "category_date" }), "utf8");
    assert.equal(
      resolveTargetOutputDir("", { HOME: fakeHome }, { category: "影视分镜", date: d }),
      path.join(fakeHome, "素材", "imagine", "影视分镜", "2026-11-18"),
    );

    // Tier 1: explicit --output-dir (e.g. passed by leo-imagine-router) used as-is unless --cat also given
    assert.equal(
      resolveTargetOutputDir("~/素材/imagine/海报艺术/2026-11-18", { HOME: fakeHome }, { date: d }),
      path.join(fakeHome, "素材", "imagine", "海报艺术", "2026-11-18"),
    );
  });
});
