import test from "node:test";
import assert from "node:assert/strict";
import {
  assertWaitParams,
  contentMatches,
  summarizeContent,
  normalizePressKey,
  wrapEvalScript,
} from "../../../../extensions/leo-cookie-txt-locally/page-drive.mjs";

test("wait params require text or selector", () => {
  assert.throws(() => assertWaitParams({}), /text or selector/);
  assert.deepEqual(assertWaitParams({ text: "OK", timeoutMs: 1000 }).timeoutMs, 1000);
});

test("wait params support idle and stability modes", () => {
  const idleWait = assertWaitParams({ idle: true });
  assert.equal(idleWait.idle, true);
  assert.equal(idleWait.idleMs, 2000);

  const customWait = assertWaitParams({ stableMs: 1500, timeoutMs: 10000 });
  assert.equal(customWait.idle, true);
  assert.equal(customWait.idleMs, 1500);
  assert.equal(customWait.timeoutMs, 10000);
});

test("wrapEvalScript protects scope and preserves return expressions", () => {
  // Simple expression wraps in IIFE eval to prevent scope leaks while returning value
  const expr = wrapEvalScript("2 + 2");
  assert.ok(expr.includes("eval("));
  assert.equal(eval(expr), 4);

  // Statements with const and expression value
  const constScript = wrapEvalScript("const btns = [1, 2, 3]; btns.length");
  assert.equal(eval(constScript), 3);
  // Running again in same scope must NOT throw Identifier already declared
  assert.equal(eval(constScript), 3);

  // Script with explicit return
  const returnScript = wrapEvalScript("const x = 10;\nreturn x * 2;");
  assert.equal(eval(returnScript), 20);

  // Already an IIFE is preserved
  assert.equal(wrapEvalScript("(() => 99)()"), "(() => 99)()");
  assert.equal(wrapEvalScript("(async () => 'ok')()"), "(async () => 'ok')()");

  // Async script with await
  const asyncScript = wrapEvalScript("const v = await Promise.resolve(42); v + 1");
  assert.ok(asyncScript.startsWith("(async () =>"));
});

test("content helpers", () => {
  assert.equal(contentMatches({ haystack: "Hello World", text: "hello" }), true);
  assert.equal(contentMatches({ haystack: "Hello", selectorFound: true }), true);
  assert.equal(contentMatches({ haystack: "Hello", selectorFound: false }), false);
  assert.equal(contentMatches({ haystack: "", selectorFound: true }), true);
  assert.equal(summarizeContent({ title: "t", url: "u", text: "a   b", maxChars: 3 }).text, "a b".slice(0, 3));
  assert.equal(normalizePressKey("Enter"), "Enter");
  assert.throws(() => normalizePressKey(""), /requires key/);
});
