#!/usr/bin/env node

/**
 * Pixabay 高清免版税视觉与音视频素材事实探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：作品标题、作者/创作者（主页、头像、粉丝数、社交链接）、作品分类（照片/插画/矢量图/视频）、
 *    商用授权（Pixabay Content License，无需署名可商用）、画质分辨率、长宽比/时长、相机参数（EXIF）、互动数据（浏览/下载/点赞/评论数）、标签（Tags）零失真落盘。
 * 2. 媒体资产全量本地化：超清原图（1280px / 2560px Zoom）、矢量透明图（PNG）、高码率视频切片（4K/HD MP4）完整下载至 media/ 目录。
 * 3. 动态配置输出路径：无硬编码目录，优先级为 CLI --out > 记忆配置 (~/.shrimp/skills/leo-lantern/pixabay-source-config.json) > 默认 (D:\素材\Pixabay)。
 * 4. 聚焦事实存证：本期专注高保真素材事实与原始文件沉淀，二创与混剪由下游 Router（leo-xhs-router / leo-video-router / space-xhs-cover）接力。
 */

import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync, execSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, "../scripts/cli/index.mjs");

// ==================== 路径与配置解析 (零写死) ====================

function getConfigPath() {
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "pixabay-source-config.json");
}

function loadConfig() {
  const cfgPath = getConfigPath();
  try {
    if (syncFs.existsSync(cfgPath)) {
      const raw = syncFs.readFileSync(cfgPath, "utf8").replace(/^\uFEFF/, "");
      return JSON.parse(raw);
    }
  } catch (err) {
    // 忽略读取错误
  }
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
  if (process.env.LEO_LANTERN_PIXABAY_OUT) {
    return path.resolve(process.env.LEO_LANTERN_PIXABAY_OUT);
  }
  const defaultDir = "D:\\素材\\Pixabay";
  if (process.platform === "win32" && syncFs.existsSync("D:\\")) {
    return path.resolve(defaultDir);
  }
  return path.resolve(process.cwd(), "output", "pixabay-source");
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
  const tmpFile = path.join(os.tmpdir(), `pixabay_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
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

// ==================== 工具与媒体下载 ====================

async function downloadMediaFile(url, destPath) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": "https://pixabay.com/"
      }
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }

    const fileStream = syncFs.createWriteStream(destPath);
    await pipeline(Readable.fromWeb(res.body), fileStream);
    const stat = await fs.stat(destPath);
    return { ok: true, size: stat.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ==================== 页面提取脚本 ====================

const EXTRACT_SEARCH_RESULTS_SCRIPT = `
(() => {
  const p = window.__BOOTSTRAP__?.page;
  if (!p || !Array.isArray(p.results)) {
    return { ok: false, total: 0, results: [] };
  }

  const items = p.results.map(r => {
    let bestUrl = '';
    const isVideo = r.mediaType === 'video' || r.mediaDescriptiveType === 'video' || Boolean(r.duration);
    let format = isVideo ? 'mp4' : 'jpg';

    if (isVideo) {
      bestUrl = r.sources?.mp4 || r.sources?.embed || '';
      if (r.canvaRetouchUrl) {
        const match = r.canvaRetouchUrl.match(/file-url=([^&]+)/);
        if (match) {
          try { bestUrl = decodeURIComponent(match[1]); } catch {}
        }
      }
    } else {
      bestUrl = r.sources?.['2x'] || r.sources?.['1x'] || '';
      if (r.vector && r.sources?.['2x'] && r.sources['2x'].endsWith('.png')) {
        format = 'png';
      }
    }

    const tags = Array.isArray(r.tagList) ? r.tagList.map(t => Array.isArray(t) ? t[0] : String(t)) : [];

    return {
      id: r.id,
      title: r.title || r.name || '',
      description: r.description || '',
      name: r.name || '',
      href: r.href ? (r.href.startsWith('http') ? r.href : 'https://pixabay.com' + r.href) : '',
      mediaType: r.mediaDescriptiveType || r.mediaType || (isVideo ? 'video' : 'photo'),
      isVideo,
      isAiGenerated: Boolean(r.isAiGenerated),
      isEditorsChoice: Boolean(r.isEditorsChoice),
      dimensions: {
        width: r.width || 0,
        height: r.height || 0,
        duration: r.duration || 0
      },
      metrics: {
        views: r.viewCount || 0,
        downloads: r.downloadCount || 0,
        likes: r.likeCount || 0,
        comments: r.commentCount || 0
      },
      author: {
        id: r.user?.id || 0,
        username: r.user?.username || '',
        url: r.user?.profileUrl ? (r.user.profileUrl.startsWith('http') ? r.user.profileUrl : 'https://pixabay.com' + r.user.profileUrl) : '',
        avatar: r.user?.avatarSrc ? (r.user.avatarSrc.startsWith('http') ? r.user.avatarSrc : 'https://pixabay.com' + r.user.avatarSrc) : ''
      },
      tags,
      uploadDate: r.uploadDate || '',
      bestMediaUrl: bestUrl,
      mediaFormat: format
    };
  });

  return {
    ok: true,
    total: p.total || items.length,
    page: p.page || 1,
    pages: p.pages || 1,
    results: items
  };
})()
`;

const EXTRACT_DETAIL_SCRIPT = `
(() => {
  const p = window.__BOOTSTRAP__?.page;
  const m = p?.mediaItem;
  
  const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => {
    try { return JSON.parse(s.innerText); } catch { return null; }
  }).find(obj => obj && (obj['@type'] === 'ImageObject' || obj['@type'] === 'VideoObject'));

  if (!m && !jsonLd) {
    return null;
  }

  const mediaType = m?.mediaDescriptiveType || m?.mediaType || (jsonLd?.['@type'] === 'VideoObject' ? 'video' : 'photo');
  const isVideo = mediaType === 'video' || Boolean(m?.duration) || jsonLd?.['@type'] === 'VideoObject';

  const title = m?.title || m?.name || jsonLd?.headline || jsonLd?.name || document.title.replace(/\\s*-\\s*Pixabay.*$/i, '').trim();
  const description = m?.description || jsonLd?.description || '';

  const authorName = m?.user?.username || jsonLd?.author?.name || '';
  const authorFullName = [m?.user?.firstName, m?.user?.lastName].filter(Boolean).join(' ') || '';
  const authorUrl = m?.user?.profileUrl ? (m.user.profileUrl.startsWith('http') ? m.user.profileUrl : 'https://pixabay.com' + m.user.profileUrl) : (jsonLd?.author?.url || '');
  const authorAvatar = m?.user?.avatarSrc ? (m.user.avatarSrc.startsWith('http') ? m.user.avatarSrc : 'https://pixabay.com' + m.user.avatarSrc) : (jsonLd?.author?.image || '');
  const authorBio = m?.user?.aboutMe || jsonLd?.author?.description || '';
  const authorFollowers = m?.user?.followerCount || (jsonLd?.author?.interactionStatistic?.userInteractionCount) || 0;
  const socialLinks = Array.isArray(m?.user?.socialLinks) ? m.user.socialLinks.map(s => s.url).filter(Boolean) : [];

  let tags = [];
  if (Array.isArray(m?.tags)) {
    tags = m.tags;
  } else if (jsonLd?.keywords) {
    tags = jsonLd.keywords.split(',').map(s => s.trim().toLowerCase());
  } else {
    tags = Array.from(document.querySelectorAll('a[href*="/images/search/"], a[href*="/photos/search/"]')).map(a => a.innerText.trim().toLowerCase()).filter(Boolean);
  }
  tags = Array.from(new Set(tags)).filter(t => t && !t.includes('\\n'));

  const views = m?.viewCount || (jsonLd?.interactionStatistic?.find(s => s.interactionType?.includes('ViewAction'))?.userInteractionCount) || 0;
  const downloads = m?.downloadCount || (jsonLd?.interactionStatistic?.find(s => s.interactionType?.includes('DownloadAction'))?.userInteractionCount) || 0;
  const likes = m?.likeCount || (jsonLd?.interactionStatistic?.find(s => s.interactionType?.includes('LikeAction'))?.userInteractionCount) || 0;
  const comments = m?.commentCount || jsonLd?.commentCount || 0;

  const width = m?.width || jsonLd?.width || 0;
  const height = m?.height || jsonLd?.height || 0;
  const duration = m?.duration || 0;
  const isAiGenerated = Boolean(m?.isAiGenerated);
  const isEditorsChoice = Boolean(m?.isEditorsChoice);

  const exif = {
    camera: m?.cameraName || '',
    lens: m?.lens || '',
    focalLength: m?.focalLength || '',
    aperture: m?.aperture || '',
    exposureTime: m?.exposureTime || '',
    iso: m?.iso || '',
    flash: m?.flash || ''
  };

  let bestMediaUrl = '';
  let mediaFormat = isVideo ? 'mp4' : 'jpg';

  if (isVideo) {
    bestMediaUrl = m?.sources?.mp4 || m?.sources?.mp4_tiny || '';
    if (m?.canvaRetouchUrl) {
      const match = m.canvaRetouchUrl.match(/file-url=([^&]+)/);
      if (match) {
        try { bestMediaUrl = decodeURIComponent(match[1]); } catch {}
      }
    }
  } else {
    bestMediaUrl = m?.sources?.zoom || m?.sources?.['2x'] || m?.sources?.['1x'] || jsonLd?.contentUrl || '';
    if (m?.vector && m?.sources?.['2x'] && m.sources['2x'].endsWith('.png')) {
      mediaFormat = 'png';
    } else if (bestMediaUrl.includes('.png')) {
      mediaFormat = 'png';
    }
  }

  const downloadSources = Array.isArray(m?.downloadSources) ? m.downloadSources.map(s => ({
    label: s.label || '',
    dimensions: s.dimensions || '',
    format: s.format || '',
    size: s.size || '',
    fileName: s.fileName || ''
  })) : [];

  return {
    id: m?.id || (window.location.href.match(/-(\\d+)\\/?$/) || [])[1] || '',
    title,
    description,
    url: window.location.href,
    mediaType,
    isVideo,
    isAiGenerated,
    isEditorsChoice,
    author: {
      username: authorName,
      fullName: authorFullName,
      url: authorUrl,
      avatar: authorAvatar,
      bio: authorBio,
      followers: authorFollowers,
      socialLinks
    },
    metrics: { views, downloads, likes, comments },
    dimensions: { width, height, duration },
    exif,
    license: {
      name: "Pixabay Content License",
      summary: "Free for commercial and non-commercial use across print and digital. Attribution is not required.",
      url: "https://pixabay.com/service/license-summary/"
    },
    publishedAt: m?.publishedDate || m?.uploadDate || jsonLd?.datePublished || '',
    tags,
    bestMediaUrl,
    mediaFormat,
    downloadSources
  };
})()
`;

// ==================== 主流程 ====================

async function main() {
  const args = process.argv.slice(2);

  // 参数解析
  let mode = "search"; // search | post (or item) | explore
  let query = "";
  let mediaType = "all"; // all | photos | illustrations | vectors | videos
  let targetUrl = "";
  let limit = 3;
  let cliOutDir = "";
  let skipMedia = false;
  let deepFetch = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--get-out") {
      const cfg = loadConfig();
      console.log(`当前持久化输出目录: ${cfg.output_dir || "未设置 (将使用 D:\\素材\\Pixabay 或当前工作区)"}`);
      process.exit(0);
    } else if (arg === "--set-out") {
      const p = args[++i];
      if (!p) {
        console.error("❌ 错误: --set-out 需要提供目录路径");
        process.exit(1);
      }
      const saved = saveConfig({ output_dir: path.resolve(p) });
      console.log(`✅ 已持久化配置默认输出目录: ${saved.output_dir}`);
      process.exit(0);
    } else if (arg === "--mode" || arg === "-m") {
      mode = args[++i];
    } else if (arg === "--query" || arg === "-q") {
      query = args[++i];
    } else if (arg === "--type" || arg === "-t") {
      mediaType = args[++i].toLowerCase();
    } else if (arg === "--url" || arg === "-u") {
      targetUrl = args[++i];
      mode = "post";
    } else if (arg === "--limit" || arg === "-n") {
      limit = parseInt(args[++i], 10) || 3;
    } else if (arg === "--out" || arg === "--out-dir" || arg === "-o") {
      cliOutDir = args[++i];
    } else if (arg === "--skip-media" || arg === "--no-media") {
      skipMedia = true;
    } else if (arg === "--no-deep") {
      deepFetch = false;
    } else if (!arg.startsWith("-") && !query && mode === "search") {
      query = arg;
    }
  }

  // 别名归一化
  if (mode === "item" || mode === "detail") mode = "post";
  if (mode === "trending" || mode === "popular") mode = "explore";

  if (mediaType === "photo") mediaType = "photos";
  if (mediaType === "illustration") mediaType = "illustrations";
  if (mediaType === "vector") mediaType = "vectors";
  if (mediaType === "video") mediaType = "videos";

  if (mode === "search" && !query) {
    query = "wallpaper"; // 默认搜索优质壁纸素材
  }

  // 1. 解析目标落盘目录
  const baseOutDir = resolveOutputDir(cliOutDir);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");

  let sessionSlug = "";
  if (mode === "post") {
    const idMatch = targetUrl.match(/-(\d+)\/?$/);
    sessionSlug = `item_${idMatch ? idMatch[1] : "post"}`;
  } else if (mode === "search") {
    sessionSlug = `search_${sanitizeFilename(query)}_${mediaType}`;
  } else {
    sessionSlug = `explore_${mediaType}`;
  }

  const sessionDir = path.join(baseOutDir, `${dateStr}_${timeStr}_${sessionSlug}`);
  const mediaDir = path.join(sessionDir, "media");

  await fs.mkdir(mediaDir, { recursive: true });
  console.log(`📂 本次素材落盘目录: ${sessionDir}`);

  // 2. 启动 Lantern 连接并关联 Chrome 标签页
  console.log("\n🔌 正在与 Chrome 浏览器建立 Lantern CDP 连接...");
  const startRes = runLantern("start");
  if (!startRes.ok && !startRes.bridge) {
    console.error("❌ 无法连接到 Leo Lantern 服务，请确认 Chrome 扩展已开启。");
    process.exit(1);
  }

  // 检查已有 Pixabay 标签页以直接复用
  const tabsRes = runLantern("tabs");
  let claimedTabId = null;
  if (tabsRes.ok && Array.isArray(tabsRes.result)) {
    const pixabayTab = tabsRes.result.find(t => t.url && t.url.includes("pixabay.com"));
    if (pixabayTab) claimedTabId = pixabayTab.id;
  }

  const taskRes = runLantern("start-task", ["--title", "pixabay-source", "--same-window"]);
  if (!taskRes.ok) {
    console.error("❌ 创建 Lantern 任务失败:", taskRes.error);
    process.exit(1);
  }

  if (claimedTabId) {
    runLantern("claim", ["--tabId", String(claimedTabId)]);
  }

  let finalItems = [];

  try {
    if (mode === "post") {
      if (!targetUrl) {
        console.error("❌ 单篇作品模式 (--mode post) 必须提供 --url 参数");
        process.exit(1);
      }
      console.log(`🌐 正在打开 Pixabay 详情页: ${targetUrl}`);
      runLantern("goto", [targetUrl]);
      await sleep(3500);

      const detailRes = runLanternEval(EXTRACT_DETAIL_SCRIPT);
      if (!detailRes.ok || !detailRes.evalResult) {
        console.error("❌ 提取作品事实详情失败:", detailRes.error || "未知解析错误");
        process.exit(1);
      }
      finalItems.push(detailRes.evalResult);
    } else {
      // 搜索或探索模式
      let navUrl = "";
      if (mode === "search") {
        const typePrefix = mediaType === "all" ? "images" : mediaType;
        navUrl = `https://pixabay.com/${typePrefix}/search/${encodeURIComponent(query)}/`;
        console.log(`🔍 正在检索关键词: "${query}" (类型: ${mediaType}) -> ${navUrl}`);
      } else {
        const typePrefix = mediaType === "all" ? "photos" : mediaType;
        navUrl = `https://pixabay.com/${typePrefix}/`;
        console.log(`✨ 正在浏览精选探索推荐 (类型: ${mediaType}) -> ${navUrl}`);
      }

      runLantern("goto", [navUrl]);
      await sleep(3500);

      const listRes = runLanternEval(EXTRACT_SEARCH_RESULTS_SCRIPT);
      if (!listRes.ok || !listRes.evalResult || !Array.isArray(listRes.evalResult.results)) {
        console.error("❌ 提取素材列表失败:", listRes.error || "未能获取有效结果");
        process.exit(1);
      }

      const totalFound = listRes.evalResult.total;
      const rawResults = listRes.evalResult.results;
      console.log(`📊 检索结果：全站共有 ${totalFound} 个匹配素材，本页提取 ${rawResults.length} 个`);

      const targetList = rawResults.slice(0, limit);

      // 如果启用 deepFetch 且列表不为空，逐个访问详情页获取精准 EXIF、作者生平和高码率文件
      if (deepFetch && targetList.length > 0) {
        console.log(`🔬 正在对前 ${targetList.length} 个素材进行深度事实探针抓取 (EXIF / 许可 / 4K源)...`);
        for (let idx = 0; idx < targetList.length; idx++) {
          const item = targetList[idx];
          if (!item.href) {
            finalItems.push(item);
            continue;
          }
          console.log(`  [${idx + 1}/${targetList.length}] 正在探针: ${item.title || item.name || item.id} (${item.href})`);
          runLantern("goto", [item.href]);
          await sleep(2500);

          const itemDetailRes = runLanternEval(EXTRACT_DETAIL_SCRIPT);
          if (itemDetailRes.ok && itemDetailRes.evalResult) {
            finalItems.push(itemDetailRes.evalResult);
          } else {
            console.warn(`  ⚠️ 深度提取失败，降级使用搜索元数据`);
            finalItems.push(item);
          }
        }
      } else {
        finalItems = targetList;
      }
    }
  } finally {
    runLantern("end-task");
  }

  if (finalItems.length === 0) {
    console.log("⚠️ 未能采集到有效素材，退出。");
    process.exit(0);
  }

  // 3. 媒体资产本地化下载
  console.log(`\n📦 开始本地化存储 ${finalItems.length} 个素材的高清源文件...`);
  let totalMediaFiles = 0;

  for (let idx = 0; idx < finalItems.length; idx++) {
    const item = finalItems[idx];
    item.index = idx + 1;
    item.media_files = [];

    if (skipMedia || !item.bestMediaUrl) {
      if (skipMedia) console.log(`⏩ [${idx + 1}/${finalItems.length}] 用户跳过媒体下载: ${item.title || item.id}`);
      continue;
    }

    const ext = item.mediaFormat || (item.isVideo ? "mp4" : "jpg");
    const authorSlug = sanitizeFilename(item.author?.username || "pixabay");
    const titleSlug = sanitizeFilename(item.title || item.name || "media").slice(0, 30);
    const fileName = `${String(idx + 1).padStart(2, "0")}_${authorSlug}_${item.id}_${titleSlug}.${ext}`;
    const destPath = path.join(mediaDir, fileName);

    console.log(`⬇️ [${idx + 1}/${finalItems.length}] 正在下载: ${fileName} (${item.mediaType})`);
    const dlRes = await downloadMediaFile(item.bestMediaUrl, destPath);

    if (dlRes.ok) {
      totalMediaFiles++;
      const relativePath = path.relative(sessionDir, destPath).replace(/\\/g, "/");
      item.media_files.push({
        file_name: fileName,
        file_path: destPath,
        relative_path: relativePath,
        size_bytes: dlRes.size,
        size_formatted: formatBytes(dlRes.size),
        format: ext.toUpperCase(),
        url: item.bestMediaUrl
      });
      console.log(`  ✅ 下载成功 (${formatBytes(dlRes.size)}) -> ${relativePath}`);
    } else {
      console.warn(`  ⚠️ 下载失败: ${dlRes.error}`);
    }
  }

  // 4. 落盘 帖子事实.json
  const groundTruthJson = {
    platform: "Pixabay",
    target: mode === "search" ? `Search: ${query}` : (mode === "post" ? targetUrl : `Explore: ${mediaType}`),
    mode,
    query: query || null,
    media_type: mediaType,
    fetched_at: new Date().toISOString(),
    session_dir: sessionDir,
    total_items: finalItems.length,
    total_media_files: totalMediaFiles,
    license_standard: {
      name: "Pixabay Content License",
      summary: "All content is released under the Pixabay Content License, making it safe to use for commercial and non-commercial purposes without giving credit to the artist.",
      url: "https://pixabay.com/service/license-summary/"
    },
    items: finalItems
  };

  const jsonPath = path.join(sessionDir, "帖子事实.json");
  await fs.writeFile(jsonPath, JSON.stringify(groundTruthJson, null, 2), "utf8");
  console.log(`\n💾 帖子事实 JSON 已保存: ${jsonPath}`);

  // 5. 落盘 帖子事实.md
  const mdContent = generateMarkdown(groundTruthJson);
  const mdPath = path.join(sessionDir, "帖子事实.md");
  await fs.writeFile(mdPath, mdContent, "utf8");
  console.log(`📄 帖子事实 Markdown 已保存: ${mdPath}`);

  console.log(`\n🎉 Pixabay 探针抓取完成！共收集 ${finalItems.length} 个素材，${totalMediaFiles} 个高清媒体资产已落盘。`);
}

// ==================== Markdown 事实模版生成 ====================

function generateMarkdown(data) {
  const lines = [
    `# Pixabay 高清无版权素材事实存证 (${data.target})`,
    "",
    `> **抓取时间**：${data.fetched_at}  `,
    `> **检索模式**：${data.mode} | **素材分类**：${data.media_type}  `,
    `> **有效素材数**：${data.total_items} 篇  `,
    `> **本地媒体总数**：${data.total_media_files} 个  `,
    `> **全站统一商用许可**：[Pixabay Content License](${data.license_standard.url})（免版税、商业免署名、可自由二次修改）  `,
    "",
    "---",
    ""
  ];

  data.items.forEach((item) => {
    const isVideo = item.isVideo || item.mediaType === "video";
    const typeLabel = isVideo ? "🎬 视频" : (item.mediaType === "vector" ? "📐 矢量图" : (item.mediaType === "illustration" ? "🎨 插画" : "📷 照片"));

    lines.push(`## 素材 ${String(item.index).padStart(2, "0")}：${item.title || item.name || item.id}`);
    lines.push("");
    lines.push(`- **素材类型**：${typeLabel} ${item.isAiGenerated ? "`AI 生成`" : "`实拍/原创`"} ${item.isEditorsChoice ? "`编辑推荐 (Editor's Choice)`" : ""}`);
    lines.push(`- **原始链接**：${item.url || item.href}`);
    lines.push(`- **创作者**：[${item.author?.username || "未知"}](${item.author?.url || "#"})${item.author?.fullName ? ` (${item.author.fullName})` : ""} | 粉丝数: ${item.author?.followers || 0}`);
    if (item.author?.bio) {
      lines.push(`- **创作者简介**：${item.author.bio}`);
    }
    if (item.author?.socialLinks && item.author.socialLinks.length > 0) {
      lines.push(`- **创作者外链**：${item.author.socialLinks.join(" , ")}`);
    }
    lines.push(`- **发布时间**：${item.publishedAt || item.uploadDate || "未知"}`);

    // 分辨率与指标
    const dim = item.dimensions || {};
    let dimStr = `${dim.width} × ${dim.height}`;
    if (isVideo && dim.duration) dimStr += ` | ⏱️ 时长: ${dim.duration} 秒`;
    lines.push(`- **分辨率与规格**：${dimStr}`);

    const m = item.metrics || {};
    lines.push(`- **互动数据**：👁️ ${m.views} 浏览 | 📥 ${m.downloads} 下载 | ❤️ ${m.likes} 点赞 | 💬 ${m.comments} 评论`);
    lines.push(`- **商用授权**：Pixabay Content License (无需署名，可商用，可修改)`);
    lines.push("");

    // 相机 EXIF
    if (item.exif && (item.exif.camera || item.exif.lens || item.exif.iso)) {
      lines.push("### 📷 相机拍摄参数 (EXIF)");
      lines.push("");
      const e = item.exif;
      const exifItems = [];
      if (e.camera) exifItems.push(`- **相机型号**：${e.camera}`);
      if (e.lens) exifItems.push(`- **镜头**：${e.lens}`);
      if (e.focalLength) exifItems.push(`- **焦距**：${e.focalLength}`);
      if (e.aperture) exifItems.push(`- **光圈**：${e.aperture}`);
      if (e.exposureTime) exifItems.push(`- **曝光时间**：${e.exposureTime}`);
      if (e.iso) exifItems.push(`- **ISO 感光度**：${e.iso}`);
      lines.push(exifItems.join("\n"));
      lines.push("");
    }

    // 标签
    if (item.tags && item.tags.length > 0) {
      lines.push("### 🏷️ 关联标签 (Tags)");
      lines.push("");
      lines.push(item.tags.map(t => `#${t}`).join(" "));
      lines.push("");
    }

    // 本地媒体资产
    if (item.media_files && item.media_files.length > 0) {
      lines.push("### 🖼️ 本地高清媒体资产清单");
      lines.push("");
      item.media_files.forEach((mf, i) => {
        lines.push(`${i + 1}. [${mf.file_name}](./${mf.relative_path}) (${mf.size_formatted} | ${mf.format})`);
      });
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

function sanitizeFilename(str) {
  return String(str || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .trim();
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function printHelp() {
  console.log(`
Pixabay 高清免版税视觉与音视频素材事实探针 (Ground Truth Extractor)

用法:
  node recipes/pixabay-source.mjs [选项]

模式与选项:
  --mode, -m <search|post|explore>         抓取模式 (默认: search)
  --query, -q <keyword>                    搜索关键词 (用于 search 模式，如 "cyberpunk", "mountain lake")
  --type, -t <all|photos|illustrations|vectors|videos> 素材类型过滤 (默认: all)
  --url, -u <link>                         指定单篇 Pixabay 素材详情页链接 (进入 post 模式)
  --limit, -n <num>                        抓取数量上限 (默认: 3)
  --out, --out-dir, -o <path>              指定素材落地目录 (默认: D:\\素材\\Pixabay，配置将持久化记忆)
  --no-deep                                仅根据检索流元数据下载，不逐个深入访问详情页
  --skip-media, --no-media                 跳过高清媒体文件下载，仅保存事实元数据与简介
  --set-out <path>                         单独持久化设置默认输出目录并退出
  --get-out                                查看当前配置的持久化输出目录
  --help, -h                               显示本帮助

示例:
  # 1. 站内检索优质照片并下载原图与 EXIF 事实 (默认模式):
  node recipes/pixabay-source.mjs --mode search --query "cyberpunk city" --type photos --limit 3

  # 2. 检索免版税 4K/HD 视频切片并下载 MP4 资产:
  node recipes/pixabay-source.mjs --mode search --query "nature waterfall" --type videos --limit 2

  # 3. 抓取精选矢量图 (Vectors):
  node recipes/pixabay-source.mjs --mode search --query "technology icon" --type vectors --limit 3

  # 4. 深度解析单篇作品 (照片/视频) 详情页并下载高分辨率原画:
  node recipes/pixabay-source.mjs --url "https://pixabay.com/photos/alps-mountains-valley-nature-lake-10445555/"

  # 5. 指定并记忆输出工作区目录:
  node recipes/pixabay-source.mjs --out "D:\\素材\\Pixabay"
`);
}

main().catch((err) => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
