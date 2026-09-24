import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDurationSeconds,
  parseRateLimitResetInfo,
  isTitleOrSummaryRequest,
  buildRateLimitNoticeMarkdown,
  handleOfficialRateLimit,
} from "../../lib/codex/rate-limit-shield.mjs";

test("formatDurationSeconds formats various ranges correctly", () => {
  assert.equal(formatDurationSeconds(0), "稍后重置");
  assert.equal(formatDurationSeconds(-5), "稍后重置");
  assert.equal(formatDurationSeconds(45), "约 45 秒后");
  assert.equal(formatDurationSeconds(120), "约 2 分钟后");
  assert.equal(formatDurationSeconds(3600), "约 1 小时后");
  assert.equal(formatDurationSeconds(3665), "约 1 小时 1 分钟后");
  assert.equal(formatDurationSeconds(18000), "约 5 小时后");
});

test("parseRateLimitResetInfo extracts clears_in from upstream error JSON", () => {
  const jsonWithClearsIn = JSON.stringify({
    error: {
      message: "Rate limit exceeded",
      type: "model_cap_exceeded",
      code: "model_cap_exceeded",
      clears_in: 3600,
    },
  });

  const info = parseRateLimitResetInfo(jsonWithClearsIn);
  assert.equal(info.clearsInSeconds, 3600);
  assert.ok(info.display.includes("约 1 小时后"));
  assert.ok(info.targetTimeStr != null);
});

test("parseRateLimitResetInfo uses fallback resets_at when error JSON lacks clears_in", () => {
  const futureTimestampSec = Math.floor(Date.now() / 1000) + 7200;
  const info = parseRateLimitResetInfo("plain 429 text", futureTimestampSec);
  assert.ok(info.clearsInSeconds >= 7190 && info.clearsInSeconds <= 7200);
  assert.ok(info.display.includes("约 2 小时后") || info.display.includes("约 1 小时 59 分钟后"));
});

test("parseRateLimitResetInfo defaults gracefully when no time is available", () => {
  const info = parseRateLimitResetInfo("non-json rate limit");
  assert.equal(info.clearsInSeconds, null);
  assert.equal(info.display, "稍后重置（可通过网关账号中心查看详情）");
});

test("isTitleOrSummaryRequest identifies title generation requests", () => {
  assert.equal(isTitleOrSummaryRequest({ input: [{ text: "Generate a concise title in 5 words or fewer" }] }), true);
  assert.equal(isTitleOrSummaryRequest({ instructions: "Generate title for thread" }), true);
  assert.equal(isTitleOrSummaryRequest({ input: "What is the capital of France?" }), false);
  assert.equal(isTitleOrSummaryRequest(null), false);
});

test("handleOfficialRateLimit ignores non-429 upstream", async () => {
  let written = false;
  const mockRes = {
    writeHead() { written = true; },
    write() { written = true; },
    end() { written = true; },
  };

  const handled = await handleOfficialRateLimit({
    upstream: { status: 500 },
    clientRes: mockRes,
  });
  assert.equal(handled, false);
  assert.equal(written, false);
});

test("handleOfficialRateLimit transforms stream 429 into 200 OK SSE events", async () => {
  let statusCode = 0;
  let headers = {};
  const chunks = [];
  let ended = false;

  const mockRes = {
    headersSent: false,
    writableEnded: false,
    writeHead(code, h) {
      statusCode = code;
      headers = h;
      this.headersSent = true;
    },
    write(chunk) {
      chunks.push(chunk);
    },
    end() {
      ended = true;
      this.writableEnded = true;
    },
  };

  const handled = await handleOfficialRateLimit({
    upstream: { status: 429 },
    clientRes: mockRes,
    body: { stream: true },
    requestedModel: "gpt-5.6-sol",
    requestId: "test-req-1",
    errorText: JSON.stringify({ error: { clears_in: 18000 } }),
  });

  assert.equal(handled, true);
  assert.equal(statusCode, 200);
  assert.equal(headers["Content-Type"], "text/event-stream; charset=utf-8");
  assert.equal(ended, true);

  const fullOutput = chunks.join("");
  assert.ok(fullOutput.includes("event: response.created"));
  assert.ok(fullOutput.includes("event: response.output_text.delta"));
  assert.ok(fullOutput.includes("event: response.completed"));
  assert.ok(fullOutput.includes("官方模型当前配额已耗尽"));
  assert.ok(fullOutput.includes("gpt-5.6-sol"));
  assert.ok(fullOutput.includes("约 5 小时后"));
  assert.ok(fullOutput.includes("输入框已为您保持可用"));
});

test("handleOfficialRateLimit handles non-stream 429 as 200 OK JSON", async () => {
  let statusCode = 0;
  let headers = {};
  let bodyData = "";
  let ended = false;

  const mockRes = {
    headersSent: false,
    writableEnded: false,
    writeHead(code, h) {
      statusCode = code;
      headers = h;
      this.headersSent = true;
    },
    end(data) {
      bodyData = data;
      ended = true;
      this.writableEnded = true;
    },
  };

  const handled = await handleOfficialRateLimit({
    upstream: { status: 429 },
    clientRes: mockRes,
    body: { stream: false },
    requestedModel: "gpt-5.6-luna",
    requestId: "test-req-2",
  });

  assert.equal(handled, true);
  assert.equal(statusCode, 200);
  assert.equal(headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(ended, true);

  const parsed = JSON.parse(bodyData);
  assert.equal(parsed.status, "completed");
  assert.equal(parsed.object, "response");
  assert.ok(parsed.output[0].content[0].text.includes("官方模型当前配额已耗尽"));
});

test("handleOfficialRateLimit gracefully falls back title requests to default title", async () => {
  let bodyData = "";
  const mockRes = {
    headersSent: false,
    writableEnded: false,
    writeHead() {},
    end(data) {
      bodyData = data;
    },
  };

  const handled = await handleOfficialRateLimit({
    upstream: { status: 429 },
    clientRes: mockRes,
    body: { stream: false, input: [{ text: "Generate title for thread" }] },
    requestedModel: "gpt-5.6-luna",
    requestId: "test-req-title",
  });

  assert.equal(handled, true);
  const parsed = JSON.parse(bodyData);
  assert.equal(parsed.status, "completed");
  assert.equal(parsed.output[0].content[0].text, "新对话");
});
