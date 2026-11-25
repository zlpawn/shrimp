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
      if (controllers.get(url) === controller) {
        activeUrls.delete(url);
        controllers.delete(url);
      }
    }
  }

  function start(urls = []) {
    for (const url of urls) {
      pollLoopForUrl(url);
    }
  }

  function stopUrl(url) {
    activeUrls.delete(url);
    const controller = controllers.get(url);
    if (controller) {
      controllers.delete(url);
      controller.abort();
    }
  }

  function reconcile(urls = []) {
    const desired = new Set(urls);
    for (const url of [...activeUrls]) {
      if (!desired.has(url)) stopUrl(url);
    }
    start(desired);
  }

  function stop() {
    for (const url of [...activeUrls]) {
      stopUrl(url);
    }
  }

  function isPolling(url) {
    return activeUrls.has(url);
  }

  return { start, stopUrl, reconcile, stop, isPolling };
}
