import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeGenerateContentResponse } from "../../lib/antigravity/proto-codec.mjs";
import {
  getAntigravityUsage,
  recordAntigravityUsage,
} from "../../lib/antigravity/usage-store.mjs";

test("decodeGenerateContentResponse extracts consumed and remaining credits", () => {
  // v1 wrapper fields 3 and 4 are varints: consumed=12, remaining=88.
  const buf = Buffer.from([0x18, 0x0c, 0x20, 0x58]);
  const result = decodeGenerateContentResponse(buf);
  assert.equal(result.consumedCredits, 12);
  assert.equal(result.remainingCredits, 88);
});

test("antigravity usage store keeps only the latest snapshot", () => {
  recordAntigravityUsage({ remainingCredits: 88, consumedCredits: 12 });
  const first = getAntigravityUsage();
  assert.equal(first.available, true);
  assert.equal(first.remaining_credits, 88);
  recordAntigravityUsage({ remainingCredits: 80, consumedCredits: 20 });
  const second = getAntigravityUsage();
  assert.equal(second.remaining_credits, 80);
  assert.equal(second.consumed_credits, 20);
  assert.ok(second.updated_at >= first.updated_at);
});
