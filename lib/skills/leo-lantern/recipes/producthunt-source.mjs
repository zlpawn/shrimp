#!/usr/bin/env node

/**
 * Product Hunt 全球科技新产品、AI 神器与创投风向标事实探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：产品名称、Slogan/一句话定义、完整 Pitch/官方介绍文案、
 *    分类标签（Topics）、Upvotes 点赞票数、官方网址直链（官网）、排名与上线事实、高清展示截图原样落盘。
 * 2. 媒体资产全量本地化：产品 Logo、社交预览大图（og:image）与高清功能截图完整下载至 media/ 目录。
 * 3. 动态配置输出路径：无硬编码目录，优先级为 CLI --out > 记忆配置 (~/.shrimp/skills/leo-lantern/producthunt-source-config.json) > 默认 (D:\素材\ProductHunt)。
 * 4. 深度赋能下游技能：为小红书爆款 AI 工具选题（leo-xhs-router）、技术调研（research subagent）、科技资讯沉淀一手海外前沿事实。
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
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "producthunt-source-config.json");
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
  if (process.env.LEO_LANTERN_PRODUCTHUNT_OUT) {
    return path.resolve(process.env.LEO_LANTERN_PRODUCTHUNT_OUT);
  }
  const defaultDir = "D:\\素材\\ProductHunt";
  if (process.platform === "win32" && syncFs.existsSync("D:\\")) {
    return path.resolve(defaultDir);
  }
  return path.resolve(process.cwd(), "output", "producthunt-source");
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
  const tmpFile = path.join(os.tmpdir(), `ph_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
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

async function downloadMediaFile(url, destPath) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": "https://www.producthunt.com/"
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

// ==================== 页面解析脚本 ====================

const EXTRACT_LEADERBOARD_SCRIPT = `
(() => {
  const links = Array.from(document.querySelectorAll('a[href*="/products/"]'));
  const seen = new Set();
  const products = [];

  for (const a of links) {
    const href = a.href;
    const match = href.match(/producthunt\\.com\\/products\\/([^/?#]+)/);
    if (!match) continue;
    const slug = match[1];
    if (seen.has(slug)) continue;
    seen.add(slug);

    const container = a.closest('div[class*="item"], li, section, div[class*="card"], div[class*="Row"]') || a.parentElement?.parentElement;
    const rawText = container?.innerText || '';
    const lines = rawText.split('\\n').map(s => s.trim()).filter(Boolean);

    let name = a.innerText.trim();
    let rank = '';
    const rankMatch = name.match(/^(\\d+)\\.\\s*(.*)/);
    if (rankMatch) {
      rank = rankMatch[1];
      name = rankMatch[2].replace(/\\s{2,}.*$/, '').trim();
    }

    let tagline = '';
    if (lines.length > 1) {
      tagline = lines.find((l, idx) => idx > 0 && !l.includes('•') && !/^\\d+$/.test(l) && l.length > 5) || lines[1];
      tagline = tagline.replace(/\\s{2,}.*$/, '').trim();
    }

    const upvoteBtn = container?.querySelector('button[data-test="vote-button"], button[class*="vote"], button[class*="Vote"]');
    const upvoteText = upvoteBtn?.innerText?.trim() || '';
    const voteMatch = upvoteText.match(/(\\d+)/) || rawText.match(/\\b(\\d{2,5})\\b/);
    const upvotes = voteMatch ? voteMatch[1] : '';

    const img = container?.querySelector('img');
    const logoUrl = img?.src || '';

    const topics = Array.from(container?.querySelectorAll('a[href*="/topics/"]') || []).map(t => t.innerText.trim());

    products.push({
      rank: rank ? parseInt(rank, 10) : products.length + 1,
      name,
      slug,
      url: href,
      tagline,
      upvotes,
      logoUrl,
      topics
    });
  }

  return {
    title: document.title,
    count: products.length,
    products
  };
})()
`;

const EXTRACT_PRODUCT_DETAIL_SCRIPT = `
(() => {
  const url = window.location.href;
  const slug = (window.location.pathname.match(/\\/(products|posts)\\/([^/]+)/) || [])[2] || '';

  const ogTitle = document.querySelector('meta[property="og:title"]')?.content || document.title;
  const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';
  const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';

  const h1 = document.querySelector('h1')?.innerText?.trim() || '';
  const taglineEl = document.querySelector('h2, div[class*="tagline"]') || document.querySelector('h1 + div');
  let tagline = taglineEl?.innerText?.trim() || '';
  if (!tagline && ogTitle) {
    tagline = ogTitle.replace(h1, '').replace(/^[:\\s-]+/, '').replace(/\\|\\s*Product Hunt.*$/i, '').trim();
  }

  const descEl = document.querySelector('div[class*="description"], div[class*="content"] > p, div[class*="styles_html__"]') ||
                 document.querySelector('meta[name="description"]');
  const fullDescription = descEl?.innerText?.trim() || descEl?.content || ogDesc;

  const visitBtn = Array.from(document.querySelectorAll('a')).find(a => {
    const text = (a.innerText || '').toLowerCase();
    return (text.includes('visit') || text.includes('get it') || text.includes('website')) && a.href && !a.href.includes('producthunt.com');
  });
  const website = visitBtn ? visitBtn.href : '';

  const upvoteBtn = document.querySelector('button[data-test="vote-button"], button[class*="vote"], button[class*="Vote"]');
  let upvotes = upvoteBtn?.innerText?.trim() || '';
  const voteMatch = upvotes.match(/(\\d[\\d,]*)/);
  const upvoteCount = voteMatch ? voteMatch[1].replace(/,/g, '') : upvotes;

  const topicLinks = Array.from(document.querySelectorAll('a[href*="/topics/"]')).map(a => a.innerText.trim());
  const topics = Array.from(new Set(topicLinks.filter(Boolean)));

  const logoImg = document.querySelector('img[src*="ph-files"][src*="h=48"], img[src*="ph-files"][src*="h=64"], img[src*="ph-files"][class*="logo"]');
  const logoUrl = logoImg?.src || '';

  const galleryImgs = Array.from(document.querySelectorAll('img[src*="ph-files"]'))
    .map(img => img.src)
    .filter(src => {
      return !src.includes('w=48') && !src.includes('h=48') && !src.includes('w=32') && !src.includes('avatar') && !src.includes('user');
    });
  const uniqueScreenshots = Array.from(new Set(galleryImgs));

  return {
    name: h1 || slug,
    slug,
    url,
    tagline,
    description: fullDescription,
    website,
    upvotes: upvoteCount,
    topics,
    logoUrl,
    ogImage,
    screenshots: uniqueScreenshots.slice(0, 6)
  };
})()
`;

// ==================== 主流程 ====================

async function main() {
  const args = process.argv.slice(2);

  let mode = "today"; // today | product | topic | search
  let query = "";
  let targetUrl = "";
  let topic = "";
  let limit = 5;
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
      console.log(`当前持久化输出目录: ${cfg.output_dir || "未设置 (将使用 D:\\素材\\ProductHunt 或当前工作区)"}`);
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
    } else if (arg === "--url" || arg === "-u") {
      targetUrl = args[++i];
      mode = "product";
    } else if (arg === "--topic" || arg === "-t") {
      topic = args[++i];
      mode = "topic";
    } else if (arg === "--query" || arg === "-q") {
      query = args[++i];
      mode = "search";
    } else if (arg === "--limit" || arg === "-n") {
      limit = parseInt(args[++i], 10) || 5;
    } else if (arg === "--out" || arg === "--out-dir" || arg === "-o") {
      cliOutDir = args[++i];
    } else if (arg === "--no-deep") {
      deepFetch = false;
    } else if (arg === "--skip-media" || arg === "--no-media") {
      skipMedia = true;
    } else if (!arg.startsWith("-")) {
      if (arg.includes("producthunt.com/products/") || arg.includes("producthunt.com/posts/")) {
        targetUrl = arg;
        mode = "product";
      } else if (!query) {
        query = arg;
        mode = "search";
      }
    }
  }

  // 别名与模式归一化
  if (mode === "item" || mode === "post") mode = "product";
  if (mode === "leaderboard" || mode === "daily") mode = "today";

  // 1. 解析目标落盘目录
  const baseOutDir = resolveOutputDir(cliOutDir);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");

  let sessionSlug = "";
  if (mode === "product") {
    const slugMatch = targetUrl.match(/\/(products|posts)\/([^/?#]+)/);
    sessionSlug = `product_${slugMatch ? slugMatch[2] : "item"}`;
  } else if (mode === "topic") {
    sessionSlug = `topic_${sanitizeFilename(topic)}`;
  } else if (mode === "search") {
    sessionSlug = `search_${sanitizeFilename(query)}`;
  } else {
    sessionSlug = "today_top";
  }

  const sessionDir = path.join(baseOutDir, `${dateStr}_${timeStr}_${sessionSlug}`);
  const mediaDir = path.join(sessionDir, "media");

  await fs.mkdir(mediaDir, { recursive: true });
  console.log(`📂 本次 Product Hunt 事实落盘目录: ${sessionDir}`);

  // 2. 启动 Lantern 连接并关联 Chrome 标签页
  console.log("\n🔌 正在与 Chrome 浏览器建立 Lantern CDP 连接...");
  const startRes = runLantern("start");
  if (!startRes.ok && !startRes.bridge) {
    console.error("❌ 无法连接到 Leo Lantern 服务，请确认 Chrome 扩展已开启。");
    process.exit(1);
  }

  const tabsRes = runLantern("tabs");
  let claimedTabId = null;
  if (tabsRes.ok && Array.isArray(tabsRes.result)) {
    const phTab = tabsRes.result.find(t => t.url && t.url.includes("producthunt.com"));
    if (phTab) claimedTabId = phTab.id;
  }

  const taskRes = runLantern("start-task", ["--title", "producthunt-source", "--same-window"]);
  if (!taskRes.ok) {
    console.error("❌ 创建 Lantern 任务失败:", taskRes.error);
    process.exit(1);
  }

  if (claimedTabId) {
    runLantern("claim", ["--tabId", String(claimedTabId)]);
  }

  let finalProducts = [];
  let metaInfo = {};

  try {
    if (mode === "product") {
      console.log(`🌐 正在打开产品详情页: ${targetUrl}`);
      runLantern("goto", [targetUrl]);
      await sleep(3500);

      const prodRes = runLanternEval(EXTRACT_PRODUCT_DETAIL_SCRIPT);
      if (!prodRes.ok || !prodRes.evalResult || !prodRes.evalResult.name) {
        console.error("❌ 提取产品详情失败:", prodRes.error);
        process.exit(1);
      }

      finalProducts.push(prodRes.evalResult);
    } else {
      let navUrl = "https://www.producthunt.com/";
      if (mode === "topic") {
        navUrl = `https://www.producthunt.com/topics/${encodeURIComponent(topic)}`;
        console.log(`🏷️ 正在抓取主题分类榜单 (${topic}) -> ${navUrl}`);
      } else if (mode === "search") {
        navUrl = `https://www.producthunt.com/search?q=${encodeURIComponent(query)}`;
        console.log(`🔍 检索产品: "${query}" -> ${navUrl}`);
      } else {
        console.log(`🔥 正在检索今日精选榜单 (Today's Top Launches) -> ${navUrl}`);
      }

      runLantern("goto", [navUrl]);
      await sleep(3500);

      const listRes = runLanternEval(EXTRACT_LEADERBOARD_SCRIPT);
      if (!listRes.ok || !listRes.evalResult || !Array.isArray(listRes.evalResult.products)) {
        console.error("❌ 提取产品榜单失败:", listRes.error);
        process.exit(1);
      }

      metaInfo.title = listRes.evalResult.title || "Product Hunt Top Launches";
      const targetList = listRes.evalResult.products.slice(0, limit);
      console.log(`📊 抓取到 ${targetList.length} 个上榜产品，准备采集详细事实...`);

      if (deepFetch) {
        for (let i = 0; i < targetList.length; i++) {
          const item = targetList[i];
          console.log(`  [${i + 1}/${targetList.length}] 正在深度探测: #${item.rank} ${item.name} (${item.url})`);
          runLantern("goto", [item.url]);
          await sleep(2500);

          const pRes = runLanternEval(EXTRACT_PRODUCT_DETAIL_SCRIPT);
          if (pRes.ok && pRes.evalResult && pRes.evalResult.name) {
            finalProducts.push({ ...item, ...pRes.evalResult });
          } else {
            finalProducts.push(item);
          }
        }
      } else {
        finalProducts = targetList;
      }
    }
  } finally {
    runLantern("end-task");
  }

  if (finalProducts.length === 0) {
    console.log("⚠️ 未能采集到有效产品数据，退出。");
    process.exit(0);
  }

  // 3. 资产全量本地化（Logo、封面与展示截图）
  console.log(`\n📦 开始本地化存储 ${finalProducts.length} 个产品的高清图文素材...`);
  let totalMediaFiles = 0;

  for (let idx = 0; idx < finalProducts.length; idx++) {
    const prod = finalProducts[idx];
    prod.index = idx + 1;
    prod.media_files = [];

    if (skipMedia) continue;

    // 下载产品 Logo
    if (prod.logoUrl && prod.logoUrl.startsWith("http")) {
      const logoFileName = `${String(idx + 1).padStart(2, "0")}_${sanitizeFilename(prod.slug || prod.name)}_logo.png`;
      const logoPath = path.join(mediaDir, logoFileName);
      console.log(`  ⬇️ [${idx + 1}/${finalProducts.length}] 正在下载产品 Logo: ${logoFileName}`);
      const dlRes = await downloadMediaFile(prod.logoUrl, logoPath);
      if (dlRes.ok) {
        totalMediaFiles++;
        const rel = path.relative(sessionDir, logoPath).replace(/\\/g, "/");
        prod.media_files.push({
          type: "LOGO",
          file_name: logoFileName,
          file_path: logoPath,
          relative_path: rel,
          size_formatted: formatBytes(dlRes.size),
          url: prod.logoUrl
        });
      }
    }

    // 下载社交大图 / 封面
    if (prod.ogImage && prod.ogImage.startsWith("http")) {
      const coverFileName = `${String(idx + 1).padStart(2, "0")}_${sanitizeFilename(prod.slug || prod.name)}_cover.jpg`;
      const coverPath = path.join(mediaDir, coverFileName);
      console.log(`  ⬇️ [${idx + 1}/${finalProducts.length}] 正在下载宣传封面: ${coverFileName}`);
      const dlRes = await downloadMediaFile(prod.ogImage, coverPath);
      if (dlRes.ok) {
        totalMediaFiles++;
        const rel = path.relative(sessionDir, coverPath).replace(/\\/g, "/");
        prod.media_files.push({
          type: "COVER",
          file_name: coverFileName,
          file_path: coverPath,
          relative_path: rel,
          size_formatted: formatBytes(dlRes.size),
          url: prod.ogImage
        });
      }
    }

    // 下载第 1 张功能展示大图
    if (Array.isArray(prod.screenshots) && prod.screenshots.length > 0) {
      const firstShot = prod.screenshots[0];
      if (firstShot && firstShot.startsWith("http")) {
        const shotFileName = `${String(idx + 1).padStart(2, "0")}_${sanitizeFilename(prod.slug || prod.name)}_shot.png`;
        const shotPath = path.join(mediaDir, shotFileName);
        const dlRes = await downloadMediaFile(firstShot, shotPath);
        if (dlRes.ok) {
          totalMediaFiles++;
          const rel = path.relative(sessionDir, shotPath).replace(/\\/g, "/");
          prod.media_files.push({
            type: "SCREENSHOT",
            file_name: shotFileName,
            file_path: shotPath,
            relative_path: rel,
            size_formatted: formatBytes(dlRes.size),
            url: firstShot
          });
        }
      }
    }
  }

  // 4. 落盘 帖子事实.json
  const groundTruthJson = {
    platform: "Product Hunt",
    target: mode === "product" ? finalProducts[0]?.name : (mode === "topic" ? `Topic: ${topic}` : (mode === "search" ? `Search: ${query}` : "Today Top Launches")),
    mode,
    topic: topic || null,
    query: query || null,
    fetched_at: new Date().toISOString(),
    session_dir: sessionDir,
    total_products: finalProducts.length,
    total_media_files: totalMediaFiles,
    meta: metaInfo,
    products: finalProducts
  };

  const jsonPath = path.join(sessionDir, "帖子事实.json");
  await fs.writeFile(jsonPath, JSON.stringify(groundTruthJson, null, 2), "utf8");
  console.log(`\n💾 帖子事实 JSON 已保存: ${jsonPath}`);

  // 5. 落盘 帖子事实.md
  const mdContent = generateMarkdown(groundTruthJson);
  const mdPath = path.join(sessionDir, "帖子事实.md");
  await fs.writeFile(mdPath, mdContent, "utf8");
  console.log(`📄 帖子事实 Markdown 已保存: ${mdPath}`);

  console.log(`\n🎉 Product Hunt 事实探针抓取完成！共记录 ${finalProducts.length} 个新产品事实，${totalMediaFiles} 个高清资产已落盘。`);
}

// ==================== Markdown 事实模版生成 ====================

function generateMarkdown(data) {
  const lines = [
    `# Product Hunt 全球科技新产品事实存证 (${data.target})`,
    "",
    `> **抓取时间**：${data.fetched_at}  `,
    `> **检索模式**：${data.mode} ${data.topic ? `| **主题**：${data.topic}` : ""} ${data.query ? `| **搜索词**：${data.query}` : ""}  `,
    `> **产品总数**：${data.total_products} 款  `,
    `> **本地媒体总数**：${data.total_media_files} 个 (含产品 Logo、宣传封面与高清截图)  `,
    `> **适用场景**：AI 神器选题、海外科技快讯、小红书图文推文、竞品分析与创新调研  `,
    "",
    "---",
    ""
  ];

  data.products.forEach((p) => {
    lines.push(`## 产品 ${String(p.index).padStart(2, "0")}：[${p.name}](${p.url})${p.rank ? ` · 榜单排名 #${p.rank}` : ""}`);
    lines.push("");
    lines.push(`- **一句话定义 (Slogan)**：**${p.tagline || "暂无标语"}**`);
    if (p.website) {
      lines.push(`- **官方网址**：[${p.website}](${p.website})`);
    }
    if (p.upvotes) {
      lines.push(`- **社区热度**：🔥 **${p.upvotes} Upvotes** 赞同票数`);
    }
    if (p.topics && p.topics.length > 0) {
      lines.push(`- **所属领域**：${p.topics.map(t => `\`#${t}\``).join(" ")}`);
    }
    lines.push(`- **Product Hunt 页面**：${p.url}`);
    lines.push("");

    if (p.description) {
      lines.push("### 📝 产品核心介绍 (Pitch)");
      lines.push("");
      lines.push("```text");
      lines.push(p.description);
      lines.push("```");
      lines.push("");
    }

    if (p.media_files && p.media_files.length > 0) {
      lines.push("### 🖼️ 本地视觉资产清单");
      lines.push("");
      p.media_files.forEach((m) => {
        lines.push(`- **${m.type}**：[\`${m.file_name}\`](./${m.relative_path}) (${m.size_formatted})`);
      });
      lines.push("");

      const coverOrShot = p.media_files.find(m => m.type === "COVER" || m.type === "SCREENSHOT");
      if (coverOrShot) {
        lines.push(`![${p.name}](./${coverOrShot.relative_path})`);
        lines.push("");
      }
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
Product Hunt 全球科技新产品与 AI 神器事实探针 (Ground Truth Extractor)

用法:
  node recipes/producthunt-source.mjs [选项] [产品链接]

模式与选项:
  --mode, -m <today|product|topic|search>  抓取模式 (默认: today 今日榜单)
  --url, -u <link>                         指定产品详情页链接 (如 https://www.producthunt.com/products/maxma-2)
  --topic, -t <name>                       指定主题分类 (如 artificial-intelligence, developer-tools)
  --query, -q <keyword>                    搜索关键词 (用于 search 模式)
  --limit, -n <num>                        抓取产品数量上限 (默认: 5)
  --out, --out-dir, -o <path>              指定素材落地目录 (默认: D:\\素材\\ProductHunt，配置将持久化记忆)
  --no-deep                                仅提取榜单元数据，不逐个深入抓取官网与完整 Pitch
  --skip-media, --no-media                 跳过 Logo 与截图下载，仅抓取文字事实
  --set-out <path>                         单独持久化设置默认输出目录并退出
  --get-out                                查看当前配置的持久化输出目录
  --help, -h                               显示本帮助

示例:
  # 1. 抓取今日全站最火 Top 5 科技新产品及完整 Pitch 与截图 (默认模式):
  node recipes/producthunt-source.mjs --mode today --limit 5

  # 2. 深度解析单篇产品详情、提取官网外链与高分辨率图文:
  node recipes/producthunt-source.mjs --url "https://www.producthunt.com/products/maxma-2"

  # 3. 抓取特定分类 (如 Artificial Intelligence) 热门产品:
  node recipes/producthunt-source.mjs --mode topic --topic artificial-intelligence --limit 5

  # 4. 搜索特定关键词工具:
  node recipes/producthunt-source.mjs --mode search --query "coding agent" --limit 3

  # 5. 指定并记忆输出工作区目录:
  node recipes/producthunt-source.mjs --out "D:\\素材\\ProductHunt"
`);
}

main().catch((err) => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
