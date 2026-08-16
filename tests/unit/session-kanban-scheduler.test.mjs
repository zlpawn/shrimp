import test from "node:test";
import assert from "node:assert/strict";

import { createSessionKanbanScheduler } from "../../lib/session-kanban/application/scheduler.mjs";

test("scheduler runs dispatch repeatedly until stopped", async () => {
  const timers = [];
  let runs = 0;
  const service = { dispatchReady: async () => { runs += 1; return { dispatched: 0, waiting: 1 }; } };
  const scheduler = createSessionKanbanScheduler(service, {
    intervalMs: 100,
    setTimer: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
  });

  scheduler.start();
  assert.equal(timers.length, 1);
  await timers[0].fn();
  assert.equal(timers.length, 2);
  assert.equal(runs, 1);
  scheduler.stop();
});

test("scheduler keeps running after a failed scan", async () => {
  const timers = [];
  let failures = 0;
  const service = { dispatchReady: async () => { failures += 1; throw new Error("temporary"); } };
  const scheduler = createSessionKanbanScheduler(service, {
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers[timers.length - 1]; },
    clearTimer: () => {},
  });
  scheduler.start();
  await timers[0].fn();
  assert.equal(timers.length, 2);
  assert.equal(failures, 1);
});
