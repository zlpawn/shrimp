#!/usr/bin/env node

/**
 * X (Twitter) AI 羊毛与官方促销情报双轨巡检哨兵
 * 
 * 基于 sentinel-base 通用基底构建：
 * - 轨道一：中文深度实操与生态漏洞
 * - 轨道二：全球一手官方放粮与开发者免费层
 */

import { runSentinel } from "./lib/sentinel-base.mjs";

const DEFAULT_TRACK_1_QUERY = '(Gemini OR "AI Studio" OR Claude OR OpenAI OR ChatGPT OR Grok OR DeepSeek OR Groq OR Qwen OR OpenRouter OR Cerebras) (羊毛 OR 白嫖 OR 免费额度 OR 免费API OR 限时免费 OR 免费领 OR "0元" OR 送福利 OR 折扣 OR BUG价)';

const DEFAULT_TRACK_2_QUERY = '(OpenAI OR Anthropic OR Claude OR Gemini OR "Google AI" OR Groq OR DeepSeek) ("free tier" OR "free credits" OR "promo code" OR "at no extra charge" OR "free API" OR "free access")';

runSentinel({
  name: "X (Twitter) AI 羊毛与官方促销双轨巡检哨兵",
  defaultArchive: "/Users/user/素材/X/AI羊毛监控汇总.md",
  defaultOut: "/Users/user/素材/X/ai-promo-latest",
  defaultLimit: 8,
  // 提取历史 X 推文 ID 正则
  idExtractorRegex: /https:\/\/(?:x|twitter)\.com\/[a-zA-Z0-9_]+\/status\/(\d+)/g,
  // 提取推文对象中 ID 属性
  idGetter: (tweet) => tweet.id,
  // 解析巡检轨道
  resolveTracks: (options) => [
    {
      name: "轨道一：中文深度实操与生态漏洞",
      recipe: "recipes/x-source.mjs",
      args: {
        mode: "search",
        query: options.extra.track1 || DEFAULT_TRACK_1_QUERY,
        type: options.type || "latest",
        limit: options.limit
      }
    },
    {
      name: "轨道二：全球一手官方放粮与开发者免费层",
      recipe: "recipes/x-source.mjs",
      args: {
        mode: "search",
        query: options.extra.track2 || DEFAULT_TRACK_2_QUERY,
        type: options.type || "latest",
        limit: options.limit
      }
    }
  ],
  // 针对推文特征的高保真 Markdown 格式化
  formatMarkdown: (candidates, meta, totalRaw, archivedCount) => {
    let md = `# X (Twitter) AI 羊毛与官方促销巡检候选事实\n\n`;
    md += `> **巡检时间**：${new Date().toLocaleString("zh-CN")}\n`;
    md += `> **原始采集**：${totalRaw} 条 | **历史已收录**：${archivedCount} 条 | **未收录候选**：${candidates.length} 条\n`;
    md += `> **存储目录**：\`${meta.outputDir}\`\n\n`;
    md += `---\n\n`;

    if (candidates.length === 0) {
      md += `### ℹ️ 本次巡检未发现任何未收录的有效新推文。\n`;
      md += `所有抓取到的推文均已在存量档案中，无需进行增量追加，请严格保持静默。\n`;
      return md;
    }

    for (let i = 0; i < candidates.length; i++) {
      const t = candidates[i];
      const m = t.metrics || {};
      md += `## #${i + 1} ${t.author?.name || "未知"} (${t.author?.handle || ""})\n\n`;
      md += `- 🔗 **推文链接**：[查看推文](${t.url})\n`;
      md += `- 🕒 **发布时间**：\`${t.publishedAt || "未知"}\`\n`;
      md += `- 📊 **互动数据**：${m.rawString || "暂无"}\n\n`;
      md += `### 📝 原文事实内容\n\n`;
      md += `\`\`\`text\n${(t.rawText || "").trim()}\n\`\`\`\n\n`;

      if (t.quotedTweet) {
        md += `> 📌 **引用推文**：${t.quotedTweet.author} (${t.quotedTweet.handle})\n`;
        if (t.quotedTweet.url) md += `> 链接：${t.quotedTweet.url}\n`;
        md += `>\n> ${(t.quotedTweet.rawText || "").replace(/\n/g, "\n> ")}\n\n`;
      }
      md += `---\n\n`;
    }
    return md;
  }
}).catch((err) => {
  console.error("❌ [x-promo-sentinel] 执行出错:", err);
  process.exit(1);
});
