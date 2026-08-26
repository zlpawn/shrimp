import crypto from "node:crypto";

/**
 * Common Chinese stop words and noisy conversational phrases.
 */
const STOP_WORDS = new Set([
  "如何", "评价", "怎么看", "如何看待", "为什么", "最新", "今日", "发布", "刚刚", "宣布", "曝",
  "网传", "回应", "官方", "什么是", "哪个", "进行", "关于", "对于", "一个", "这个", "那个",
  "以及", "因为", "所以", "如果", "但是", "而且", "相关", "的", "了", "在", "是", "和", "与",
  "被", "将", "已", "并", "中", "上", "下", "前", "后", "有", "多", "引发", "热议", "登上", "热搜"
]);

/**
 * Tokenize Chinese and English text into normalized entity & n-gram tokens.
 * @param {string} text 
 * @returns {Set<string>}
 */
export function tokenizeText(text = "") {
  if (!text || typeof text !== "string") return new Set();
  const normalized = text.toLowerCase().trim();
  const tokens = new Set();

  // Extract English/alphanumeric tokens and hyphenated identifiers (e.g. gpt-5, deepseek, 36kr, v4)
  const enMatches = normalized.match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/gi) || [];
  for (const m of enMatches) {
    if (m.length > 1 && !STOP_WORDS.has(m)) {
      tokens.add(m);
    }
  }

  // Extract Chinese characters
  const cjkOnly = normalized.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let i = 0; i < cjkOnly.length - 1; i++) {
    const bi = cjkOnly.slice(i, i + 2);
    if (!STOP_WORDS.has(bi)) {
      tokens.add(bi);
    }
    if (i < cjkOnly.length - 2) {
      const tri = cjkOnly.slice(i, i + 3);
      if (!STOP_WORDS.has(tri)) {
        tokens.add(tri);
      }
    }
  }

  return tokens;
}

/**
 * Computes Jaccard similarity between two token sets.
 * @param {Set<string>} setA 
 * @param {Set<string>} setB 
 * @returns {number}
 */
export function computeJaccardSimilarity(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
  let intersectionCount = 0;
  for (const t of setA) {
    if (setB.has(t)) intersectionCount++;
  }
  const unionSize = setA.size + setB.size - intersectionCount;
  return unionSize > 0 ? intersectionCount / unionSize : 0;
}

/**
 * Checks if two items or clusters are semantically similar.
 * @param {Object} itemA 
 * @param {Object} itemB 
 * @returns {boolean}
 */
function areItemsSimilar(itemA, itemB) {
  const tokensA = itemA.tokens || tokenizeText(itemA.title);
  const tokensB = itemB.tokens || tokenizeText(itemB.title);

  // 1. High Jaccard similarity on tokens
  const jaccard = computeJaccardSimilarity(tokensA, tokensB);
  if (jaccard >= 0.22) return true;

  // 2. Strong shared multi-char entity match (e.g. "openai", "gpt-5", "deepseek", "固态电池")
  let sharedStrongTokens = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      if (t.length >= 3 || (/^[a-z0-9]/i.test(t) && t.length >= 2)) {
        sharedStrongTokens++;
      }
    }
  }
  if (sharedStrongTokens >= 1 && jaccard >= 0.12) return true;
  if (sharedStrongTokens >= 2) return true;

  return false;
}

/**
 * Matches an item title against focus topics keywords.
 * @param {string} title 
 * @param {Array<Object>} focusTopics 
 * @returns {string | null}
 */
function matchFocusTopic(title = "", focusTopics = []) {
  if (!title || !Array.isArray(focusTopics) || focusTopics.length === 0) return null;
  const lowerTitle = title.toLowerCase();

  for (const topic of focusTopics) {
    if (topic && topic.enabled !== false && Array.isArray(topic.keywords)) {
      for (const kw of topic.keywords) {
        if (kw && typeof kw === "string" && lowerTitle.includes(kw.toLowerCase())) {
          return topic.id;
        }
      }
    }
  }
  return null;
}

/**
 * Groups raw items into coarse clusters using token similarity & topic matching.
 * 
 * @param {Array<Object>} items 
 * @param {Array<Object>} [focusTopics] 
 * @returns {Array<Object>}
 */
export function coarseClusterItems(items = [], focusTopics = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const clusters = [];

  for (const item of items) {
    if (!item || !item.title) continue;

    const tokens = tokenizeText(item.title);
    const matchedTopic = matchFocusTopic(item.title, focusTopics);
    const enrichedItem = { ...item, tokens, matched_topic: matchedTopic };

    let matchedCluster = null;

    for (const cluster of clusters) {
      // Check similarity against representative item or cluster items
      const isMatch = areItemsSimilar(enrichedItem, cluster) ||
        cluster.items.some(existing => areItemsSimilar(enrichedItem, existing));

      if (isMatch) {
        matchedCluster = cluster;
        break;
      }
    }

    if (matchedCluster) {
      matchedCluster.items.push(enrichedItem);
      if (enrichedItem.id) matchedCluster.raw_item_ids.push(String(enrichedItem.id));
      if (enrichedItem.platform && !matchedCluster.platforms.includes(enrichedItem.platform)) {
        matchedCluster.platforms.push(enrichedItem.platform);
        matchedCluster.platform_count = matchedCluster.platforms.length;
      }
      if (!matchedCluster.matched_topic && enrichedItem.matched_topic) {
        matchedCluster.matched_topic = enrichedItem.matched_topic;
      }
      // Update timestamps
      const itemSeen = enrichedItem.first_seen_at || enrichedItem.collected_at;
      if (itemSeen && (!matchedCluster.first_seen_at || itemSeen < matchedCluster.first_seen_at)) {
        matchedCluster.first_seen_at = itemSeen;
      }
      const itemLast = enrichedItem.last_seen_at || enrichedItem.collected_at;
      if (itemLast && (!matchedCluster.last_seen_at || itemLast > matchedCluster.last_seen_at)) {
        matchedCluster.last_seen_at = itemLast;
      }
      // Update representative title if new item has a better rank
      const currentRank = Number(enrichedItem.rank) || 999;
      if (currentRank < matchedCluster.best_rank) {
        matchedCluster.best_rank = currentRank;
        matchedCluster.title = enrichedItem.title;
      }
    } else {
      const now = new Date().toISOString();
      const clusterId = "evt_" + crypto.randomBytes(6).toString("hex");
      clusters.push({
        event_id: clusterId,
        cluster_id: clusterId,
        title: enrichedItem.title,
        summary: enrichedItem.title,
        items: [enrichedItem],
        raw_item_ids: enrichedItem.id ? [String(enrichedItem.id)] : [],
        platforms: enrichedItem.platform ? [enrichedItem.platform] : [],
        platform_count: enrichedItem.platform ? 1 : 0,
        matched_topic: enrichedItem.matched_topic || null,
        best_rank: Number(enrichedItem.rank) || 999,
        tokens,
        first_seen_at: enrichedItem.first_seen_at || enrichedItem.collected_at || now,
        last_seen_at: enrichedItem.last_seen_at || enrichedItem.collected_at || now
      });
    }
  }

  for (const cluster of clusters) {
    let maxVelocity = 0;
    let dominantState = "NEW";
    for (const item of cluster.items || []) {
      const v = parseFloat(item.velocity) || 0;
      if (Math.abs(v) > Math.abs(maxVelocity)) {
        maxVelocity = v;
      }
      if (item.trend_state && item.trend_state !== "NEW") {
        dominantState = item.trend_state;
      }
    }
    cluster.velocity = maxVelocity;
    if (dominantState === "NEW") {
      if (maxVelocity >= 10 || (maxVelocity >= 5 && cluster.platform_count >= 2)) {
        dominantState = "RAPID_RISING";
      } else if (maxVelocity >= 2) {
        dominantState = "RISING";
      } else if (maxVelocity <= -3) {
        dominantState = "DECLINING";
      }
    }
    cluster.trend_state = dominantState;
  }

  return clusters;
}

/**
 * Safely parse JSON or markdown-fenced JSON from LLM output.
 * @param {string} text 
 * @returns {any}
 */
function safeParseJson(text) {
  if (!text || typeof text !== "string") return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to find JSON array or object substring
    const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Refines coarse clusters using an LLM model caller with graceful fallback.
 * 
 * @param {Array<Object>} coarseClusters 
 * @param {Function | Object} [modelCaller] 
 * @returns {Promise<Array<Object>>}
 */
export function refineClustersWithLLM(coarseClusters = [], modelCaller = null) {
  if (!modelCaller || !Array.isArray(coarseClusters) || coarseClusters.length === 0) {
    return coarseClusters;
  }

  const callFn = typeof modelCaller === "function"
    ? modelCaller
    : (typeof modelCaller?.callModel === "function" ? modelCaller.callModel.bind(modelCaller) : null);

  if (!callFn) {
    return coarseClusters;
  }

  return (async () => {
    try {
      const summaryPayload = coarseClusters.map(c => ({
        event_id: c.event_id,
        current_title: c.title,
        titles: c.items.map(i => i.title),
        platforms: c.platforms
      }));

      const prompt = `你是一个专业的新闻与舆情情报分析师。请对以下聚合热点事件进行提炼和规范化命名，生成一个客观精准的标题（title）和一段1句话的事件摘要（summary）。
返回严格的 JSON 数组格式，不要包含多余文字：
[
  {
    "event_id": "...",
    "title": "规范化事件标题",
    "summary": "1句话事件核心事实摘要"
  }
]

待处理事件：
${JSON.stringify(summaryPayload, null, 2)}`;

      const responseText = await callFn(prompt);
      const parsed = safeParseJson(responseText);

      if (Array.isArray(parsed) && parsed.length > 0) {
        const resultMap = new Map(parsed.map(p => [p.event_id, p]));
        return coarseClusters.map(c => {
          const match = resultMap.get(c.event_id);
          if (match) {
            return {
              ...c,
              title: match.title || c.title,
              summary: match.summary || c.summary || c.title
            };
          }
          return c;
        });
      }
      return coarseClusters;
    } catch {
      return coarseClusters;
    }
  })();
}

/**
 * Complete pipeline: coarse clusters raw items and transforms them into standard Event objects.
 * 
 * @param {Array<Object>} items 
 * @param {Array<Object>} [focusTopics] 
 * @param {Function | Object} [modelCaller] 
 * @returns {Promise<Array<Object>>}
 */
export async function clusterRawItems(items = [], focusTopics = [], modelCaller = null) {
  const coarse = coarseClusterItems(items, focusTopics);
  const refined = await refineClustersWithLLM(coarse, modelCaller);

  const now = new Date().toISOString();
  return refined.map(c => ({
    event_id: c.event_id || c.cluster_id || ("evt_" + crypto.randomBytes(6).toString("hex")),
    title: c.title,
    summary: c.summary || c.title,
    platforms: Array.isArray(c.platforms) ? c.platforms : [],
    platform_count: Number(c.platform_count) || (Array.isArray(c.platforms) ? c.platforms.length : 1),
    trend_state: c.trend_state || "NEW",
    velocity: Number(c.velocity) || 0.0,
    world_importance_score: c.world_importance_score !== undefined ? c.world_importance_score : null,
    creator_value_score: c.creator_value_score !== undefined ? c.creator_value_score : null,
    creator_angles: Array.isArray(c.creator_angles) ? c.creator_angles : [],
    matched_topic: c.matched_topic || null,
    raw_item_ids: Array.isArray(c.raw_item_ids) ? c.raw_item_ids : (c.items ? c.items.map(i => String(i.id)) : []),
    first_seen_at: c.first_seen_at || now,
    last_seen_at: c.last_seen_at || now,
    updated_at: now
  }));
}
