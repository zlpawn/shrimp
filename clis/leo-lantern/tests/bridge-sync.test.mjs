import test from "node:test";
import assert from "node:assert/strict";
import {
  heartbeatTarget,
  registerTarget,
} from "../../../extensions/leo-cookie-txt-locally/bridge-sync.mjs";

function response(ok, status = ok ? 200 : 404) {
  return { ok, status };
}

test("registration falls back to Gateway when Bridge hello returns 404", async () => {
  const calls = [];
  const result = await registerTarget(
    "http://127.0.0.1:8788",
    { id: "ext-1", task: { taskId: "task-1" } },
    async (url, options) => {
      calls.push([url, JSON.parse(options.body)]);
      if (url.endsWith("/ext/hello")) return response(false, 404);
      if (url.endsWith("/v1/extensions/register")) return response(true, 200);
      throw new Error(`unexpected URL ${url}`);
    }
  );

  assert.deepEqual(result, { online: true, mode: "gateway" });
  assert.deepEqual(calls.map(([url]) => new URL(url).pathname), [
    "/ext/hello",
    "/v1/extensions/register",
  ]);
});

test("registration reports offline when both non-2xx attempts fail", async () => {
  const result = await registerTarget(
    "http://127.0.0.1:8788",
    { id: "ext-2" },
    async () => response(false, 503)
  );
  assert.deepEqual(result, { online: false, mode: null });
});

test("heartbeat falls back on non-2xx and preserves the task summary", async () => {
  const calls = [];
  const payload = { id: "ext-3", task: { taskId: "task-active", claimedTabId: 9 } };
  const result = await heartbeatTarget(
    "http://127.0.0.1:8788",
    payload,
    async (url, options) => {
      calls.push([url, JSON.parse(options.body)]);
      return url.endsWith("/ext/heartbeat") ? response(false, 404) : response(true, 200);
    }
  );

  assert.deepEqual(result, { online: true, mode: "gateway" });
  assert.deepEqual(calls[1][1], payload);
});

test("network failure on the first path still attempts the fallback", async () => {
  let calls = 0;
  const result = await registerTarget("http://127.0.0.1:8788", { id: "ext-4" }, async () => {
    calls += 1;
    if (calls === 1) throw new Error("connection reset");
    return response(true, 200);
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, { online: true, mode: "gateway" });
});
