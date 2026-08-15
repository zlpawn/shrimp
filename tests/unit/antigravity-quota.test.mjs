import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeUserQuotaSummaryForTests,
  retrieveAntigravityQuota,
  normalizeAntigravityQuotaResponse,
  quotaMethodRegistry,
} from "../../lib/antigravity/quota.mjs";
import { antigravitySubscriptionAuthProvider } from "../../lib/antigravity/auth-service.mjs";
import { getAntigravityUsage, resetAntigravityUsageForTests } from "../../lib/antigravity/usage-store.mjs";

test("quota registry exposes open extension points with transport paths", () => {
  const summary = quotaMethodRegistry.find((method) => method.id === "RetrieveUserQuotaSummary");
  assert.equal(summary.path, "/google.internal.cloud.code.v1internal.PredictionService/RetrieveUserQuotaSummary");
  assert.equal(typeof summary.decode, "function");
  const quota = quotaMethodRegistry.find((method) => method.id === "RetrieveUserQuota");
  assert.equal(quota.path, "/google.internal.cloud.code.v1internal.PredictionService/RetrieveUserQuota");
});

test("normalize quota response maps common scalar quota fields", () => {
  const usage = normalizeAntigravityQuotaResponse({
    remainingCredits: 88,
    consumedCredits: 12,
    quota: {
      remainingCredits: 88,
      consumedCredits: 12,
    },
  });
  assert.equal(usage.available, true);
  assert.equal(usage.remaining_credits, 88);
  assert.equal(usage.consumed_credits, 12);
});

test("normalize quota response reports unavailable without fields", () => {
  const usage = normalizeAntigravityQuotaResponse({});
  assert.equal(usage.available, false);
  assert.equal(usage.error.code, "antigravity_quota_fields_unavailable");
});

test("provider exposes async quota usage retrieval", () => {
  assert.equal(typeof antigravitySubscriptionAuthProvider.getUsage, "function");
});

test("retrieve quota records successful response and falls back to latest usage", async () => {
  resetAntigravityUsageForTests();
  const failure = await retrieveAntigravityQuota({
    callUnary: async () => {
      throw new Error("unavailable");
    },
    fallback: () => getAntigravityUsage(),
  });
  assert.equal(failure.available, false);
  const success = await retrieveAntigravityQuota({
    callUnary: async () => ({ remainingCredits: 42, consumedCredits: 58 }),
    methods: [{
      id: "test",
      path: "/service/Test",
      request: () => Buffer.alloc(0),
      decode: (payload) => payload,
      normalize: normalizeAntigravityQuotaResponse,
    }],
  });
  assert.equal(success.remaining_credits, 42);
  assert.equal(getAntigravityUsage().remaining_credits, 42);
});

test("quota summary retains multiple limits with localized labels", () => {
  const usage = decodeUserQuotaSummaryForTests({
    groups: [
      {
        id: "gemini-weekly",
        title: "Weekly Limit Remaining",
        window: "weekly",
        quota: { field1: 1_000_000 },
        description: "You have used some of your weekly limit, it will fully refresh in 3 days, 15 hours.",
      },
      {
        id: "gemini-5h",
        title: "Five Hour Limit Remaining",
        window: "5h",
        quota: { field1: 250_000 },
        description: "You have used some of your 5-hour limit, it will fully refresh in 1 hour, 30 minutes.",
      },
    ],
  });
  assert.equal(usage.available, true);
  assert.equal(usage.remaining_percent, 100);
  assert.equal(usage.limits.length, 2);
  assert.deepEqual(usage.limits[0], {
    id: "weekly",
    label: "周额度",
    remaining_percent: 100,
    reset_hint: "已使用部分周额度，将在 3 天 15 小时后刷新。",
  });
  assert.deepEqual(usage.limits[1], {
    id: "5h",
    label: "5 小时额度",
    remaining_percent: 25,
    reset_hint: "已使用部分 5 小时额度，将在 1 小时 30 分钟后刷新。",
  });
});
