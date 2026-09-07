import path from "node:path";
import { SchedulerConfigStore } from "./config-store.mjs";
import { JobRegistry } from "./registry.mjs";
import { createSchedulerRoutes } from "./routes.mjs";

import { TrendCrawlAdapter } from "./adapters/trend-crawl.mjs";
import { TrendBriefAdapter } from "./adapters/trend-brief.mjs";
import { KbSyncAdapter } from "./adapters/kb-sync.mjs";
import { KanbanDispatchAdapter } from "./adapters/kanban-dispatch.mjs";
import { FxRateAdapter } from "./adapters/fx-rate.mjs";
import { ModelPricingAdapter } from "./adapters/model-pricing.mjs";
import { SessionSyncAdapter } from "./adapters/session-sync.mjs";

/**
 * Initialize the Job Scheduler module for Shrimp Gateway.
 *
 * @param {object} options
 * @param {string} [options.configDir] - Directory where scheduler.config.json is stored
 * @param {object} [options.logger] - Logger instance
 * @param {Function} [options.getTrendIntelService]
 * @param {Function} [options.getTrendIntelScheduler]
 * @param {Function} [options.getKbSyncScheduler]
 * @param {Function} [options.getKbChannelSecrets]
 * @param {Function} [options.getSessionKanbanScheduler]
 * @param {Function} [options.getSessionKanbanService]
 * @param {Function} [options.getFxRateService]
 * @param {Function} [options.getModelPricingEngine]
 * @param {Function} [options.getSessionWatcherDaemon]
 * @returns {{
 *   registry: JobRegistry,
 *   configStore: SchedulerConfigStore,
 *   handleSchedulerRequest: Function
 * }}
 */
export function initSchedulerModule({
  configDir = process.cwd(),
  logger = console,
  getTrendIntelService,
  getTrendIntelScheduler,
  getKbSyncScheduler,
  getKbChannelSecrets,
  getSessionKanbanScheduler,
  getSessionKanbanService,
  getFxRateService,
  getModelPricingEngine,
  getSessionWatcherDaemon,
} = {}) {
  const configPath = path.join(configDir, "scheduler.config.json");
  const exampleConfigPath = path.join(configDir, "scheduler.config.example.json");

  const configStore = new SchedulerConfigStore({
    configPath,
    exampleConfigPath,
    logger,
  });

  // Ensure default/example config is loaded or created
  configStore.load();

  const registry = new JobRegistry({ configStore, logger });

  // 1. Trend Intel Crawl
  registry.register(
    new TrendCrawlAdapter({
      getService: getTrendIntelService,
      getScheduler: getTrendIntelScheduler,
    })
  );

  // 2. Trend Intel Daily Brief
  registry.register(
    new TrendBriefAdapter({
      getService: getTrendIntelService,
      getScheduler: getTrendIntelScheduler,
    })
  );

  // 3. Knowledge Base Sync
  registry.register(
    new KbSyncAdapter({
      getScheduler: getKbSyncScheduler,
      getChannelSecrets: getKbChannelSecrets,
    })
  );

  // 4. Session Kanban Dispatch
  registry.register(
    new KanbanDispatchAdapter({
      getScheduler: getSessionKanbanScheduler,
      getService: getSessionKanbanService,
    })
  );

  // 5. FX Rate Refresh
  registry.register(
    new FxRateAdapter({
      getService: getFxRateService,
    })
  );

  // 6. Model Pricing Refresh
  registry.register(
    new ModelPricingAdapter({
      getEngine: getModelPricingEngine,
    })
  );

  // 7. Session Sync Daemon
  registry.register(
    new SessionSyncAdapter({
      getDaemon: getSessionWatcherDaemon,
    })
  );

  const handleSchedulerRequest = createSchedulerRoutes({
    registry,
    configStore,
  });

  /**
   * Re-apply persisted scheduler.config.json to the live underlying services.
   * Called once after the gateway finishes booting its background services so
   * that jobs disabled/re-tuned from the Job Scheduler panel stay that way
   * across gateway restarts.
   *
   * Only jobs explicitly saved through the panel (`_touched`) are applied:
   * a fresh scheduler.config.json cloned from the example must not change
   * the out-of-the-box behaviour of modules the user never configured.
   * Adapters whose backing service is not (yet) initialized are skipped
   * silently — config is still persisted and will be applied on the next
   * update or boot.
   */
  async function applyBootConfig() {
    const applied = [];
    const skipped = [];
    for (const adapter of registry.getAll()) {
      if (!configStore.isJobTouched || !configStore.isJobTouched(adapter.id)) {
        skipped.push(adapter.id);
        continue;
      }
      const config = configStore.getJobConfig(adapter.id) || {};
      try {
        await adapter.onConfigChange(config, config);
        applied.push(adapter.id);
      } catch (err) {
        skipped.push(adapter.id);
        logger.warn?.(
          `[Scheduler] Boot config not applied for ${adapter.id}: ${err?.message || err}`
        );
      }
    }
    return { applied, skipped };
  }

  return {
    registry,
    configStore,
    handleSchedulerRequest,
    applyBootConfig,
  };
}
