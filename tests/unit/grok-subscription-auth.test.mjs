import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getGrokAuthStatus,
  getGrokUsage,
} from "../../lib/grok/subscription-auth.mjs";
import {
  listProviders,
  runProviderAction,
} from "../../lib/subscription-auth/index.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "grok-auth-"));
}

function writeAuth(dir, entry, filename = "auth.json") {
  const authPath = path.join(dir, filename);
  fs.writeFileSync(authPath, JSON.stringify({
    "https://auth.x.ai::scope": entry,
  }));
  return authPath;
}

test("grok status reports ready auth and counts grok nodes", () => {
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "session-key",
    user_id: "user-1",
    email: "user@example.com",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  const status = getGrokAuthStatus({
    env: { GROK_AUTH_PATH: authPath },
    config: {
      clients: {
        codex: {
          endpoints: [
            { id: "one", type: "grok", models: ["grok-4.5"] },
            { id: "two", type: "grok-subscription" },
            { id: "three", type: "openai-chat" },
          ],
        },
      },
    },
  });
  assert.equal(status.provider, "grok");
  assert.equal(status.state, "ready");
  assert.equal(status.token.account_id, "user@example.com");
  assert.equal(status.nodes.count, 2);
  assert.equal(status.usage.available, false);
});

test("grok status reports expired auth", () => {
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "session-key",
    user_id: "user-1",
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  const status = getGrokAuthStatus({ env: { GROK_AUTH_PATH: authPath } });
  assert.equal(status.state, "token_expired");
  assert.equal(status.state_label, "Token 已过期");
});

test("grok usage normalizes credits and sends official headers", async () => {
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "session-key",
    user_id: "user-1",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  let captured;
  const usage = await getGrokUsage({
    env: { GROK_AUTH_PATH: authPath },
    baseUrl: "https://proxy.example/v1",
    fetchImpl: async (url, init) => {
      captured = { url, headers: init.headers };
      return {
        ok: true,
        json: async () => ({
          config: {
            creditUsagePercent: 42.5,
            currentPeriod: {
              type: "USAGE_PERIOD_TYPE_WEEKLY",
              start: "2026-08-12T14:32:36Z",
              end: "2026-08-19T14:32:36Z",
            },
            prepaidBalance: { val: 1250 },
            onDemandUsed: { val: 100 },
            onDemandCap: { val: 500 },
          },
        }),
      };
    },
  });
  assert.equal(captured.url, "https://proxy.example/v1/billing?format=credits");
  assert.equal(captured.headers.Authorization, "Bearer session-key");
  assert.equal(captured.headers["X-XAI-Token-Auth"], "xai-grok-cli");
  assert.equal(captured.headers.xuserid, "user-1");
  assert.equal(usage.available, true);
  assert.equal(usage.used_percent, 42.5);
  assert.equal(usage.remaining_percent, 57.5);
  assert.equal(usage.period.type, "USAGE_PERIOD_TYPE_WEEKLY");
  assert.equal(usage.prepaid_balance_usd, 12.5);
  assert.equal(usage.on_demand_used_usd, 1);
  assert.equal(usage.on_demand_cap_usd, 5);
});

test("grok usage does not request billing without credentials", async () => {
  const dir = tmpDir();
  const usage = await getGrokUsage({
    env: { GROK_AUTH_PATH: path.join(dir, "missing.json") },
    fetchImpl: async () => {
      throw new Error("must not fetch");
    },
  });
  assert.equal(usage.available, false);
  assert.equal(usage.error.code, "grok_auth_missing");
});

test("subscription registry lists grok and supports usage action", async () => {
  assert.ok(listProviders().some((provider) => provider.id === "grok"));
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "session-key",
    user_id: "user-1",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  const usage = await runProviderAction("grok", "usage", {
    env: { GROK_AUTH_PATH: authPath },
    baseUrl: "https://proxy.example/v1",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ config: { creditUsagePercent: 25 } }),
    }),
  });
  assert.equal(usage.remaining_percent, 75);
});
