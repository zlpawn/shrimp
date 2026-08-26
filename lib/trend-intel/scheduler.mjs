/**
 * Background Scheduler for Trend Intelligence crawling and daily brief generation.
 * 
 * @param {object} service - TrendIntelService instance
 * @param {object} [options={}]
 * @param {number} [options.intervalMinutes]
 * @param {Array<string>} [options.dailyBriefTimes]
 * @param {object} [options.logger]
 * @returns {TrendIntelScheduler}
 */
export function createTrendIntelScheduler(service, options = {}) {
  const logger = options.logger || console;
  let crawlTimer = null;
  let minuteTimer = null;
  let running = false;
  let lastCrawlAt = null;
  let lastBriefAt = null;
  let lastExecutedDailyKey = null;

  async function runCrawl() {
    try {
      const config = service.getConfig()?.scheduler || {};
      if (config.enabled === false) return;

      const result = await service.crawlOnce();
      lastCrawlAt = new Date().toISOString();
      if (typeof logger.info === "function") {
        logger.info(`[TrendIntelScheduler] Crawl completed: ${result.count} items crawled at ${lastCrawlAt}`);
      }
    } catch (err) {
      if (typeof logger.error === "function") {
        logger.error(`[TrendIntelScheduler] Crawl error:`, err?.message || err);
      }
    }
  }

  async function checkDailyBrief() {
    try {
      const config = service.getConfig()?.scheduler || {};
      if (config.enabled === false) return;

      const dailyTimes = options.dailyBriefTimes || config.daily_brief_times || ["08:30", "18:00"];
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const currentTimeStr = `${hours}:${minutes}`;
      const currentDateStr = now.toISOString().slice(0, 10);
      const executionKey = `${currentDateStr}_${currentTimeStr}`;

      if (dailyTimes.includes(currentTimeStr) && lastExecutedDailyKey !== executionKey) {
        lastExecutedDailyKey = executionKey;
        if (typeof logger.info === "function") {
          logger.info(`[TrendIntelScheduler] Triggering scheduled daily brief for ${currentTimeStr}`);
        }
        await service.generateBriefOnce({ date: currentDateStr });
        lastBriefAt = new Date().toISOString();
      }
    } catch (err) {
      if (typeof logger.error === "function") {
        logger.error(`[TrendIntelScheduler] Daily brief error:`, err?.message || err);
      }
    }
  }

  function start() {
    if (running) return;
    running = true;

    const config = service.getConfig()?.scheduler || {};
    const intervalMin = Math.max(1, Number(options.intervalMinutes) || Number(config.interval_minutes) || 30);
    const intervalMs = intervalMin * 60 * 1000;

    // Start crawl periodic timer
    crawlTimer = setInterval(runCrawl, intervalMs);

    // Start daily brief minute check timer
    minuteTimer = setInterval(checkDailyBrief, 30000);

    if (typeof logger.info === "function") {
      logger.info(`[TrendIntelScheduler] Started with crawl interval: ${intervalMin}m`);
    }
  }

  function stop() {
    running = false;
    if (crawlTimer) {
      clearInterval(crawlTimer);
      crawlTimer = null;
    }
    if (minuteTimer) {
      clearInterval(minuteTimer);
      minuteTimer = null;
    }
    if (typeof logger.info === "function") {
      logger.info(`[TrendIntelScheduler] Stopped`);
    }
  }

  function getStatus() {
    const config = service.getConfig()?.scheduler || {};
    return {
      running,
      lastCrawlAt,
      lastBriefAt,
      enabled: config.enabled !== false,
      interval_minutes: Number(options.intervalMinutes) || Number(config.interval_minutes) || 30,
      daily_brief_times: options.dailyBriefTimes || config.daily_brief_times || ["08:30", "18:00"]
    };
  }

  return {
    start,
    stop,
    getStatus,
    runCrawl
  };
}
