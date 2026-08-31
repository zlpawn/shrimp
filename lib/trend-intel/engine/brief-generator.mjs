/**
 * Format a platform tag list.
 * @param {string[]} platforms 
 * @returns {string}
 */
function formatPlatforms(platforms = []) {
  if (!Array.isArray(platforms) || platforms.length === 0) return "全网";
  return platforms.join(", ");
}

/**
 * Assembles the 5-section daily intelligence brief in Markdown.
 * 
 * 5 Sections:
 * ① 今天必须知道 (Must Know - World Importance)
 * ② 正在快速升温 (Rapid Rising - Velocity & State)
 * ③ 今天最值得做的内容 (Top Creator Ideas - Angles & Opportunities)
 * ④ 值得知道，但不一定做 (World Observation - Background & Context)
 * ⑤ 大众舆论讨论 (Public Chatter & Sentiment)
 * + 🎯 重点赛道精选专栏 (Dynamic Focus Topics)
 * 
 * @param {Array<Object>} events 
 * @param {Array<Object>} [focusTopics] 
 * @param {Object} [options] 
 * @returns {string}
 */
export function assembleBriefMarkdown(events = [], focusTopics = [], options = {}) {
  const now = new Date();
  const dateStr = options.date || now.toISOString().slice(0, 10);
  const timeStr = options.time || now.toTimeString().slice(0, 5);

  const lines = [];

  // Title & Header
  lines.push(`# 每日热点与趋势情报简报`);
  lines.push(`> 📅 日期：${dateStr} | 🕒 生成时间：${timeStr} | 📊 覆盖热点事件：${events.length} 项\n`);

  if (!Array.isArray(events) || events.length === 0) {
    lines.push(`*今日暂无可聚合的热点事件数据。*\n`);
    return lines.join("\n");
  }

  // Helper deduplicator so items can appear in their primary sections
  const mustKnowEvents = events
    .filter(e => Number(e.world_importance_score) >= 8.0)
    .sort((a, b) => (b.world_importance_score || 0) - (a.world_importance_score || 0));

  const rapidRisingEvents = events
    .filter(e => e.trend_state === "RAPID_RISING" || Number(e.velocity) >= 5.0 || (e.trend_state === "RISING" && Number(e.velocity) >= 2.0))
    .sort((a, b) => (b.velocity || 0) - (a.velocity || 0));

  const creatorEvents = events
    .filter(e => Number(e.creator_value_score) >= 7.5 || (Array.isArray(e.creator_angles) && e.creator_angles.length > 0))
    .sort((a, b) => (b.creator_value_score || 0) - (a.creator_value_score || 0));

  const worldObservationEvents = events
    .filter(e => (Number(e.world_importance_score) >= 6.0 && Number(e.creator_value_score) < 7.5) || (Number(e.world_importance_score) >= 6.0 && !rapidRisingEvents.includes(e) && !mustKnowEvents.includes(e)))
    .sort((a, b) => (b.world_importance_score || 0) - (a.world_importance_score || 0));

  const publicChatterEvents = events
    .filter(e => !mustKnowEvents.includes(e) && (e.trend_state === "PEAK" || e.trend_state === "RISING" || Number(e.creator_value_score) >= 5.0 || e.platform_count >= 2))
    .sort((a, b) => (b.platform_count || 0) - (a.platform_count || 0));

  // Section 1: ① 今天必须知道
  lines.push(`## ① 今天必须知道`);
  const topMustKnow = mustKnowEvents.length > 0
    ? mustKnowEvents.slice(0, 5)
    : [...events].sort((a, b) => (b.world_importance_score || 0) - (a.world_importance_score || 0)).slice(0, 3);

  if (topMustKnow.length > 0) {
    for (const evt of topMustKnow) {
      const score = evt.world_importance_score !== null && evt.world_importance_score !== undefined ? `${evt.world_importance_score}/10` : "未评分";
      lines.push(`- **【${evt.title}】** (世界重要度: ${score} | 平台: ${formatPlatforms(evt.platforms)})`);
      lines.push(`  - 📌 **核心事实**：${evt.summary || evt.title}`);
    }
  } else {
    lines.push(`- *今日暂无重大宏观级突发事件。*`);
  }
  lines.push("");

  // Section 2: ② 正在快速升温
  lines.push(`## ② 正在快速升温`);
  const topRising = rapidRisingEvents.length > 0
    ? rapidRisingEvents.slice(0, 5)
    : [...events].sort((a, b) => (b.velocity || 0) - (a.velocity || 0)).slice(0, 3);

  if (topRising.length > 0) {
    for (const evt of topRising) {
      const velText = Number(evt.velocity) > 0 ? `+${evt.velocity}` : `${evt.velocity || 0}`;
      lines.push(`- **【${evt.title}】** 🚀 状态: ${evt.trend_state || "RISING"} (速度: ${velText} 排名/时 | 平台: ${formatPlatforms(evt.platforms)})`);
      lines.push(`  - 📌 **动态速递**：${evt.summary || evt.title}`);
    }
  } else {
    lines.push(`- *当前暂无处于快速攀升状态的突发热点。*`);
  }
  lines.push("");

  // Section 3: ③ 今天最值得做的内容
  lines.push(`## ③ 今天最值得做的内容`);
  const topCreator = creatorEvents.length > 0
    ? creatorEvents.slice(0, 5)
    : [...events].sort((a, b) => (b.creator_value_score || 0) - (a.creator_value_score || 0)).slice(0, 3);

  if (topCreator.length > 0) {
    for (const evt of topCreator) {
      const score = evt.creator_value_score !== null && evt.creator_value_score !== undefined ? `${evt.creator_value_score}/10` : "未评分";
      const angles = Array.isArray(evt.creator_angles) && evt.creator_angles.length > 0
        ? evt.creator_angles
        : ["事件核心事实与深度背景拆解", "受众痛点与舆论争议分析"];
      const windowStr = evt.trend_state === "RAPID_RISING"
        ? "🔥 黄金 12 小时内（抢占首发热度与第一波讨论）"
        : (evt.trend_state === "PEAK" ? "⚡ 24 小时内（适合深度复盘、观点输出与争议解析）" : "⏱️ 48 小时内（适合系统化知识科普或长文长视频）");

      lines.push(`- **【${evt.title}】** 💡 创作价值: ${score}`);
      lines.push(`  - 📌 **事件概述**：${evt.summary || evt.title}`);
      lines.push(`  - 🎯 **切入角度推荐**：`);
      for (const angle of angles) {
        lines.push(`    - ${angle}`);
      }
      lines.push(`  - ⏳ **建议窗口期**：${windowStr}`);
    }
  } else {
    lines.push(`- *今日暂无高价值创作选题建议。*`);
  }
  lines.push("");

  // Section 4: ④ 值得知道，但不一定做
  lines.push(`## ④ 值得知道，但不一定做`);
  const topObservation = worldObservationEvents.length > 0
    ? worldObservationEvents.slice(0, 5)
    : events.slice(0, 3);

  if (topObservation.length > 0) {
    for (const evt of topObservation) {
      const wScore = evt.world_importance_score !== null && evt.world_importance_score !== undefined ? `${evt.world_importance_score}/10` : "-";
      const cScore = evt.creator_value_score !== null && evt.creator_value_score !== undefined ? `${evt.creator_value_score}/10` : "-";
      lines.push(`- **【${evt.title}】** (重要度: ${wScore} | 创作价值: ${cScore})`);
      lines.push(`  - 📌 **观察说明**：${evt.summary || evt.title}`);
    }
  } else {
    lines.push(`- *暂无需要单独宏观观察的行业背景事件。*`);
  }
  lines.push("");

  // Section 5: ⑤ 大众舆论讨论
  lines.push(`## ⑤ 大众舆论讨论`);
  const topChatter = publicChatterEvents.length > 0
    ? publicChatterEvents.slice(0, 5)
    : events.slice(0, 3);

  if (topChatter.length > 0) {
    for (const evt of topChatter) {
      lines.push(`- **【${evt.title}】** (平台: ${formatPlatforms(evt.platforms)})`);
      lines.push(`  - 💬 **舆论焦点**：${evt.summary || evt.title}`);
    }
  } else {
    lines.push(`- *暂无显著大众舆论事件。*`);
  }
  lines.push("");

  // Focus Columns: 🎯 重点赛道精选专栏
  if (Array.isArray(focusTopics) && focusTopics.length > 0) {
    for (const topic of focusTopics) {
      if (!topic || topic.enabled === false) continue;

      const topicEvents = events.filter(evt => {
        if (evt.matched_topic === topic.id) return true;
        if (Array.isArray(topic.keywords)) {
          const lowerTitle = (evt.title || "").toLowerCase();
          return topic.keywords.some(kw => kw && lowerTitle.includes(kw.toLowerCase()));
        }
        return false;
      });

      if (topicEvents.length > 0) {
        const icon = topic.icon ? `${topic.icon} ` : "";
        lines.push(`## 🎯 重点赛道精选：${topic.name}`);
        for (const evt of topicEvents.slice(0, 5)) {
          const score = evt.creator_value_score ? ` (创作价值: ${evt.creator_value_score}/10)` : "";
          lines.push(`- **【${evt.title}】**${score}`);
          lines.push(`  - 📌 **赛道动态**：${evt.summary || evt.title}`);
          if (Array.isArray(evt.creator_angles) && evt.creator_angles.length > 0) {
            lines.push(`  - 💡 **赛道视角**：${evt.creator_angles[0]}`);
          }
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

/**
 * Generates structured daily brief object with markdown and metadata.
 * 
 * @param {Array<Object>} events 
 * @param {Array<Object>} [focusTopics] 
 * @param {Object} [options] 
 * @returns {{ date: string, markdown: string, metadata: Object, created_at: string }}
 */
export function generateDailyBrief(events = [], focusTopics = [], options = {}) {
  const now = new Date();
  const dateStr = options.date || now.toISOString().slice(0, 10);
  const markdown = assembleBriefMarkdown(events, focusTopics, options);

  const highImportanceCount = events.filter(e => Number(e.world_importance_score) >= 8.0).length;
  const highCreatorCount = events.filter(e => Number(e.creator_value_score) >= 7.5).length;
  const rapidRisingCount = events.filter(e => e.trend_state === "RAPID_RISING" || Number(e.velocity) >= 5.0).length;

  const eventLinks = {};
  for (const evt of events) {
    if (evt.title) {
      eventLinks[evt.title] = {
        url: evt.primary_url || (evt.items && evt.items[0]?.url) || "",
        platform_urls: evt.platform_urls || {}
      };
    }
  }

  return {
    date: dateStr,
    markdown,
    metadata: {
      total_events: events.length,
      high_importance_count: highImportanceCount,
      high_creator_count: highCreatorCount,
      rapid_rising_count: rapidRisingCount,
      event_links: eventLinks,
      generated_at: now.toISOString()
    },
    created_at: now.toISOString()
  };
}
