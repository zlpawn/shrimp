import test from "node:test";
import assert from "node:assert/strict";
import { createMultiUrlPollLoop } from "../../../extensions/leo-cookie-txt-locally/poll-loop.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("poll loop handles a ready command without waiting for the other URL", async () => {
  const events = [];
  const slow = deferred();
  let fastCalls = 0;

  const pollForCommand = async (url, _waitMs, signal) => {
    if (signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    if (url === "fast") {
      fastCalls += 1;
      if (fastCalls === 1) return { online: true, cmd: { id: "cmd-1" } };
      await new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    await slow.promise;
    if (signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    return { online: true, cmd: null };
  };

  const loop = createMultiUrlPollLoop({
    pollForCommand,
    runTask: async (url, cmd) => {
      events.push(`${url}:${cmd.id}`);
    },
    sleep: async () => {},
    waitMs: 25_000,
    offlineBackoffMs: 1,
  });

  loop.start(["fast", "slow"]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(events, ["fast:cmd-1"]);
  loop.stop();
  slow.resolve();
});

test("reconcile aborts removed URLs, retains existing loops, and starts new URLs", async () => {
  const starts = new Map();
  const aborts = [];
  const pollForCommand = (url, _waitMs, signal) => {
    starts.set(url, (starts.get(url) || 0) + 1);
    return new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        aborts.push(url);
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  };
  const loop = createMultiUrlPollLoop({
    pollForCommand,
    runTask: async () => {},
    sleep: async () => {},
    waitMs: 25_000,
    offlineBackoffMs: 1,
  });

  loop.reconcile(["bridge", "gateway-old"]);
  await new Promise((resolve) => setImmediate(resolve));
  loop.reconcile(["bridge", "gateway-new"]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(starts.get("bridge"), 1);
  assert.equal(starts.get("gateway-old"), 1);
  assert.equal(starts.get("gateway-new"), 1);
  assert.deepEqual(aborts, ["gateway-old"]);
  assert.equal(loop.isPolling("bridge"), true);
  assert.equal(loop.isPolling("gateway-old"), false);
  assert.equal(loop.isPolling("gateway-new"), true);
  loop.stop();
});

test("removing a URL does not interrupt a command already executing from it", async () => {
  const commandStarted = deferred();
  const allowCommandToFinish = deferred();
  const commandFinished = deferred();
  let pollCalls = 0;
  const loop = createMultiUrlPollLoop({
    pollForCommand: async (_url, _waitMs, signal) => {
      pollCalls += 1;
      if (pollCalls === 1) return { online: true, cmd: { id: "claimed" } };
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    },
    runTask: async () => {
      commandStarted.resolve();
      await allowCommandToFinish.promise;
      commandFinished.resolve();
    },
    sleep: async () => {},
    waitMs: 25_000,
    offlineBackoffMs: 1,
  });

  loop.reconcile(["gateway"]);
  await commandStarted.promise;
  loop.reconcile([]);
  allowCommandToFinish.resolve();
  await commandFinished.promise;
  assert.equal(loop.isPolling("gateway"), false);
});
