import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPayload,
  parseArgs,
  requestDecision,
  resolveProviderConfig,
  validateRequest,
} from "../scripts/decide.mjs";

const REQUEST = {
  state: "Help! My payouts have been failing for 3 days.",
  questions: {
    urgent: {
      type: "noul",
      instructions: "Is this urgent?",
    },
    department: {
      type: "choice",
      instructions: "Which team?",
      criteria: { billing: "Payments", technical: "Bugs" },
    },
    frustration: {
      type: "score",
      instructions: "How frustrated?",
      criteria: ["Calm", "Angry"],
    },
  },
};

test("defaults to OpenRouter with one generic key", () => {
  const args = parseArgs([]);
  const config = resolveProviderConfig(args, { LEO_TYPESAFE_API_KEY: "secret" });
  assert.equal(config.provider, "openrouter");
  assert.equal(config.endpoint, "https://openrouter.ai/api/v1/systemone");
  assert.equal(config.apiKey, "secret");
  assert.equal(config.apiKeyEnv, "LEO_TYPESAFE_API_KEY");
});

test("uses provider-specific keys only as compatibility fallbacks", () => {
  const openrouter = resolveProviderConfig({ provider: "openrouter" }, { OPENROUTER_API_KEY: "or" });
  const typesafe = resolveProviderConfig({ provider: "typesafe" }, { TYPESAFE_API_KEY: "ts" });
  assert.equal(openrouter.apiKey, "or");
  assert.equal(typesafe.apiKey, "ts");
});

test("custom provider needs a URL and defaults to generic key", () => {
  assert.throws(() => resolveProviderConfig({ provider: "custom" }, {}), /requires --url/);
  const config = resolveProviderConfig(
    { provider: "custom", url: "https://example.com/v1/systemone" },
    { LEO_TYPESAFE_API_KEY: "custom" },
  );
  assert.equal(config.apiKey, "custom");
  assert.equal(config.model, "jev-latest");
});

test("validates questions and adds the default model", () => {
  assert.equal(validateRequest(REQUEST), REQUEST);
  const payload = buildPayload(REQUEST, { model: "jev-latest" });
  assert.equal(payload.model, "jev-latest");
  assert.throws(
    () => validateRequest({ state: "x", questions: { bad: { type: "choice", instructions: "x", criteria: { one: null } } } }),
    /at least two criteria/,
  );
});

test("retries a transient response once and returns JSON", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 529 });
    }
    return new Response(JSON.stringify({ model: "jev", answers: {}, usage: {} }), { status: 200 });
  };
  const result = await requestDecision({
    config: {
      endpoint: "https://example.com/v1/systemone",
      apiKey: "secret",
      acceptedKeyEnvs: ["LEO_TYPESAFE_API_KEY"],
    },
    payload: REQUEST,
    retries: 1,
    fetchImpl,
    wait: async () => {},
  });
  assert.equal(calls, 2);
  assert.equal(result.model, "jev");
});

test("never accepts a secret as a CLI argument", () => {
  assert.throws(() => parseArgs(["--api-key", "secret"]), /Unknown argument/);
});

