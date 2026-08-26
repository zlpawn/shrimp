/**
 * Safe JSON parser handling raw or markdown code-fenced strings.
 * @param {string} text 
 * @returns {any}
 */
function safeParseJson(text) {
  if (!text || typeof text !== "string") return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
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
 * Clamp a numeric score between min and max, rounded to 1 decimal.
 * @param {number} val 
 * @param {number} min 
 * @param {number} max 
 * @returns {number}
 */
function clampScore(val, min = 1.0, max = 10.0) {
  const num = Number(val);
  if (isNaN(num)) return min;
  const clamped = Math.max(min, Math.min(max, num));
  return Number(clamped.toFixed(1));
}

/**
 * Heuristically scores an event when offline or when LLM caller is not available.
 * @param {Object} event 
 * @returns {{ world_importance_score: number, creator_value_score: number, creator_angles: string[], summary: string }}
 */
function calculateHeuristicScores(event) {
  const title = (event.title || "").toLowerCase();
  const platforms = Array.isArray(event.platforms) ? event.platforms : [];
  const platformCount = Math.max(1, Number(event.platform_count) || platforms.length || 1);
  const velocity = Number(event.velocity) || 0;
  const trendState = event.trend_state || "NEW";

  let worldScore = 5.0;
  let creatorScore = 5.0;

  // 1. World Importance Platform Weighting
  if (platforms.some(p => ["wallstreetcn", "36kr", "github"].includes(p))) {
    worldScore += 2.0;
  }
  if (platformCount >= 3) {
    worldScore += 1.5;
    creatorScore += 1.5;
  } else if (platformCount >= 2) {
    worldScore += 0.8;
    creatorScore += 0.8;
  }

  // 2. World Importance Keywords
  const macroKeywords = [
    "央行", "降息", "加息", "突破", "重磅", "政策", "通胀", "gdp", "制裁", "关税",
    "危机", "重组", "财报", "大模型", "芯片", "算力", "科学", "医学", "首发", "收购"
  ];
  for (const kw of macroKeywords) {
    if (title.includes(kw)) {
      worldScore += 1.5;
      break;
    }
  }

  // Gossip / Pure entertainment penalty for world importance
  const gossipKeywords = ["结婚", "离婚", "恋情", "八卦", "穿搭", "走红毯", "同框", "生子"];
  for (const kw of gossipKeywords) {
    if (title.includes(kw)) {
      worldScore -= 2.0;
      creatorScore += 1.0;
      break;
    }
  }

  // 3. Creator Value Evaluation
  if (platforms.some(p => ["zhihu", "bilibili", "douyin", "weibo", "xiaohongshu"].includes(p))) {
    creatorScore += 1.2;
  }

  if (trendState === "RAPID_RISING" || velocity >= 10) {
    creatorScore += 2.2;
  } else if (trendState === "RISING" || velocity >= 3) {
    creatorScore += 1.0;
  } else if (trendState === "PEAK") {
    creatorScore += 0.8;
  }

  const creatorViralKeywords = [
    "如何", "翻车", "热议", "争议", "黑幕", "测评", "体验", "对比", "内幕",
    "爆料", "回应", "真相", "实测", "避坑", "降价", "黑科技"
  ];
  for (const kw of creatorViralKeywords) {
    if (title.includes(kw)) {
      creatorScore += 1.8;
      break;
    }
  }

  if (event.matched_topic === "topic_ai") {
    worldScore += 1.0;
    creatorScore += 1.2;
  } else if (event.matched_topic === "topic_cars") {
    worldScore += 0.5;
    creatorScore += 1.5;
  }

  // Determine sensible default angles
  let angles = [];
  if (event.matched_topic === "topic_ai" || title.includes("ai") || title.includes("模型")) {
    angles = [
      "核心技术原理解析与实际能力评测",
      "对比主流竞品的性能与成本优势",
      "对普通用户与上下游行业的落地影响"
    ];
  } else if (event.matched_topic === "topic_cars" || title.includes("车") || title.includes("电池")) {
    angles = [
      "从工程量产难度与技术路线拆解",
      "对普通消费者选购与二手保值率的影响",
      "对新能源与汽车市场格局的冲击与应对"
    ];
  } else if (worldScore >= 7.5) {
    angles = [
      "事件底层逻辑与宏观背景深度复盘",
      "不同立场关键方的利益博弈与连锁反应",
      "对大众民生与行业发展的长期启示"
    ];
  } else {
    angles = [
      "事件核心事实与深度背景拆解",
      "公众核心争议焦点与情绪痛点剖析",
      "从受众视角出发的实用建议与行动指引"
    ];
  }

  const summary = event.summary || `${event.title}（跨平台热度持续发酵，覆盖 ${platforms.join("、") || "多"} 平台）`;

  return {
    world_importance_score: clampScore(worldScore),
    creator_value_score: clampScore(creatorScore),
    creator_angles: Array.isArray(event.creator_angles) && event.creator_angles.length > 0 ? event.creator_angles : angles,
    summary
  };
}

/**
 * Scores events using LLM dual-scoring (World Importance & Creator Value) with heuristic offline fallback.
 * 
 * @param {Array<Object>} events 
 * @param {Function | Object} [modelCaller] 
 * @returns {Promise<Array<Object>>}
 */
export async function scoreEvents(events = [], modelCaller = null) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const callFn = typeof modelCaller === "function"
    ? modelCaller
    : (typeof modelCaller?.callModel === "function" ? modelCaller.callModel.bind(modelCaller) : null);

  // If no LLM available, apply rule-based heuristic scoring
  if (!callFn) {
    return events.map(evt => {
      const heuristic = calculateHeuristicScores(evt);
      return {
        ...evt,
        world_importance_score: evt.world_importance_score !== undefined && evt.world_importance_score !== null ? Number(evt.world_importance_score) : heuristic.world_importance_score,
        creator_value_score: evt.creator_value_score !== undefined && evt.creator_value_score !== null ? Number(evt.creator_value_score) : heuristic.creator_value_score,
        summary: evt.summary || heuristic.summary,
        creator_angles: Array.isArray(evt.creator_angles) && evt.creator_angles.length > 0 ? evt.creator_angles : heuristic.creator_angles
      };
    });
  }

  // Call LLM for dual-scoring
  try {
    const payload = events.map(e => ({
      event_id: e.event_id,
      title: e.title,
      platforms: e.platforms,
      trend_state: e.trend_state,
      velocity: e.velocity,
      matched_topic: e.matched_topic
    }));

    const prompt = `你是一个资深热点情报分析专家和全网内容选题总监。请评估以下热点事件，并提供客观双维度评分与创作切入角度。
评分维度（1.0 - 10.0 分，保留一位小数）：
1. world_importance_score：世界真实重要度（宏观经济、科技重大突破、政策法案、社会重大影响等）
2. creator_value_score：内容创作价值（讨论热度、选题钩子、观点争议性、受众痛点与共鸣感）
3. summary：1-2 句精炼客观的事实陈述与背景
4. creator_angles：2-3 个具体可落地的创作者切入角度

请返回严格的 JSON 数组，格式如下：
[
  {
    "event_id": "...",
    "world_importance_score": 8.5,
    "creator_value_score": 9.0,
    "summary": "...",
    "creator_angles": ["角度1", "角度2"]
  }
]

待评估事件：
${JSON.stringify(payload, null, 2)}`;

    const responseText = await callFn(prompt);
    const parsed = safeParseJson(responseText);

    if (Array.isArray(parsed) && parsed.length > 0) {
      const scoreMap = new Map(parsed.map(p => [p.event_id, p]));
      return events.map(evt => {
        const item = scoreMap.get(evt.event_id);
        if (item) {
          return {
            ...evt,
            world_importance_score: clampScore(item.world_importance_score ?? 5.0),
            creator_value_score: clampScore(item.creator_value_score ?? 5.0),
            summary: item.summary || evt.summary || evt.title,
            creator_angles: Array.isArray(item.creator_angles) && item.creator_angles.length > 0
              ? item.creator_angles
              : (evt.creator_angles || [])
          };
        }
        const fallback = calculateHeuristicScores(evt);
        return {
          ...evt,
          world_importance_score: evt.world_importance_score ?? fallback.world_importance_score,
          creator_value_score: evt.creator_value_score ?? fallback.creator_value_score,
          summary: evt.summary || fallback.summary,
          creator_angles: evt.creator_angles || fallback.creator_angles
        };
      });
    }
  } catch {
    // If LLM call or parsing fails, fallback cleanly to heuristics
  }

  return events.map(evt => {
    const heuristic = calculateHeuristicScores(evt);
    return {
      ...evt,
      world_importance_score: evt.world_importance_score ?? heuristic.world_importance_score,
      creator_value_score: evt.creator_value_score ?? heuristic.creator_value_score,
      summary: evt.summary || heuristic.summary,
      creator_angles: evt.creator_angles || heuristic.creator_angles
    };
  });
}
