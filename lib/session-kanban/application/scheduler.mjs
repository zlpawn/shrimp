export function createSessionKanbanScheduler(service, {
  intervalMs = 30 * 1000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = timer => clearTimeout(timer),
  logger = console,
} = {}) {
  let timer = null;
  let running = false;

  function schedule() {
    timer = setTimer(runOnce, intervalMs);
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
  };
}
