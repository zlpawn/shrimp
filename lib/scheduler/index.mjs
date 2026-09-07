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

  return {
    registry,
    configStore,
    handleSchedulerRequest,
  };
}
