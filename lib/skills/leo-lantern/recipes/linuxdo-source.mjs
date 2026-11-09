#!/usr/bin/env node

/**
 * LINUX DO 前沿快讯与社区硬核技术事实探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：保留楼主原文、代码块、数据指标（浏览量/点赞数/回复量）及高赞解答楼层。
 * 2. 媒体资产全量本地化：帖子插图并发下载至本地 media/ 目录（支持 direct fetch + gallery-dl 兜底）。
 * 3. 动态配置输出路径：无硬编码目录，优先级为 CLI --out > 记忆配置 (~/.shrimp/...) > 动态默认。
 * 4. 聚焦事实存证：本期专注事实数据与本地资产沉淀，二创留给下游 Router 接力。
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
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "linuxdo-source-config.json");
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
  if (process.env.LEO_LANTERN_LINUXDO_OUT) {
    return path.resolve(process.env.LEO_LANTERN_LINUXDO_OUT);
  }
  // 动态兜底路径
  return path.resolve(process.cwd(), "output", "linuxdo-source");
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
  const tmpFile = path.join(os.tmpdir(), `ld_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
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

// ==================== 工具探测 (gallery-dl) ====================

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
  const tmpCookieFile = path.join(os.tmpdir(), `linuxdo_cookie_${Date.now()}.txt`);
  const res = runLantern("cookies", ["--domain=linux.do", "--format=txt", `--out=${tmpCookieFile}`]);
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
        "Referer": "https://linux.do/"
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

// ==================== DOM 解析脚本 (在 Chrome 中执行) ====================

const EXTRACT_TOPIC_LIST_SCRIPT = `
(() => {
  const rows = Array.from(document.querySelectorAll('tr.topic-list-item'));
  return rows.map(r => {
    const link = r.querySelector('a.title, a.raw-topic-link');
    const postsEl = r.querySelector('.posts, .num.posts');
    const viewsEl = r.querySelector('.views, .num.views');
    const activityEl = r.querySelector('.activity');
    const tags = Array.from(r.querySelectorAll('.discourse-tag')).map(t => t.innerText.trim());
    
    const title = link ? link.innerText.trim() : '';
    const href = link ? link.href : '';
    const idMatch = href.match(/\\/t\\/(?:[^\\/]+\\/)?(\\d+)/);
    const topicId = idMatch ? idMatch[1] : '';

    return {
      id: topicId,
      title,
      url: href,
      replies: postsEl ? postsEl.innerText.trim() : '0',
      views: viewsEl ? viewsEl.innerText.trim() : '0',
      activity: activityEl ? activityEl.innerText.trim() : '',
      tags
    };
  }).filter(t => t.id && t.title && !t.title.startsWith('关于“'));
})()
`;

const EXTRACT_POST_DETAIL_SCRIPT = `
(() => {
  const p1 = document.querySelector('#post_1, .topic-post:first-child');
  if (!p1) return null;

  const cooked = p1.querySelector('.cooked');
  const user = p1.querySelector('.names, .username');
  const time = p1.querySelector('time');
  const likesEl = p1.querySelector('.like-count');

  // 提取高清原图链接 (优先提取 /original/ 原版，或从 /optimized/ 升阶)
  const links = Array.from(p1.querySelectorAll('.cooked a')).map(a => a.href);
  const origLinks = links.filter(l => l.includes('/original/'));
  
  const imgs = Array.from(p1.querySelectorAll('.cooked img')).map(img => {
    let src = img.src || img.getAttribute('data-orig-src') || '';
    if (src.includes('/optimized/')) {
      // 升阶为无损原图
      src = src.replace('/optimized/', '/original/').replace(/_\\d+_\\d+x\\d+\\./, '.');
    }
    return src;
  }).filter(src => src && !src.includes('/images/emoji/') && !src.includes('avatar'));

  const allImages = Array.from(new Set([...origLinks, ...imgs]));

  // 提取高赞回复 (赞数 >= 1 的优质讨论楼层)
  const otherPosts = Array.from(document.querySelectorAll('.topic-post')).slice(1);
  const topReplies = otherPosts.map(p => {
    const u = p.querySelector('.names, .username');
    const textEl = p.querySelector('.cooked');
    const lEl = p.querySelector('.like-count');
    const likes = lEl ? parseInt(lEl.innerText.trim() || '0', 10) || 0 : 0;
    return {
      user: u ? u.innerText.replace(/\\n+/g, ' ').trim() : '匿名',
      likes,
      text: textEl ? textEl.innerText.trim() : ''
    };
  }).filter(r => r.text && r.text.length > 5).sort((a, b) => b.likes - a.likes).slice(0, 3);

  return {
    author: user ? user.innerText.replace(/\\n+/g, ' ').trim() : '未知',
    publishedAt: time ? time.getAttribute('datetime') : null,
    likes: likesEl ? likesEl.innerText.trim() : '0',
    rawText: cooked ? cooked.innerText.trim() : '',
    images: allImages,
    topReplies
  };
})()
`;

// ==================== 主流程调度 ====================

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
      console.log(`✅ 已持久化设置 LINUX DO 输出目录: ${saved.output_dir}`);
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
      if (k === "c") parsedArgs.channel = args[++i];
      else if (k === "q") parsedArgs.query = args[++i];
      else if (k === "n") parsedArgs.limit = parseInt(args[++i], 10);
      else if (k === "o") parsedArgs.out = args[++i];
    }
  }

  const channel = parsedArgs.channel || "news"; // 'news' | 'hot' | 'top' | 'latest'
  const query = parsedArgs.query || "";
  const limit = parseInt(parsedArgs.limit || "5", 10);
  const skipMedia = Boolean(parsedArgs["skip-media"]);

  const baseOutputDir = resolveOutputDir(parsedArgs.out);
  console.log(`🚀 Leo Lantern LINUX DO 事实探针启动`);
  console.log(`📁 基础输出目录: ${baseOutputDir}`);
  console.log(`🎯 目标频道/查询: ${query ? `搜索[${query}]` : channel} (目标数量: ${limit})`);

  // 1. 确保桥接服务可用
  const startRes = runLantern("start");
  if (!startRes.ok && !startRes.bridge) {
    console.error("❌ 无法连接到 Leo Lantern 桥接，请确认 Chrome 浏览器及扩展已打开。");
    process.exit(1);
  }

  // 2. 检查并接管已有 LINUX DO 标签页或开新任务
  const tabsRes = runLantern("tabs");
  const openTabs = tabsRes.result || [];
  const existingTab = openTabs.find((t) => t.url && t.url.includes("linux.do"));

  const taskRes = runLantern("start-task", ["--title=linuxdo-source", "--same-window=true"]);
  if (!taskRes.ok) {
    console.error("❌ 创建浏览器任务失败:", taskRes.error);
    process.exit(1);
  }

  if (existingTab) {
    console.log(`🔗 发现已有 LINUX DO 标签页 (TabID: ${existingTab.id})，进行复用接管...`);
    runLantern("claim", [`--tabId=${existingTab.id}`]);
  }

  // 3. 构造访问路由
  let targetUrl = "https://linux.do/c/news/34/l/hot";
  let slug = "news";

  if (query) {
    const cleanQuery = query.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_").slice(0, 30);
    slug = `search-${cleanQuery}`;
    targetUrl = `https://linux.do/search?q=${encodeURIComponent(query)}`;
  } else if (channel === "hot") {
    slug = "hot";
    targetUrl = "https://linux.do/hot";
  } else if (channel === "top") {
    slug = "top";
    targetUrl = "https://linux.do/top";
  } else if (channel === "latest") {
    slug = "latest";
    targetUrl = "https://linux.do/latest";
  } else {
    slug = "news";
    targetUrl = "https://linux.do/c/news/34/l/hot";
  }

  console.log(`🧭 正在导航至板块: ${targetUrl}...`);
  runLantern("goto", [targetUrl]);
  await sleep(3000);

  // 4. 扫描板块提取话题列表
  console.log(`🔍 正在扫描板块列表...`);
  const listRes = runLanternEval(EXTRACT_TOPIC_LIST_SCRIPT);
  const rawTopics = (listRes && listRes.ok && Array.isArray(listRes.evalResult)) ? listRes.evalResult : [];

  if (rawTopics.length === 0) {
    console.error("❌ 未在页面上检索到话题列表，请确认页面是否已完全加载。");
    process.exit(1);
  }

  const selectedTopics = rawTopics.slice(0, limit);
  console.log(`📊 匹配到 ${selectedTopics.length} 个目标话题，开始逐篇提取深度事实内容...\n`);

  // 5. 准备输出目录
  const dateStr = new Date().toISOString().slice(0, 10);
  const sessionDirName = `${dateStr}-${slug}`;
  const targetDir = path.join(baseOutputDir, sessionDirName);
  const mediaDir = path.join(targetDir, "media");

  await fs.mkdir(mediaDir, { recursive: true });

  // 6. 逐篇抓取正文与插图
  let cookieFile = null;
  if (!skipMedia) {
    cookieFile = await exportCookiesIfNeeded();
  }

  const fullTopics = [];

  for (let i = 0; i < selectedTopics.length; i++) {
    const t = selectedTopics[i];
    const indexStr = String(i + 1).padStart(2, "0");
    console.log(`📄 [${indexStr}/${selectedTopics.length}] 正在提取: ${t.title}`);

    runLantern("goto", [t.url]);
    await sleep(2500);

    const detailRes = runLanternEval(EXTRACT_POST_DETAIL_SCRIPT);
    const detail = (detailRes && detailRes.ok && detailRes.evalResult) ? detailRes.evalResult : {};

    const localMedia = [];
    const imgs = detail.images || [];

    if (!skipMedia && imgs.length > 0) {
      for (let imgIdx = 0; imgIdx < imgs.length; imgIdx++) {
        let imgUrl = imgs[imgIdx];
        if (imgUrl.startsWith("/")) imgUrl = "https://linux.do" + imgUrl;

        const extMatch = imgUrl.match(/\.(png|jpg|jpeg|webp|gif|svg)/i);
        const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
        const fileName = `ld_${indexStr}_${t.id}_img_${imgIdx + 1}.${ext}`;
        const destPath = path.join(mediaDir, fileName);
        const relPath = path.join("media", fileName).replace(/\\/g, "/");

        let ok = await downloadDirectImage(imgUrl, destPath);
        if (!ok) {
          ok = downloadWithGalleryDl(imgUrl, mediaDir, fileName, cookieFile);
        }

        localMedia.push({
          type: "image",
          remoteUrl: imgUrl,
          localPath: ok ? relPath : null,
          status: ok ? "success" : "failed"
        });
      }
    }

    fullTopics.push({
      index: i + 1,
      id: t.id,
      title: t.title,
      url: t.url,
      tags: t.tags,
      author: detail.author || "未知",
      publishedAt: detail.publishedAt || null,
      metrics: {
        views: t.views,
        replies: t.replies,
        likes: detail.likes || "0"
      },
      rawContent: detail.rawText || "(未获取到正文)",
      topReplies: detail.topReplies || [],
      localMedia
    });
  }

  // 清理临时 Cookie 文件
  if (cookieFile && syncFs.existsSync(cookieFile)) {
    try { syncFs.unlinkSync(cookieFile); } catch {}
  }

  // 7. 生成【帖子事实.json】
  const factsJson = {
    metadata: {
      source: "linux.do",
      channel,
      query: query || null,
      capturedAt: new Date().toISOString(),
      totalTopics: fullTopics.length,
      outputDir: targetDir
    },
    topics: fullTopics
  };

  const jsonOutPath = path.join(targetDir, "帖子事实.json");
  await fs.writeFile(jsonOutPath, JSON.stringify(factsJson, null, 2), "utf8");

  // 8. 生成【帖子事实.md】
  let mdContent = `# LINUX DO 社区帖子事实档案 (Ground Truth)\n\n`;
  mdContent += `> **采集时间**：${new Date().toLocaleString("zh-CN")}\n`;
  mdContent += `> **频道分类**：\`${channel}\`${query ? ` (检索词: \`${query}\`)` : ""}\n`;
  mdContent += `> **帖子总数**：${fullTopics.length} 篇\n`;
  mdContent += `> **存储目录**：\`${targetDir}\`\n\n`;
  mdContent += `---\n\n`;

  for (const t of fullTopics) {
    const m = t.metrics;
    mdContent += `## #${t.index} ${t.title}\n\n`;
    mdContent += `- 🔗 **原始帖子**：[查看讨论](${t.url})\n`;
    mdContent += `- 👤 **楼主作者**：\`${t.author}\`\n`;
    mdContent += `- 🕒 **发布时间**：\`${t.publishedAt || "未知"}\`\n`;
    mdContent += `- 🏷️ **标签分类**：${t.tags && t.tags.length ? t.tags.map(tag => `\`#${tag}\``).join(" ") : "(无标签)"}\n`;
    mdContent += `- 📊 **事实数据**：👁️ 阅读 \`${m.views}\` · ❤️ 点赞 \`${m.likes}\` · 💬 回复 \`${m.replies}\`\n\n`;

    mdContent += `### 📝 楼主原文事实内容\n\n`;
    mdContent += `\`\`\`text\n${t.rawContent.trim()}\n\`\`\`\n\n`;

    if (t.topReplies && t.topReplies.length > 0) {
      mdContent += `### 💡 社区高赞解答与热评反馈 (${t.topReplies.length} 条)\n\n`;
      for (const rep of t.topReplies) {
        mdContent += `> 👤 **@${rep.user}** (获赞: ${rep.likes})：\n>\n`;
        mdContent += `> ${rep.text.replace(/\n/g, "\n> ")}\n\n`;
      }
    }

    if (t.localMedia && t.localMedia.length > 0) {
      mdContent += `### 📁 本地插图资产 (${t.localMedia.length} 个)\n\n`;
      for (const media of t.localMedia) {
        if (media.status === "success" && media.localPath) {
          mdContent += `- 📷 本地原图: \`${media.localPath}\`\n\n  ![](${media.localPath})\n\n`;
        } else {
          mdContent += `- ⚠️ 图片下载失败: ${media.remoteUrl}\n\n`;
        }
      }
    }

    mdContent += `---\n\n`;
  }

  const mdOutPath = path.join(targetDir, "帖子事实.md");
  await fs.writeFile(mdOutPath, mdContent, "utf8");

  console.log(`\n======================================================`);
  console.log(`✅ LINUX DO 事实采集完成！产物已落盘至目标工作区：`);
  console.log(`📁 目录: ${targetDir}`);
  console.log(`📄 事实文档: ${mdOutPath}`);
  console.log(`📋 机器数据: ${jsonOutPath}`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
