import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isDeterministicQuotaError,
  runCredentialFailover,
  shouldFailoverCredential,
  shouldRetryUpstreamResponse,
} from "../../lib/upstream-retry.mjs";

test("does not retry deterministic account quota errors", async () => {
  const response = new Response(JSON.stringify({
    error: {
      code: "AccountQuotaExceeded",
      message: "You have exceeded the weekly usage quota.",
      type: "TooManyRequests",
    },
  }), { status: 429 });

  assert.equal(await shouldRetryUpstreamResponse(response), false);
});

test("retries ordinary rate limits and overload responses", async () => {
  assert.equal(
    await shouldRetryUpstreamResponse(
      new Response('{"error":{"message":"rate limit exceeded, retry later"}}', { status: 429 }),
    ),
    true,
  );
  assert.equal(await shouldRetryUpstreamResponse(new Response("", { status: 503 })), true);
  assert.equal(await shouldRetryUpstreamResponse(new Response("", { status: 400 })), false);
});

test("recognizes common deterministic quota error text", () => {
  assert.equal(isDeterministicQuotaError("AccountQuotaExceeded"), true);
  assert.equal(isDeterministicQuotaError("weekly usage quota will reset tomorrow"), true);
  assert.equal(isDeterministicQuotaError("requests per minute exceeded"), false);
});

test("credential failover retries 429 and every 5xx", async () => {
  assert.equal(
    await shouldFailoverCredential(new Response("", { status: 500 })),
    true,
  );
  assert.equal(
    await shouldFailoverCredential(new Response("", { status: 529 })),
    true,
  );
  assert.equal(
    await shouldFailoverCredential(new Response("", { status: 400 })),
    false,
  );
  assert.equal(
    await shouldFailoverCredential(new Response(JSON.stringify({
      error: { code: "AccountQuotaExceeded" },
    }), { status: 429 })),
    true,
  );
});

test("credential failover stops after min(key count, 3)", async () => {
  const seen = [];
  const response = await runCredentialFailover({
    credentials: [
      { credentialId: "a", apiKey: "key-a" },
      { credentialId: "b", apiKey: "key-b" },
      { credentialId: "c", apiKey: "key-c" },
      { credentialId: "d", apiKey: "key-d" },
    ],
    request: async ({ credential }) => {
      seen.push(credential.credentialId);
      return new Response("", { status: 503 });
    },
    limits: { perAttemptMs: 50, maxAttempts: 3, totalMs: 200 },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(seen, ["a", "b", "c"]);
});

test("credential failover moves on after network errors", async () => {
  const seen = [];
  const response = await runCredentialFailover({
    credentials: [
      { credentialId: "a", apiKey: "key-a" },
      { credentialId: "b", apiKey: "key-b" },
    ],
    request: async ({ credential }) => {
      seen.push(credential.credentialId);
      if (credential.credentialId === "a") throw new Error("socket closed");
      return new Response("ok", { status: 200 });
    },
    limits: { perAttemptMs: 50, maxAttempts: 3, totalMs: 200 },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ["a", "b"]);
});

test("credential failover enforces per-attempt and total deadlines", async () => {
  const started = Date.now();
  await assert.rejects(() => runCredentialFailover({
    credentials: [
      { credentialId: "a", apiKey: "key-a" },
      { credentialId: "b", apiKey: "key-b" },
    ],
    request: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ));
    }),
    limits: { perAttemptMs: 20, maxAttempts: 3, totalMs: 35 },
  }));
  assert.ok(Date.now() - started < 150);
});

test("openai chat routing adapts antigravity responses without requiring base_url", async () => {
  const source = await readFile(new URL("../../server.js", import.meta.url), "utf8");
  const chatRouteMatch = source.match(/async function forwardOpenAIChatCompletionsResolved\([\s\S]*?\nasync function /);
  const chatRoute = chatRouteMatch?.[0] || "";
  assert.ok(chatRoute);
  const allowedTypes = chatRoute.match(/const route = resolveConfiguredModel\(\s*requestedModel,\s*\[([^\]]+)\]/);
  assert.ok(allowedTypes);
  assert.match(allowedTypes[1], /["']antigravity["']/);
  assert.match(
    chatRoute,
    /if \(route\?\.provider\?\.type === ["']antigravity["']\) \{[\s\S]*?openAIChatCompletionsToResponses\(body, resolvedModel\)[\s\S]*?responseFormat: ["']chat["'][\s\S]*?return;/,
  );
});
