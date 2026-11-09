#!/usr/bin/env node

/**
 * YouTube 前沿情报、音视频素材与讲稿转写事实探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：原视频标题、博主/频道、原始简介（带分段与外链）、观看/点赞数、逐字文稿（Transcript/字幕）零删减原样落盘。
 * 2. 媒体资产全量本地化：原画封面、多语言字幕（.srt）与视频（.mp4）完整下载至 media/ 目录。
 * 3. 动态配置输出路径：无硬编码目录，优先级为 CLI --out > 记忆配置 (~/.shrimp/...) > 动态默认。
 * 4. 聚焦事实存证：本期专注视频一手事实与字幕转写沉淀，二次解构由下游 Router（leo-video-router / leo-xhs-router）接力。
 */

import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync, execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, "../scripts/cli/index.mjs");

// ==================== 路径与配置解析 (零写死) ====================

function getConfigPath() {
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "youtube-source-config.json");
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
  if (process.env.LEO_LANTERN_YOUTUBE_OUT) {
    return path.resolve(process.env.LEO_LANTERN_YOUTUBE_OUT);
  }
  return path.resolve(process.cwd(), "output", "youtube-source");
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
  const tmpFile = path.join(os.tmpdir(), `yt_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
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

// ==================== 工具探测 (yt-dlp) ====================

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

// ==================== 多媒体与元数据下载引擎 ====================

async function exportCookiesIfNeeded() {
  const tmpCookieFile = path.join(os.tmpdir(), `youtube_cookie_${Date.now()}.txt`);
  const res = runLantern("cookies", ["--domain=youtube.com", "--format=txt", `--out=${tmpCookieFile}`]);
  if (res.ok && res.savedTo && syncFs.existsSync(res.savedTo)) {
    return res.savedTo;
  }
  return null;
}

function fetchYoutubeMetadata(videoUrl, cookieFile) {
  const ytDlpBin = detectTool("yt-dlp");
  if (!ytDlpBin) return null;

  const args = [
    "--no-warnings",
    "--skip-download",
    "--dump-json",
    "--js-runtimes", "node:node",
    "--extractor-args", "youtube:player_client=android,web"
  ];
  if (cookieFile && syncFs.existsSync(cookieFile)) {
    args.push("--cookies", cookieFile);
  }
  args.push(videoUrl);

  try {
    const res = spawnSync(ytDlpBin, args, { encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    if (res.status !== 0 || !res.stdout) return null;
    return JSON.parse(res.stdout);
  } catch (err) {
    return null;
  }
}

function downloadYoutubeMedia({ videoUrl, destDir, baseName, downloadVideo = true, format = "18/best[height<=720]/best", cookieFile }) {
  const ytDlpBin = detectTool("yt-dlp");
  if (!ytDlpBin) return false;

  const args = [
    "--no-warnings",
    "--no-progress",
    "--ignore-errors",
    "--js-runtimes", "node:node",
    "--extractor-args", "youtube:player_client=android,web",
    "--write-thumbnail",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs", "en,zh-Hans",
    "-P", destDir,
    "-o", `${baseName}.%(ext)s`
  ];

  if (!downloadVideo) {
    args.push("--skip-download");
  } else {
    args.push("-f", format);
  }

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

function parseTranscript(filePath) {
  try {
    if (!syncFs.existsSync(filePath)) return null;
    const content = syncFs.readFileSync(filePath, "utf8");
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const results = [];
    const seen = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const timeMatch = line.match(/^(\d{2}:)?(\d{2}:\d{2})[.,]\d+/);
      if (timeMatch) {
        const ts = timeMatch[2] || timeMatch[0];
        let text = "";
        let j = i + 1;
        while (j < lines.length && lines[j].trim() && !lines[j].includes("-->")) {
          text += " " + lines[j].trim();
          j++;
        }
        text = text.replace(/<[^>]+>/g, "").trim();
        if (text && !seen.has(text)) {
          seen.add(text);
          results.push(`[${ts}] ${text}`);
        }
        i = j - 1;
      }
    }
    return results.length > 0 ? results.join("\n") : null;
  } catch {
    return null;
  }
}

// ==================== 浏览器页面交互与链接提取 ====================

const EXTRACT_VIDEOS_SCRIPT = `
(() => {
  const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer'));
  const videos = [];
  const seen = new Set();

  for (const item of items) {
    const titleLink = item.querySelector('#video-title') || 
                      item.querySelector('a#video-title-link') || 
                      Array.from(item.querySelectorAll('a[href*="/watch?v="]')).find(a => (a.getAttribute('title') || a.innerText.trim()).length > 2);

    if (!titleLink) continue;
    const url = titleLink.href;
    const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    const videoId = match ? match[1] : '';
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);

    const title = titleLink.getAttribute('title') || titleLink.innerText.trim();
    const channelLink = item.querySelector('a[href*="/@"]') || item.querySelector('#channel-name a') || item.querySelector('ytd-channel-name a');
    const channel = channelLink ? channelLink.innerText.trim() : '';
    const channelUrl = channelLink ? channelLink.href : '';

    const metaSpans = Array.from(item.querySelectorAll('#metadata-line span')).map(s => s.innerText.trim()).filter(Boolean);
    const views = metaSpans[0] || '';
    const publishedTime = metaSpans[1] || '';

    const timeEl = item.querySelector('span#text') || item.querySelector('.badge-shape-wiz__text') || item.querySelector('ytd-thumbnail-overlay-time-status-renderer');
    const duration = timeEl ? timeEl.innerText.trim() : '';

    videos.push({
      videoId,
      title,
      videoUrl: 'https://www.youtube.com/watch?v=' + videoId,
      channel,
      channelUrl,
      views,
      publishedTime,
      duration
    });
  }

  return videos;
})()
`;

async function collectVideosWithScroll(limit, maxAttempts = 5) {
  let gathered = [];
  const seen = new Set();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = runLanternEval(EXTRACT_VIDEOS_SCRIPT);
    if (res.ok && Array.isArray(res.evalResult)) {
      for (const v of res.evalResult) {
        if (!seen.has(v.videoId)) {
          seen.add(v.videoId);
          gathered.push(v);
          if (gathered.length >= limit) return gathered.slice(0, limit);
        }
      }
    }
    if (gathered.length >= limit) break;
    runLanternEval("window.scrollBy(0, 1000);");
    await sleep(2000);
  }

  return gathered.slice(0, limit);
}

// ==================== 主控执行逻辑 ====================

async function main() {
  const args = process.argv.slice(2);
  let mode = "feed";
  let query = "";
  let channel = "";
  let targetUrl = "";
  let limit = 3;
  let customOut = "";
  let downloadMedia = true;
  let downloadVideo = true;
  let useCookies = false;
  let videoFormat = "18/best[height<=720]/best";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--mode" || a === "-m") mode = args[++i];
    else if (a === "--query" || a === "-q") query = args[++i];
    else if (a === "--channel" || a === "-c") channel = args[++i];
    else if (a === "--url") targetUrl = args[++i];
    else if (a === "--limit" || a === "-n") limit = parseInt(args[++i], 10) || 3;
    else if (a === "--out-dir" || a === "--out" || a === "-o") customOut = args[++i];
    else if (a === "--format") videoFormat = args[++i];
    else if (a === "--no-video") downloadVideo = false;
    else if (a === "--use-cookies") useCookies = true;
    else if (a === "--no-media" || a === "--skip-media") {
      downloadMedia = false;
      downloadVideo = false;
    }
    else if (a === "--set-out") {
      const target = args[++i];
      if (!target) {
        console.error("❌ --set-out 必须指定目录路径");
        process.exit(1);
      }
      const saved = saveConfig({ output_dir: path.resolve(target) });
      console.log(`✅ 已持久化配置 YouTube 默认输出目录: ${saved?.output_dir}`);
      process.exit(0);
    }
    else if (a === "--get-out") {
      const cfg = loadConfig();
      console.log(`📂 当前 YouTube 默认输出目录: ${cfg.output_dir || "未设置（将动态兜底到 ./output/youtube-source）"}`);
      process.exit(0);
    }
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  console.log("🚀 启动 YouTube 前沿情报与音视频创作素材探针 (Ground Truth Extractor)...");
  console.log(`📌 模式: ${mode} | 采集上限: ${limit} | 下载视频: ${downloadVideo ? "是" : "否"} | 下载媒体: ${downloadMedia ? "是" : "否"}`);

  // 1. 初始化输出根目录
  const outRoot = resolveOutputDir(customOut);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const targetTag = channel ? `channel_${channel.replace(/^@/, '')}` : query ? `search_${query.replace(/[^\w\u4e00-\u9fa5]/g, '_')}` : mode;
  const sessionDir = path.join(outRoot, `${dateStr}-${targetTag}`);
  const mediaDir = path.join(sessionDir, "media");

  await fs.mkdir(mediaDir, { recursive: true });
  console.log(`📂 本次落盘目录: ${sessionDir}`);

  // 2. 启动 Lantern 连接 Chrome
  console.log("\n🔌 正在与 Chrome 浏览器建立 Lantern CDP 连接...");
  const startRes = runLantern("start");
  if (!startRes.ok && !startRes.bridge) {
    console.error("❌ 无法连接到 Leo Lantern 服务，请确认 Chrome 扩展已开启。");
    process.exit(1);
  }

  // 检查已有 YouTube 标签页
  const tabsRes = runLantern("tabs");
  let claimedTabId = null;
  if (tabsRes.ok && Array.isArray(tabsRes.result)) {
    const yTab = tabsRes.result.find(t => t.url && t.url.includes("youtube.com"));
    if (yTab) claimedTabId = yTab.id;
  }

  // 启动任务并认领标签页
  const taskRes = runLantern("start-task", ["--title", "youtube-source", "--same-window"]);
  if (!taskRes.ok) {
    console.error("❌ 创建 Lantern 任务失败:", taskRes.error);
    process.exit(1);
  }

  if (claimedTabId) {
    runLantern("claim", ["--tabId", String(claimedTabId)]);
  }

  // 3. 提取 Cookie (可选)
  let cookieFile = null;
  if (useCookies) {
    console.log("🍪 正在从当前 Chrome 会话导出 YouTube Cookie...");
    cookieFile = await exportCookiesIfNeeded();
    if (cookieFile) {
      console.log(`✅ Cookie 导出就绪 (${path.basename(cookieFile)})`);
    }
  }

  // 4. 根据模式导航与获取视频列表
  let collectedVideos = [];

  try {
    if (mode === "post") {
      if (!targetUrl) {
        console.error("❌ 单视频模式 (--mode post) 必须提供 --url 参数");
        process.exit(1);
      }
      collectedVideos.push({
        videoId: "single",
        videoUrl: targetUrl,
        title: ""
      });
    } else if (mode === "channel") {
      if (!channel) {
        console.error("❌ 频道模式 (--mode channel) 必须提供 --channel 参数 (如 --channel @mkbhd)");
        process.exit(1);
      }
      const handle = channel.startsWith("@") ? channel : `@${channel}`;
      const channelUrl = `https://www.youtube.com/${handle}/videos`;
      console.log(`🌐 正在打开频道视频页: ${channelUrl}`);
      runLantern("goto", [channelUrl]);
      await sleep(3500);

      collectedVideos = await collectVideosWithScroll(limit);
    } else if (mode === "search") {
      if (!query) {
        console.error("❌ 搜索模式 (--mode search) 必须提供 --query 参数");
        process.exit(1);
      }
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      console.log(`🌐 正在打开站内搜索: ${searchUrl}`);
      runLantern("goto", [searchUrl]);
      await sleep(3500);

      collectedVideos = await collectVideosWithScroll(limit);
    } else {
      // 默认 feed (首页/关注流)
      console.log("🌐 正在抓取当前 YouTube 首页推荐流 (Feed)...");
      const currentUrl = tabsRes.ok && claimedTabId ? (tabsRes.result.find(t => t.id === claimedTabId)?.url || "") : "";
      if (!currentUrl.includes("youtube.com")) {
        runLantern("goto", ["https://www.youtube.com/"]);
        await sleep(3000);
      }

      collectedVideos = await collectVideosWithScroll(limit);
    }
  } finally {
    runLantern("end-task");
  }

  console.log(`\n📦 共获取到 ${collectedVideos.length} 个待解析视频，开始提取 100% 事实元数据与下载媒体...`);

  // 5. 循环解析每个视频的详情数据与媒体下载
  const finalPosts = [];
  let totalMediaFiles = 0;

  for (let i = 0; i < collectedVideos.length; i++) {
    const rawVideo = collectedVideos[i];
    const postIdx = String(i + 1).padStart(2, "0");
    const videoUrl = rawVideo.videoUrl;

    console.log(`\n[${i + 1}/${collectedVideos.length}] 正在解析视频: ${videoUrl}`);

    // 使用 yt-dlp 提取 100% 原始机器可读元数据
    const meta = fetchYoutubeMetadata(videoUrl, cookieFile);

    const title = meta?.title || rawVideo.title || "YouTube Video";
    const channelName = meta?.uploader || meta?.channel || rawVideo.channel || "Unknown Channel";
    const channelUrl = meta?.uploader_url || meta?.channel_url || rawVideo.channelUrl || null;
    const duration = meta?.duration_string || rawVideo.duration || null;
    const uploadDate = meta?.upload_date ? `${meta.upload_date.slice(0,4)}-${meta.upload_date.slice(4,6)}-${meta.upload_date.slice(6,8)}` : null;
    const views = meta?.view_count ? String(meta.view_count) : (rawVideo.views || null);
    const likes = meta?.like_count ? String(meta.like_count) : null;
    const description = meta?.description || "";
    const tags = meta?.tags || [];

    // 下载媒体 (封面、字幕与视频)
    const localMediaFiles = [];
    let transcriptText = null;

    if (downloadMedia) {
      console.log(`  📥 正在抓取原画封面、字幕与视频流...`);
      const baseName = `yt_${postIdx}_${meta?.id || rawVideo.videoId || "video"}`;
      
      downloadYoutubeMedia({
        videoUrl,
        destDir: mediaDir,
        baseName,
        downloadVideo,
        format: videoFormat,
        cookieFile
      });

      // 扫描落盘文件
      const allFiles = syncFs.readdirSync(mediaDir);
      const matchedFiles = allFiles.filter(f => f.startsWith(baseName));

      // 寻找字幕并提取逐字文稿 (Transcript)
      const subFile = matchedFiles.find(f => f.endsWith(".srt") || f.endsWith(".vtt"));
      if (subFile) {
        const fullSubPath = path.join(mediaDir, subFile);
        transcriptText = parseTranscript(fullSubPath);
      }

      for (const f of matchedFiles) {
        const stat = syncFs.statSync(path.join(mediaDir, f));
        localMediaFiles.push({
          file_name: f,
          relative_path: `media/${f}`,
          size_bytes: stat.size,
          size_formatted: formatBytes(stat.size)
        });
        totalMediaFiles++;
      }
      console.log(`  ✅ 已落地 ${localMediaFiles.length} 个媒体/文稿文件 ${transcriptText ? "(含带时间戳字幕转写)" : ""}`);
    }

    finalPosts.push({
      index: i + 1,
      id: meta?.id || rawVideo.videoId || "video",
      title,
      channel: {
        name: channelName,
        url: channelUrl
      },
      video_url: videoUrl,
      published_at: uploadDate,
      duration,
      metrics: {
        views,
        likes
      },
      tags,
      description,
      transcript: transcriptText,
      media_files: localMediaFiles
    });
  }

  // 6. 落盘 帖子事实.json
  const groundTruthJson = {
    fetched_at: now.toISOString(),
    platform: "YouTube",
    mode,
    target: targetTag,
    total_posts: finalPosts.length,
    total_media_files: totalMediaFiles,
    posts: finalPosts
  };

  const jsonPath = path.join(sessionDir, "帖子事实.json");
  await fs.writeFile(jsonPath, JSON.stringify(groundTruthJson, null, 2), "utf8");
  console.log(`\n💾 帖子事实 JSON 已保存: ${jsonPath}`);

  // 7. 落盘 帖子事实.md
  const mdContent = generateMarkdown(groundTruthJson);
  const mdPath = path.join(sessionDir, "帖子事实.md");
  await fs.writeFile(mdPath, mdContent, "utf8");
  console.log(`📄 帖子事实 Markdown 已保存: ${mdPath}`);

  // 清理临时 Cookie 文件
  if (cookieFile) {
    try { syncFs.unlinkSync(cookieFile); } catch {}
  }

  console.log(`\n🎉 YouTube 探针抓取完成！共收集 ${finalPosts.length} 个事实视频，${totalMediaFiles} 个本地媒体/字幕文件。`);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function generateMarkdown(data) {
  const lines = [
    `# YouTube 视频情报与事实存证 (${data.target})`,
    "",
    `> **抓取时间**：${data.fetched_at}  `,
    `> **平台模式**：${data.mode}  `,
    `> **有效视频数**：${data.total_posts} 篇  `,
    `> **本地媒体总数**：${data.total_media_files} 个  `,
    "",
    "---",
    ""
  ];

  data.posts.forEach((p) => {
    lines.push(`## 视频 ${String(p.index).padStart(2, "0")}：${p.title}`);
    lines.push("");
    lines.push(`- **所属频道**：[${p.channel.name}](${p.channel.url || "#"})`);
    lines.push(`- **视频链接**：${p.video_url}`);
    lines.push(`- **发布日期**：${p.published_at || "未知"}`);
    lines.push(`- **视频时长**：${p.duration || "未知"}`);
    lines.push(`- **互动指标**：${p.metrics.views ? `${p.metrics.views} 次观看` : ""} ${p.metrics.likes ? `| 👍 ${p.metrics.likes}` : ""}`);
    lines.push("");

    if (p.tags && p.tags.length > 0) {
      lines.push("### 🏷️ 视频标签 (Tags)");
      lines.push("");
      lines.push(p.tags.map(t => `#${t}`).join(" "));
      lines.push("");
    }

    lines.push("### 📝 原始视频简介 (Description)");
    lines.push("");
    if (p.description) {
      lines.push("```text");
      lines.push(p.description);
      lines.push("```");
    } else {
      lines.push("*（该视频无简介文本）*");
    }
    lines.push("");

    if (p.transcript) {
      lines.push("### 🎙️ 视频逐字文稿 (Transcript / 带时间戳字幕)");
      lines.push("");
      lines.push("```text");
      lines.push(p.transcript);
      lines.push("```");
      lines.push("");
    }

    if (p.media_files && p.media_files.length > 0) {
      lines.push("### 🖼️ 本地媒体与文稿资产清单");
      lines.push("");
      p.media_files.forEach((m, idx) => {
        lines.push(`${idx + 1}. [${m.file_name}](./${m.relative_path}) (${m.size_formatted})`);
      });
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

function printHelp() {
  console.log(`
YouTube 前沿情报与音视频创作素材探针 (Ground Truth Extractor)

用法:
  node recipes/youtube-source.mjs [选项]

模式与选项:
  --mode, -m <feed|channel|search|post>   抓取模式 (默认: feed)
  --channel, -c <handle>                  指定 YouTube 频道 (用于 channel 模式，如 @mkbhd, @LinusTechTips)
  --query, -q <keyword>                   搜索关键词 (用于 search 模式)
  --url <link>                            指定单篇 YouTube 视频链接 (用于 post 模式)
  --limit, -n <num>                       抓取视频数量上限 (默认: 3)
  --out, --out-dir, -o <path>             指定素材落地目录 (默认: D:\\素材\\YouTube，配置将持久化记忆)
  --format <fmt>                          视频下载清晰度格式 (默认: 18/best[height<=720]/best)
  --no-video                              仅下载原画封面与字幕转写，不下载视频本体
  --skip-media, --no-media                跳过所有媒体下载，仅抓取纯元数据与简介
  --set-out <path>                        单独持久化设置默认输出目录并退出
  --get-out                               查看当前配置的持久化输出目录
  --help, -h                              显示本帮助

示例:
  # 1. 抓取当前首页推荐流最新 3 篇（默认模式）：
  node recipes/youtube-source.mjs --mode feed --limit 3

  # 2. 定向抓取指定频道最新视频并提取字幕文稿与封面：
  node recipes/youtube-source.mjs --mode channel --channel @AnthropicAI --limit 3

  # 3. 站内关键词搜索（仅提取封面与文稿，不下载大视频）：
  node recipes/youtube-source.mjs --mode search --query "Claude Code tutorial" --no-video --limit 3

  # 4. 深度解析单篇视频并下载原画视频与逐字稿：
  node recipes/youtube-source.mjs --mode post --url "https://www.youtube.com/watch?v=..."

  # 5. 指定并记忆输出工作区目录：
  node recipes/youtube-source.mjs --out "D:\\素材\\YouTube"
`);
}

main().catch((err) => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
