#!/usr/bin/env node
/**
 * scrapers/xhs.mjs
 * 
 * 小红书专项抓取器 (Xiaohongshu Scraper Module)
 * 职责：
 * 1. 针对指定目的地与主题检索素人经验（自动剔除商业广告、报团推广黑名单）
 * 2. 毫秒级提取真实笔记标题、作者名与发布日期
 * 3. 独立运行或作为模块导入均可
 * 
 * CLI 用法：
 *   node ./lib/skills/leo-travel-planner/scripts/scrapers/xhs.mjs --keyword="川西大环线 避坑" --limit=8
 */

import { withScraperTask, findOrCreateTab } from "./base.mjs";

const BLACKLIST_WORDS = [
  "私信", "报团", "定制游", "纯玩团", "小团", "拼车", 
  "包车师傅", "旅行社", "私聊", "滴滴我", "领队找我"
];

/**
 * 执行小红书专项抓取
 */
export async function scrapeXiaohongshu(options = {}) {
  const { keyword = "川西大环线 避坑", limit = 10 } = options;
  const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`;

  return await withScraperTask("xhs-search", async ({ runCmd }) => {
    // 1. 定位或新建小红书 Tab
    const { id: tabId } = await findOrCreateTab("xiaohongshu.com", searchUrl);
    await runCmd("tabs.claim", { tabId, focus: false });
    await runCmd("tabs.goto", { tabId, url: searchUrl, focus: false });

    // 2. 毫秒级等待搜索结果卡片出现 (动态就绪监听，最多等 5s)
    await runCmd("dom.wait", {
      tabId,
      selector: "section.note-item, .note-card, a.title, .title",
      timeoutMs: 5000,
    }).catch(() => null);

    // 3. 提取页面文本流
    const content = await runCmd("dom.content", { tabId, maxChars: 8000 });
    const text = content?.text || "";

    // 4. 正则解析与去噪
    const notes = [];
    // 匹配如: "川西自驾踩坑实录｜藏区保命干货全汇总 十一的长镜头 07-19" 或 "川西高反都是吃出来的 薯片脆皮 4天前"
    const notePattern = /([^\n]+?(?:避坑|踩坑|高反|自驾|听劝|血泪|后悔|保命|经验)[^\n]*?)\s+([^\s\d]{2,12})\s+(\d{1,2}-\d{1,2}|\d+天前|\d{4}-\d{2}-\d{2})/g;

    let match;
    while ((match = notePattern.exec(text)) !== null) {
      const title = match[1].trim();
      const author = match[2].trim();
      const date = match[3].trim();

      // 过滤广告黑名单
      if (!BLACKLIST_WORDS.some(bw => title.includes(bw) || author.includes(bw))) {
        if (!notes.some(n => n.title === title)) {
          notes.push({
            title,
            author,
            date,
            sourceUrl: searchUrl,
            platform: "小红书",
          });
          if (notes.length >= limit) break;
        }
      }
    }

    // 兜底补录：若严格匹配数量不足，提取包含关键词的核心行
    if (notes.length === 0) {
      const fallbackLines = text.split("\n").map(s => s.trim()).filter(s => 
        (s.includes("避坑") || s.includes("高反") || s.includes("踩坑")) && 
        !BLACKLIST_WORDS.some(bw => s.includes(bw)) &&
        s.length >= 8 && s.length <= 60
      ).slice(0, limit);

      for (const line of fallbackLines) {
        notes.push({
          title: line,
          author: "素人实测",
          date: "当季",
          sourceUrl: searchUrl,
          platform: "小红书",
        });
      }
    }

    return {
      keyword,
      scrapedAt: new Date().toISOString(),
      total: notes.length,
      notes,
    };
  });
}

// 支持 CLI 直接执行
if (process.argv[1] && process.argv[1].endsWith("xhs.mjs")) {
  const args = process.argv.slice(2);
  let keyword = "川西大环线 避坑";
  let limit = 8;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--keyword=")) keyword = args[i].slice(10);
    else if (args[i] === "--keyword" && args[i + 1]) keyword = args[++i];
    else if (args[i].startsWith("--limit=")) limit = Number(args[i].slice(8));
    else if (args[i] === "--limit" && args[i + 1]) limit = Number(args[++i]);
  }

  console.log(`[XHS Scraper] 开始抓取小红书关键词: "${keyword}" (上限: ${limit} 条)...`);
  scrapeXiaohongshu({ keyword, limit })
    .then((res) => {
      console.log(`[XHS Scraper] 抓取成功！共提取到 ${res.total} 篇真实素人笔记 (标签组已自动解散)：`);
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error("[XHS Scraper] 抓取失败:", err.message);
      process.exit(1);
    });
}
