import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUserQuotaSummaryForTests,
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
  const usage = normalizeUserQuotaSummaryForTests({
    groups: [
      {
        id: "gemini-weekly",
        title: "Weekly Limit Remaining",
        window: "weekly",
        quota: { remaining_percent: 100 },
        description: "You have used some of your weekly limit, it will fully refresh in 3 days, 15 hours.",
      },
      {
        id: "gemini-5h",
        title: "Five Hour Limit Remaining",
        window: "5h",
        quota: { remaining_percent: 25 },
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
    group: "gemini",
    remaining_percent: 100,
    reset_after: "3 天 15 小时",
    reset_hint: "",
  });
  assert.deepEqual(usage.limits[1], {
    id: "5h",
    label: "5 小时额度",
    group: "gemini",
    remaining_percent: 25,
    reset_after: "1 小时 30 分钟",
    reset_hint: "",
  });
});

test("quota summary parses real wire payload with gemini and third-party groups", () => {
  const summaryMethod = quotaMethodRegistry.find((method) => method.id === "RetrieveUserQuotaSummary");
  const payload = summaryMethod.normalize({
    groups: [
      {
        id: "gemini-weekly",
        title: "Weekly Limit Remaining",
        window: "weekly",
        quota: { remaining_percent: 82.4889600276947 },
        description: "You have used some of your weekly limit, it will fully refresh in 3 days, 7 hours.",
      },
      {
        id: "gemini-5h",
        title: "Five Hour Limit Remaining",
        window: "5h",
        quota: { remaining_percent: 99.98999834060669 },
        description: "You have used some of your 5-hour limit, it will fully refresh in 4 hours, 57 minutes.",
      },
      {
        id: "3p-weekly",
        title: "Weekly Limit Remaining",
        window: "weekly",
        quota: { remaining_percent: 100 },
      },
      {
        id: "3p-5h",
        title: "Five Hour Limit Remaining",
        window: "5h",
        quota: { remaining_percent: 100 },
      },
    ],
  });
  assert.equal(payload.limits.length, 4);
  assert.deepEqual(payload.limits.map((limit) => [limit.group, limit.id]), [
    ["gemini", "weekly"],
    ["gemini", "5h"],
    ["third_party", "weekly"],
    ["third_party", "5h"],
  ]);
  assert.equal(payload.limits[0].remaining_percent.toFixed(2), "82.49");
  assert.equal(payload.limits[1].remaining_percent.toFixed(2), "99.99");
  assert.equal(payload.limits[2].remaining_percent, 100);
  assert.equal(payload.limits[3].remaining_percent, 100);
  assert.equal(payload.limits[0].reset_after, "3 天 7 小时");
  assert.equal(payload.limits[1].reset_after, "4 小时 57 分钟");
});

test("quota summary decoder parses real nested quota entries", () => {
  const summaryMethod = quotaMethodRegistry.find((method) => method.id === "RetrieveUserQuotaSummary");
  const payload = summaryMethod.decode(Buffer.from(
    "12e8020a90010a0d67656d696e692d7765656b6c7912165765656b6c79204c696d69742052656d61696e696e671a067765656b6c79320608abd995d4063a52596f752068617665207573656420736f6d65206f6620796f7572207765656b6c79206c696d69742c2069742077696c6c2066756c6c79207265667265736820696e203320646179732c203720686f7572732e25f72b533f0a8f010a0967656d696e692d356812194669766520486f7572204c696d69742052656d61696e696e671a02356832060891b585d4063a56596f752068617665207573656420736f6d65206f6620796f757220352d686f7572206c696d69742c2069742077696c6c2066756c6c79207265667265736820696e203420686f7572732c203537206d696e757465732e2572f97f3f120d47656d696e69204d6f64656c731a324d6f64656c732077697468696e20746869732067726f75703a2047656d696e6920466c6173682c2047656d696e692050726f12c5010a380a0933702d7765656b6c7912165765656b6c79204c696d69742052656d61696e696e671a067765656b6c79320608e89ea9d406250000803f0a330a0533702d356812194669766520486f7572204c696d69742052656d61696e696e671a023568320608b8b685d406250000803f1215436c6175646520616e6420475054206d6f64656c731a3d4d6f64656c732077697468696e20746869732067726f75703a20436c61756465204f7075772c20436c6175646520536f6e6e65742c204750542d4f53531afb0257697468696e20656163682067726f75702c206d6f64656c732073686172652061207765656b6c79206c696d697420616e64206120352d686f7572206c696d69742e",
    "hex",
  ));
  const usage = summaryMethod.normalize(payload);
  assert.equal(usage.limits.length, 4);
  assert.deepEqual(usage.limits.map((limit) => [limit.group, limit.id]), [
    ["gemini", "weekly"],
    ["gemini", "5h"],
    ["third_party", "weekly"],
    ["third_party", "5h"],
  ]);
  assert.equal(usage.limits[0].remaining_percent.toFixed(2), "82.49");
  assert.equal(usage.limits[1].remaining_percent.toFixed(2), "99.99");
  assert.equal(usage.limits[2].remaining_percent, 100);
  assert.equal(usage.limits[3].remaining_percent, 100);
  assert.equal(usage.limits[0].reset_after, "3 天 7 小时");
  assert.equal(usage.limits[1].reset_after, "4 小时 57 分钟");
});
