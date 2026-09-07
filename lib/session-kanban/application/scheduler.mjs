export function createSessionKanbanScheduler(service, {
  intervalMs = 30 * 1000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = timer => clearTimeout(timer),
  logger = console,
} = {}) {
  let timer = null;
  let running = false;
  let currentIntervalMs = Math.max(1000, Number(intervalMs) || 30 * 1000);

  function schedule() {
    timer = setTimer(runOnce, currentIntervalMs);
  }

  /**
   * Change the polling interval at runtime. The next scan is re-armed with the
   * new interval immediately (in-flight scans are not interrupted).
   * @param {number} ms
   */
  function setIntervalMs(ms) {
    const next = Math.max(1000, Number(ms) || 30 * 1000);
    if (next === currentIntervalMs && timer !== null) return;
    currentIntervalMs = next;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
      schedule();
    }
  }

  function getIntervalMs() {
    return currentIntervalMs;
  }

  async function runOnce() {
    if (running) return;
    running = true;
    try {
      await service.dispatchReady();
    } catch (error) {
      logger.warn?.("[session-kanban] dispatch scan failed: " + (error?.message || String(error)));
    } finally {
      running = false;
      if (timer !== null) schedule();
    }
  }

  return {
    start() {
      if (timer !== null) return;
      schedule();
    },
    stop() {
      if (timer === null) return;
      clearTimer(timer);
      timer = null;
    },
    runOnce,
    setIntervalMs,
    getIntervalMs,
  };
}
