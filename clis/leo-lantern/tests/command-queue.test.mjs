import test from "node:test";
import assert from "node:assert/strict";
import { createCommandQueue } from "../../../extensions/leo-cookie-txt-locally/command-queue.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("commands from different polling URLs execute globally one at a time", async () => {
  const first = deferred();
  const events = [];
  let active = 0;
  let maxActive = 0;
  const queue = createCommandQueue({
    execute: async (command) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`start:${command.id}`);
      if (command.id === "one") await first.promise;
      events.push(`end:${command.id}`);
      active -= 1;
      return { ok: true, result: { id: command.id } };
    },
    report: async () => {},
  });

  const one = queue.submit("bridge", { id: "one" });
  const two = queue.submit("gateway", { id: "two" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["start:one"]);

  first.resolve();
  await Promise.all([one, two]);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, ["start:one", "end:one", "start:two", "end:two"]);
});

test("in-flight duplicates share one execution and report to every source", async () => {
  const gate = deferred();
  const reports = [];
  let executions = 0;
  const queue = createCommandQueue({
    execute: async () => {
      executions += 1;
      await gate.promise;
      return { ok: true, result: { clicked: true } };
    },
    report: async (source, id, envelope) => reports.push({ source, id, envelope }),
  });

  const fromBridge = queue.submit("bridge", { id: "dup" });
  const fromGateway = queue.submit("gateway", { id: "dup" });
  gate.resolve();
  const [bridgeResult, gatewayResult] = await Promise.all([fromBridge, fromGateway]);

  assert.equal(executions, 1);
  assert.deepEqual(bridgeResult, gatewayResult);
  assert.deepEqual(reports.map((item) => item.source).sort(), ["bridge", "gateway"]);
  assert.ok(reports.every((item) => item.id === "dup" && item.envelope.ok === true));
});

test("completed duplicate replays the cached envelope without executing again", async () => {
  const reports = [];
  let executions = 0;
  const queue = createCommandQueue({
    execute: async () => {
      executions += 1;
      return { ok: true, result: { value: executions } };
    },
    report: async (source, id, envelope) => reports.push({ source, id, envelope }),
  });

  await queue.submit("bridge", { id: "cached" });
  await queue.submit("gateway", { id: "cached" });

  assert.equal(executions, 1);
  assert.equal(reports.length, 2);
  assert.deepEqual(reports[0].envelope, reports[1].envelope);
});

test("a failed command produces one failure envelope and does not poison the queue", async () => {
  const reports = [];
  const queue = createCommandQueue({
    execute: async (command) => {
      if (command.id === "bad") throw Object.assign(new Error("outside"), { code: "tab_outside_task" });
      return { ok: true, result: { id: command.id } };
    },
    report: async (_source, id, envelope) => reports.push({ id, envelope }),
  });

  const bad = await queue.submit("bridge", { id: "bad" });
  const good = await queue.submit("bridge", { id: "good" });

  assert.deepEqual(bad, {
    ok: false,
    error: { code: "tab_outside_task", message: "outside" },
  });
  assert.deepEqual(good, { ok: true, result: { id: "good" } });
  assert.deepEqual(reports.map(({ id }) => id), ["bad", "good"]);
});

test("completed cache is bounded by count and TTL", async () => {
  let now = 0;
  let executions = 0;
  const queue = createCommandQueue({
    execute: async (command) => {
      executions += 1;
      return { ok: true, result: { id: command.id, executions } };
    },
    report: async () => {},
    now: () => now,
    maxCompleted: 2,
    ttlMs: 10,
  });

  await queue.submit("bridge", { id: "a" });
  await queue.submit("bridge", { id: "b" });
  await queue.submit("bridge", { id: "c" });
  await queue.submit("bridge", { id: "a" });
  assert.equal(executions, 4, "oldest completed command should be evicted by count");

  now = 11;
  await queue.submit("bridge", { id: "c" });
  assert.equal(executions, 5, "completed command should be evicted by TTL");
});
