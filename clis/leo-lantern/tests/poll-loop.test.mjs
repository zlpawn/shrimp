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
