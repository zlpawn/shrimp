import path from "node:path";
import { createKbStore } from "./kb-store.mjs";
import { createEngineRegistry, MarkItDownAdapter, DoclingAdapter } from "./engine-adapter.mjs";
import { createWebScraper } from "./scraper.mjs";
import { createKbPipeline } from "./pipeline.mjs";
import { createKbRoutes } from "./routes.mjs";

export function initKnowledgeBaseModule({ dataDir, taskQueue = null }) {
  const kbDataDir = path.join(dataDir, "knowledge-base");
  const dbPath = path.join(kbDataDir, "kb.db");

  const store = createKbStore({ dbPath });
  store.init();

  const registry = createEngineRegistry();
  registry.register(new MarkItDownAdapter());
  registry.register(new DoclingAdapter());

  const scraper = createWebScraper({});
  const pipeline = createKbPipeline({
    store,
    registry,
    scraper,
    dataDir: kbDataDir,
    taskQueue,
  });

  const routeHandler = createKbRoutes({
    store,
    pipeline,
    registry,
    dataDir: kbDataDir,
    taskQueue,
  });

  return {
    store,
    registry,
    scraper,
    pipeline,
    routeHandler,
  };
}

export {
  createKbStore,
  createEngineRegistry,
  MarkItDownAdapter,
  DoclingAdapter,
  createWebScraper,
  createKbPipeline,
  createKbRoutes,
};
