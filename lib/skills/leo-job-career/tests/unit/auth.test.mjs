import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "../../scripts/lib/config.mjs";
import { parseCookieHeader, parseNetscapeCookies, importCookieHeader, loadAuthState, saveAuthState } from "../../scripts/lib/auth.mjs";

test("parseCookieHeader correctly parses cookies and handles values containing =", () => {
  const header = "__zp_stoken__=xyz123==; lastCity=101010100; complex=a=b=c; empty=";
  const result = parseCookieHeader(header);
  assert.equal(result.valid, true);
  assert.equal(result.cookie_count, 4);
  assert.deepEqual(result.cookie_names, ["__zp_stoken__", "lastCity", "complex", "empty"]);
  assert.equal(result.cookies.get("__zp_stoken__"), "xyz123==");
  assert.equal(result.cookies.get("complex"), "a=b=c");
  assert.equal(result.cookies.get("empty"), "");
});

test("parseCookieHeader rejects empty or invalid non-cookie content", () => {
  assert.equal(parseCookieHeader("").valid, false);
  assert.equal(parseCookieHeader("   ").valid, false);
  assert.equal(parseCookieHeader("just random text without equals sign").valid, false);
});

test("parseNetscapeCookies parses cookies.txt lines", () => {
  const netscape = "# Netscape HTTP Cookie File\n.zhipin.com\tTRUE\t/\tTRUE\t1799999999\t__zp_stoken__\ttoken_val\n.zhipin.com\tTRUE\t/\tFALSE\t0\tcity\t101010100\n";
  const result = parseNetscapeCookies(netscape);
  assert.equal(result.valid, true);
  assert.equal(result.cookie_count, 2);
  assert.deepEqual(result.cookie_names, ["__zp_stoken__", "city"]);
  assert.equal(result.cookies.get("__zp_stoken__"), "token_val");
});

test("importCookieHeader stores header atomically with 0600 permissions and writes auth-state.json", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-auth-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  ensureRuntimeDirectories(paths);

  const rawHeader = "__zp_stoken__=stoken123; lastCity=101010100; geek_zp_token=geek456";
  const importRes = importCookieHeader(rawHeader, { paths, source: "test" });
  assert.equal(importRes.ok, true);
  assert.equal(importRes.cookie_count, 3);
  assert.deepEqual(importRes.cookie_names, ["__zp_stoken__", "lastCity", "geek_zp_token"]);

  assert.ok(fs.existsSync(paths.cookieHeaderFile));
  assert.ok(fs.existsSync(paths.authStateFile));

  if (process.platform !== "win32") {
    const stat = fs.statSync(paths.cookieHeaderFile);
    assert.equal(stat.mode & 0o777, 0o600);
  }

  const savedState = loadAuthState({ paths });
  assert.equal(savedState.status, "imported");
  assert.equal(savedState.cookie_count, 3);
  assert.deepEqual(savedState.cookie_names, ["__zp_stoken__", "lastCity", "geek_zp_token"]);

  fs.rmSync(tmpBase, { recursive: true, force: true });
});
