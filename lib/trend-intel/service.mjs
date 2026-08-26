import { createTrendIntelDb } from "./storage/db.mjs";
import { createTrendIntelConfigStore } from "./storage/config-store.mjs";
import { resolveDataDir } from "./storage/paths.mjs";
import { crawlAllActivePlatforms } from "./providers/index.mjs";
import { calculateVelocityAndState } from "./engine/trend-calculator.mjs";
import { clusterRawItems } from "./engine/cluster.mjs";
import { scoreEvents } from "./engine/scorer.mjs";
import { generateDailyBrief } from "./engine/brief-generator.mjs";
import { exportArtifactFiles } from "./engine/exporter.mjs";

/**
 * Creates a default LLM model caller using gateway completions endpoint if model configured.
 * @param {object} config 
 * @param {object} options 
 * @returns {(prompt: string) => Promise<string>}
 */
function createDefaultModelCaller(config, { listenPort = 8787, fetchImpl = fetch } = {}) {
  const model = config?.model_route?.model;
  const client = config?.model_route?.client || "codex";
  if (!model) return null;

  return async function callModel(prompt) {
    const url = `http://127.0.0.1:${listenPort}/${encodeURIComponent(client)}/v1/chat/completions`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-gateway-client": client
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3
      })
    });
    if (!res.ok) {
      throw new Error(`Model call failed with status ${res.status}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "";
  };
}

/**
 * Creates the high-level Trend Intelligence application service.
 * 
 * @param {object} [options={}]
 * @param {string} [options.dataDir]
 * @param {object} [options.db]
 * @param {object} [options.configStore]
 * @param {Function} [options.modelCaller]
 * @param {Function} [options.fetchImpl]
 * @param {number} [options.listenPort]
 * @returns {TrendIntelService}
 */
export function createTrendIntelService(options = {}) {
  const dataDir = options.dataDir ? resolveDataDir(options.dataDir) : resolveDataDir();
  const db = options.db || createTrendIntelDb(dataDir);
  const configStore = options.configStore || createTrendIntelConfigStore(dataDir);
  const fetchImpl = options.fetchImpl || fetch;
  const listenPort = Number(options.listenPort) || 8787;
  const modelCaller = options.modelCaller || null;

  /**
   * Crawls all active platforms and RSS feeds, records snapshots, updates item velocities.
   * @param {object} [crawlOptions={}]
   * @returns {Promise<{ count: number, items: Array<object>, crawled_at: string }>}
   */
  async function crawlOnce(crawlOptions = {}) {
    const config = configStore.get();
    const fetchOptions = {
      fetchImpl: crawlOptions.fetchImpl || fetchImpl,
      proxy: crawlOptions.proxy || config.proxy,
      ...crawlOptions
    };

    const items = await crawlAllActivePlatforms(config, fetchOptions);
    if (Array.isArray(items) && items.length > 0) {
      // 1. Save raw items to DB
      db.saveRawItems(items);

      // 2. Record rank snapshots
      const snapshots = items.map(item => ({
        item_id: item.id,
        platform: item.platform,
        rank: item.rank,
        score: item.score,
        recorded_at: item.collected_at || new Date().toISOString()
      }));
      db.recordSnapshots(snapshots);

      // 3. Compute and update velocities & state
      for (const item of items) {
        const itemSnaps = db.getItemSnapshots(item.id);
        const { velocity, previousRank } = calculateVelocityAndState(itemSnaps);
        item.velocity = String(velocity);
        if (previousRank !== null && previousRank !== undefined) {
          item.previous_rank = previousRank;
        }
      }
      db.saveRawItems(items);
    }

    return {
      count: Array.isArray(items) ? items.length : 0,
      items: items || [],
      crawled_at: new Date().toISOString()
    };
  }

  /**
   * Executes clustering, scoring, 5-section brief assembly, and artifact exports.
   * @param {object} [genOptions={}]
   * @returns {Promise<{ brief: object, events: Array<object>, exports: object }>}
   */
  async function generateBriefOnce(genOptions = {}) {
    const config = configStore.get();
    const caller = genOptions.modelCaller || modelCaller || createDefaultModelCaller(config, {
      listenPort,
      fetchImpl: genOptions.fetchImpl || fetchImpl
    });

    // 1. Fetch recent raw items
    const rawItems = db.getRawItems({
      since: genOptions.since,
      limit: genOptions.limit || 500
    });

    // 2. Cluster raw items into events
    const clusteredEvents = await clusterRawItems(rawItems, config.focus_topics, caller);

    // 3. Score events (world importance & creator value)
    const scoredEvents = await scoreEvents(clusteredEvents, caller);

    // 4. Save events to DB
    db.saveEvents(scoredEvents);

    // 5. Generate daily brief
    const brief = generateDailyBrief(scoredEvents, config.focus_topics, { date: genOptions.date });

    // 6. Save brief to DB
    db.saveBrief(brief);

    // 7. Export markdown & json files to disk
    const exports = exportArtifactFiles(dataDir, brief, scoredEvents);

    return {
      brief,
      events: scoredEvents,
      exports
    };
  }

  /**
   * Retrieves daily brief by date or latest.
   * @param {string} [date]
   * @returns {object | null}
   */
  function getBrief(date = null) {
    if (date) {
      return db.getBriefByDate(date);
    }
    return db.getLatestBrief();
  }

  /**
   * Queries events with optional filters.
   * @param {object} [query={}]
   * @returns {Array<object>}
   */
  function getEvents(query = {}) {
    return db.getEvents(query);
  }

  /**
   * Queries raw items with optional filters.
   * @param {object} [query={}]
   * @returns {Array<object>}
   */
  function getRawItems(query = {}) {
    return db.getRawItems(query);
  }

  /**
   * Gets current configuration.
   * @returns {object}
   */
  function getConfig() {
    return configStore.get();
  }

  /**
   * Updates configuration with patch.
   * @param {object} patch
   * @returns {object}
   */
  function updateConfig(patch) {
    return configStore.update(patch);
  }

  /**
   * Retrieves a single event and its rank snapshots across platforms.
   * @param {string} eventId
   * @returns {{ event: object, snapshots: Array<object> } | null}
   */
  function getSingleEventHistory(eventId) {
    const events = db.getEvents({ event_id: eventId });
    if (!events || events.length === 0) {
      return null;
    }
    const event = events[0];
    const snapshots = [];
    for (const itemId of event.raw_item_ids || []) {
      const itemSnaps = db.getItemSnapshots(itemId);
      snapshots.push(...itemSnaps);
    }
    return {
      event,
      snapshots
    };
  }

  /**
   * Closes database connection.
   */
  function destroy() {
    db.close();
  }

  return {
    dataDir,
    db,
    configStore,
    crawlOnce,
    generateBriefOnce,
    getBrief,
    getEvents,
    getRawItems,
    getConfig,
    updateConfig,
    getSingleEventHistory,
    destroy,
    close: destroy
  };
}
