#!/usr/bin/env node

/**
 * Instagram 前沿情报与创作素材探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：正文、作者、互动数据、标签、时间零删减零修改原样落盘。
 * 2. 媒体资产全量本地化：图片（单图/多图轮播）与视频（Reels/短视频）完整下载到本地 media/ 目录。
 * 3. 动态配置输出路径：无硬编码目录，优先级为 CLI --out > 记忆配置 (~/.shrimp/...) > 动态默认。
 * 4. 聚焦事实存证：本期专注事实数据与本地资产沉淀，二创由下游 Router 接力。
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
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "instagram-source-config.json");
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
  if (process.env.LEO_LANTERN_INSTAGRAM_OUT) {
    return path.resolve(process.env.LEO_LANTERN_INSTAGRAM_OUT);
  }
  return path.resolve(process.cwd(), "output", "instagram-source");
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
  const tmpFile = path.join(os.tmpdir(), `ig_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
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

// ==================== 多媒体与元数据下载引擎 ====================

async function exportCookiesIfNeeded() {
  const tmpCookieFile = path.join(os.tmpdir(), `ig_cookie_${Date.now()}.txt`);
  const res = runLantern("cookies", ["--domain=instagram.com", "--format=txt", `--out=${tmpCookieFile}`]);
  if (res.ok && res.savedTo && syncFs.existsSync(res.savedTo)) {
    return res.savedTo;
  }
  return null;
}

function fetchPostMetadataWithGalleryDl(postUrl, cookieFile) {
  const galleryDlBin = detectTool("gallery-dl");
  if (!galleryDlBin) return null;

  const args = ["-j"];
  if (cookieFile && syncFs.existsSync(cookieFile)) {
    args.push("--cookies", cookieFile);
  }
  args.push(postUrl);

  try {
    const res = spawnSync(galleryDlBin, args, { encoding: "utf8", windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    if (res.status !== 0 || !res.stdout) return null;
    
    const parsed = JSON.parse(res.stdout);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    // gallery-dl 输出为一个数组，每项是 [typeCode, metaObject]
    const entries = parsed.map(item => Array.isArray(item) ? item[item.length - 1] : item).filter(Boolean);
    const mainMeta = entries.find(e => typeof e === "object" && e.category === "instagram") || entries[0];
    
    // 搜集所有的媒体文件 URL
    const mediaUrls = [];
    for (const e of entries) {
      if (typeof e === "object") {
        if (e.video_url) mediaUrls.push(e.video_url);
        else if (e.display_url) mediaUrls.push(e.display_url);
      }
    }

    return {
      category: mainMeta.category,
      shortcode: mainMeta.shortcode || mainMeta.post_shortcode,
      postId: mainMeta.post_id || mainMeta.id,
      postUrl: mainMeta.post_url || postUrl,
      author: {
        username: mainMeta.username || (mainMeta.owner && mainMeta.owner.username) || "",
        fullname: mainMeta.fullname || (mainMeta.owner && mainMeta.owner.full_name) || "",
        profileUrl: (mainMeta.username ? `https://www.instagram.com/${mainMeta.username}/` : null),
        avatarUrl: mainMeta.profile_pic_url || (mainMeta.owner && mainMeta.owner.profile_pic_url) || null,
        isVerified: !!(mainMeta.owner && mainMeta.owner.is_verified)
      },
      publishedAt: mainMeta.date || mainMeta.post_date || null,
      caption: mainMeta.description || "",
      tags: mainMeta.tags || [],
      likes: mainMeta.likes ?? null,
      mediaCount: entries.length,
      mediaUrls
    };
  } catch (err) {
    return null;
  }
}

function downloadWithGalleryDl(targetUrl, destDir, fileNamePattern, cookieFile) {
  const galleryDlBin = detectTool("gallery-dl");
  if (!galleryDlBin) return false;

  const args = [
    "--dest", destDir,
    "-o", "directory=[]",
    "--filename", fileNamePattern,
    "--no-part"
  ];
  if (cookieFile && syncFs.existsSync(cookieFile)) {
    args.push("--cookies", cookieFile);
  }
  args.push(targetUrl);

  try {
    const res = spawnSync(galleryDlBin, args, { encoding: "utf8", windowsHide: true });
    return res.status === 0;
  } catch {
    return false;
  }
}

function downloadWithYtDlp(postUrl, destDir, destBaseName, cookieFile) {
  const ytDlpBin = detectTool("yt-dlp");
  if (!ytDlpBin) return false;

  const args = [
    "--no-warnings",
    "-P", destDir,
    "-o", `${destBaseName}.%(ext)s`
  ];
  if (cookieFile && syncFs.existsSync(cookieFile)) {
    args.push("--cookies", cookieFile);
  }
  args.push(postUrl);

  try {
    const res = spawnSync(ytDlpBin, args, { encoding: "utf8", windowsHide: true });
    return res.status === 0;
  } catch {
    return false;
  }
}

async function downloadDirectImage(imageUrl, destPath) {
  try {
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.instagram.com/"
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

// ==================== 浏览器页面交互与链接提取 ====================

const EXTRACT_FEED_POSTS_SCRIPT = `
(() => {
  const articles = Array.from(document.querySelectorAll('article'));
  const results = [];
  
  for (const art of articles) {
    // 寻找帖子链接
    const linkEl = art.querySelector('a[href*="/p/"]') || art.querySelector('a[href*="/reel/"]');
    if (!linkEl) continue;
    
    const postUrl = linkEl.href;
    const match = postUrl.match(/\\/(p|reel)\\/([A-Za-z0-9_-]+)/);
    const shortcode = match ? match[2] : '';
    if (!shortcode) continue;

    // 作者
    const authorEl = art.querySelector('header a') || art.querySelector('a[role="link"]');
    const username = authorEl ? authorEl.innerText.trim() : '';

    // 时间
    const timeEl = art.querySelector('time');
    const publishedAt = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText) : '';

    // 指标
    const spans = Array.from(art.querySelectorAll('span, button, a')).map(s => s.innerText.trim());
    const likeCandidate = spans.find(t => /^\\d[\\d,]*\\s*(万|k|次赞|次播放)?$/i.test(t) || /赞|likes/i.test(t));

    // 展开更多正文 (若有)
    try {
      const moreBtn = Array.from(art.querySelectorAll('*')).find(el => el.children.length === 0 && (el.innerText || '').includes('更多'));
      if (moreBtn) moreBtn.click();
    } catch {}

    // 正文
    const textEls = Array.from(art.querySelectorAll('h1, span[dir="auto"], div[dir="auto"]')).map(el => el.innerText.trim()).filter(Boolean);
    const caption = textEls.find(t => t.length > 15) || '';

    // 图片
    const images = Array.from(art.querySelectorAll('img'))
      .map(i => i.src)
      .filter(src => src && !src.includes('avatar') && !src.includes('s150x150'));

    results.push({
      shortcode,
      postUrl,
      username,
      publishedAt,
      likes: likeCandidate || null,
      caption,
      firstImage: images[0] || null
    });
  }

  return results;
})()
`;

const EXTRACT_GRID_LINKS_SCRIPT = `
(() => {
  const links = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
  const seen = new Set();
  const urls = [];
  for (const a of links) {
    const href = a.href;
    const match = href.match(/\\/(p|reel)\\/([A-Za-z0-9_-]+)/);
    if (match && !seen.has(match[2])) {
      seen.add(match[2]);
      urls.push({
        shortcode: match[2],
        type: match[1],
        postUrl: 'https://www.instagram.com/' + match[1] + '/' + match[2] + '/'
      });
    }
  }
  return urls;
})()
`;

// ==================== 主控执行逻辑 ====================

async function main() {
  const args = process.argv.slice(2);
  let mode = "feed";
  let username = "";
  let tag = "";
  let targetUrl = "";
  let limit = 5;
  let customOut = "";
  let downloadMedia = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--mode" || a === "-m") mode = args[++i];
    else if (a === "--username" || a === "--user" || a === "-u") username = args[++i];
    else if (a === "--tag" || a === "-t") tag = args[++i];
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
      console.log(`✅ 已持久化配置 Instagram 默认输出目录: ${saved?.output_dir}`);
      process.exit(0);
    }
    else if (a === "--get-out") {
      const cfg = loadConfig();
      console.log(`📂 当前 Instagram 默认输出目录: ${cfg.output_dir || "未设置（将动态兜底到 ./output/instagram-source）"}`);
      process.exit(0);
    }
    else if (a === "--no-media" || a === "--skip-media") downloadMedia = false;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  console.log("🚀 启动 Instagram 前沿情报与创作素材探针 (Ground Truth Extractor)...");
  console.log(`📌 模式: ${mode} | 采集上限: ${limit} | 下载媒体: ${downloadMedia ? "是" : "否"}`);

  // 1. 初始化输出根目录
  const outRoot = resolveOutputDir(customOut);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const targetTag = username ? `user_${username}` : tag ? `tag_${tag}` : mode;
  const sessionDir = path.join(outRoot, `${dateStr}-${targetTag}`);
  const mediaDir = path.join(sessionDir, "media");

  await fs.mkdir(mediaDir, { recursive: true });
  console.log(`📂 本次落盘目录: ${sessionDir}`);

  // 2. 启动 Lantern 会话并关联 Chrome
  console.log("\n🔌 正在与 Chrome 浏览器建立 Lantern CDP 连接...");
  const startRes = runLantern("start");
  if (!startRes.ok && !startRes.bridge) {
    console.error("❌ 无法连接到 Leo Lantern 服务，请确认 Chrome 扩展已开启。");
    process.exit(1);
  }

  // 检查已有标签页
  const tabsRes = runLantern("tabs");
  let claimedTabId = null;
  if (tabsRes.ok && Array.isArray(tabsRes.result)) {
    const igTab = tabsRes.result.find(t => t.url && t.url.includes("instagram.com"));
    if (igTab) claimedTabId = igTab.id;
  }

  // 启动任务
  const taskRes = runLantern("start-task", ["--title", "instagram-source", "--same-window"]);
  if (!taskRes.ok) {
    console.error("❌ 创建 Lantern 任务失败:", taskRes.error);
    process.exit(1);
  }

  if (claimedTabId) {
    runLantern("claim", ["--tabId", String(claimedTabId)]);
  }

  // 3. 提取会话 Cookie
  console.log("🍪 正在从当前 Chrome 会话导出 Instagram Cookie...");
  const cookieFile = await exportCookiesIfNeeded();
  if (cookieFile) {
    console.log(`✅ Cookie 导出就绪 (${path.basename(cookieFile)})`);
  } else {
    console.warn("⚠️ 未能导出 Cookie，公开页面仍可尝试抓取。");
  }

  // 4. 根据模式导航与搜集帖子短链接
  let collectedPosts = [];

  try {
    if (mode === "post") {
      if (!targetUrl) {
        console.error("❌ 单帖模式 (--mode post) 必须提供 --url 参数");
        process.exit(1);
      }
      const match = targetUrl.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
      const shortcode = match ? match[2] : "single_post";
      collectedPosts.push({ shortcode, postUrl: targetUrl });
    } else if (mode === "user") {
      if (!username) {
        console.error("❌ 用户模式 (--mode user) 必须提供 --username 参数");
        process.exit(1);
      }
      const userUrl = `https://www.instagram.com/${username.replace(/^@/, '')}/`;
      console.log(`🌐 正在打开博主主页: ${userUrl}`);
      runLantern("goto", [userUrl]);
      await sleep(3500);

      const gridRes = runLanternEval(EXTRACT_GRID_LINKS_SCRIPT);
      const links = (gridRes.ok && Array.isArray(gridRes.evalResult)) ? gridRes.evalResult : [];
      collectedPosts = links.slice(0, limit);
    } else if (mode === "tag") {
      if (!tag) {
        console.error("❌ 话题模式 (--mode tag) 必须提供 --tag 参数");
        process.exit(1);
      }
      const tagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
      console.log(`🌐 正在打开话题页面: ${tagUrl}`);
      runLantern("goto", [tagUrl]);
      await sleep(3500);

      const gridRes = runLanternEval(EXTRACT_GRID_LINKS_SCRIPT);
      const links = (gridRes.ok && Array.isArray(gridRes.evalResult)) ? gridRes.evalResult : [];
      collectedPosts = links.slice(0, limit);
    } else if (mode === "explore") {
      console.log("🌐 正在打开 Instagram 探索页...");
      runLantern("goto", ["https://www.instagram.com/explore/"]);
      await sleep(3500);

      const gridRes = runLanternEval(EXTRACT_GRID_LINKS_SCRIPT);
      const links = (gridRes.ok && Array.isArray(gridRes.evalResult)) ? gridRes.evalResult : [];
      collectedPosts = links.slice(0, limit);
    } else {
      // 默认 feed 模式
      console.log("🌐 正在抓取当前主页信息流 (Feed)...");
      const currentUrl = tabsRes.ok && claimedTabId ? (tabsRes.result.find(t => t.id === claimedTabId)?.url || "") : "";
      if (!currentUrl.includes("instagram.com")) {
        runLantern("goto", ["https://www.instagram.com/"]);
        await sleep(3000);
      }

      // 滚动搜集足够数量的帖子
      const seenCodes = new Set();
      let scrollAttempts = 0;
      while (collectedPosts.length < limit && scrollAttempts < 10) {
        const feedRes = runLanternEval(EXTRACT_FEED_POSTS_SCRIPT);
        if (feedRes.ok && Array.isArray(feedRes.evalResult)) {
          for (const item of feedRes.evalResult) {
            if (!seenCodes.has(item.shortcode)) {
              seenCodes.add(item.shortcode);
              collectedPosts.push(item);
              if (collectedPosts.length >= limit) break;
            }
          }
        }
        if (collectedPosts.length >= limit) break;
        scrollAttempts++;
        runLanternEval("window.scrollBy(0, 1200);");
        await sleep(1800);
      }
    }
  } finally {
    // 结束 Agent 任务，保持浏览器正常状态
    runLantern("end-task");
  }

  console.log(`\n📦 共获取到 ${collectedPosts.length} 条待解析帖子，开始提取 100% 事实元数据与下载媒体...`);

  // 5. 循环解析每条帖子的事实数据与下载媒体
  const finalPosts = [];
  let totalMediaFiles = 0;

  for (let i = 0; i < collectedPosts.length; i++) {
    const rawPost = collectedPosts[i];
    const postIdx = String(i + 1).padStart(2, "0");
    const shortcode = rawPost.shortcode;
    const postUrl = rawPost.postUrl || `https://www.instagram.com/p/${shortcode}/`;

    console.log(`\n[${i + 1}/${collectedPosts.length}] 正在解析帖子: ${postUrl}`);

    // 使用 gallery-dl 提取高精度 JSON 元数据
    const meta = fetchPostMetadataWithGalleryDl(postUrl, cookieFile);
    
    const author = meta?.author?.username ? meta.author : {
      username: rawPost.username || "unknown",
      fullname: "",
      profileUrl: rawPost.username ? `https://www.instagram.com/${rawPost.username}/` : null,
      avatarUrl: null,
      isVerified: false
    };

    const publishedAt = meta?.publishedAt || rawPost.publishedAt || null;
    const caption = meta?.caption || rawPost.caption || "";
    const tags = meta?.tags && meta.tags.length > 0 ? meta.tags : (caption.match(/#[^\s#]+/g) || []);
    const metrics = {
      likes: meta?.likes ?? rawPost.likes ?? null,
      mediaCount: meta?.mediaCount || (rawPost.firstImage ? 1 : 0)
    };

    // 下载媒体文件
    const localMediaFiles = [];
    if (downloadMedia) {
      console.log(`  📥 正在下载媒体资产到本地...`);
      const filePattern = `ig_${postIdx}_${shortcode}_{num}.{extension}`;
      
      const dlOk = downloadWithGalleryDl(postUrl, mediaDir, filePattern, cookieFile);
      
      // 扫描本次下载落盘的文件
      const allFiles = syncFs.readdirSync(mediaDir);
      const postFiles = allFiles.filter(f => f.startsWith(`ig_${postIdx}_${shortcode}`));

      // 若未下载成功且为视频帖，使用 yt-dlp 兜底
      if (postFiles.length === 0) {
        const ytdlBase = `ig_${postIdx}_${shortcode}`;
        downloadWithYtDlp(postUrl, mediaDir, ytdlBase, cookieFile);
        const refreshedFiles = syncFs.readdirSync(mediaDir);
        const ytdlFiles = refreshedFiles.filter(f => f.startsWith(ytdlBase));
        postFiles.push(...ytdlFiles);
      }

      // 若依然没有，且 DOM 中保留了首图，直接 fetch 兜底
      if (postFiles.length === 0 && rawPost.firstImage) {
        const fallbackName = `ig_${postIdx}_${shortcode}_fallback.jpg`;
        const fallbackPath = path.join(mediaDir, fallbackName);
        const directOk = await downloadDirectImage(rawPost.firstImage, fallbackPath);
        if (directOk) postFiles.push(fallbackName);
      }

      for (const f of postFiles) {
        const stat = syncFs.statSync(path.join(mediaDir, f));
        localMediaFiles.push({
          file_name: f,
          relative_path: `media/${f}`,
          size_bytes: stat.size,
          size_formatted: formatBytes(stat.size)
        });
        totalMediaFiles++;
      }
      console.log(`  ✅ 已落地 ${localMediaFiles.length} 个媒体文件`);
    }

    finalPosts.push({
      index: i + 1,
      shortcode,
      post_url: postUrl,
      author,
      published_at: publishedAt,
      caption,
      tags,
      metrics,
      media_files: localMediaFiles
    });
  }

  // 6. 落盘 帖子事实.json
  const groundTruthJson = {
    fetched_at: now.toISOString(),
    platform: "Instagram",
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

  console.log(`\n🎉 Instagram 探针抓取完成！共收集 ${finalPosts.length} 条事实帖子，${totalMediaFiles} 个本地媒体文件。`);
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
    `# Instagram 帖子事实沉淀 (${data.target})`,
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
    lines.push(`## 帖子 ${String(p.index).padStart(2, "0")}：@${p.author.username || "unknown"} (${p.shortcode})`);
    lines.push("");
    lines.push(`- **帖子链接**：${p.post_url}`);
    lines.push(`- **博主全名**：${p.author.fullname || p.author.username || "无"}`);
    lines.push(`- **发布时间**：${p.published_at || "未知"}`);
    lines.push(`- **点赞互动**：${p.metrics.likes ?? "未公开/未知"}`);
    lines.push("");
    
    lines.push("### 📝 原文事实 (Caption)");
    lines.push("");
    if (p.caption) {
      lines.push("```text");
      lines.push(p.caption);
      lines.push("```");
    } else {
      lines.push("*（该帖子无文字描述）*");
    }
    lines.push("");

    if (p.tags && p.tags.length > 0) {
      lines.push("### 🏷️ 原始标签 (Hashtags)");
      lines.push("");
      lines.push(p.tags.join(" "));
      lines.push("");
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
Instagram 前沿情报与创作素材探针 (Ground Truth Extractor)

用法:
  node recipes/instagram-source.mjs [选项]

模式与选项:
  --mode, -m <feed|user|tag|explore|post>   抓取模式 (默认: feed)
  --user, --username, -u <id>              指定 Instagram 博主用户名 (用于 user 模式)
  --tag, -t <name>                         指定 Hashtag 标签名称 (用于 tag 模式)
  --url <link>                             指定单篇帖子或 Reels 链接 (用于 post 模式)
  --limit, -n <num>                        抓取数量上限 (默认: 5)
  --out, --out-dir, -o <path>              指定素材落地目录 (默认: D:\\素材\\Instagram，配置将持久化记忆)
  --set-out <path>                         单独持久化设置默认输出目录并退出
  --get-out                                查看当前配置的持久化输出目录
  --skip-media, --no-media                 仅抓取正文与指标，不下载媒体文件
  --help, -h                               显示本帮助

示例:
  # 1. 抓取当前主页关注/推荐流最新 3 篇
  node recipes/instagram-source.mjs --mode feed --limit 3

  # 2. 抓取指定博主主页的最新 5 篇
  node recipes/instagram-source.mjs --mode user --username openai --limit 5

  # 3. 抓取指定标签探索流
  node recipes/instagram-source.mjs --mode tag --tag generativeai --limit 5

  # 4. 深度解析单篇帖子并下载全部轮播原图或短视频
  node recipes/instagram-source.mjs --mode post --url "https://www.instagram.com/p/DeHeOpaTKQS/"

  # 5. 指定并记忆输出工作区目录
  node recipes/instagram-source.mjs --out "D:\\素材\\Instagram"
`);
}

main().catch((err) => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
