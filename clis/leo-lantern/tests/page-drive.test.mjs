import test from "node:test";
import assert from "node:assert/strict";
import {
  assertWaitParams,
  contentMatches,
  summarizeContent,
  normalizePressKey,
} from "../../../extensions/leo-cookie-txt-locally/page-drive.mjs";

test("wait params require text or selector", () => {
  assert.throws(() => assertWaitParams({}), /text or selector/);
  assert.deepEqual(assertWaitParams({ text: "OK", timeoutMs: 1000 }).timeoutMs, 1000);
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
