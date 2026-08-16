import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getGrokAuthStatus,
  getGrokUsage,
  refreshGrokToken,
  ensureFreshGrokAuth,
  writeGrokCredential,
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

test("grok status reports expired auth without refresh_token", () => {
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "session-key",
    user_id: "user-1",
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  const status = getGrokAuthStatus({ env: { GROK_AUTH_PATH: authPath } });
  assert.equal(status.state, "token_expired");
  assert.equal(status.state_label, "Token 已过期");
  assert.equal(status.token.refresh_token_configured, false);
});

test("grok status reports auto-refreshable when expired with refresh_token", () => {
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "session-key",
    user_id: "user-1",
    refresh_token: "refresh-secret",
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  const status = getGrokAuthStatus({ env: { GROK_AUTH_PATH: authPath } });
  assert.equal(status.state, "ready");
  assert.equal(status.state_label, "可自动刷新");
  assert.equal(status.token.refresh_token_configured, true);
  assert.equal(status.token.expired, true);
});

test("grok refreshGrokToken successfully refreshes and writes back to file", async () => {
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "old-access-token",
    refresh_token: "old-refresh-token",
    oidc_client_id: "test-client-id",
    user_id: "user-123",
    email: "test@example.com",
    expires_at: new Date(Date.now() - 10000).toISOString(),
  });

  let capturedUrl = "";
  let capturedBody = "";
  let capturedHeaders = null;

  const result = await refreshGrokToken({
    env: { GROK_AUTH_PATH: authPath },
    fetchImpl: async (url, init) => {
      capturedUrl = url;
      capturedBody = init.body;
      capturedHeaders = init.headers;
      return {
        ok: true,
        json: async () => ({
          access_token: "new-access-token-xyz",
          refresh_token: "new-refresh-token-abc",
          expires_in: 21600,
        }),
      };
    },
  });

  assert.equal(capturedUrl, "https://auth.x.ai/oauth2/token");
  assert.match(capturedBody, /grant_type=refresh_token/);
  assert.match(capturedBody, /refresh_token=old-refresh-token/);
  assert.match(capturedBody, /client_id=test-client-id/);
  assert.equal(capturedHeaders["Content-Type"], "application/x-www-form-urlencoded");

  assert.equal(result.ok, true);
  assert.equal(result.access_token, "new-access-token-xyz");
  assert.equal(result.refresh_token, "new-refresh-token-abc");
  assert.equal(result.expires_in_seconds, 21600);

  // Verify file was updated safely while preserving user_id and email
  const updated = JSON.parse(fs.readFileSync(authPath, "utf8"));
  const entry = updated["https://auth.x.ai::scope"];
  assert.equal(entry.key, "new-access-token-xyz");
  assert.equal(entry.refresh_token, "new-refresh-token-abc");
  assert.equal(entry.user_id, "user-123");
  assert.equal(entry.email, "test@example.com");
  assert.ok(Date.parse(entry.expires_at) > Date.now());
});

test("grok refreshGrokToken throws if refresh_token is missing", async () => {
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "old-access-token",
    user_id: "user-123",
  });

  await assert.rejects(
    async () => {
      await refreshGrokToken({ env: { GROK_AUTH_PATH: authPath } });
    },
    { code: "grok_refresh_token_missing" }
  );
});

test("grok refreshGrokToken throws on upstream 400 error", async () => {
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "old-access-token",
    refresh_token: "invalid-refresh-token",
  });

  await assert.rejects(
    async () => {
      await refreshGrokToken({
        env: { GROK_AUTH_PATH: authPath },
        fetchImpl: async () => ({
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: "invalid_grant", error_description: "Refresh token is invalid or expired" }),
        }),
      });
    },
    (err) => {
      assert.equal(err.code, "grok_refresh_failed");
      assert.match(err.message, /Refresh token is invalid or expired/);
      return true;
    }
  );
});

test("ensureFreshGrokAuth skips refresh when token is fresh", async () => {
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "valid-token",
    refresh_token: "valid-refresh",
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  });

  let fetched = false;
  const auth = await ensureFreshGrokAuth({
    env: { GROK_AUTH_PATH: authPath },
    fetchImpl: async () => {
      fetched = true;
      return { ok: true };
    },
  });

  assert.equal(fetched, false);
  assert.equal(auth.key, "valid-token");
});

test("ensureFreshGrokAuth auto-refreshes when token is expired", async () => {
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "expired-token",
    refresh_token: "refresh-token",
    expires_at: new Date(Date.now() - 10000).toISOString(),
  });

  let fetched = false;
  const auth = await ensureFreshGrokAuth({
    env: { GROK_AUTH_PATH: authPath },
    fetchImpl: async () => {
      fetched = true;
      return {
        ok: true,
        json: async () => ({
          access_token: "fresh-auto-token",
          expires_in: 3600,
        }),
      };
    },
  });

  assert.equal(fetched, true);
  assert.equal(auth.key, "fresh-auto-token");
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

test("subscription registry lists grok and supports usage and refresh actions", async () => {
  assert.ok(listProviders().some((provider) => provider.id === "grok"));
  const dir = tmpDir();
  const authPath = writeAuth(dir, {
    key: "session-key",
    refresh_token: "refresh-key",
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

  const refreshResult = await runProviderAction("grok", "refresh", {
    env: { GROK_AUTH_PATH: authPath },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ access_token: "new-token-from-action", expires_in: 3600 }),
    }),
  });
  assert.equal(refreshResult.ok, true);
  assert.equal(refreshResult.access_token, "new-token-from-action");
});
