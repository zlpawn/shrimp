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

test("setIntervalMs re-arms an active timer with the new interval", async () => {
  const timers = [];
  const cleared = [];
  let runs = 0;
  const service = { dispatchReady: async () => { runs += 1; } };
  const scheduler = createSessionKanbanScheduler(service, {
    intervalMs: 100,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers[timers.length - 1]; },
    clearTimer: (t) => { cleared.push(t); },
  });

  scheduler.start();
  assert.equal(timers.length, 1);
  // intervalMs is floored to 1s
  assert.equal(timers[0].ms, 1000);

  // Change interval while scheduled: old timer cleared, new one armed
  scheduler.setIntervalMs(5000);
  assert.equal(cleared.length, 1);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].ms, 5000);
  assert.equal(scheduler.getIntervalMs(), 5000);

  // Interval change while stopped: only stored, no timer created
  scheduler.stop();
  scheduler.setIntervalMs(9000);
  assert.equal(timers.length, 2);
  assert.equal(scheduler.getIntervalMs(), 9000);

  // Restart uses the newest interval
  scheduler.start();
  assert.equal(timers.length, 3);
  assert.equal(timers[2].ms, 9000);

  // Running the timer fn keeps re-arming with current interval
  await timers[2].fn();
  assert.equal(runs, 1);
  assert.equal(timers[3].ms, 9000);
});

test("setIntervalMs enforces a 1s floor", () => {
  const scheduler = createSessionKanbanScheduler(
    { dispatchReady: async () => {} },
    { intervalMs: 100, setTimer: () => ({}), clearTimer: () => {} }
  );
  scheduler.setIntervalMs(50);
  assert.equal(scheduler.getIntervalMs(), 1000);
});
