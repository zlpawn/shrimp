import path from "node:path";
import { createKbStore } from "./kb-store.mjs";
import { createEngineRegistry, MarkItDownAdapter, DoclingAdapter, WhisperAdapter } from "./engine-adapter.mjs";
import { createWebScraper } from "./scraper.mjs";
import { createCraftChannel, resolveCraftMcpUrl } from "./craft-channel.mjs";
import { createKbPipeline } from "./pipeline.mjs";
import { createKbRoutes } from "./routes.mjs";
import { createKarpathyCompiler } from "./karpathy-compiler.mjs";
import { ChannelSecretsStore } from "./channel-secrets.mjs";
import { SyncHistoryStore } from "./sync-history.mjs";
import { WereadChannel } from "./weread-channel.mjs";
import { SyncScheduler } from "./sync-scheduler.mjs";

export function initKnowledgeBaseModule({ dataDir, taskQueue = null, config = {}, listenPort = 8787 }) {
  const kbDataDir = path.join(dataDir, "knowledge-base");
  const dbPath = path.join(kbDataDir, "kb.db");

  const store = createKbStore({ dbPath });
  store.init();

  const registry = createEngineRegistry();
  registry.register(new MarkItDownAdapter());
  registry.register(new DoclingAdapter());
  registry.register(new WhisperAdapter());

  const scraper = createWebScraper({});
  const pipeline = createKbPipeline({
    store,
    registry,
    scraper,
    dataDir: kbDataDir,
    taskQueue,
  });

  const channelSecrets = new ChannelSecretsStore({ dataDir: kbDataDir });
  const syncHistory = new SyncHistoryStore({ dataDir: kbDataDir });

  const craftMcpUrl = channelSecrets.getChannelCredential("craft", "mcp_url") || resolveCraftMcpUrl(config);
  const craftChannel = createCraftChannel({ mcpUrl: craftMcpUrl });

  const wereadApiKey = channelSecrets.getChannelCredential("weread", "api_key");
  const wereadChannel = new WereadChannel({ apiKey: wereadApiKey });

  const syncScheduler = new SyncScheduler({
    channelSecrets,
    wereadChannel,
    craftChannel,
    pipeline,
    syncHistory,
    store,
  });
  syncScheduler.start();

  const compiler = createKarpathyCompiler({
    config,
    dataDir: kbDataDir,
    listenPort,
  });

  const routeHandler = createKbRoutes({
    store,
    pipeline,
    registry,
    dataDir: kbDataDir,
    taskQueue,
    craftChannel,
    compiler,
    channelSecrets,
    wereadChannel,
    syncHistory,
    syncScheduler,
  });

  return {
    store,
    registry,
    scraper,
    craftChannel,
    wereadChannel,
    channelSecrets,
    syncHistory,
    syncScheduler,
    pipeline,
    compiler,
    routeHandler,
  };
}

export {
  createKbStore,
  createEngineRegistry,
  MarkItDownAdapter,
  DoclingAdapter,
  createWebScraper,
  createCraftChannel,
  resolveCraftMcpUrl,
  createKbPipeline,
  createKbRoutes,
  createKarpathyCompiler,
};
