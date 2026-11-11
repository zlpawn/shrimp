#!/usr/bin/env node

/**
 * 抖音 (Douyin) 热门短视频、热榜趋势与原声神评事实探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：原视频文案、发布者（昵称/主页）、标签话题、点赞/评论/收藏/分享互动量、高赞热评原样落盘。
 * 2. 媒体资产全量本地化：无水印原画视频（.mp4）、高清封面（.jpg）、背景音乐（.mp3）与作者头像完整保存在 media/ 目录。
 * 3. 动态配置输出路径：无硬编码目录，优先级为 CLI --out > 记忆配置 (~/.shrimp/...) > 动态默认 (D:\素材\抖音)。
 * 4. 聚焦事实存证：沉淀一手视频客观事实与结构化元数据，二次创作与脚本改写由下游 Router（leo-video-router / leo-xhs-router）接力。
 */

import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, "../scripts/cli/index.mjs");

// ==================== 路径与配置解析 (零写死) ====================

function getConfigPath() {
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "douyin-source-config.json");
}

function loadConfig() {
  const cfgPath = getConfigPath();
  try {
    if (syncFs.existsSync(cfgPath)) {
      const raw = syncFs.readFileSync(cfgPath, "utf8").replace(/^\uFEFF/, "");
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

function saveConfig(patch) {
  const cfgPath = getConfigPath();
  try {
    syncFs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    const current = loadConfig();
    const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
    syncFs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  } catch (err) {
    console.warn("⚠️ 保存配置失败:", err.message);
    return null;
  }
}

function resolveOutputDir(cliDir) {
  if (cliDir) {
    const resolved = path.resolve(cliDir);
    saveConfig({ output_dir: resolved });
    return resolved;
  }
  const cfg = loadConfig();
  if (cfg.output_dir) {
    return path.resolve(cfg.output_dir);
  }
  if (process.env.LEO_LANTERN_DOUYIN_OUT) {
    return path.resolve(process.env.LEO_LANTERN_DOUYIN_OUT);
  }
  const defaultDir = "D:\\素材\\抖音";
  if (process.platform === "win32" && syncFs.existsSync("D:\\")) {
    return path.resolve(defaultDir);
  }
  return path.resolve(process.cwd(), "output", "douyin-source");
}

// ==================== Leo Lantern CLI 交互封装 ====================

function runLantern(cmd, args = []) {
  const res = spawnSync("node", [CLI_PATH, cmd, ...args], { encoding: "utf8" });
  if (res.status !== 0) {
    try {
      return { ok: false, error: JSON.parse(res.stderr || res.stdout || "{}").error };
    } catch {
      return { ok: false, error: res.stderr || res.stdout };
    }
  }
  try {
    return JSON.parse(res.stdout || "{}");
  } catch {
    return { ok: true, output: res.stdout };
  }
}

function runLanternEval(code) {
  const tmpFile = path.join(os.tmpdir(), `dy_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
  try {
    syncFs.writeFileSync(tmpFile, code, "utf8");
    return runLantern("eval", ["--file", tmpFile]);
  } finally {
    try { syncFs.unlinkSync(tmpFile); } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVideoDetail(maxWaitMs = 12000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const res = runLanternEval(EXTRACT_VIDEO_DETAIL_SCRIPT);
    if (res.ok && res.evalResult && (res.evalResult.videoUrl || (res.evalResult.desc && res.evalResult.stats?.digg))) {
      return res.evalResult;
    }
    await sleep(1500);
  }
  const finalRes = runLanternEval(EXTRACT_VIDEO_DETAIL_SCRIPT);
  return finalRes.ok ? finalRes.evalResult : null;
}

async function downloadMediaFile(url, destPath) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": "https://www.douyin.com/"
      }
    });
    if (!res.ok) {
      console.warn(`  ⚠️ 下载响应状态非 200: ${res.status} (${url})`);
      return false;
    }
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const fileStream = createWriteStream(destPath);
    await pipeline(res.body, fileStream);
    const stats = await fs.stat(destPath);
    return stats.size > 0;
  } catch (err) {
    console.warn(`  ⚠️ 下载媒体异常: ${err.message} (${url.slice(0, 60)}...)`);
    return false;
  }
}

// ==================== DOM 提取脚本 (浏览器沙箱执行) ====================

const EXTRACT_VIDEO_DETAIL_SCRIPT = `
(() => {
  const url = window.location.href;
  const awemeIdMatch = url.match(/\\/video\\/(\\d+)/) || url.match(/modal_id=(\\d+)/);
  const awemeId = awemeIdMatch ? awemeIdMatch[1] : '';

  // 1. 互动数据 (点赞、评论、收藏、分享)
  const digg = document.querySelector('[data-e2e="video-player-digg"]')?.innerText?.trim() || '';
  const comment = document.querySelector('[data-e2e="feed-comment-icon"]')?.innerText?.trim() || '';
  const collect = document.querySelector('[data-e2e="video-player-collect"]')?.innerText?.trim() || '';
  const share = document.querySelector('[data-e2e="video-player-share"]')?.innerText?.trim() || '';

  // 2. 作者信息
  let authorName = '';
  const authorLinks = Array.from(document.querySelectorAll('a[href*="/user/MS4w"]'));
  for (const a of authorLinks) {
    const text = a.innerText.trim();
    if (text && !text.includes('关注') && text.length < 30) {
      authorName = text;
      break;
    }
  }
  if (!authorName) {
    const match = document.body.innerText.match(/@([^\\s·\\n]+)\\s*·/);
    if (match) authorName = match[1];
  }
  const authorEl = authorLinks[0];
  const authorUrl = authorEl ? authorEl.href : '';
  const authorAvatar = document.querySelector('img[class*="avatar"], [class*="avatar"] img')?.src || '';

  // 3. 发布时间与文案描述
  let publishTime = '';
  const timeMatch = document.body.innerText.match(/发布时间：([\\d\\-\\s:]+)/);
  if (timeMatch) {
    publishTime = timeMatch[1].trim();
  }

  let desc = '';
  const descCandidates = Array.from(document.querySelectorAll('span, div, h1, p, h3')).filter(el => {
    const text = el.innerText || '';
    return text.includes('#') && el.children.length <= 4 && text.length > 5 && text.length < 500;
  });
  if (descCandidates.length > 0) {
    for (const cand of descCandidates) {
      const t = cand.innerText.trim();
      if (!t.includes('后播放') && !t.includes('后循环') && t.includes('#')) {
        desc = t;
        break;
      }
    }
    if (!desc) desc = descCandidates[0].innerText.trim();
  } else {
    const vDesc = document.querySelector('[data-e2e="video-desc"], [class*="desc"], [class*="title"]');
    if (vDesc && vDesc.innerText.trim() && vDesc.innerText.trim() !== '搜索') {
      desc = vDesc.innerText.trim();
    }
  }

  // 清洗 desc
  desc = desc.replace(/^\\d+s\\s*后播放.*?\\n/g, '').replace(/\\n\\s*\\d+s\\s*后播放.*$/g, '').trim();

  // 话题标签
  const hashtags = Array.from(desc.matchAll(/#([^\\s#]+)/g)).map(m => '#' + m[1]);

  // 4. 原画视频与背景音乐音频 (优先寻找非 blob 的真实 CDN 地址)
  let videoUrl = '';
  const vEls = Array.from(document.querySelectorAll('video'));
  for (const v of vEls) {
    const src = v.currentSrc || v.src || '';
    if (src.startsWith('http') && (src.includes('douyinvod.com') || src.includes('video/tos') || src.includes('.mp4'))) {
      videoUrl = src;
      break;
    }
  }

  // 兜底从性能资源表中获取真实视频流
  if (!videoUrl) {
    const resources = window.performance.getEntriesByType('resource').map(r => r.name);
    const matched = resources.filter(u => u.includes('douyinvod.com') && (u.includes('mime_type=video_mp4') || u.includes('video/tos')));
    if (matched.length > 0) {
      videoUrl = matched[matched.length - 1];
    }
  }

  let audioUrl = '';
  for (const v of vEls) {
    const src = v.currentSrc || v.src || '';
    if (src.startsWith('http') && (src.includes('douyinstatic.com') || src.includes('music') || src.endsWith('.mp3'))) {
      audioUrl = src;
      break;
    }
  }

  const musicEl = document.querySelector('[class*="music"], [class*="song"], [data-e2e*="music"]');
  const musicTitle = musicEl ? musicEl.innerText.trim() : '';

  // 5. 封面图
  let coverUrl = '';
  const posterImg = document.querySelector('img[class*="cover"], [class*="poster"] img, .videoImage img');
  if (posterImg && posterImg.src && posterImg.src.startsWith('http')) {
    coverUrl = posterImg.src;
  }
  if (!coverUrl) {
    const resources = window.performance.getEntriesByType('resource').map(r => r.name);
    const covers = resources.filter(u => u.includes('douyinpic.com') && (u.includes('cover') || u.includes('image-cut-tos')));
    if (covers.length > 0) coverUrl = covers[0];
  }

  // 6. 神评/精选评论
  const comments = Array.from(document.querySelectorAll('[data-e2e="comment-item"]')).map(el => {
    const lines = el.innerText.split('\\n').map(s => s.trim()).filter(Boolean);
    const avatar = el.querySelector('img')?.src || '';
    const author = lines[0] || '';
    const meta = lines.find(l => l.includes('前') || l.includes('·')) || '';
    const likes = lines.find(l => /^\\d+$/.test(l)) || '';
    const content = lines.find(l => l.length > 3 && l !== author && l !== meta && l !== likes && !l.includes('回复') && !l.includes('展开') && !l.includes('作者赞过')) || lines[1] || '';
    return {
      author,
      content,
      meta,
      likes,
      avatar
    };
  }).filter(c => c.author && c.content).slice(0, 15);

  const lines = desc.split('\\n').map(s => s.trim()).filter(Boolean);
  const cleanTitle = lines.find(l => l.includes('#') || (l.length > 5 && !l.includes('00:00') && !l.includes('作者声明') && !l.includes('倍速') && !l.includes('清屏'))) || lines[0] || '抖音短视频';

  const contentLines = lines.filter(l => {
    if (/^\\d{2}:\\d{2}\\s*\\/\\s*\\d{2}:\\d{2}$/.test(l)) return false;
    if (['倍速', '智能', '清屏', '连播', '举报', '全部评论', '留下你的精彩评论吧', '推荐视频', '关注', '加载中'].includes(l)) return false;
    if (/^\\d+(\\.\\d+)?[万亿]?$/.test(l)) return false;
    if (l.startsWith('发布时间：') || l.startsWith('大家都在搜：') || l.startsWith('粉丝') || l.startsWith('作者声明')) return false;
    return true;
  });
  const cleanDesc = contentLines.join('\\n') || cleanTitle;

  return {
    awemeId,
    url,
    title: cleanTitle,
    desc: cleanDesc,
    hashtags,
    publishTime,
    author: {
      name: authorName,
      url: authorUrl,
      avatar: authorAvatar
    },
    stats: {
      digg,
      comment,
      collect,
      share
    },
    videoUrl,
    audioUrl,
    musicTitle,
    coverUrl,
    comments
  };
})()
`;

const EXTRACT_HOT_BOARD_SCRIPT = `
(() => {
  const items = [];
  const lis = Array.from(document.querySelectorAll('li'));
  for (const li of lis) {
    const text = li.innerText || '';
    if (text.includes('万热度') && text.length < 80) {
      const match = text.match(/(.*?)\\n?(\\d+(\\.\\d+)?万热度)/);
      const a = li.querySelector('a') || li.closest('a');
      const href = a ? a.href : '';
      let rank = items.length + 1;
      let rawTitle = match ? match[1].trim() : text.split('\\n')[0];
      const rankMatch = rawTitle.match(/^(\\d+)\\s*(.*)/);
      if (rankMatch) {
        rank = parseInt(rankMatch[1], 10);
        rawTitle = rankMatch[2].trim();
      }
      const heat = match ? match[2].trim() : '';
      items.push({
        rank,
        title: rawTitle,
        heat,
        url: href
      });
    }
  }

  // 去重 (相同标题只留第一个)
  const uniqueItems = [];
  const seen = new Set();
  for (const it of items) {
    if (!seen.has(it.title)) {
      seen.add(it.title);
      uniqueItems.push(it);
    }
  }

  return {
    title: document.title,
    count: uniqueItems.length,
    items: uniqueItems
  };
})()
`;

const EXTRACT_SEARCH_CARDS_SCRIPT = `
(() => {
  const cards = [];
  const cardElements = document.querySelectorAll('.search-result-card');
  for (let i = 0; i < cardElements.length; i++) {
    const el = cardElements[i];
    const text = el.innerText || '';
    const img = el.querySelector('img')?.src || '';
    
    const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
    const duration = lines.find(l => /^\\d{2}:\\d{2}$/.test(l)) || '';
    const playCount = lines.find(l => /^\\d+(\\.\\d+)?[万亿]?$/.test(l)) || '';
    const authorLine = lines.find(l => l.startsWith('@')) || '';
    const author = authorLine.replace(/^@/, '');
    const dateLine = lines.find(l => l.includes('·') || l.includes('前') || l.includes('月') || l.includes('天')) || '';
    
    const desc = lines.find(l => l !== duration && l !== playCount && l !== authorLine && l !== dateLine && l.length > 5) || lines[0] || '';

    cards.push({
      index: i,
      author,
      desc,
      duration,
      playCount,
      dateLine,
      coverImg: img
    });
  }

  return {
    title: document.title,
    count: cards.length,
    cards
  };
})()
`;

// ==================== 主流程控制 ====================

async function main() {
  const args = process.argv.slice(2);

  // 1. CLI 选项快捷处理
  if (args.includes("--get-out")) {
    console.log(resolveOutputDir());
    process.exit(0);
  }

  const setOutIdx = args.indexOf("--set-out");
  if (setOutIdx !== -1 && args[setOutIdx + 1]) {
    const targetDir = path.resolve(args[setOutIdx + 1]);
    saveConfig({ output_dir: targetDir });
    console.log(`✅ 已持久化默认存储目录: ${targetDir}`);
    process.exit(0);
  }

  // 2. 参数解析
  let targetUrl = "";
  let mode = "hot"; // hot | search | video
  let query = "";
  let limit = 5;
  let downloadVideo = true;
  let customOut = "";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--url" && args[i + 1]) {
      targetUrl = args[i + 1];
      mode = "video";
      i++;
    } else if (a === "--mode" && args[i + 1]) {
      mode = args[i + 1].toLowerCase();
      i++;
    } else if (a === "--query" && args[i + 1]) {
      query = args[i + 1];
      mode = "search";
      i++;
    } else if (a === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10) || 5;
      i++;
    } else if (a === "--no-download-video") {
      downloadVideo = false;
    } else if (a === "--download-video") {
      downloadVideo = true;
    } else if (a === "--out" && args[i + 1]) {
      customOut = args[i + 1];
      i++;
    }
  }

  if (targetUrl) {
    mode = "video";
  }

  const outputRoot = resolveOutputDir(customOut);
  console.log(`🚀 启动抖音 (Douyin) 事实探针 | 模式: ${mode} | 输出根路径: ${outputRoot}`);

  // 3. 握手与连接 Leo Lantern
  const startRes = runLantern("start");
  if (!startRes.ok && !startRes.bridge) {
    console.error("❌ 无法连接到 Leo Lantern 服务，请确认 Chrome 扩展已开启。");
    process.exit(1);
  }

  // 查找现有或新开任务
  const tabsRes = runLantern("tabs");
  let claimedTabId = null;
  if (tabsRes.ok && Array.isArray(tabsRes.result)) {
    const dyTab = tabsRes.result.find(t => t.url && (t.url.includes("douyin.com") || t.url.includes("iesdouyin.com")));
    if (dyTab) claimedTabId = dyTab.id;
  }

  const taskRes = runLantern("start-task", ["--title", "douyin-source", "--same-window"]);
  if (!taskRes.ok) {
    console.error("❌ 创建 Lantern 任务失败:", taskRes.error);
    process.exit(1);
  }

  if (claimedTabId) {
    runLantern("claim", ["--tabId", String(claimedTabId)]);
  }

  let finalVideos = [];
  let boardInfo = {};

  try {
    if (mode === "video") {
      console.log(`🌐 正在打开抖音视频/作品详情页: ${targetUrl}`);
      runLantern("goto", [targetUrl]);

      const vidData = await waitForVideoDetail(12000);
      if (!vidData || (!vidData.videoUrl && !vidData.desc)) {
        console.error("❌ 提取视频详情事实失败: 未识别到视频内容");
        process.exit(1);
      }
      finalVideos.push(vidData);
      boardInfo.title = vidData.title;
      boardInfo.mode = "video";
    } else if (mode === "search") {
      if (!query) {
        console.error("❌ 搜索模式必须指定 --query <关键词>");
        process.exit(1);
      }
      const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(query)}`;
      console.log(`🔍 正在检索关键词 "${query}" -> ${searchUrl}`);
      runLantern("goto", [searchUrl]);
      await sleep(4500);

      const searchListRes = runLanternEval(EXTRACT_SEARCH_CARDS_SCRIPT);
      if (!searchListRes.ok || !searchListRes.evalResult || !Array.isArray(searchListRes.evalResult.cards)) {
        console.error("❌ 提取搜索卡片列表失败:", searchListRes.error);
        process.exit(1);
      }

      boardInfo.title = `抖音搜索 "${query}"`;
      boardInfo.query = query;
      boardInfo.mode = "search";

      const targetCards = searchListRes.evalResult.cards.slice(0, limit);
      console.log(`📊 抓取到 ${targetCards.length} 个搜索结果卡片，准备逐个采集高清原画与事实...`);

      for (let i = 0; i < targetCards.length; i++) {
        const item = targetCards[i];
        console.log(`  [${i + 1}/${targetCards.length}] 正在点击采集作品: ${item.desc.slice(0, 30)} (@${item.author})`);
        
        // 点击该卡片打开弹窗
        runLanternEval(`
          (() => {
            const cards = document.querySelectorAll('.search-result-card');
            if (cards[${i}]) {
              const imgArea = cards[${i}].querySelector('.videoImage') || cards[${i}];
              imgArea.click();
              return true;
            }
            return false;
          })()
        `);

        const cardDetail = await waitForVideoDetail(8000);
        if (cardDetail) {
          if (!cardDetail.desc && item.desc) cardDetail.desc = item.desc;
          if (!cardDetail.author.name && item.author) cardDetail.author.name = item.author;
          if (!cardDetail.coverUrl && item.coverImg) cardDetail.coverUrl = item.coverImg;
          finalVideos.push(cardDetail);
        }

        // 按 ESC 或点击遮罩关闭弹窗准备下一个
        runLantern("press", ["Escape"]);
        await sleep(1000);
      }
    } else {
      // 默认热榜模式
      const hotUrl = "https://www.douyin.com/hot";
      console.log(`🔥 正在检索抖音官方实时热榜 (Douyin Hot Search) -> ${hotUrl}`);
      runLantern("goto", [hotUrl]);
      await sleep(4000);

      const hotListRes = runLanternEval(EXTRACT_HOT_BOARD_SCRIPT);
      if (!hotListRes.ok || !hotListRes.evalResult || !Array.isArray(hotListRes.evalResult.items)) {
        console.error("❌ 提取热榜数据失败:", hotListRes.error);
        process.exit(1);
      }

      boardInfo.title = "抖音官方实时热榜 (Top Trending)";
      boardInfo.mode = "hot";
      boardInfo.hotList = hotListRes.evalResult.items;

      const targetItems = hotListRes.evalResult.items.slice(0, limit);
      console.log(`📊 抓取到 ${hotListRes.evalResult.items.length} 个上榜热点，准备深入采集前 ${targetItems.length} 个热榜原视频...`);

      for (let i = 0; i < targetItems.length; i++) {
        const item = targetItems[i];
        console.log(`  [${i + 1}/${targetItems.length}] 正在深度探测热榜 #${item.rank}: ${item.title} (${item.heat})`);
        
        if (item.url) {
          runLantern("goto", [item.url]);
          const topicVidRes = await waitForVideoDetail(10000);
          if (topicVidRes) {
            topicVidRes.hotRank = item.rank;
            topicVidRes.hotTitle = item.title;
            topicVidRes.hotHeat = item.heat;
            finalVideos.push(topicVidRes);
          }
        }
      }
    }
  } finally {
    // 结束 Lantern 任务
    runLantern("end-task");
  }

  if (finalVideos.length === 0) {
    console.warn("⚠️ 未提取到任何有效视频事实。");
    process.exit(1);
  }

  // 4. 落盘目录初始化
  const dateStr = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const safeIdentifier = (mode === "video" ? (finalVideos[0]?.awemeId || "item") : (mode === "search" ? query : "trending"))
    .replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  const targetDirName = `${dateStr}_${mode}_${safeIdentifier}`;
  const saveDir = path.join(outputRoot, targetDirName);
  const mediaDir = path.join(saveDir, "media");

  await fs.mkdir(mediaDir, { recursive: true });
  console.log(`📂 创建存证目录: ${saveDir}`);

  // 5. 媒体资产全量本地化
  console.log(`📥 正在下载媒体资产（视频、封面与头像）...`);
  let downloadedMediaCount = 0;

  for (let i = 0; i < finalVideos.length; i++) {
    const vid = finalVideos[i];
    const prefix = String(i + 1).padStart(2, "0");
    const safeVidName = (vid.awemeId || `video_${i + 1}`).slice(0, 20);

    vid.localMedia = {};

    // (1) 下载视频 MP4
    if (downloadVideo && vid.videoUrl && vid.videoUrl.startsWith("http")) {
      const vidFileName = `${prefix}_${safeVidName}.mp4`;
      const vidPath = path.join(mediaDir, vidFileName);
      console.log(`  [${i + 1}/${finalVideos.length}] 正在下载原画视频: ${vidFileName}...`);
      const ok = await downloadMediaFile(vid.videoUrl, vidPath);
      if (ok) {
        vid.localMedia.video = path.relative(saveDir, vidPath).replace(/\\/g, "/");
        downloadedMediaCount++;
      }
    }

    // (2) 下载封面
    if (vid.coverUrl && vid.coverUrl.startsWith("http")) {
      const coverFileName = `${prefix}_${safeVidName}_cover.jpg`;
      const coverPath = path.join(mediaDir, coverFileName);
      const ok = await downloadMediaFile(vid.coverUrl, coverPath);
      if (ok) {
        vid.localMedia.cover = path.relative(saveDir, coverPath).replace(/\\/g, "/");
        downloadedMediaCount++;
      }
    }

    // (3) 下载作者头像
    if (vid.author?.avatar && vid.author.avatar.startsWith("http")) {
      const avatarFileName = `${prefix}_${safeVidName}_avatar.jpg`;
      const avatarPath = path.join(mediaDir, avatarFileName);
      const ok = await downloadMediaFile(vid.author.avatar, avatarPath);
      if (ok) {
        vid.localMedia.avatar = path.relative(saveDir, avatarPath).replace(/\\/g, "/");
        downloadedMediaCount++;
      }
    }

    // (4) 下载背景音乐
    if (vid.audioUrl && vid.audioUrl.startsWith("http")) {
      const audioFileName = `${prefix}_${safeVidName}_bgm.mp3`;
      const audioPath = path.join(mediaDir, audioFileName);
      const ok = await downloadMediaFile(vid.audioUrl, audioPath);
      if (ok) {
        vid.localMedia.audio = path.relative(saveDir, audioPath).replace(/\\/g, "/");
        downloadedMediaCount++;
      }
    }
  }

  // 6. 构造元数据并生成双规报告 (JSON + MD)
  const fullPayload = {
    metadata: {
      platform: "douyin",
      mode,
      query: query || null,
      targetUrl: targetUrl || null,
      title: boardInfo.title,
      fetched_at: new Date().toISOString(),
      video_count: finalVideos.length,
      downloaded_media_count: downloadedMediaCount,
      hotList: boardInfo.hotList || null
    },
    videos: finalVideos
  };

  // 写入 帖子事实.json
  const jsonPath = path.join(saveDir, "帖子事实.json");
  await fs.writeFile(jsonPath, JSON.stringify(fullPayload, null, 2), "utf8");

  // 生成 帖子事实.md
  let md = `# 抖音 (Douyin) 热门短视频与热榜事实存证\n\n`;
  md += `> **抓取时间**：${fullPayload.metadata.fetched_at}  \n`;
  md += `> **检索模式**：${mode} ${query ? `(关键词: ${query})` : ""}  \n`;
  md += `> **作品总数**：${finalVideos.length} 个  \n`;
  md += `> **本地媒体总数**：${downloadedMediaCount} 个 (含原画视频 MP4、高清封面图与原声音频)  \n`;
  md += `> **适用场景**：抖音爆款解构、热点监控、爆款文案拆解、中继同步与短视频二创  \n\n`;

  if (boardInfo.hotList && boardInfo.hotList.length > 0) {
    md += `## 🔥 抖音实时热榜榜单概览 (Top 10)\n\n`;
    md += `| 排名 | 热点话题名称 | 实时热度值 | 详情链接 |\n`;
    md += `| :---: | :--- | :--- | :--- |\n`;
    boardInfo.hotList.slice(0, 10).forEach(h => {
      md += `| **#${h.rank}** | [${h.title}](${h.url || '#'}) | 🔥 **${h.heat}** | [查看原帖](${h.url || '#'}) |\n`;
    });
    md += `\n---\n\n`;
  }

  finalVideos.forEach((v, idx) => {
    const num = String(idx + 1).padStart(2, "0");
    const rankTitle = v.hotRank ? ` · 热榜 #${v.hotRank} (${v.hotHeat})` : "";
    md += `## 作品 ${num}：[${v.title || '抖音短视频'}](${v.url || '#'}) ${rankTitle}\n\n`;
    
    md += `- **作者**：**${v.author?.name || '未知创作者'}** [主页链接](${v.author?.url || '#'})  \n`;
    if (v.publishTime) md += `- **发布时间**：${v.publishTime}  \n`;
    md += `- **社区互动**：👍 **${v.stats?.digg || '0'}** 点赞 ｜ 💬 **${v.stats?.comment || '0'}** 评论 ｜ ⭐ **${v.stats?.collect || '0'}** 收藏 ｜ 🔄 **${v.stats?.share || '0'}** 分享  \n`;
    if (v.musicTitle) md += `- **BGM 背景音乐**：🎵 ${v.musicTitle}  \n`;
    if (v.hashtags && v.hashtags.length > 0) md += `- **话题标签**：${v.hashtags.map(t => '`' + t + '`').join(" ")}  \n`;
    md += `- **作品直达链接**：${v.url}  \n\n`;

    md += `### 📝 作品原始文案与描述\n\n`;
    md += `\`\`\`text\n${v.desc || '(暂无文案描述)'}\n\`\`\`\n\n`;

    md += `### 🎬 本地媒体资产清单\n\n`;
    if (v.localMedia.video) md += `- 📹 **原画视频**：[\`${path.basename(v.localMedia.video)}\`](./${v.localMedia.video})  \n`;
    if (v.localMedia.cover) md += `- 🖼️ **高清封面**：[\`${path.basename(v.localMedia.cover)}\`](./${v.localMedia.cover})  \n`;
    if (v.localMedia.avatar) md += `- 👤 **作者头像**：[\`${path.basename(v.localMedia.avatar)}\`](./${v.localMedia.avatar})  \n`;
    if (v.localMedia.audio) md += `- 🎵 **原声音频**：[\`${path.basename(v.localMedia.audio)}\`](./${v.localMedia.audio})  \n`;
    md += `\n`;

    if (v.localMedia.cover) {
      md += `![封面](./${v.localMedia.cover})\n\n`;
    }

    if (v.comments && v.comments.length > 0) {
      md += `### 💬 精选热评与高赞神评 (${v.comments.length} 条)\n\n`;
      v.comments.forEach((c, cIdx) => {
        md += `> **${c.author}** ${c.meta ? `(${c.meta})` : ""} ${c.likes ? `· 👍 ${c.likes}` : ""}\n`;
        md += `> ${c.content}\n>\n`;
      });
      md += `\n`;
    }

    md += `---\n\n`;
  });

  const mdPath = path.join(saveDir, "帖子事实.md");
  await fs.writeFile(mdPath, md, "utf8");

  console.log(`\n🎉 抖音事实探测已完成！`);
  console.log(`📄 结构化事实元数据: ${jsonPath}`);
  console.log(`📑 事实存证报告: ${mdPath}`);
  console.log(`📂 素材文件目录: ${mediaDir} (共 ${downloadedMediaCount} 个素材文件)`);
}

main().catch(err => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
