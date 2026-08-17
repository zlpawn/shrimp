import test from "node:test";
import assert from "node:assert/strict";
import { detectQuotaExhaustion } from "../../lib/session-kanban/infra/quota-detector.mjs";

test("quota detector parses Volcengine Ark weekly limit reset timestamp", () => {
  const logError = "Vision fallback failed: {\"error\":{\"code\":\"AccountQuotaExceeded\",\"message\":\"You have exceeded the weekly usage quota. It will reset at 2026-08-03 00:00:00 +0800 CST. We recommend upgrading your plan for more quota, or waiting for the reset.\",\"type\":\"TooManyRequests\"}}";
  const now = Date.parse("2026-08-01T12:00:00+08:00");
  const result = detectQuotaExhaustion({ error: logError, now });

  assert.equal(result.isQuotaError, true);
  assert.equal(result.vendorTag, "volcengine");
  assert.equal(result.vendorName, "火山引擎");
  assert.ok(result.resumeAtMs > now);
  const expectedMs = Date.parse("2026-08-03T00:00:00+08:00");
  assert.equal(result.resumeAtMs, expectedMs);
  assert.match(result.reason, /周配额|AccountQuotaExceeded|reset/i);
});

test("quota detector parses Claude 5-hour limit reset duration and clock time", () => {
  const now = Date.parse("2026-08-17T12:00:00Z");
  
  // Duration format
  const resDuration = detectQuotaExhaustion({
    error: "You have reached your 5-hour limit. Try again in 3 hours 30 minutes.",
    now,
  });
  assert.equal(resDuration.isQuotaError, true);
  assert.equal(resDuration.vendorTag, "claude");
  assert.equal(resDuration.resumeAtMs, now + (3 * 3600 + 30 * 60) * 1000);

  // Time format
  const resTime = detectQuotaExhaustion({
    error: "You have reached your message limit. It will reset at 15:30.",
    now: Date.parse("2026-08-17T12:00:00+08:00"),
  });
  assert.equal(resTime.isQuotaError, true);
  assert.equal(resTime.vendorTag, "claude");
  assert.ok(resTime.resumeAtMs > Date.parse("2026-08-17T12:00:00+08:00"));
});

test("quota detector detects Zhipu GLM 1301/1302 and balance exhaustion", () => {
  const now = Date.parse("2026-08-17T12:00:00Z");
  const res1301 = detectQuotaExhaustion({ error: "Zhipu API error: 1301 系统繁忙或调用频率超限", now });
  assert.equal(res1301.isQuotaError, true);
  assert.equal(res1301.vendorTag, "zhipu");
  assert.equal(res1301.vendorName, "智谱 AI");
  assert.ok(res1301.resumeAtMs > now);

  const res1302 = detectQuotaExhaustion({ error: "1302 账户余额不足或已欠费", now });
  assert.equal(res1302.isQuotaError, true);
  assert.equal(res1302.vendorTag, "zhipu");
});

test("quota detector detects DeepSeek 429 rate limit and 402 insufficient balance", () => {
  const now = Date.parse("2026-08-17T12:00:00Z");
  const res429 = detectQuotaExhaustion({ error: "DeepSeek API error 429: Rate limit reached", now });
  assert.equal(res429.isQuotaError, true);
  assert.equal(res429.vendorTag, "deepseek");
  assert.equal(res429.vendorName, "DeepSeek");

  const resBalance = detectQuotaExhaustion({ error: "DeepSeek: Insufficient Balance 余额不足", now });
  assert.equal(resBalance.isQuotaError, true);
  assert.equal(resBalance.vendorTag, "deepseek");
});

test("quota detector detects Grok xAI rate limits and token expiration", () => {
  const now = Date.parse("2026-08-17T12:00:00Z");
  const resToken = detectQuotaExhaustion({ error: "Grok session token expired. Run `grok` to refresh, then retry.", now });
  assert.equal(resToken.isQuotaError, true);
  assert.equal(resToken.vendorTag, "grok");

  const resRate = detectQuotaExhaustion({ error: "xAI Grok: Rate limit exceeded. Throttled.", now });
  assert.equal(resRate.isQuotaError, true);
  assert.equal(resRate.vendorTag, "grok");
});

test("quota detector detects Antigravity gRPC resource exhaustion", () => {
  const now = Date.parse("2026-08-17T12:00:00Z");
  const result = detectQuotaExhaustion({
    error: "gRPC error: status=8 message=Resource has been exhausted (e.g. check quota).",
    now,
  });
  assert.equal(result.isQuotaError, true);
  assert.equal(result.vendorTag, "antigravity");
  assert.equal(result.vendorName, "Antigravity");
  assert.ok(result.resumeAtMs > now);
});

test("quota detector ignores non-quota errors", () => {
  const result = detectQuotaExhaustion({ error: "TypeError: Cannot read properties of undefined" });
  assert.equal(result.isQuotaError, false);
});
