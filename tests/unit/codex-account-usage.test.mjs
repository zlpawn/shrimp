import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  normalizeCodexRateLimits,
  readCodexAccountUsage,
} from "../../lib/codex/account-usage.mjs";

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdin = {
    writes: [],
    write(value) {
      this.writes.push(value);
      const message = JSON.parse(value);
      const response = message.method === "initialize"
        ? { id: message.id, result: { userAgent: "codex-test" } }
        : {
          id: message.id,
          result: {
            rateLimits: {
              limitId: "codex",
              planType: "plus",
              primary: { usedPercent: 40, resetsAt: 1787231747, windowDurationMins: 10080 },
              secondary: { usedPercent: 10, resetsAt: 1787145347 },
              credits: { hasCredits: true, unlimited: false, balance: "12" },
            },
            rateLimitsByLimitId: {
              codex: {
                limitId: "codex",
                primary: { usedPercent: 40, resetsAt: 1787231747 },
              },
            },
          },
        };
      queueMicrotask(() => {
        proc.stdout.emit("data", JSON.stringify(response) + "\n");
      });
      return true;
    },
    end() {},
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {};
  return proc;
}

test("normalize codex rate limits to remaining usage", () => {
  const usage = normalizeCodexRateLimits({
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 40, resetsAt: 1787231747 },
      secondary: { usedPercent: 10, resetsAt: 1787145347 },
      credits: { hasCredits: true, unlimited: false, balance: "12" },
    },
    rateLimitsByLimitId: {
      codex: { limitId: "codex", primary: { usedPercent: 40 } },
      cyber: { limitId: "cyber", primary: { usedPercent: 80 } },
    },
  });
  assert.equal(usage.available, true);
  assert.equal(usage.remaining_percent, 60);
  assert.equal(usage.primary.remaining_percent, 60);
  assert.equal(usage.primary.resets_at, 1787231747);
  assert.deepEqual(usage.credits, { available: true, unlimited: false, balance: "12" });
  assert.equal(usage.buckets.length, 2);
  assert.equal(usage.buckets[0].remaining_percent, 60);
  assert.equal(usage.buckets[1].remaining_percent, 20);
});

test("read codex usage initializes app-server then reads rate limits", async () => {
  let spawned;
  const usage = await readCodexAccountUsage({
    command: "codex app-server --stdio",
    spawnImpl: (command, args, options) => {
      spawned = { command, args, options };
      return fakeProcess();
    },
  });
  assert.equal(spawned.command, "codex");
  assert.deepEqual(spawned.args, ["app-server", "--stdio"]);
  assert.equal(usage.available, true);
  assert.equal(usage.remaining_percent, 60);
  assert.equal(usage.plan_type, "plus");
});
