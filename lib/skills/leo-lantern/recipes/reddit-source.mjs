#!/usr/bin/env node

/**
 * Reddit 前沿情报与深度社区讨论事实探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：楼主标题、正文 Markdown、发帖社区、作者、点赞/评论数、社区高赞回复原汁原味落盘。
 * 2. 媒体资产全量本地化：插图（单图/多图相册）与 Reddit 视频完整下载至 media/ 目录。
 * 3. 动态配置输出路径：无硬编码目录，优先级为 CLI --out > 记忆配置 (~/.shrimp/...) > 动态默认。
 * 4. 聚焦事实存证：本期专注社区一手讨论与本地资产沉淀，二创由下游 Router 接力。
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
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "reddit-source-config.json");
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
  if (process.env.LEO_LANTERN_REDDIT_OUT) {
    return path.resolve(process.env.LEO_LANTERN_REDDIT_OUT);
  }
  return path.resolve(process.cwd(), "output", "reddit-source");
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
  const tmpFile = path.join(os.tmpdir(), `reddit_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
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

// ==================== 工具探测 (gallery-dl & yt-dlp) ====================

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

// ==================== 多媒体下载引擎 ====================

async function exportCookiesIfNeeded() {
  const tmpCookieFile = path.join(os.tmpdir(), `reddit_cookie_${Date.now()}.txt`);
  const res = runLantern("cookies", ["--domain=reddit.com", "--format=txt", `--out=${tmpCookieFile}`]);
  if (res.ok && res.savedTo && syncFs.existsSync(res.savedTo)) {
    return res.savedTo;
  }
  return null;
}

async function downloadDirectImage(imageUrl, destPath) {
  try {
    const cleanUrl = imageUrl.replace(/&amp;/g, "&");
    const res = await fetch(cleanUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.reddit.com/"
      }
    });
    if (!res.ok) return false;
    const arrayBuffer = await res.arrayBuffer();
    await fs.writeFile(destPath, Buffer.from(arrayBuffer));
    return true;
  } catch {
    return false;
  }
}

function downloadWithYtDlp(postUrl, destDir, destBaseName, cookieFile) {
  const ytDlpBin = detectTool("yt-dlp");
  if (!ytDlpBin) return false;

  const args = [
    "--no-warnings",
    "--no-progress",
    "-P", destDir,
    "-o", `${destBaseName}.%(ext)s`
  ];
  if (cookieFile && syncFs.existsSync(cookieFile)) {
    args.push("--cookies", cookieFile);
  }
  args.push(postUrl);

  try {
    const res = spawnSync(ytDlpBin, args, { stdio: "ignore", windowsHide: true });
    return res.status === 0;
  } catch {
    return false;
  }
}

// ==================== 页面解析脚本 (在 Chrome 中执行) ====================

const EXTRACT_POST_LIST_SCRIPT = `
(() => {
  const posts = Array.from(document.querySelectorAll('shreddit-post'));
  const results = [];
  const seenIds = new Set();

  for (const p of posts) {
    const id = p.id;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const title = p.getAttribute('post-title') || '';
    const author = p.getAttribute('author') || '';
    const subreddit = p.getAttribute('subreddit-prefixed-name') || '';
    const score = p.getAttribute('score') || '0';
    const commentCount = p.getAttribute('comment-count') || '0';
    const permalink = p.getAttribute('permalink') || '';
    const contentHref = p.getAttribute('content-href') || '';
    const postType = p.getAttribute('post-type') || 'text';
    const domain = p.getAttribute('domain') || '';

    // 正文摘要（列表页若有）
    const textBody = p.querySelector('[slot="text-body"]') || p.querySelector('.md');
    const previewText = textBody ? textBody.innerText.trim() : '';

    results.push({
      id,
      title,
      author,
      subreddit,
      score,
      commentCount,
      permalink: permalink.startsWith('http') ? permalink : ('https://www.reddit.com' + permalink),
      contentHref,
      postType,
      domain,
      previewText
    });
  }

  return results;
})()
`;

const EXTRACT_POST_DETAIL_SCRIPT = `
(() => {
  const p = document.querySelector('shreddit-post');
  
  // 1. 正文 Markdown/Text
  const textBodyEl = (p ? p.querySelector('[slot="text-body"]') : null) || 
                     document.querySelector('[slot="text-body"]') || 
                     document.querySelector('.md');
  const selftext = textBodyEl ? textBodyEl.innerText.trim() : '';

  // 2. 媒体图片 (原图优先，去重)
  const imageElements = Array.from(document.querySelectorAll('shreddit-post img, [slot="post-media-container"] img'));
  const rawImageUrls = imageElements
    .map(i => i.src)
    .filter(src => src && (src.includes('i.redd.it') || src.includes('preview.redd.it')));
  
  // 去除缩略图重复并转为高清原图 URL
  const uniqueImages = Array.from(new Set(rawImageUrls.map(u => u.replace(/&amp;/g, '&'))));

  // 3. 视频播放器
  const player = document.querySelector('shreddit-player');
  const videoSrc = player ? (player.getAttribute('src') || player.src) : null;

  // 4. 社区精选高赞回复 (前 5 条)
  const commentEls = Array.from(document.querySelectorAll('shreddit-comment')).slice(0, 6);
  const comments = [];
  for (const c of commentEls) {
    const author = c.getAttribute('author') || '';
    const score = c.getAttribute('score') || '';
    if (!author || author === '[deleted]') continue;
    const bodyEl = c.querySelector('div[slot="comment"]') || c.querySelector('.md');
    const body = bodyEl ? bodyEl.innerText.trim() : '';
    if (body) {
      comments.push({ author, score, body });
    }
  }

  return {
    selftext,
    images: uniqueImages,
    videoSrc,
    comments
  };
})()
`;

// ==================== 主控执行逻辑 ====================

async function main() {
  const args = process.argv.slice(2);
  let mode = "feed";
  let subreddit = "";
  let sort = "hot";
  let query = "";
  let targetUrl = "";
  let limit = 5;
  let customOut = "";
  let downloadMedia = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--mode" || a === "-m") mode = args[++i];
    else if (a === "--sub" || a === "--subreddit" || a === "-s") subreddit = args[++i];
    else if (a === "--sort") sort = args[++i];
    else if (a === "--query" || a === "-q") query = args[++i];
    else if (a === "--url") targetUrl = args[++i];
    else if (a === "--limit" || a === "-n") limit = parseInt(args[++i], 10) || 5;
    else if (a === "--out-dir" || a === "--out" || a === "-o") customOut = args[++i];
    else if (a === "--set-out") {
      const target = args[++i];
      if (!target) {
        console.error("❌ --set-out 必须指定目录路径");
        process.exit(1);
      }
      const saved = saveConfig({ output_dir: path.resolve(target) });
      console.log(`✅ 已持久化配置 Reddit 默认输出目录: ${saved?.output_dir}`);
      process.exit(0);
    }
    else if (a === "--get-out") {
      const cfg = loadConfig();
      console.log(`📂 当前 Reddit 默认输出目录: ${cfg.output_dir || "未设置（将动态兜底到 ./output/reddit-source）"}`);
      process.exit(0);
    }
    else if (a === "--no-media" || a === "--skip-media") downloadMedia = false;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  console.log("🚀 启动 Reddit 前沿情报与深度社区讨论事实探针 (Ground Truth Extractor)...");
  console.log(`📌 模式: ${mode} | 采集上限: ${limit} | 下载媒体: ${downloadMedia ? "是" : "否"}`);

  // 1. 初始化输出根目录
  const outRoot = resolveOutputDir(customOut);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const targetTag = subreddit ? `r_${subreddit.replace(/^r\//, '')}` : query ? `search_${query.replace(/[^\w\u4e00-\u9fa5]/g, '_')}` : mode;
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

  // 检查已有 Reddit 标签页
  const tabsRes = runLantern("tabs");
  let claimedTabId = null;
  if (tabsRes.ok && Array.isArray(tabsRes.result)) {
    const rTab = tabsRes.result.find(t => t.url && t.url.includes("reddit.com"));
    if (rTab) claimedTabId = rTab.id;
  }

  // 启动任务并认领标签页
  const taskRes = runLantern("start-task", ["--title", "reddit-source", "--same-window"]);
  if (!taskRes.ok) {
    console.error("❌ 创建 Lantern 任务失败:", taskRes.error);
    process.exit(1);
  }

  if (claimedTabId) {
    runLantern("claim", ["--tabId", String(claimedTabId)]);
  }

  // 3. 提取 Reddit 会话 Cookie (用于工具容灾)
  console.log("🍪 正在从当前 Chrome 会话导出 Reddit Cookie...");
  const cookieFile = await exportCookiesIfNeeded();
  if (cookieFile) {
    console.log(`✅ Cookie 导出就绪 (${path.basename(cookieFile)})`);
  }

  // 4. 根据模式导航与获取帖子列表
  let collectedPosts = [];

  try {
    if (mode === "post") {
      if (!targetUrl) {
        console.error("❌ 单帖模式 (--mode post) 必须提供 --url 参数");
        process.exit(1);
      }
      collectedPosts.push({
        id: "single_post",
        title: "",
        permalink: targetUrl,
        postType: "unknown"
      });
    } else if (mode === "sub" || mode === "subreddit") {
      if (!subreddit) {
        console.error("❌ 社区模式 (--mode sub) 必须提供 --sub 参数 (例如 --sub ClaudeAI)");
        process.exit(1);
      }
      const cleanSub = subreddit.replace(/^r\//, '');
      const subUrl = `https://www.reddit.com/r/${cleanSub}/${sort}/`;
      console.log(`🌐 正在打开社区板块: ${subUrl}`);
      runLantern("goto", [subUrl]);
      await sleep(3500);

      const listRes = runLanternEval(EXTRACT_POST_LIST_SCRIPT);
      const list = (listRes.ok && Array.isArray(listRes.evalResult)) ? listRes.evalResult : [];
      collectedPosts = list.slice(0, limit);
    } else if (mode === "search") {
      if (!query) {
        console.error("❌ 搜索模式 (--mode search) 必须提供 --query 参数");
        process.exit(1);
      }
      const searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=relevance`;
      console.log(`🌐 正在打开站内搜索: ${searchUrl}`);
      runLantern("goto", [searchUrl]);
      await sleep(3500);

      const listRes = runLanternEval(EXTRACT_POST_LIST_SCRIPT);
      const list = (listRes.ok && Array.isArray(listRes.evalResult)) ? listRes.evalResult : [];
      collectedPosts = list.slice(0, limit);
    } else {
      // 默认 feed (首页/热门推荐)
      console.log("🌐 正在抓取当前 Reddit 首页信息流 (Feed)...");
      const currentUrl = tabsRes.ok && claimedTabId ? (tabsRes.result.find(t => t.id === claimedTabId)?.url || "") : "";
      if (!currentUrl.includes("reddit.com")) {
        runLantern("goto", ["https://www.reddit.com/"]);
        await sleep(3000);
      }

      const listRes = runLanternEval(EXTRACT_POST_LIST_SCRIPT);
      const list = (listRes.ok && Array.isArray(listRes.evalResult)) ? listRes.evalResult : [];
      collectedPosts = list.slice(0, limit);
    }
  } finally {
    // 任务保留至解析完成
  }

  console.log(`\n📦 共获取到 ${collectedPosts.length} 篇待解析帖子，开始深入详情页提取事实与下载媒体...`);

  // 5. 循环深入每篇帖子提取完整 Markdown 与高赞回复
  const finalPosts = [];
  let totalMediaFiles = 0;

  try {
    for (let i = 0; i < collectedPosts.length; i++) {
      const rawPost = collectedPosts[i];
      const postIdx = String(i + 1).padStart(2, "0");
      const permalink = rawPost.permalink;

      console.log(`\n[${i + 1}/${collectedPosts.length}] 正在深入解析帖子: ${permalink}`);
      
      // 导航到帖子详情页提取全量正文与回复
      runLantern("goto", [permalink]);
      await sleep(2800);

      const detailRes = runLanternEval(EXTRACT_POST_DETAIL_SCRIPT);
      const detail = (detailRes.ok && detailRes.evalResult) ? detailRes.evalResult : {};

      // 获取基本事实
      const title = rawPost.title || (await runLanternEval("document.querySelector('shreddit-post')?.getAttribute('post-title') || document.title")).evalResult || "";
      const author = rawPost.author || (await runLanternEval("document.querySelector('shreddit-post')?.getAttribute('author') || ''")).evalResult || "";
      const subreddit = rawPost.subreddit || (await runLanternEval("document.querySelector('shreddit-post')?.getAttribute('subreddit-prefixed-name') || ''")).evalResult || "";
      const score = rawPost.score || (await runLanternEval("document.querySelector('shreddit-post')?.getAttribute('score') || '0'")).evalResult || "0";
      const commentCount = rawPost.commentCount || (await runLanternEval("document.querySelector('shreddit-post')?.getAttribute('comment-count') || '0'")).evalResult || "0";
      const contentHref = rawPost.contentHref || (await runLanternEval("document.querySelector('shreddit-post')?.getAttribute('content-href') || ''")).evalResult || "";
      const postType = rawPost.postType || "text";

      const selftext = detail.selftext || rawPost.previewText || "";
      const comments = detail.comments || [];

      // 媒体下载
      const localMediaFiles = [];
      if (downloadMedia) {
        console.log(`  📥 正在下载媒体文件到本地...`);
        const candidateImages = detail.images || [];
        if (contentHref && (contentHref.includes('i.redd.it') || contentHref.includes('preview.redd.it'))) {
          candidateImages.unshift(contentHref);
        }

        const uniqueImageUrls = Array.from(new Set(candidateImages));
        let imgNum = 1;
        for (const imgUrl of uniqueImageUrls) {
          const extMatch = imgUrl.match(/\.(jpg|jpeg|png|webp|gif)/i);
          const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
          const fileName = `reddit_${postIdx}_img_${imgNum}.${ext}`;
          const destPath = path.join(mediaDir, fileName);

          const ok = await downloadDirectImage(imgUrl, destPath);
          if (ok && syncFs.existsSync(destPath)) {
            const stat = syncFs.statSync(destPath);
            if (stat.size > 2000) { // 过滤微型占位图
              localMediaFiles.push({
                file_name: fileName,
                relative_path: `media/${fileName}`,
                size_bytes: stat.size,
                size_formatted: formatBytes(stat.size),
                original_url: imgUrl
              });
              totalMediaFiles++;
              imgNum++;
            } else {
              try { syncFs.unlinkSync(destPath); } catch {}
            }
          }
        }

        // 视频下载 (若是视频帖)
        const isVideo = postType === "video" || 
                        (contentHref && contentHref.includes('v.redd.it')) ||
                        (typeof detail.videoSrc === 'string' && (detail.videoSrc.includes('v.redd.it') || detail.videoSrc.includes('.mp4')));

        if (isVideo) {
          console.log(`  🎥 检测到视频帖，正在联动 yt-dlp 抓取原画视频...`);
          const videoBase = `reddit_${postIdx}_video`;
          const ytdlOk = downloadWithYtDlp(permalink, mediaDir, videoBase, cookieFile);
          const currentFiles = syncFs.readdirSync(mediaDir);
          const matchedVideo = currentFiles.find(f => f.startsWith(videoBase));
          if (matchedVideo) {
            const stat = syncFs.statSync(path.join(mediaDir, matchedVideo));
            localMediaFiles.push({
              file_name: matchedVideo,
              relative_path: `media/${matchedVideo}`,
              size_bytes: stat.size,
              size_formatted: formatBytes(stat.size)
            });
            totalMediaFiles++;
          }
        }

        console.log(`  ✅ 已落地 ${localMediaFiles.length} 个媒体文件`);
      }

      finalPosts.push({
        index: i + 1,
        id: rawPost.id,
        title,
        author: {
          username: author,
          profile_url: author ? `https://www.reddit.com/user/${author}/` : null
        },
        subreddit,
        post_url: permalink,
        content_href: contentHref,
        post_type: postType,
        score,
        comment_count: commentCount,
        selftext,
        comments,
        media_files: localMediaFiles
      });
    }
  } finally {
    runLantern("end-task");
  }

  // 6. 落盘 帖子事实.json
  const groundTruthJson = {
    fetched_at: now.toISOString(),
    platform: "Reddit",
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

  console.log(`\n🎉 Reddit 探针抓取完成！共收集 ${finalPosts.length} 篇事实帖子，${totalMediaFiles} 个本地媒体文件。`);
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
    `# Reddit 社区讨论与事实沉淀 (${data.target})`,
    "",
    `> **抓取时间**：${data.fetched_at}  `,
    `> **平台模式**：${data.mode}  `,
    `> **有效帖子数**：${data.total_posts} 篇  `,
    `> **本地媒体总数**：${data.total_media_files} 个  `,
    "",
    "---",
    ""
  ];

  data.posts.forEach((p) => {
    lines.push(`## 帖子 ${String(p.index).padStart(2, "0")}：${p.title}`);
    lines.push("");
    lines.push(`- **社区板块**：${p.subreddit || "未知"}`);
    lines.push(`- **发布作者**：u/${p.author.username || "未知"}`);
    lines.push(`- **帖子链接**：${p.post_url}`);
    lines.push(`- **点赞互动**：▲ ${p.score} 赞 | 💬 ${p.comment_count} 评论`);
    if (p.content_href && !p.content_href.includes('reddit.com')) {
      lines.push(`- **外部链接**：${p.content_href}`);
    }
    lines.push("");

    lines.push("### 📝 楼主原帖正文 (Selftext)");
    lines.push("");
    if (p.selftext) {
      lines.push(p.selftext);
    } else {
      lines.push("*（该帖为纯图片/链接/短视讯，无正文字文）*");
    }
    lines.push("");

    if (p.comments && p.comments.length > 0) {
      lines.push("### 💬 社区精选高赞回复 (Top Comments)");
      lines.push("");
      p.comments.forEach((c, idx) => {
        lines.push(`**${idx + 1}. u/${c.author}** (▲ ${c.score}):`);
        lines.push(`> ${c.body.replace(/\n+/g, '\n> ')}`);
        lines.push("");
      });
    }

    if (p.media_files && p.media_files.length > 0) {
      lines.push("### 🖼️ 本地媒体资产清单");
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
Reddit 前沿情报与深度社区讨论事实探针 (Ground Truth Extractor)

用法:
  node recipes/reddit-source.mjs [选项]

模式与选项:
  --mode, -m <feed|sub|search|post>   抓取模式 (默认: feed)
  --sub, --subreddit, -s <name>       指定 Subreddit 板块 (用于 sub 模式，如 ClaudeAI, technology)
  --sort <hot|top|new>                板块排序规则 (默认: hot)
  --query, -q <keyword>               搜索关键词 (用于 search 模式)
  --url <link>                        指定单篇 Reddit 帖子链接 (用于 post 模式)
  --limit, -n <num>                   抓取数量上限 (默认: 5)
  --out, --out-dir, -o <path>         指定素材落地目录 (默认: D:\\素材\\Reddit，配置将持久化记忆)
  --set-out <path>                    单独持久化设置默认输出目录并退出
  --get-out                           查看当前配置的持久化输出目录
  --skip-media, --no-media            仅抓取纯文本与评论，不下载媒体文件
  --help, -h                          显示本帮助

示例:
  # 1. 抓取当前主页流最新 3 篇（默认模式）：
  node recipes/reddit-source.mjs --mode feed --limit 3

  # 2. 定向抓取 r/ClaudeAI 社区热门帖子：
  node recipes/reddit-source.mjs --mode sub --sub ClaudeAI --limit 5

  # 3. 站内关键词搜索：
  node recipes/reddit-source.mjs --mode search --query "Cursor vs Windsurf" --limit 5

  # 4. 深度解析单篇帖子与社区高赞神评：
  node recipes/reddit-source.mjs --mode post --url "https://www.reddit.com/r/ClaudeAI/comments/..."

  # 5. 指定并记忆输出工作区目录：
  node recipes/reddit-source.mjs --out "D:\\素材\\Reddit"
`);
}

main().catch((err) => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
