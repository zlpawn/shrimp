#!/usr/bin/env node

/**
 * 哔哩哔哩 (Bilibili) 热门视频、全站排行榜与高赞神评事实探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：原视频标题、BV号/AID、UP主（昵称/UID/主页）、分区标签、播放/弹幕/点赞/投币/收藏/分享互动量、原简介、神评原样落盘。
 * 2. 媒体资产全量本地化：原画/1080P 高清视频（.mp4）、高清封面大图（.jpg）、UP主头像与字幕文件完整保存在 media/ 目录。
 * 3. 动态配置输出路径：无硬编码目录，优先级为 CLI --out > 记忆配置 (~/.shrimp/...) > 动态默认 (D:\素材\B站)。
 * 4. 聚焦事实存证：沉淀一手视频客观事实与结构化元数据，二次创作由下游 Router（leo-video-router / leo-xhs-router）接力。
 */

import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync, execSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, "../scripts/cli/index.mjs");

// ==================== 路径与配置解析 (零写死) ====================

function getConfigPath() {
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "bilibili-source-config.json");
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
  if (process.env.LEO_LANTERN_BILIBILI_OUT) {
    return path.resolve(process.env.LEO_LANTERN_BILIBILI_OUT);
  }
  const defaultDir = "D:\\素材\\B站";
  if (process.platform === "win32" && syncFs.existsSync("D:\\")) {
    return path.resolve(defaultDir);
  }
  return path.resolve(process.cwd(), "output", "bilibili-source");
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
  const tmpFile = path.join(os.tmpdir(), `bili_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
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

function detectTool(toolName) {
  try {
    const whichCmd = process.platform === "win32" ? `where ${toolName}` : `which ${toolName}`;
    const output = execSync(whichCmd, { encoding: "utf8", windowsHide: true }).trim();
    if (output) return toolName;
  } catch {}

  if (process.platform === "win32") {
    const localExe = path.join(os.homedir(), ".local", "bin", `${toolName}.exe`);
    if (syncFs.existsSync(localExe)) return localExe;
  }
  return null;
}

async function exportCookiesIfNeeded() {
  const tmpCookieFile = path.join(os.tmpdir(), `bili_cookie_${Date.now()}.txt`);
  const res = runLantern("cookies", ["--domain=bilibili.com", "--format=txt", `--out=${tmpCookieFile}`]);
  if (res.ok && res.savedTo && syncFs.existsSync(res.savedTo)) {
    return res.savedTo;
  }
  return null;
}

function downloadBilibiliVideo({ videoUrl, destDir, baseName, cookieFile }) {
  const ytDlpBin = detectTool("yt-dlp");
  if (!ytDlpBin) return false;

  const args = [
    "--no-warnings",
    "--no-progress",
    "--ignore-errors",
    "-f", "bv*[height<=1080]+ba/b",
    "--merge-output-format", "mp4",
    "-P", destDir,
    "-o", `${baseName}.%(ext)s`
  ];

  if (cookieFile && syncFs.existsSync(cookieFile)) {
    args.push("--cookies", cookieFile);
  }
  args.push(videoUrl);

  try {
    const res = spawnSync(ytDlpBin, args, { stdio: "ignore", windowsHide: true });
    return res.status === 0;
  } catch {
    return false;
  }
}

async function downloadMediaFile(url, destPath) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": "https://www.bilibili.com/"
      }
    });
    if (!res.ok) {
      return false;
    }
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const fileStream = createWriteStream(destPath);
    await pipeline(res.body, fileStream);
    const stats = await fs.stat(destPath);
    return stats.size > 0;
  } catch (err) {
    return false;
  }
}

// ==================== DOM 提取脚本 (浏览器沙箱执行) ====================

const EXTRACT_VIDEO_DETAIL_SCRIPT = `
(async () => {
  const state = window.__INITIAL_STATE__;
  const vd = state?.videoData || {};

  const bvid = vd.bvid || (window.location.href.match(/BV[a-zA-Z0-9]+/) || [''])[0];
  const aid = vd.aid || '';
  const cid = vd.cid || '';
  const title = vd.title || document.querySelector('h1.video-title, [class*="video-title"]')?.innerText?.trim() || document.title;
  
  // 描述 (优先从 videoData，若空则尝试 DOM)
  let desc = vd.desc || '';
  if (!desc) {
    const descEl = document.querySelector('.basic-desc-info, .desc-info-text, #v_desc, [class*="desc-info"]');
    desc = descEl ? descEl.innerText.trim() : '';
  }
  const dynamic = vd.dynamic || '';

  // UP主信息
  const owner = vd.owner || {};
  let upName = owner.name || document.querySelector('.up-name, [class*="up-name"]')?.innerText?.trim() || '';
  let upMid = owner.mid || '';
  let upFace = owner.face || document.querySelector('.up-avatar img, [class*="up-avatar"] img')?.src || '';
  let upSpace = upMid ? \`https://space.bilibili.com/\${upMid}\` : '';

  // 发布时间与时长
  let pubdate = '';
  if (vd.pubdate) {
    pubdate = new Date(vd.pubdate * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }
  let duration = vd.duration || 0;
  let durationFormatted = '';
  if (duration > 0) {
    const m = Math.floor(duration / 60);
    const s = duration % 60;
    durationFormatted = \`\${String(m).padStart(2, '0')}:\${String(s).padStart(2, '0')}\`;
  }

  // 封面与分类
  let pic = vd.pic || '';
  if (pic.startsWith('//')) pic = 'https:' + pic;
  if (pic.startsWith('http://')) pic = pic.replace('http://', 'https://');
  const tname = vd.tname || '';

  // 互动数据
  const stat = vd.stat || {};
  const stats = {
    view: stat.view || document.querySelector('.view-text, [class*="view-text"]')?.innerText?.trim() || '0',
    danmaku: stat.danmaku || document.querySelector('.dm-text, [class*="dm-text"]')?.innerText?.trim() || '0',
    reply: stat.reply || '0',
    like: stat.like || document.querySelector('.video-like-info, [class*="like-info"]')?.innerText?.trim() || '0',
    coin: stat.coin || document.querySelector('.video-coin-info, [class*="coin-info"]')?.innerText?.trim() || '0',
    favorite: stat.favorite || document.querySelector('.video-fav-info, [class*="fav-info"]')?.innerText?.trim() || '0',
    share: stat.share || document.querySelector('.video-share-info, [class*="share-info"]')?.innerText?.trim() || '0'
  };

  // 标签
  const tags = state?.tags ? state.tags.map(t => t.tag_name) : [];

  // 获取热门精选评论
  const comments = [];
  if (aid) {
    try {
      const res = await fetch(\`https://api.bilibili.com/x/v2/reply/main?oid=\${aid}&type=1&mode=3\`, {
        credentials: 'include'
      });
      const data = await res.json();
      const replies = data?.data?.replies || [];
      for (const r of replies.slice(0, 15)) {
        comments.push({
          author: r.member?.uname || '',
          avatar: r.member?.avatar || '',
          content: r.content?.message || '',
          likes: r.like || 0,
          location: r.reply_control?.location || '',
          time: new Date(r.ctime * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        });
      }
    } catch {}
  }

  // 分P列表
  const pages = vd.pages ? vd.pages.map(p => ({
    page: p.page,
    part: p.part,
    duration: p.duration
  })) : [];

  return {
    bvid,
    aid,
    cid,
    url: \`https://www.bilibili.com/video/\${bvid}\`,
    title,
    desc,
    dynamic,
    pubdate,
    duration: durationFormatted,
    tname,
    coverUrl: pic,
    tags,
    author: {
      name: upName,
      mid: upMid,
      avatar: upFace,
      url: upSpace
    },
    stats,
    pages,
    comments
  };
})()
`;

const EXTRACT_RANKING_LIST_SCRIPT = `
(() => {
  const cards = [];
  const cardElements = document.querySelectorAll('.rank-item, .rank-wrap, .popular-video-card, .video-card');
  for (let idx = 0; idx < cardElements.length; idx++) {
    const el = cardElements[idx];
    const a = el.querySelector('a[href*="/video/BV"]') || el.querySelector('a[href*="/video/av"]');
    const titleEl = el.querySelector('.title, .video-name, [class*="title"]');
    const authorEl = el.querySelector('.up-name, .author, [class*="up-name"]');
    const statEl = el.querySelector('.pts, .video-stat, [class*="stat"]');
    const img = el.querySelector('img');

    if (a && titleEl) {
      let href = a.href;
      if (href.startsWith('//')) href = 'https:' + href;
      cards.push({
        rank: idx + 1,
        title: (titleEl.innerText || titleEl.textContent || '').trim().replace(/\\s+/g, ' '),
        url: href,
        author: (authorEl?.innerText || authorEl?.textContent || '').trim(),
        stat: (statEl?.innerText || statEl?.textContent || '').trim().replace(/\\s+/g, ' '),
        cover: img ? (img.src || img.getAttribute('data-src') || '') : ''
      });
    }
  }

  return {
    title: document.title,
    count: cards.length,
    cards
  };
})()
`;

const EXTRACT_SEARCH_LIST_SCRIPT = `
(() => {
  const cards = [];
  document.querySelectorAll('.bili-video-card').forEach((el, idx) => {
    const a = el.querySelector('a[href*="/video/BV"]') || el.querySelector('a[href*="/video/av"]');
    const titleEl = el.querySelector('.bili-video-card__info--tit, [class*="title"], h3');
    const authorEl = el.querySelector('.bili-video-card__info--author, [class*="up-name"], [class*="author"]');
    const img = el.querySelector('img');

    const titleText = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim().replace(/\\s+/g, ' ') : '';
    const authorText = authorEl ? (authorEl.innerText || authorEl.textContent || '').trim() : '';

    if (a && titleText && titleText !== '反馈成功') {
      let href = a.href;
      if (href.startsWith('//')) href = 'https:' + href;
      cards.push({
        index: idx + 1,
        title: titleText,
        url: href,
        author: authorText,
        cover: img ? (img.src || img.getAttribute('data-src') || '') : ''
      });
    }
  });

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
  let mode = "ranking"; // ranking | popular | search | video
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
  console.log(`🚀 启动哔哩哔哩 (Bilibili) 事实探针 | 模式: ${mode} | 输出根路径: ${outputRoot}`);

  // 3. 握手与连接 Leo Lantern
  const startRes = runLantern("start");
  if (!startRes.ok && !startRes.bridge) {
    console.error("❌ 无法连接到 Leo Lantern 服务，请确认 Chrome 扩展已开启。");
    process.exit(1);
  }

  // 寻找现有的 bilibili tab
  const tabsRes = runLantern("tabs");
  let claimedTabId = null;
  if (tabsRes.ok && Array.isArray(tabsRes.result)) {
    const biliTab = tabsRes.result.find(t => t.url && t.url.includes("bilibili.com"));
    if (biliTab) claimedTabId = biliTab.id;
  }

  const taskRes = runLantern("start-task", ["--title", "bilibili-source", "--same-window"]);
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
      console.log(`🌐 正在打开 B站 视频详情页: ${targetUrl}`);
      runLantern("goto", [targetUrl]);
      await sleep(3500);

      const vidRes = runLanternEval(EXTRACT_VIDEO_DETAIL_SCRIPT);
      if (!vidRes.ok || !vidRes.evalResult || !vidRes.evalResult.title) {
        console.error("❌ 提取视频事实失败:", vidRes.error || "未识别到视频内容");
        process.exit(1);
      }
      finalVideos.push(vidRes.evalResult);
      boardInfo.title = vidRes.evalResult.title;
      boardInfo.mode = "video";
    } else if (mode === "search") {
      if (!query) {
        console.error("❌ 搜索模式必须指定 --query <关键词>");
        process.exit(1);
      }
      const searchUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`;
      console.log(`🔍 正在检索关键词 "${query}" -> ${searchUrl}`);
      runLantern("goto", [searchUrl]);
      await sleep(4000);

      const searchListRes = runLanternEval(EXTRACT_SEARCH_LIST_SCRIPT);
      if (!searchListRes.ok || !searchListRes.evalResult || !Array.isArray(searchListRes.evalResult.cards)) {
        console.error("❌ 提取搜索卡片列表失败:", searchListRes.error);
        process.exit(1);
      }

      boardInfo.title = `B站搜索 "${query}"`;
      boardInfo.query = query;
      boardInfo.mode = "search";

      const targetCards = searchListRes.evalResult.cards.slice(0, limit);
      console.log(`📊 抓取到 ${targetCards.length} 个搜索结果视频，准备逐个采集高清原画与事实...`);

      for (let i = 0; i < targetCards.length; i++) {
        const item = targetCards[i];
        console.log(`  [${i + 1}/${targetCards.length}] 正在深度探测: ${item.title.slice(0, 30)} (@${item.author})`);
        runLantern("goto", [item.url]);
        await sleep(3000);

        const cardDetail = runLanternEval(EXTRACT_VIDEO_DETAIL_SCRIPT);
        if (cardDetail.ok && cardDetail.evalResult) {
          finalVideos.push(cardDetail.evalResult);
        }
      }
    } else {
      // 默认排行榜/热门模式
      const rankUrl = mode === "popular" ? "https://www.bilibili.com/v/popular/all" : "https://www.bilibili.com/v/popular/rank/all";
      console.log(`🔥 正在检索 B站官方榜单 (${mode === "popular" ? "综合热门" : "全站排行榜"}) -> ${rankUrl}`);
      runLantern("goto", [rankUrl]);
      await sleep(4000);

      const listRes = runLanternEval(EXTRACT_RANKING_LIST_SCRIPT);
      if (!listRes.ok || !listRes.evalResult || !Array.isArray(listRes.evalResult.cards)) {
        console.error("❌ 提取榜单数据失败:", listRes.error);
        process.exit(1);
      }

      boardInfo.title = mode === "popular" ? "哔哩哔哩综合热门" : "哔哩哔哩全站排行榜";
      boardInfo.mode = mode;
      boardInfo.rankList = listRes.evalResult.cards;

      const targetItems = listRes.evalResult.cards.slice(0, limit);
      console.log(`📊 抓取到 ${listRes.evalResult.cards.length} 个上榜视频，准备深入采集前 ${targetItems.length} 个原视频事实...`);

      for (let i = 0; i < targetItems.length; i++) {
        const item = targetItems[i];
        console.log(`  [${i + 1}/${targetItems.length}] 正在深度探测榜单 #${item.rank}: ${item.title.slice(0, 30)} (@${item.author})`);
        runLantern("goto", [item.url]);
        await sleep(3000);

        const topicVidRes = runLanternEval(EXTRACT_VIDEO_DETAIL_SCRIPT);
        if (topicVidRes.ok && topicVidRes.evalResult) {
          const resObj = topicVidRes.evalResult;
          resObj.rankNum = item.rank;
          resObj.rankStat = item.stat;
          finalVideos.push(resObj);
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
  const safeIdentifier = (mode === "video" ? (finalVideos[0]?.bvid || "item") : (mode === "search" ? query : mode))
    .replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  const targetDirName = `${dateStr}_${mode}_${safeIdentifier}`;
  const saveDir = path.join(outputRoot, targetDirName);
  const mediaDir = path.join(saveDir, "media");

  await fs.mkdir(mediaDir, { recursive: true });
  console.log(`📂 创建存证目录: ${saveDir}`);

  // 5. 导出 Cookie 并下载多媒体资产
  let cookieFile = null;
  if (downloadVideo) {
    cookieFile = await exportCookiesIfNeeded();
  }

  console.log(`📥 正在下载媒体资产（封面、头像与原画视频）...`);
  let downloadedMediaCount = 0;

  for (let i = 0; i < finalVideos.length; i++) {
    const vid = finalVideos[i];
    const prefix = String(i + 1).padStart(2, "0");
    const safeVidName = (vid.bvid || `video_${i + 1}`);

    vid.localMedia = {};

    // (1) 下载封面
    if (vid.coverUrl && vid.coverUrl.startsWith("http")) {
      const coverFileName = `${prefix}_${safeVidName}_cover.jpg`;
      const coverPath = path.join(mediaDir, coverFileName);
      const ok = await downloadMediaFile(vid.coverUrl, coverPath);
      if (ok) {
        vid.localMedia.cover = path.relative(saveDir, coverPath).replace(/\\/g, "/");
        downloadedMediaCount++;
      }
    }

    // (2) 下载 UP 主头像
    if (vid.author?.avatar && vid.author.avatar.startsWith("http")) {
      const avatarFileName = `${prefix}_${safeVidName}_avatar.jpg`;
      const avatarPath = path.join(mediaDir, avatarFileName);
      const ok = await downloadMediaFile(vid.author.avatar, avatarPath);
      if (ok) {
        vid.localMedia.avatar = path.relative(saveDir, avatarPath).replace(/\\/g, "/");
        downloadedMediaCount++;
      }
    }

    // (3) 下载原画视频 MP4 (通过 yt-dlp + cookie 闭环)
    if (downloadVideo && vid.url) {
      console.log(`  [${i + 1}/${finalVideos.length}] 正在下载高清视频: ${safeVidName}.mp4...`);
      const baseName = `${prefix}_${safeVidName}`;
      const ok = downloadBilibiliVideo({
        videoUrl: vid.url,
        destDir: mediaDir,
        baseName,
        cookieFile
      });
      if (ok) {
        const expectedFile = `${baseName}.mp4`;
        const expectedPath = path.join(mediaDir, expectedFile);
        if (syncFs.existsSync(expectedPath)) {
          vid.localMedia.video = path.relative(saveDir, expectedPath).replace(/\\/g, "/");
          downloadedMediaCount++;
        }
      }
    }
  }

  // 6. 构造元数据并生成双规报告 (JSON + MD)
  const fullPayload = {
    metadata: {
      platform: "bilibili",
      mode,
      query: query || null,
      targetUrl: targetUrl || null,
      title: boardInfo.title,
      fetched_at: new Date().toISOString(),
      video_count: finalVideos.length,
      downloaded_media_count: downloadedMediaCount,
      rankList: boardInfo.rankList || null
    },
    videos: finalVideos
  };

  // 写入 帖子事实.json
  const jsonPath = path.join(saveDir, "帖子事实.json");
  await fs.writeFile(jsonPath, JSON.stringify(fullPayload, null, 2), "utf8");

  // 生成 帖子事实.md
  let md = `# 哔哩哔哩 (Bilibili) 视频与榜单事实存证\n\n`;
  md += `> **抓取时间**：${fullPayload.metadata.fetched_at}  \n`;
  md += `> **检索模式**：${mode} ${query ? `(关键词: ${query})` : ""}  \n`;
  md += `> **作品总数**：${finalVideos.length} 个  \n`;
  md += `> **本地媒体总数**：${downloadedMediaCount} 个 (含高清视频 MP4、原画封面图与UP主头像)  \n`;
  md += `> **适用场景**：中长视频知识库归档、B站热点监控、爆款选题拆解、AI 视频解构与二创  \n\n`;

  if (boardInfo.rankList && boardInfo.rankList.length > 0) {
    md += `## 🔥 B站榜单概览 (Top 10)\n\n`;
    md += `| 排名 | 视频标题 | UP主 | 热度/播放数据 | 详情直达 |\n`;
    md += `| :---: | :--- | :--- | :--- | :--- |\n`;
    boardInfo.rankList.slice(0, 10).forEach(h => {
      md += `| **#${h.rank}** | [${h.title}](${h.url || '#'}) | ${h.author} | ${h.stat || '-'} | [查看原帖](${h.url || '#'}) |\n`;
    });
    md += `\n---\n\n`;
  }

  finalVideos.forEach((v, idx) => {
    const num = String(idx + 1).padStart(2, "0");
    const rankTitle = v.rankNum ? ` · 榜单 #${v.rankNum} (${v.rankStat || ''})` : "";
    md += `## 作品 ${num}：[${v.title || 'B站视频'}](${v.url || '#'}) ${rankTitle}\n\n`;
    
    md += `- **UP主**：**[${v.author?.name || '未知UP主'}](${v.author?.url || '#'})** (UID: \`${v.author?.mid || '-'}\`)  \n`;
    if (v.pubdate) md += `- **发布时间**：${v.pubdate}  \n`;
    if (v.duration) md += `- **视频时长**：⏱️ ${v.duration}  \n`;
    if (v.tname) md += `- **所属分区**：🏷️ \`${v.tname}\`  \n`;
    md += `- **核心互动数据**：👁️ **${v.stats?.view || '0'}** 播放 ｜ 💬 **${v.stats?.danmaku || '0'}** 弹幕 ｜ 👍 **${v.stats?.like || '0'}** 点赞 ｜ 🪙 **${v.stats?.coin || '0'}** 投币 ｜ ⭐ **${v.stats?.favorite || '0'}** 收藏 ｜ 🔄 **${v.stats?.share || '0'}** 分享  \n`;
    if (v.tags && v.tags.length > 0) md += `- **视频标签**：${v.tags.map(t => '`' + t + '`').join(" ")}  \n`;
    md += `- **视频直达链接**：${v.url} (BV号: \`${v.bvid}\` / AID: \`${v.aid}\`)  \n\n`;

    if (v.desc) {
      md += `### 📝 视频原始简介与文案\n\n`;
      md += `\`\`\`text\n${v.desc}\n\`\`\`\n\n`;
    }

    if (v.dynamic) {
      md += `### 📢 UP主动态内容\n\n`;
      md += `> ${v.dynamic}\n\n`;
    }

    md += `### 🎬 本地媒体资产清单\n\n`;
    if (v.localMedia.video) md += `- 📹 **高清视频**：[\`${path.basename(v.localMedia.video)}\`](./${v.localMedia.video})  \n`;
    if (v.localMedia.cover) md += `- 🖼️ **原画封面**：[\`${path.basename(v.localMedia.cover)}\`](./${v.localMedia.cover})  \n`;
    if (v.localMedia.avatar) md += `- 👤 **UP主头像**：[\`${path.basename(v.localMedia.avatar)}\`](./${v.localMedia.avatar})  \n`;
    md += `\n`;

    if (v.localMedia.cover) {
      md += `![封面](./${v.localMedia.cover})\n\n`;
    }

    if (v.comments && v.comments.length > 0) {
      md += `### 💬 精选热评与高赞神评 (${v.comments.length} 条)\n\n`;
      v.comments.forEach((c) => {
        md += `> **${c.author}** ${c.location ? `(${c.location})` : ""} · 👍 ${c.likes} (${c.time})\n`;
        md += `> ${c.content}\n>\n`;
      });
      md += `\n`;
    }

    md += `---\n\n`;
  });

  const mdPath = path.join(saveDir, "帖子事实.md");
  await fs.writeFile(mdPath, md, "utf8");

  console.log(`\n🎉 哔哩哔哩事实探测已完成！`);
  console.log(`📄 结构化事实元数据: ${jsonPath}`);
  console.log(`📑 事实存证报告: ${mdPath}`);
  console.log(`📂 素材文件目录: ${mediaDir} (共 ${downloadedMediaCount} 个素材文件)`);
}

main().catch(err => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
