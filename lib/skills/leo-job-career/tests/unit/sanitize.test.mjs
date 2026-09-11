import test from "node:test";
import assert from "node:assert/strict";
import { redactCookieString, redactHeaders, redactUrl, sanitizeRecord } from "../../scripts/lib/sanitize.mjs";

test("redactCookieString replaces cookie values with REDACTED while preserving names", () => {
  const cookieStr = "__zp_stoken__=secret12345; lastCity=101010100; wt2=abc=def";
  const redacted = redactCookieString(cookieStr);
  assert.equal(redacted, "__zp_stoken__=[REDACTED]; lastCity=[REDACTED]; wt2=[REDACTED]");
});

test("redactHeaders redacts sensitive headers like cookie and authorization", () => {
  const headers = {
    "content-type": "application/json",
    cookie: "foo=bar; baz=qux",
    authorization: "Bearer secret-token",
    "user-agent": "Mozilla/5.0",
  };
  const redacted = redactHeaders(headers);
  assert.equal(redacted["content-type"], "application/json");
  assert.equal(redacted["cookie"], "foo=[REDACTED]; baz=[REDACTED]");
  assert.equal(redacted["authorization"], "[REDACTED]");
  assert.equal(redacted["user-agent"], "Mozilla/5.0");
});

test("redactUrl strips sensitive query parameters like securityId and lid if present", () => {
  const url = "https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=secretSecId123&lid=secretLid456&jobId=abc";
  const redacted = redactUrl(url);
  assert.ok(!redacted.includes("secretSecId123"));
  assert.ok(!redacted.includes("secretLid456"));
  assert.ok(redacted.includes("securityId=[REDACTED]"));
  assert.ok(redacted.includes("lid=[REDACTED]"));
  assert.ok(redacted.includes("jobId=abc"));
});

test("sanitizeRecord redacts sensitive fields in raw objects", () => {
  const raw = {
    jobName: "Java Agent",
    securityId: "sensitive-sec-id",
    lid: "sensitive-lid",
    headers: { cookie: "a=b" }
  };
  const sanitized = sanitizeRecord(raw);
  assert.equal(sanitized.jobName, "Java Agent");
  assert.equal(sanitized.securityId, "[REDACTED]");
  assert.equal(sanitized.lid, "[REDACTED]");
  assert.equal(sanitized.headers.cookie, "a=[REDACTED]");
});
