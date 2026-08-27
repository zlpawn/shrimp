import test from "node:test";
import assert from "node:assert/strict";
import { shouldStopNetworkCapture } from "../../../extensions/leo-cookie-txt-locally/background-lifecycle.mjs";

test("task end skips network stop when no capture exists", () => {
  assert.equal(shouldStopNetworkCapture(null), false);
  assert.equal(shouldStopNetworkCapture(undefined), false);
});

test("task end stops only a live capture", () => {
  assert.equal(shouldStopNetworkCapture({ tabId: 7, stoppedAt: null }), true);
  assert.equal(shouldStopNetworkCapture({ tabId: 7, stoppedAt: 100 }), false);
});
