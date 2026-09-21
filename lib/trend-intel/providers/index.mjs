import { PLATFORMS, getPlatform, isSupportedPlatform, listPlatforms } from "./platforms.mjs";
import { resolveProxyUrl, createProxyAgent, fetchWithProxy } from "./proxy-helper.mjs";
import { fetchNewsNowPlatform, parseNewsNowResponse } from "./newsnow.mjs";
import { fetchRssFeed, parseRssXml } from "./rss.mjs";
import { fetchDiscourseViaBrowser, normalizeDiscourseTopics } from "./browser-fetcher.mjs";

export {
  PLATFORMS,
  getPlatform,
  isSupportedPlatform,
  listPlatforms,
  resolveProxyUrl,
  createProxyAgent,
  fetchWithProxy,
  fetchNewsNowPlatform,
  parseNewsNowResponse,
  fetchRssFeed,
  parseRssXml,
  fetchDiscourseViaBrowser,
  normalizeDiscourseTopics
};

/**
 * Execute tasks with concurrency limit.
 * @param {number} concurrency
 * @param {Array<T>} items
 * @param {(item: T) => Promise<R>} iteratorFn
 * @returns {Promise<Array<R>>}
 */
async function asyncPool(concurrency, items, iteratorFn) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    results.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean, clean);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

/**
 * Crawl all enabled platforms and active focus topic RSS sources.
 * @param {object} config - TrendIntelConfig
 * @param {object} [options={}] - Crawl options (concurrency, proxy, fetchImpl, etc.)
 * @returns {Promise<Array<object>>} Flat list of Standard Raw Items
 */
export async function crawlAllActivePlatforms(config = {}, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency) || 3);
  const proxyConfig = options.proxy || config?.proxy || {};
  const fetchOptions = {
    proxy: proxyConfig,
    fetchImpl: options.fetchImpl,
    timeout: options.timeout || 15000,
    retries: options.retries !== undefined ? options.retries : 2
  };

  // 1. Identify enabled hotlist platforms
  const platformSettings = config?.platforms || {};
  const enabledPlatforms = Object.entries(platformSettings)
    .filter(([_, enabled]) => enabled === true)
    .map(([platformId]) => platformId.toLowerCase());

  // 2. Identify enabled RSS sources from focus topics
  const focusTopics = Array.isArray(config?.focus_topics) ? config.focus_topics : [];
  const activeRssSources = [];
  const seenRssUrls = new Set();

  for (const topic of focusTopics) {
    if (topic?.enabled === false) continue;
    const sources = Array.isArray(topic.rss_sources) ? topic.rss_sources : [];
    for (const url of sources) {
      const trimmedUrl = String(url || "").trim();
      if (trimmedUrl && !seenRssUrls.has(trimmedUrl)) {
        seenRssUrls.add(trimmedUrl);
        activeRssSources.push({
          url: trimmedUrl,
          sourceId: topic.id || "rss",
          platformName: topic.name || "RSS",
          icon: topic.icon || "📰",
          cookie: topic.cookie || ""
        });
      }
    }
  }

  // 3. Identify enabled geek feeds (extensible geek RSS sources)
  const geekFeeds = Array.isArray(config?.geek_feeds) ? config.geek_feeds : [];
  for (const feed of geekFeeds) {
    if (feed?.enabled === false) continue;
    if (options?.isScheduled && feed?.crawl_mode === "on_demand") continue;
    const trimmedUrl = String(feed?.url || "").trim();
    if (trimmedUrl && !seenRssUrls.has(trimmedUrl)) {
      seenRssUrls.add(trimmedUrl);
      activeRssSources.push({
        url: trimmedUrl,
        sourceId: feed.id || "geek_feed",
        platformName: feed.name || feed.id || "极客速览",
        icon: feed.icon || "💻",
        cookie: feed.cookie || ""
      });
    }
  }

  // 4. Build task list
  const tasks = [
    ...enabledPlatforms.map((platformId) => ({ type: "platform", platformId })),
    ...activeRssSources.map((rss) => ({
      type: "rss",
      url: rss.url,
      sourceId: rss.sourceId,
      platformName: rss.platformName,
      icon: rss.icon,
      cookie: rss.cookie || ""
    }))
  ];

  // 5. Execute all tasks concurrently with error isolation
  const allResults = await asyncPool(concurrency, tasks, async (task) => {
    if (task.type === "platform") {
      try {
        const items = await fetchNewsNowPlatform(task.platformId, fetchOptions);
        if (typeof options.onPlatformSuccess === "function") {
          options.onPlatformSuccess(task.platformId, items);
        }
        return items;
      } catch (err) {
        if (typeof options.onPlatformError === "function") {
          options.onPlatformError(task.platformId, err);
        } else {
          console.warn(`[crawlAllActivePlatforms] Failed to crawl platform "${task.platformId}":`, err?.message || err);
        }
        return [];
      }
    }

    if (task.type === "rss") {
      try {
        const items = await fetchRssFeed(task.url, {
          ...fetchOptions,
          sourceId: task.sourceId,
          platformName: task.platformName,
          icon: task.icon,
          cookie: task.cookie || ""
        });
        if (typeof options.onRssSuccess === "function") {
          options.onRssSuccess(task.url, items);
        }
        return items;
      } catch (err) {
        // Fallback for Cloudflare protected feeds like linux.do
        const isCloudflareBlocked =
          err?.status === 403 ||
          String(err?.message || "").includes("403") ||
          task.sourceId === "linux_do" ||
          (typeof task.url === "string" && task.url.includes("linux.do"));

        if (isCloudflareBlocked) {
          try {
            const browserItems = await fetchDiscourseViaBrowser({
              url: task.url,
              cookie: task.cookie || "",
              proxy: config?.proxy || {},
              sourceId: task.sourceId,
              platformName: task.platformName,
              icon: task.icon,
              timeout: 20000
            });
            if (browserItems && browserItems.length > 0) {
              if (typeof options.onRssSuccess === "function") {
                options.onRssSuccess(task.url, browserItems);
              }
              return browserItems;
            }
          } catch (browserErr) {
            console.warn(`[crawlAllActivePlatforms] Autonomous browser fetch fallback failed for "${task.url}":`, browserErr?.message || browserErr);
          }
        }

        if (typeof options.onRssError === "function") {
          options.onRssError(task.url, err);
        } else {
          console.warn(`[crawlAllActivePlatforms] Failed to crawl RSS feed "${task.url}":`, err?.message || err);
        }
        return [];
      }
    }

    return [];
  });

  return allResults.flat();
}
