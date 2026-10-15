import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import zlib from "node:zlib";
import {
  sanitizeBlockedFeatures,
  sanitizeWhamUsage,
  decompressBuffer,
  mapDesktopUrlToUpstream,
  createDesktopApiShieldServer,
} from "../../lib/codex/desktop-api-shield.mjs";

test("sanitizeBlockedFeatures removes send and tpp_send but keeps other features", () => {
  const input = {
    conversation_id: "conv-123",
    blocked_features: [
      { name: "send", block_reason: "codex_rate_limit" },
      { name: "tpp_send", block_reason: "codex_rate_limit" },
      { name: "image_gen", block_reason: "daily_limit" },
      { name: "voice", block_reason: "unsupported" },
    ],
  };

  const output = sanitizeBlockedFeatures(input);
  assert.equal(output.blocked_features.length, 2);
  assert.deepEqual(
    output.blocked_features.map((f) => f.name),
    ["image_gen", "voice"]
  );
});

test("sanitizeBlockedFeatures handles nested structures and arrays", () => {
  const input = {
    detail: {
      conversation_detail_metadata: {
        blocked_features: [
          { name: "send", resets_after: "2026-10-15T15:00:00Z" },
        ],
      },
    },
    items: [
      {
        blocked_features: [{ name: "tpp_send" }],
      },
    ],
  };

  const output = sanitizeBlockedFeatures(input);
  assert.deepEqual(output.detail.conversation_detail_metadata.blocked_features, []);
  assert.deepEqual(output.items[0].blocked_features, []);
});

test("sanitizeWhamUsage sets rate_limit.allowed to true and enriches upsell notice", () => {
  const usagePayload = {
    user_id: "user-123",
    account_id: "acc-123",
    plan_type: "plus",
    rate_limit: {
      allowed: false,
      limit_reached: true,
      primary_window: { used_percent: 100 },
    },
    rate_limit_upsell: {
      title: "Codex 和工作使用额度已用完",
      description: "你的速率限制将于 1:15 重置...",
      ctas: [],
    },
    blocked_features: [{ name: "send" }],
  };

  const output = sanitizeWhamUsage(usagePayload);
  assert.equal(output.rate_limit.allowed, true);
  assert.ok(output.rate_limit_upsell.description.includes("官方模型当前配额已耗尽"));
  assert.ok(output.rate_limit_upsell.description.includes("解除输入框封锁"));
  assert.deepEqual(output.blocked_features, []);
});

test("decompressBuffer handles gzip, deflate and brotli correctly", () => {
  const original = Buffer.from("Hello world from Codex Shield!", "utf8");

  const gzipped = zlib.gzipSync(original);
  assert.deepEqual(decompressBuffer(gzipped, "gzip"), original);

  const deflated = zlib.deflateSync(original);
  assert.deepEqual(decompressBuffer(deflated, "deflate"), original);

  const brotli = zlib.brotliCompressSync(original);
  assert.deepEqual(decompressBuffer(brotli, "br"), original);

  // Uncompressed passthrough
  assert.deepEqual(decompressBuffer(original, ""), original);
});

test("mapDesktopUrlToUpstream translates /api and /public to ChatGPT endpoints", () => {
  assert.equal(
    mapDesktopUrlToUpstream("/api/wham/usage").href,
    "https://chatgpt.com/backend-api/wham/usage"
  );
  assert.equal(
    mapDesktopUrlToUpstream("/api/conversation/init?foo=bar").href,
    "https://chatgpt.com/backend-api/conversation/init?foo=bar"
  );
  assert.equal(
    mapDesktopUrlToUpstream("/public/v1/auth").href,
    "https://chatgpt.com/public-api/v1/auth"
  );
});

test("createDesktopApiShieldServer intercepts and transforms usage and blocked_features", async () => {
  // Start mock upstream server (simulating chatgpt.com)
  let lastUpstreamPath = "";
  const mockUpstream = http.createServer((req, res) => {
    lastUpstreamPath = req.url;

    if (req.url === "/backend-api/wham/usage") {
      const payload = JSON.stringify({
        rate_limit: { allowed: false, limit_reached: true },
        rate_limit_upsell: { title: "Limit", description: "Blocked" },
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "gzip",
      });
      res.end(zlib.gzipSync(Buffer.from(payload)));
      return;
    }

    if (req.url === "/backend-api/conversation/init") {
      const payload = JSON.stringify({
        conversation_id: "test-init",
        blocked_features: [{ name: "send" }, { name: "custom" }],
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(payload);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("passthrough");
  });

  await new Promise((resolve) => mockUpstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = mockUpstream.address().port;

  // Create shield server overriding https request with local mock upstream
  const shieldServer = http.createServer(async (req, res) => {
    // Forward to mock upstream instead of real chatgpt.com
    const reqUrl = req.url || "/";
    let targetPath = reqUrl;
    if (reqUrl.startsWith("/api/")) targetPath = "/backend-api/" + reqUrl.slice(5);

    const isUsage = reqUrl.startsWith("/api/wham/usage");
    const isConversation = reqUrl.startsWith("/api/conversation");

    const upstreamReq = http.request(
      `http://127.0.0.1:${upstreamPort}${targetPath}`,
      { method: req.method, headers: req.headers },
      (upstreamRes) => {
        const chunks = [];
        upstreamRes.on("data", (c) => chunks.push(c));
        upstreamRes.on("end", () => {
          const rawBuffer = Buffer.concat(chunks);
          const decompressed = decompressBuffer(rawBuffer, upstreamRes.headers["content-encoding"]);
          let data = JSON.parse(decompressed.toString("utf8"));

          if (isUsage) {
            data = sanitizeWhamUsage(data);
          } else if (isConversation) {
            data = sanitizeBlockedFeatures(data);
          }

          const outJson = JSON.stringify(data);
          res.writeHead(upstreamRes.statusCode, {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(outJson),
          });
          res.end(outJson);
        });
      }
    );
    req.pipe(upstreamReq);
  });

  await new Promise((resolve) => shieldServer.listen(0, "127.0.0.1", resolve));
  const shieldPort = shieldServer.address().port;

  // Test 1: GET /api/wham/usage
  const usageRes = await fetch(`http://127.0.0.1:${shieldPort}/api/wham/usage`);
  assert.equal(usageRes.status, 200);
  const usageData = await usageRes.json();
  assert.equal(usageData.rate_limit.allowed, true);
  assert.ok(usageData.rate_limit_upsell.description.includes("官方模型当前配额已耗尽"));

  // Test 2: POST /api/conversation/init
  const convRes = await fetch(`http://127.0.0.1:${shieldPort}/api/conversation/init`, {
    method: "POST",
  });
  assert.equal(convRes.status, 200);
  const convData = await convRes.json();
  assert.equal(convData.blocked_features.length, 1);
  assert.equal(convData.blocked_features[0].name, "custom");

  mockUpstream.close();
  shieldServer.close();
});
