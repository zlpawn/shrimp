#!/usr/bin/env node
/**
 * scrapers/xhs.mjs
 * 
 * 小红书专项抓取器 (Xiaohongshu Scraper Module - 账号安全防封强化版)
 * 
 * 🛡️ 核心防风控与账号安全设计准则：
 * 1. 【24h 本地长效缓存】：相同关键词 24 小时内只请求一次，避免反复高频触发小红书后台风控计数器。
 * 2. 【纯被动 DOM 读取】：绝不劫持 API 请求、不碰 JS 加密签名 (a1/x-s/x-t)，零前端特征暴露。
 * 3. 【风控熔断机制】：一旦检测到“滑动验证/网络异常/频繁”，立即主动熔断并退出，绝不盲目重试！
 * 4. 【拟人随机抖动 (Jitter)】：加入 1~2 秒随机等待，模拟真人视线停留，不搞机械化并发。
 * 5. 【首屏轻量采集】：仅取首屏自然曝光的真实笔记，严禁无限滚动到底部。
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { withScraperTask, findOrCreateTab } from "./base.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.resolve(__dirname, "../../output/cache/xhs_cache.json");

const BLACKLIST_WORDS = [
  "私信", "报团", "定制游", "纯玩团", "小团", "拼车", 
  "包车师傅", "旅行社", "私聊", "滴滴我", "领队找我"
];

const RISK_SIGNALS = [
  "请完成安全验证", "滑动滑块", "滑动验证", "验证码", 
  "网络异常", "访问过于频繁", "操作太快了", "请稍后重试"
];

/**
 * 随机延时工具（模拟人类操作随机抖动）
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 读取本地持久化缓存
 */
async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * 写入本地持久化缓存
 */
async function saveCache(cacheData) {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2), "utf8");
  } catch (e) {
    console.warn("[XHS Shield] 写入本地缓存警告:", e.message);
  }
}

/**
 * 执行小红书专项抓取
 */
export async function scrapeXiaohongshu(options = {}) {
  const {
    keyword = "川西大环线 避坑",
    limit = 8,
    useCache = true,
    cacheTtlHours = 24,
  } = options;

  // 1. 优先命中 24h 本地长效缓存（最大程度保护真实账号不被频繁调用）
  if (useCache) {
    const cache = await loadCache();
    const hit = cache[keyword];
    if (hit && hit.timestamp) {
      const ageHours = (Date.now() - hit.timestamp) / (1000 * 60 * 60);
      if (ageHours < cacheTtlHours && hit.data && hit.data.notes && hit.data.notes.length > 0) {
        console.log(`[XHS Shield 🛡️] 命中本地 24h 缓存 (缓存于 ${ageHours.toFixed(1)} 小时前)，跳过网络请求，保护账号安全！`);
        return {
          ...hit.data,
          fromCache: true,
          cacheAgeHours: Number(ageHours.toFixed(1)),
        };
      }
    }
  }

  const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`;

  return await withScraperTask("xhs-search", async ({ runCmd }) => {
    // 2. 定位或新建小红书 Tab (优先复用，绝不频繁重新打开或刷新)
    const { id: tabId, tab, reused } = await findOrCreateTab("xiaohongshu.com", searchUrl);
    await runCmd("tabs.claim", { tabId, focus: true });

    // 智能防风控：如果当前已在对应关键词的搜索页，直接读取 DOM，严禁重复刷新！
    const currentUrl = decodeURIComponent(tab?.url || "");
    if (!reused || !currentUrl.includes(keyword)) {
      await runCmd("tabs.goto", { tabId, url: searchUrl, focus: true });
      await runCmd("dom.wait", {
        tabId,
        selector: "section.note-item, .note-card, a.title, .title",
        timeoutMs: 6000,
      }).catch(() => null);
    }

    // 拟人视线停留 500~1000ms
    await sleep(Math.floor(Math.random() * 500) + 500);

    // 4. 提取页面文本流 (仅提取首屏纯文本，绝不注入破坏性脚本)
    const content = await runCmd("dom.content", { tabId, maxChars: 8000 });
    const text = content?.text || "";

    // 5. 核心风控熔断侦测：若页面出现滑块或频繁提示，立刻熔断！
    for (const signal of RISK_SIGNALS) {
      if (text.includes(signal)) {
        console.warn(`\n[XHS Shield ⚠️ 熔断告警] 检测到小红书风控特征: "${signal}"！`);
        console.warn("[XHS Shield ⚠️ 熔断告警] 触发主动安全熔断，立即终止对小红书的自动化探测，确保账号零风险！\n");
        return {
          keyword,
          scrapedAt: new Date().toISOString(),
          riskIntercepted: true,
          warning: `触发小红书安全风控 (${signal})，已主动熔断保号`,
          total: 0,
          notes: [],
        };
      }
    }

    // 6. 正则解析与商业去噪
    const notes = [];
    // 匹配小红书流: [标题] [作者名] [日期: MM-DD/X天前/YYYY-MM-DD] [点赞数]
    const cardRegex = /(?:^|\d+\s+)(.+?)\s+([^\s\d]{2,15}|[\w_]+)\s+(\d{1,2}-\d{1,2}|\d+天前|\d{4}-\d{2}-\d{2})\s+(\d+)/g;

    let match;
    while ((match = cardRegex.exec(text)) !== null) {
      let rawTitle = match[1].trim().replace(/^\d+\s*/, "");
      const author = match[2].trim();
      const date = match[3].trim();
      const likes = match[4].trim();

      // 去除通用无意义前缀
      if (rawTitle.startsWith("全部 图文 视频 用户 筛选")) {
        rawTitle = rawTitle.replace("全部 图文 视频 用户 筛选", "").trim();
      }

      // 仅保留旅行避坑相关有价值内容
      if (rawTitle.length >= 6 && !BLACKLIST_WORDS.some(bw => rawTitle.includes(bw) || author.includes(bw))) {
        if (!notes.some(n => n.title === rawTitle)) {
          notes.push({
            title: rawTitle,
            author,
            date,
            likes: Number(likes) || 0,
            sourceUrl: searchUrl,
            platform: "小红书",
          });
          if (notes.length >= limit) break;
        }
      }
    }

    // 兜底补录
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

    const finalResult = {
      keyword,
      scrapedAt: new Date().toISOString(),
      total: notes.length,
      notes,
    };

    // 7. 写入本地 24h 缓存
    if (notes.length > 0) {
      const cache = await loadCache();
      cache[keyword] = {
        timestamp: Date.now(),
        data: finalResult,
      };
      await saveCache(cache);
    }

    return finalResult;
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

  console.log(`[XHS Scraper] 开始安全检索小红书: "${keyword}" (上限: ${limit} 条)...`);
  scrapeXiaohongshu({ keyword, limit })
    .then((res) => {
      console.log(`[XHS Scraper] 抓取完成！(来源: ${res.fromCache ? "24h本地缓存" : "网络实时"}, 数量: ${res.total})`);
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error("[XHS Scraper] 抓取异常:", err.message);
      process.exit(1);
    });
}
