import test from "node:test";
import assert from "node:assert/strict";
import { exportCookies, looksLikeLoginUrl, visitForCookies } from "../../../../extensions/leo-cookie-txt-locally/cookie-export.mjs";
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

/** A browser whose visited page goes through the given urls, then settles on the last one. */
function fakeBrowser({ urls = ["https://example.com/"], cookies = [COOKIE], passwordField = false, removeFails = false } = {}) {
  const calls = { created: [], removed: [], read: [] };
  const pending = [...urls];
  return {
    calls,
    windows: {
      create: async (details) => {
        calls.created.push(details);
        return { id: 7, tabs: [{ id: 70 }] };
      },
      remove: async (id) => {
        calls.removed.push(id);
        if (removeFails) throw new Error("window already gone");
      },
    },
    tabs: {
      get: async () => {
        const url = pending.length > 1 ? pending.shift() : pending[0];
        return { id: 70, url, status: "complete" };
      },
    },
    cookies: {
      getAll: async (details) => {
        calls.read.push(details);
        return cookies;
      },
    },
    scripting: {
      executeScript: async () => [{ result: passwordField }],
    },
  };
}
const FAST = { settleMs: 5, pollMs: 1 };

test("a visit opens a background window, reads the cookies and closes it", async () => {
  const browser = fakeBrowser();
  const result = await visitForCookies(browser, { url: "https://example.com/" }, FAST);
  assert.deepEqual(browser.calls.created, [{ url: "https://example.com/", focused: false, type: "normal" }]);
  assert.deepEqual(browser.calls.removed, [7]);
  assert.deepEqual(browser.calls.read, [{ url: "https://example.com/" }]);
  assert.equal(result.loginRequired, false);
  assert.deepEqual(result.cookies, [COOKIE]);
  assert.equal(result.matchedBy, "url");
});

test("a visit can open one page and read the cookies of another url", async () => {
  const browser = fakeBrowser();
  await visitForCookies(browser, { url: "https://example.com/", cookieUrl: "https://example.com/api" }, FAST);
  assert.deepEqual(browser.calls.read, [{ url: "https://example.com/api" }]);
});

test("a redirect to a login page reports it, hides the query and still closes the window", async () => {
  const browser = fakeBrowser({
    urls: ["https://luke.ke.com/", "https://test-login.ke.com/login?service=secret#x"],
  });
  const result = await visitForCookies(browser, { url: "https://luke.ke.com/" }, FAST);
  assert.equal(result.loginRequired, true);
  assert.equal(result.finalUrl, "https://test-login.ke.com/login");
  assert.deepEqual(browser.calls.removed, [7]);
});

test("a visible password field means login is required, even without a login url", async () => {
  const browser = fakeBrowser({ passwordField: true });
  assert.equal((await visitForCookies(browser, { url: "https://example.com/" }, FAST)).loginRequired, true);
});

test("a window that cannot be closed does not lose the result", async () => {
  const browser = fakeBrowser({ removeFails: true });
  assert.deepEqual((await visitForCookies(browser, { url: "https://example.com/" }, FAST)).cookies, [COOKIE]);
});

test("a page that never settles still closes its window", async () => {
  const browser = fakeBrowser();
  browser.tabs.get = async () => ({ id: 70, url: "https://example.com/", status: "loading" });
  const result = await visitForCookies(browser, { url: "https://example.com/", timeoutMs: 20 }, FAST);
  assert.equal(result.settled, false);
  assert.deepEqual(browser.calls.removed, [7]);
});

test("a visit only opens web pages", async () => {
  const browser = fakeBrowser();
  await assert.rejects(visitForCookies(browser, { url: "file:///etc/passwd" }, FAST), /http/);
  assert.deepEqual(browser.calls.created, []);
});

test("login urls are told apart from similar names", () => {
  for (const url of [
    "https://test-login.ke.com/x",
    "https://a.com/login",
    "https://a.com/#/signin",
    "https://accounts.google.com/",
    "https://sso.a.com/",
    "https://id.atlassian.com/login",
    "https://gitlab.com/users/sign_in",
    "https://a.com/log-in",
    "https://a.com/logon",
  ]) {
    assert.equal(looksLikeLoginUrl(url), true, url);
  }
  for (const url of [
    "https://luke.ke.com/app/iot_auth/role",
    "https://blogin.com/",
    "https://a.com/loginfo",
    "https://a.com/",
    "https://account.microsoft.com/account",
    "https://github.com/settings/profile",
    "https://a.com/design-in/x",
  ]) {
    assert.equal(looksLikeLoginUrl(url), false, url);
  }
});

function bridgeWith({ read = [], visit }) {
  return startFakeExtension((cmd) => {
    if (cmd.type === "cookies.visit") {
      if (!visit) throw { code: "invalid_request", message: "Unsupported task type: cookies.visit" };
      return visit;
    }
    return { cookies: read, count: read.length, matchedBy: "url" };
  });
}

test("--open-if-missing does not open a page when cookies are already there", async () => {
  const fake = await bridgeWith({ read: [COOKIE], visit: { cookies: [], loginRequired: false } });
  try {
    const res = await executeCommand("cookies", { url: "https://a.com/", "open-if-missing": true }, [], { port: fake.port });
    assert.deepEqual(res.result.cookies, [COOKIE]);
    assert.deepEqual(fake.commands.map((cmd) => cmd.type), ["cookies.export"]);
  } finally {
    await fake.stop();
  }
});

test("without --open-if-missing a missing cookie never opens a page", async () => {
  const fake = await bridgeWith({ visit: { cookies: [COOKIE], loginRequired: false } });
  try {
    await executeCommand("cookies", { url: "https://a.com/" }, [], { port: fake.port });
    assert.deepEqual(fake.commands.map((cmd) => cmd.type), ["cookies.export"]);
  } finally {
    await fake.stop();
  }
});

test("--open-if-missing returns the cookies the page set", async () => {
  const fake = await bridgeWith({ visit: { cookies: [COOKIE], count: 1, matchedBy: "url", loginRequired: false } });
  try {
    const res = await executeCommand("cookies", { domain: "a.com", "open-if-missing": true }, [], { port: fake.port });
    assert.deepEqual(res.result.cookies, [COOKIE]);
    assert.equal(fake.commands[1].type, "cookies.visit");
    assert.equal(fake.commands[1].params.url, "https://a.com/");
  } finally {
    await fake.stop();
  }
});

test("--open-if-missing reports a required login and does not hand out the login page's cookies", async () => {
  const fake = await bridgeWith({
    visit: { cookies: [COOKIE], count: 1, loginRequired: true, finalUrl: "https://login.a.com/" },
  });
  try {
    await assert.rejects(
      executeCommand("cookies", { url: "https://a.com/", "open-if-missing": true }, [], { port: fake.port }),
      (err) => err.code === "login_required" && err.message.includes("login.a.com")
    );
  } finally {
    await fake.stop();
  }
});

test("--open-if-missing asks for a reload when the extension predates visits", async () => {
  const fake = await bridgeWith({});
  try {
    await assert.rejects(
      executeCommand("cookies", { url: "https://a.com/", "open-if-missing": true }, [], { port: fake.port }),
      (err) => err.code === "extension_outdated" && err.message.includes("chrome://extensions")
    );
  } finally {
    await fake.stop();
  }
});
