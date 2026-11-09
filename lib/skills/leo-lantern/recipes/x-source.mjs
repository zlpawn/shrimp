#!/usr/bin/env node

/**
 * X (Twitter) 前沿情报与创作素材探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：正文、作者、互动数据、时间零删减零修改原样落盘。
 * 2. 媒体资产全量本地化：图片（支持 direct fetch + gallery-dl 兜底）与视频（yt-dlp）全部下载到本地。
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
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "x-source-config.json");
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
  if (process.env.LEO_LANTERN_X_OUT) {
    return path.resolve(process.env.LEO_LANTERN_X_OUT);
  }
  // 动态兜底路径
  return path.resolve(process.cwd(), "output", "x-source");
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
  const tmpFile = path.join(os.tmpdir(), `x_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
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
  const tmpCookieFile = path.join(os.tmpdir(), `x_cookie_${Date.now()}.txt`);
  const res = runLantern("cookies", ["--domain=x.com", "--format=txt", `--out=${tmpCookieFile}`]);
  if (res.ok && res.savedTo && syncFs.existsSync(res.savedTo)) {
    return res.savedTo;
  }
  return null;
}

async function downloadDirectImage(imageUrl, destPath) {
  try {
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://x.com/"
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

function downloadWithYtDlp(tweetUrl, destDir, destBaseName, cookieFile) {
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
  args.push(tweetUrl);

  try {
    const res = spawnSync(ytDlpBin, args, { encoding: "utf8", windowsHide: true });
    return res.status === 0;
  } catch {
    return false;
  }
}

// ==================== 页面解析脚本 (在 Chrome 中执行) ====================

const EXTRACT_TWEETS_SCRIPT = `
(() => {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  return articles.map(art => {
    // 过滤广告 / 赞助帖
    const isAd = art.innerHTML.includes('广告') || 
                 art.innerHTML.includes('Promoted') || 
                 !!art.querySelector('[data-testid="placementTracking"]');

    // 1. 用户信息提取
    const userNames = Array.from(art.querySelectorAll('[data-testid="User-Name"]'));
    const mainUserEl = userNames[0];
    const authorName = mainUserEl ? (mainUserEl.querySelector('span')?.innerText || mainUserEl.innerText.split('\\n')[0]).trim() : '';
    const handleMatch = mainUserEl ? mainUserEl.innerText.match(/@[a-zA-Z0-9_]+/) : null;
    const authorHandle = handleMatch ? handleMatch[0] : '';
    const isVerified = !!art.querySelector('svg[data-testid="icon-verified"]');
    
    const avatarImg = art.querySelector('div[data-testid*="UserAvatar"] img') || 
                      art.querySelector('[data-testid="Tweet-User-Avatar"] img') || 
                      art.querySelector('img[src*="profile_images"]');
    const avatarUrl = avatarImg ? avatarImg.src : null;
    const profileLink = mainUserEl ? mainUserEl.querySelector('a') : null;
    const profileUrl = profileLink ? profileLink.href : (authorHandle ? 'https://x.com/' + authorHandle.replace('@', '') : null);
    
    // 2. 推文链接与 ID
    const statusLinks = Array.from(art.querySelectorAll('a[href*="/status/"]')).map(a => a.href);
    const mainStatusUrl = statusLinks.find(l => !l.includes('/photo/') && !l.includes('/video/') && !l.includes('/analytics')) || statusLinks[0] || '';
    const idMatch = mainStatusUrl.match(/\\/status\\/(\\d+)/);
    const tweetId = idMatch ? idMatch[1] : '';
    
    // 3. 发布时间 (ISO 8601)
    const timeEl = art.querySelector('time');
    const publishedAt = timeEl ? timeEl.getAttribute('datetime') : null;
    
    // 4. 正文与引用推文
    const tweetTextEls = Array.from(art.querySelectorAll('[data-testid="tweetText"]'));
    const rawText = tweetTextEls[0] ? tweetTextEls[0].innerText : '';
    
    let quotedTweet = null;
    if (tweetTextEls.length > 1 || userNames.length > 1) {
      const qUserEl = userNames[1];
      const qHandleMatch = qUserEl ? qUserEl.innerText.match(/@[a-zA-Z0-9_]+/) : null;
      const qStatusLink = statusLinks.find(l => tweetId && !l.includes(tweetId));
      quotedTweet = {
        author: qUserEl ? qUserEl.innerText.split('\\n')[0].trim() : '',
        handle: qHandleMatch ? qHandleMatch[0] : '',
        rawText: tweetTextEls[1] ? tweetTextEls[1].innerText : '',
        url: qStatusLink || ''
      };
    }
    
    // 5. 互动指标 (replies, reposts, likes, bookmarks, views)
    const groupEl = art.querySelector('[role="group"]');
    const rawMetrics = groupEl ? (groupEl.getAttribute('aria-label') || groupEl.innerText.replace(/\\n+/g, ' ')) : '';
    
    const parseNum = (str, pattern) => {
      const m = str.match(pattern);
      if (!m) return 0;
      return parseInt(m[1].replace(/,/g, ''), 10) || 0;
    };
    
    const replies = parseNum(rawMetrics, /(\\d[\\d,]*)\\s*(?:回复|replies|reply)/i);
    const reposts = parseNum(rawMetrics, /(\\d[\\d,]*)\\s*(?:次转帖|reposts|repost|retweets)/i);
    const likes = parseNum(rawMetrics, /(\\d[\\d,]*)\\s*(?:喜欢|likes|like)/i);
    const bookmarks = parseNum(rawMetrics, /(\\d[\\d,]*)\\s*(?:书签|bookmarks|bookmark)/i);
    const views = parseNum(rawMetrics, /(\\d[\\d,]*)\\s*(?:次观看|views|view)/i);
    
    // 6. 媒体元素标记与提取 (支持照片链接、图片标签与视频标记)
    const hasPhotoLink = statusLinks.some(l => l.includes('/photo/'));
    const photoImgs = Array.from(art.querySelectorAll('[data-testid="tweetPhoto"] img, [aria-label="Image"] img, img[src*="pbs.twimg.com/media/"]'));
    const images = photoImgs.map(img => {
      let src = img.src;
      if (src.includes('name=')) {
        src = src.replace(/name=[a-zA-Z0-9_]+/, 'name=orig');
      } else if (src.includes('?')) {
        src += '&name=orig';
      }
      return src;
    }).filter((v, i, a) => a.indexOf(v) === i);
    
    const hasVideo = !!art.querySelector('video') || 
                     art.innerHTML.includes('amplify_video_thumb') || 
                     statusLinks.some(l => l.includes('/video/'));
    
    const hasImage = hasPhotoLink || images.length > 0;
    
    return {
      id: tweetId,
      url: mainStatusUrl,
      isAd,
      author: {
        name: authorName,
        handle: authorHandle,
        verified: isVerified,
        avatar: avatarUrl,
        profileUrl
      },
      publishedAt,
      rawText,
      metrics: {
        replies,
        reposts,
        likes,
        bookmarks,
        views,
        rawMetrics
      },
      quotedTweet,
      media: {
        hasImage,
        images,
        hasVideo
      }
    };
  }).filter(t => !t.isAd && t.id && t.url);
})()
`;

// ==================== 主逻辑调度 ====================

async function main() {
  const args = process.argv.slice(2);
  const parsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--set-out") {
      const target = args[++i];
      if (!target) {
        console.error("❌ 请提供目标路径: --set-out <path>");
        process.exit(1);
      }
      const saved = saveConfig({ output_dir: path.resolve(target) });
      console.log(`✅ 已持久化设置输出目录: ${saved.output_dir}`);
      process.exit(0);
    }
    if (arg === "--get-out") {
      const cfg = loadConfig();
      console.log(`📁 当前配置的输出目录: ${cfg.output_dir || "(未设置，使用默认)"}`);
      process.exit(0);
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key.includes("=")) {
        const [k, v] = key.split("=");
        parsedArgs[k] = v;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        parsedArgs[key] = args[++i];
      } else {
        parsedArgs[key] = true;
      }
    } else if (arg.startsWith("-")) {
      const k = arg.slice(1);
      if (k === "m") parsedArgs.mode = args[++i];
      else if (k === "q") parsedArgs.query = args[++i];
      else if (k === "u") parsedArgs.user = args[++i];
      else if (k === "n") parsedArgs.limit = parseInt(args[++i], 10);
      else if (k === "o") parsedArgs.out = args[++i];
      else if (k === "t") parsedArgs.type = args[++i];
    }
  }

  const mode = parsedArgs.mode || "following"; // 'following' | 'search' | 'user' | 'for-you'
  const query = parsedArgs.query || "";
  const user = parsedArgs.user || "";
  const searchType = parsedArgs.type || "top"; // 'top' | 'latest'
  const limit = parseInt(parsedArgs.limit || "10", 10);
  const skipMedia = Boolean(parsedArgs["skip-media"]);
  const maxScrolls = parseInt(parsedArgs["scroll-max"] || "15", 10);

  const baseOutputDir = resolveOutputDir(parsedArgs.out);
  console.log(`🚀 Leo Lantern X 事实探针启动`);
  console.log(`📁 基础输出目录: ${baseOutputDir}`);
  console.log(`🎯 采集模式: ${mode} (目标数量: ${limit})`);

  // 1. 确保桥接可用
  const startRes = runLantern("start");
  if (!startRes.ok && !startRes.bridge) {
    console.error("❌ 无法连接到 Leo Lantern 桥接，请确认 Chrome 浏览器及扩展已打开。");
    process.exit(1);
  }

  // 2. 检查并接管已有 X 标签页或开新任务
  const tabsRes = runLantern("tabs");
  const openTabs = tabsRes.result || [];
  const existingXTab = openTabs.find((t) => t.url && (t.url.includes("x.com") || t.url.includes("twitter.com")));

  // 开启独立任务组
  const taskRes = runLantern("start-task", ["--title=x-source", "--same-window=true"]);
  if (!taskRes.ok) {
    console.error("❌ 创建浏览器任务失败:", taskRes.error);
    process.exit(1);
  }

  if (existingXTab) {
    console.log(`🔗 发现已有 X 标签页 (TabID: ${existingXTab.id})，进行复用接管...`);
    runLantern("claim", [`--tabId=${existingXTab.id}`]);
  }

  // 3. 导航至目标页面
  let slug = "";
  if (mode === "following") {
    slug = "following";
    console.log("🧭 正在前往关注流...");
    runLantern("goto", ["https://x.com/home"]);
    await sleep(2500);
    // 切换至“正在关注”Tab
    runLantern("click", ['--text="正在关注"']);
    await sleep(2000);
  } else if (mode === "for-you") {
    slug = "for-you";
    console.log("🧭 正在前往为你推荐流...");
    runLantern("goto", ["https://x.com/home"]);
    await sleep(2500);
    runLantern("click", ['--text="为你推荐"']);
    await sleep(2000);
  } else if (mode === "search") {
    if (!query) {
      console.error("❌ search 模式必须提供 --query 参数");
      process.exit(1);
    }
    const cleanSlug = query.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_").slice(0, 30);
    slug = `search-${cleanSlug}`;
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&f=${searchType === "latest" ? "live" : "top"}`;
    console.log(`🧭 正在导航至搜索: ${query} (${searchType})...`);
    runLantern("goto", [searchUrl]);
    await sleep(3500);
  } else if (mode === "user") {
    if (!user) {
      console.error("❌ user 模式必须提供 --user 参数 (例如: --user sama)");
      process.exit(1);
    }
    const cleanUser = user.replace("@", "");
    slug = `user-${cleanUser}`;
    const userUrl = `https://x.com/${cleanUser}`;
    console.log(`🧭 正在导航至用户主页: @${cleanUser}...`);
    runLantern("goto", [userUrl]);
    await sleep(3500);
  }

  // 4. 滚动并采集推文
  console.log(`🔍 正在扫描页面提取推文数据...`);
  const collectedMap = new Map();
  let scrolls = 0;
  let stagnantCount = 0;

  while (collectedMap.size < limit && scrolls < maxScrolls) {
    const evalRes = runLanternEval(EXTRACT_TWEETS_SCRIPT);
    const tweets = (evalRes && evalRes.ok && Array.isArray(evalRes.evalResult)) ? evalRes.evalResult : [];

    let newFound = 0;
    for (const tw of tweets) {
      if (!collectedMap.has(tw.id)) {
        collectedMap.set(tw.id, tw);
        newFound++;
        if (collectedMap.size >= limit) break;
      }
    }

    console.log(`📊 已收集: ${collectedMap.size}/${limit} 条 (当前批次新增: ${newFound})`);
    if (collectedMap.size >= limit) break;

    if (newFound === 0) {
      stagnantCount++;
      if (stagnantCount >= 4) {
        console.log("ℹ️ 连续多次滚动未发现新推文，到达流末尾或加载较慢，停止滚动。");
        break;
      }
    } else {
      stagnantCount = 0;
    }

    // 滚动页面
    runLanternEval("window.scrollBy(0, 1200)");
    scrolls++;
    await sleep(1800);
  }

  const finalTweets = Array.from(collectedMap.values()).slice(0, limit);
  console.log(`\n🎉 成功提取 ${finalTweets.length} 条推文事实数据！开始处理资产与落盘...\n`);

  // 5. 准备输出目录
  const dateStr = new Date().toISOString().slice(0, 10);
  const sessionDirName = `${dateStr}-${slug}`;
  const targetDir = path.join(baseOutputDir, sessionDirName);
  const mediaDir = path.join(targetDir, "media");

  await fs.mkdir(mediaDir, { recursive: true });

  // 6. 下载媒体文件 (若未跳过)
  let cookieFile = null;
  if (!skipMedia) {
    console.log("📦 导出当前登录 Cookie 供媒体下载引擎联动使用...");
    cookieFile = await exportCookiesIfNeeded();
  }

  for (let i = 0; i < finalTweets.length; i++) {
    const tw = finalTweets[i];
    const indexStr = String(i + 1).padStart(2, "0");
    tw.localMedia = [];

    if (skipMedia) continue;

    // 处理图片下载
    if (tw.media?.hasImage) {
      let downloadedCount = 0;
      const imgs = tw.media?.images || [];

      // 方案 A: 尝试直接下载已捕获的 pbs.twimg.com 链接
      for (let imgIdx = 0; imgIdx < imgs.length; imgIdx++) {
        const imgUrl = imgs[imgIdx];
        const ext = imgUrl.includes("format=png") ? "png" : "jpg";
        const fileName = `tw_${indexStr}_${tw.id}_img_${imgIdx + 1}.${ext}`;
        const destPath = path.join(mediaDir, fileName);
        const relPath = path.join("media", fileName).replace(/\\/g, "/");

        const ok = await downloadDirectImage(imgUrl, destPath);
        if (ok) {
          downloadedCount++;
          console.log(`  🖼️ [${indexStr}] 直链原图下载成功: ${fileName}`);
          tw.localMedia.push({
            type: "image",
            remoteUrl: imgUrl,
            localPath: relPath,
            status: "success"
          });
        }
      }

      // 方案 B: 若直链未捕获或下载失败，通过 gallery-dl 兜底提取原帖全量图集
      if (downloadedCount === 0) {
        console.log(`  🖼️ [${indexStr}] 尝试通过 gallery-dl 采集推文高清原图...`);
        const pattern = `tw_${indexStr}_${tw.id}_img_{num}.{extension}`;
        const ok = downloadWithGalleryDl(tw.url, mediaDir, pattern, cookieFile);
        if (ok) {
          try {
            const files = syncFs.readdirSync(mediaDir);
            const prefix = `tw_${indexStr}_${tw.id}_img_`;
            const matched = files.filter(f => f.startsWith(prefix));
            for (const f of matched) {
              const relPath = path.join("media", f).replace(/\\/g, "/");
              tw.localMedia.push({
                type: "image",
                remoteUrl: tw.url,
                localPath: relPath,
                status: "success"
              });
              console.log(`  🖼️ [${indexStr}] gallery-dl 保存图片成功: ${f}`);
            }
          } catch {}
        }
      }
    }

    // 处理视频下载 (通过 yt-dlp)
    if (tw.media?.hasVideo) {
      const baseName = `tw_${indexStr}_${tw.id}_video`;
      console.log(`  🎬 [${indexStr}] 检测到推文视频，正在通过 yt-dlp 抓取...`);
      const ok = downloadWithYtDlp(tw.url, mediaDir, baseName, cookieFile);

      // 探测实际生成的文件名 (mp4 / mkv / webm 等)
      if (ok) {
        try {
          const files = syncFs.readdirSync(mediaDir);
          const found = files.find((f) => f.startsWith(baseName));
          if (found) {
            const relPath = path.join("media", found).replace(/\\/g, "/");
            tw.localMedia.push({
              type: "video",
              remoteUrl: tw.url,
              localPath: relPath,
              status: "success"
            });
            console.log(`  🎬 [${indexStr}] yt-dlp 保存视频成功: ${found}`);
          }
        } catch {}
      }
    }
  }

  // 清理临时 Cookie 文件
  if (cookieFile && syncFs.existsSync(cookieFile)) {
    try { syncFs.unlinkSync(cookieFile); } catch {}
  }

  // 7. 生成【帖子事实.json】
  const factsJson = {
    metadata: {
      source: "x.com",
      mode,
      query: query || null,
      user: user || null,
      capturedAt: new Date().toISOString(),
      totalTweets: finalTweets.length,
      outputDir: targetDir
    },
    tweets: finalTweets.map((t, idx) => ({
      index: idx + 1,
      id: t.id,
      url: t.url,
      author: {
        name: t.author.name,
        handle: t.author.handle,
        verified: t.author.verified,
        profileUrl: t.author.profileUrl,
        avatar: t.author.avatar
      },
      publishedAt: t.publishedAt,
      rawText: t.rawText,
      metrics: {
        replies: t.metrics.replies,
        reposts: t.metrics.reposts,
        likes: t.metrics.likes,
        bookmarks: t.metrics.bookmarks,
        views: t.metrics.views,
        rawString: t.metrics.rawMetrics
      },
      quotedTweet: t.quotedTweet,
      mediaSummary: {
        hasImage: t.media?.hasImage || false,
        hasVideo: t.media?.hasVideo || false
      },
      localMedia: t.localMedia || []
    }))
  };

  const jsonOutPath = path.join(targetDir, "帖子事实.json");
  await fs.writeFile(jsonOutPath, JSON.stringify(factsJson, null, 2), "utf8");

  // 8. 生成【帖子事实.md】
  let mdContent = `# X (Twitter) 帖子事实档案 (Ground Truth)\n\n`;
  mdContent += `> **采集时间**：${new Date().toLocaleString("zh-CN")}\n`;
  mdContent += `> **采集模式**：\`${mode}\`${query ? ` (关键词: \`${query}\`)` : ""}${user ? ` (用户: \`@${user}\`)` : ""}\n`;
  mdContent += `> **推文总数**：${finalTweets.length} 条\n`;
  mdContent += `> **存储目录**：\`${targetDir}\`\n\n`;
  mdContent += `---\n\n`;

  for (let i = 0; i < finalTweets.length; i++) {
    const t = finalTweets[i];
    const m = t.metrics;
    mdContent += `## #${i + 1} ${t.author.name} (${t.author.handle})${t.author.verified ? " ☑️" : ""}\n\n`;
    mdContent += `- 🔗 **原始链接**：[查看推文](${t.url})\n`;
    mdContent += `- 🕒 **发布时间**：\`${t.publishedAt || "未知"}\`\n`;
    mdContent += `- 📊 **事实数据**：💬 回复 \`${m.replies.toLocaleString()}\` · 🔁 转帖 \`${m.reposts.toLocaleString()}\` · ❤️ 点赞 \`${m.likes.toLocaleString()}\` · 🔖 书签 \`${m.bookmarks.toLocaleString()}\` · 👁️ 浏览 \`${m.views.toLocaleString()}\`\n\n`;

    mdContent += `### 📝 原文事实内容\n\n`;
    mdContent += `\`\`\`text\n${t.rawText.trim() || "(无纯文本，仅媒体或引用)"}\n\`\`\`\n\n`;

    if (t.quotedTweet) {
      mdContent += `> 📌 **引用推文事实**：\n`;
      mdContent += `> **作者**：${t.quotedTweet.author} (${t.quotedTweet.handle})\n`;
      if (t.quotedTweet.url) mdContent += `> **链接**：${t.quotedTweet.url}\n`;
      mdContent += `>\n> ${t.quotedTweet.rawText.replace(/\n/g, "\n> ")}\n\n`;
    }

    if (t.localMedia && t.localMedia.length > 0) {
      mdContent += `### 📁 本地多媒体资产 (${t.localMedia.length} 个)\n\n`;
      for (const media of t.localMedia) {
        if (media.status === "success" && media.localPath) {
          if (media.type === "image") {
            mdContent += `- 📷 本地原图: \`${media.localPath}\`\n\n  ![](${media.localPath})\n\n`;
          } else if (media.type === "video") {
            mdContent += `- 🎬 本地视频: \`${media.localPath}\` (可在二创时直接作为剪辑素材)\n\n`;
          }
        } else {
          mdContent += `- ⚠️ 媒体文件下载失败: ${media.remoteUrl}\n\n`;
        }
      }
    }

    mdContent += `---\n\n`;
  }

  const mdOutPath = path.join(targetDir, "帖子事实.md");
  await fs.writeFile(mdOutPath, mdContent, "utf8");

  console.log(`\n======================================================`);
  console.log(`✅ 采集归档完成！产物已落盘至目标工作区：`);
  console.log(`📁 目录: ${targetDir}`);
  console.log(`📄 事实文档: ${mdOutPath}`);
  console.log(`📋 机器数据: ${jsonOutPath}`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
