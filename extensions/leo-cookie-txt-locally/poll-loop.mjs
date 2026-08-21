export function createMultiUrlPollLoop({
  pollForCommand,
  runTask,
  sleep,
  waitMs,
  offlineBackoffMs,
}) {
  const activeUrls = new Set();
  const controllers = new Map();

  async function pollLoopForUrl(url) {
    if (activeUrls.has(url)) return;
    activeUrls.add(url);
    const controller = new AbortController();
    controllers.set(url, controller);

    try {
      while (activeUrls.has(url)) {
        let polled;
        try {
          polled = await pollForCommand(url, waitMs, controller.signal);
        } catch (err) {
          if (err?.name === "AbortError" || !activeUrls.has(url)) break;
          polled = { online: false, cmd: null };
        }

        if (!activeUrls.has(url)) break;
        if (polled?.cmd) {
          await runTask(url, polled.cmd);
          continue;
        }
        if (!polled?.online) {
          await sleep(offlineBackoffMs);
        }
      }
    } finally {
      activeUrls.delete(url);
      controllers.delete(url);
    }
  }

  function start(urls = []) {
    for (const url of urls) {
      pollLoopForUrl(url);
    }
  }

  function stop() {
    for (const url of [...activeUrls]) {
      activeUrls.delete(url);
    }
    for (const controller of controllers.values()) {
      controller.abort();
    }
  }

  function isPolling(url) {
    return activeUrls.has(url);
  }

  return { start, stop, isPolling };
}
