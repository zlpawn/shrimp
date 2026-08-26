import { fetchWithProxy } from "./proxy-helper.mjs";

const DEFAULT_NEWSNOW_API = "https://newsnow.busiyi.world/api/s";

/**
 * Parse a raw NewsNow API response into Standard Items.
 * @param {string} platformId
 * @param {any} payload
 * @returns {Array<object>}
 */
export function parseNewsNowResponse(platformId, payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  let data = null;
  if (Array.isArray(payload)) {
    data = payload;
  } else if (Array.isArray(payload.data)) {
    data = payload.data;
  } else if (payload.data && Array.isArray(payload.data.items)) {
    data = payload.data.items;
  }

  if (!Array.isArray(data)) {
    return [];
  }

  const now = new Date().toISOString();
  const normalizedPlatform = String(platformId || "unknown").toLowerCase();

  const items = [];
  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    if (!entry || typeof entry !== "object") continue;

    const title = String(entry.title || entry.name || entry.word || "").trim();
    if (!title) continue;

    const rawId = entry.id !== undefined && entry.id !== null ? String(entry.id).trim() : "";
    const itemId = rawId
      ? (rawId.startsWith(`${normalizedPlatform}:`) ? rawId : `${normalizedPlatform}:${rawId}`)
      : `${normalizedPlatform}:${title}`;

    const url = String(entry.url || entry.link || entry.mobileUrl || "").trim();
    const rank = Number(entry.rank) || (i + 1);
    const prevRank = Number(entry.previous_rank ?? entry.prevRank ?? 0) || 0;
    const velocity = String(entry.velocity || entry.trend || "");
    const score = Number(entry.hot ?? entry.hotValue ?? entry.heat ?? entry.score ?? 0) || 0;

    items.push({
      id: itemId,
      source: "newsnow",
      platform: normalizedPlatform,
      country: "CN",
      language: "zh",
      type: "hotlist",
      title,
      url,
      rank,
      previous_rank: prevRank,
      velocity,
      score,
      first_seen_at: now,
      last_seen_at: now,
      collected_at: now,
      raw: entry
    });
  }

  return items;
}

/**
 * Fetch hot items for a specific platform from NewsNow API with retries and timeout.
 * @param {string} platformId
 * @param {object} [options={}]
 * @returns {Promise<Array<object>>}
 */
export async function fetchNewsNowPlatform(platformId, options = {}) {
  const {
    baseUrl = DEFAULT_NEWSNOW_API,
    timeout = 15000,
    retries = 3,
    retryDelay = 500,
    proxy = {},
    fetchImpl,
    headers = {}
  } = options;

  const url = `${baseUrl.replace(/\/+$/, "")}?id=${encodeURIComponent(platformId)}&latest`;

  const requestHeaders = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "Shrimp-TrendIntel/1.0",
    ...headers
  };

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithProxy(
        url,
        {
          fetchImpl,
          timeout,
          headers: requestHeaders,
          method: "GET"
        },
        proxy
      );

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        const status = res.status;
        const err = new Error(`NewsNow API error for platform "${platformId}" (HTTP ${status}): ${errorText.slice(0, 200)}`);
        err.status = status;

        // If 4xx client error (except 429 rate limit), do not retry
        if (status >= 400 && status < 500 && status !== 429) {
          throw err;
        }

        if (attempt < retries) {
          const waitTime = retryDelay * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, waitTime));
          lastError = err;
          continue;
        }
        throw err;
      }

      const json = await res.json();
      return parseNewsNowResponse(platformId, json);
    } catch (err) {
      lastError = err;
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err;
      }
      if (attempt < retries) {
        const waitTime = retryDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }
    }
  }

  throw lastError || new Error(`Failed to fetch NewsNow data for platform "${platformId}" after ${retries} retries`);
}
