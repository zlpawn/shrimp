import test from "node:test";
import assert from "node:assert/strict";
import { exportCookies } from "../../../../extensions/leo-cookie-txt-locally/cookie-export.mjs";
import { executeCommand } from "../scripts/cli/lib/cli.mjs";
import { startFakeExtension } from "./fake-extension.mjs";

function chromeWith(cookies) {
  const calls = [];
  return {
    calls,
    cookies: {
      getAll: async (details) => {
        calls.push(details);
        return cookies;
      },
    },
  };
}

const COOKIE = { name: "sid", value: "x", domain: ".ke.com" };

test("reads by url when given one, so parent-domain cookies are included, and says so", async () => {
  const chromeApi = chromeWith([COOKIE]);
  const result = await exportCookies(chromeApi, { url: "https://luke.ke.com/api", domain: "luke.ke.com" });
  assert.deepEqual(chromeApi.calls, [{ url: "https://luke.ke.com/api" }]);
  assert.deepEqual(result, { cookies: [COOKIE], count: 1, matchedBy: "url" });
});

test("reads by domain when no url is given", async () => {
  const chromeApi = chromeWith([COOKIE]);
  const result = await exportCookies(chromeApi, { domain: "ke.com" });
  assert.deepEqual(chromeApi.calls, [{ domain: "ke.com" }]);
  assert.deepEqual(result, { cookies: [COOKIE], count: 1 });
});

test("cookies --url also sends the hostname, so an extension without url support stays scoped", async () => {
  const fake = await startFakeExtension(() => ({ cookies: [], count: 0 }));
  try {
    await executeCommand("cookies", { url: "https://luke.ke.com/api" }, [], { port: fake.port });
    assert.deepEqual(fake.commands[0].params, { domain: "luke.ke.com", url: "https://luke.ke.com/api" });
  } finally {
    await fake.stop();
  }
});

test("cookies needs a domain or a url", async () => {
  await assert.rejects(executeCommand("cookies", {}, [], { port: 1 }), /--domain or --url/);
});
