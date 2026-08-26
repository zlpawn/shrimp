import { fetchWithProxy } from "./proxy-helper.mjs";

/**
 * Decode XML entities and strip CDATA wrappers.
 * @param {string} str
 * @returns {string}
 */
export function decodeXmlEntities(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

/**
 * Extract content inside a specific XML tag.
 * @param {string} xmlBlock
 * @param {string} tagName
 * @returns {string}
 */
function extractTagContent(xmlBlock, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xmlBlock.match(regex);
  return match ? match[1].trim() : "";
}

/**
 * Extract URL from <link> tag (handles both text nodes and href attributes).
 * @param {string} xmlBlock
 * @returns {string}
 */
function extractLink(xmlBlock) {
  // Check for Atom style: <link href="..." rel="alternate" /> or <link rel="alternate" href="..." />
  const hrefMatch = xmlBlock.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
  if (hrefMatch && hrefMatch[1]) {
    return hrefMatch[1].trim();
  }

  // Check for standard RSS style: <link>https://...</link>
  const textLink = extractTagContent(xmlBlock, "link");
  if (textLink) {
    return decodeXmlEntities(textLink);
  }

  return "";
}

/**
 * Parse an XML string (RSS 2.0, RSS 1.0, or Atom) into Standard Items.
 * @param {string} sourceId
 * @param {string} xmlText
 * @param {string} [feedUrl=""]
 * @returns {Array<object>}
 */
export function parseRssXml(sourceId, xmlText, feedUrl = "") {
  if (!xmlText || typeof xmlText !== "string") {
    return [];
  }

  const now = new Date().toISOString();
  const normalizedSource = String(sourceId || "rss").trim();

  // Find all <item> (RSS) or <entry> (Atom) blocks
  const itemMatches = [
    ...xmlText.matchAll(/<item[\s\S]*?>([\s\S]*?)<\/item>/gi),
    ...xmlText.matchAll(/<entry[\s\S]*?>([\s\S]*?)<\/entry>/gi)
  ];

  if (!itemMatches || itemMatches.length === 0) {
    return [];
  }

  const items = [];
  for (let i = 0; i < itemMatches.length; i++) {
    const block = itemMatches[i][1] || itemMatches[i][0];

    const rawTitle = extractTagContent(block, "title");
    const title = decodeXmlEntities(rawTitle);
    if (!title) continue;

    let link = extractLink(block);
    if (!link) {
      const guid = extractTagContent(block, "guid");
      if (guid && (guid.startsWith("http://") || guid.startsWith("https://"))) {
        link = decodeXmlEntities(guid);
      }
    }

    // If link is relative and feedUrl is provided, resolve it
    if (link && feedUrl && !link.startsWith("http://") && !link.startsWith("https://")) {
      try {
        link = new URL(link, feedUrl).toString();
      } catch {}
    }

    const rawDesc =
      extractTagContent(block, "description") ||
      extractTagContent(block, "content:encoded") ||
      extractTagContent(block, "summary") ||
      extractTagContent(block, "content");
    const description = decodeXmlEntities(rawDesc);

    const pubDateStr =
      extractTagContent(block, "pubDate") ||
      extractTagContent(block, "published") ||
      extractTagContent(block, "updated") ||
      extractTagContent(block, "dc:date");

    let publishedAt = now;
    if (pubDateStr) {
      const parsedTime = Date.parse(pubDateStr);
      if (!Number.isNaN(parsedTime)) {
        publishedAt = new Date(parsedTime).toISOString();
      }
    }

    const guid =
      decodeXmlEntities(extractTagContent(block, "guid")) ||
      decodeXmlEntities(extractTagContent(block, "id")) ||
      "";

    const author =
      decodeXmlEntities(extractTagContent(block, "author")) ||
      decodeXmlEntities(extractTagContent(block, "dc:creator")) ||
      "";

    const itemId = guid || (link ? `${normalizedSource}:${link}` : `${normalizedSource}:${title}`);

    items.push({
      id: itemId,
      source: "rss",
      platform: normalizedSource,
      country: "CN",
      language: "zh",
      type: "rss",
      title,
      url: link,
      rank: i + 1,
      previous_rank: 0,
      velocity: "",
      score: 0,
      first_seen_at: publishedAt,
      last_seen_at: now,
      collected_at: now,
      raw: {
        title,
        url: link,
        description,
        pubDate: pubDateStr,
        guid,
        author,
        feedUrl
      }
    });
  }

  return items;
}

/**
 * Fetch an RSS or Atom feed from a URL and parse it into Standard Items.
 * @param {string} url
 * @param {object} [options={}]
 * @returns {Promise<Array<object>>}
 */
export async function fetchRssFeed(url, options = {}) {
  const {
    sourceId = "",
    timeout = 15000,
    retries = 2,
    retryDelay = 500,
    proxy = {},
    fetchImpl,
    headers = {}
  } = options;

  const requestHeaders = {
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
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
        const err = new Error(`RSS feed error for "${url}" (HTTP ${status}): ${errorText.slice(0, 200)}`);
        err.status = status;

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

      const xmlText = await res.text();
      return parseRssXml(sourceId || url, xmlText, url);
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

  throw lastError || new Error(`Failed to fetch RSS feed from "${url}" after ${retries} retries`);
}
