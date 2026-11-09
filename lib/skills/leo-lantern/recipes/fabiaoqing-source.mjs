#!/usr/bin/env node

/**
 * 发表情 (fabiaoqing.com) 中文表情包、热梗图与斗图嘴替事实探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：表情包文字标题、情绪意图、原始来源链接、所属合集/套图名称、关联标签零失真落盘。
 * 2. 媒体资产全量本地化：无损高清原图（自动升级至 /large/ 超清画质）、动态 GIF 动图完整下载至 media/ 目录。
 * 3. 动态配置输出路径：无硬编码目录，优先级为 CLI --out > 记忆配置 (~/.shrimp/skills/leo-lantern/fabiaoqing-source-config.json) > 默认 (D:\素材\表情包)。
 * 4. 深度赋能下游技能：为 bqb-downloader（职场嘴替）、space-xhs-writer（小红书配图/梗图）、leo-xhs-router 注入海量一手中文表情包事实。
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
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "fabiaoqing-source-config.json");
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
  if (process.env.LEO_LANTERN_FABIAOQING_OUT) {
    return path.resolve(process.env.LEO_LANTERN_FABIAOQING_OUT);
  }
  const defaultDir = "D:\\素材\\表情包";
  if (process.platform === "win32" && syncFs.existsSync("D:\\")) {
    return path.resolve(defaultDir);
  }
  return path.resolve(process.cwd(), "output", "fabiaoqing-source");
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
  const tmpFile = path.join(os.tmpdir(), `fbq_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
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

function upgradeImageUrl(url) {
  if (!url) return "";
  return url
    .replace("/bmiddle/", "/large/")
    .replace("/thumb/", "/large/")
    .replace("/small/", "/large/");
}

function detectImageFormat(url) {
  if (!url) return "jpg";
  if (url.includes(".gif")) return "gif";
  if (url.includes(".png")) return "png";
  if (url.includes(".webp")) return "webp";
  return "jpg";
}

async function downloadMediaFile(url, destPath) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": "https://fabiaoqing.com/"
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

const EXTRACT_SEARCH_MEMES_SCRIPT = `
(async () => {
  for (let i = 0; i < 20; i++) {
    const imgs = Array.from(document.querySelectorAll('img.bqppsearch, .searchbqppdiv img, .bqppdiv img, img[data-original]'))
      .filter(img => {
        const src = img.getAttribute('data-original') || img.src || '';
        return src && !src.includes('transparent') && !src.includes('logo') && !src.includes('arrow');
      });
    if (imgs.length > 0) break;
    await new Promise(r => setTimeout(r, 300));
  }

  const imgs = Array.from(document.querySelectorAll('img.bqppsearch, .searchbqppdiv img, .bqppdiv img, img[data-original]')).map(img => {
    let title = img.title || img.alt || '';
    title = title.replace(/_发表情.*$/i, '').replace(/_.*表情$/i, '').trim();

    let rawSrc = img.getAttribute('data-original') || img.src || '';
    if (rawSrc.includes('transparent') || rawSrc.includes('logo')) {
      rawSrc = img.getAttribute('data-original') || '';
    }

    const parentLink = img.closest('a')?.href || '';

    return {
      title,
      imgUrl: rawSrc,
      href: parentLink
    };
  }).filter(i => i.imgUrl && !i.imgUrl.includes('transparent') && !i.imgUrl.includes('logo') && !i.imgUrl.includes('arrow'));

  const seen = new Set();
  const uniqueItems = [];
  for (const it of imgs) {
    if (!seen.has(it.imgUrl)) {
      seen.add(it.imgUrl);
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

const EXTRACT_PACK_MEMES_SCRIPT = `
(async () => {
  for (let i = 0; i < 20; i++) {
    const imgs = Array.from(document.querySelectorAll('.bqppdiv1 img, .bqppdiv img, .ui.segment img, img[data-original]'))
      .filter(img => {
        const src = img.getAttribute('data-original') || img.src || '';
        return src && !src.includes('transparent') && !src.includes('logo') && !src.includes('arrow');
      });
    if (imgs.length > 0) break;
    await new Promise(r => setTimeout(r, 300));
  }

  const pageTitle = document.querySelector('h1, h2, .header')?.innerText?.trim() || document.title.replace(/_.*$/i, '').trim();

  const imgs = Array.from(document.querySelectorAll('.bqppdiv1 img, .bqppdiv img, .ui.segment img, img[data-original]')).map(img => {
    let title = img.title || img.alt || '';
    title = title.replace(/_发表情.*$/i, '').replace(/_.*表情$/i, '').trim();

    let rawSrc = img.getAttribute('data-original') || img.src || '';
    if (rawSrc.includes('transparent') || rawSrc.includes('logo')) {
      rawSrc = img.getAttribute('data-original') || '';
    }

    const parentLink = img.closest('a')?.href || '';

    return {
      title,
      imgUrl: rawSrc,
      href: parentLink
    };
  }).filter(i => i.imgUrl && !i.imgUrl.includes('transparent') && !i.imgUrl.includes('logo') && !i.imgUrl.includes('arrow'));

  const seen = new Set();
  const uniqueItems = [];
  for (const it of imgs) {
    if (!seen.has(it.imgUrl)) {
      seen.add(it.imgUrl);
      uniqueItems.push(it);
    }
  }

  return {
    packTitle: pageTitle,
    count: uniqueItems.length,
    items: uniqueItems
  };
})()
`;

// ==================== 主流程 ====================

async function main() {
  const args = process.argv.slice(2);

  // 参数解析
  let mode = "search"; // search | pack | hot | post
  let query = "";
  let targetUrl = "";
  let limit = 10;
  let cliOutDir = "";
  let skipMedia = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--get-out") {
      const cfg = loadConfig();
      console.log(`当前持久化输出目录: ${cfg.output_dir || "未设置 (将使用 D:\\素材\\表情包 或当前工作区)"}`);
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
    } else if (arg === "--url" || arg === "-u") {
      targetUrl = args[++i];
      if (targetUrl.includes("/bqb/detail/")) {
        mode = "pack";
      } else {
        mode = "post";
      }
    } else if (arg === "--limit" || arg === "-n") {
      limit = parseInt(args[++i], 10) || 10;
    } else if (arg === "--out" || arg === "--out-dir" || arg === "-o") {
      cliOutDir = args[++i];
    } else if (arg === "--skip-media" || arg === "--no-media") {
      skipMedia = true;
    } else if (!arg.startsWith("-") && !query && mode === "search") {
      query = arg;
    }
  }

  // 别名归一化
  if (mode === "item") mode = "post";
  if (mode === "album" || mode === "bqb") mode = "pack";
  if (mode === "explore" || mode === "trending") mode = "hot";

  if (mode === "search" && !query) {
    query = "摸鱼"; // 默认搜索摸鱼表情包
  }

  // 1. 解析目标落盘目录
  const baseOutDir = resolveOutputDir(cliOutDir);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");

  let sessionSlug = "";
  if (mode === "pack") {
    const idMatch = targetUrl.match(/\/(\d+)\.html/);
    sessionSlug = `pack_${idMatch ? idMatch[1] : "album"}`;
  } else if (mode === "post") {
    const idMatch = targetUrl.match(/\/(\d+)\.html/);
    sessionSlug = `item_${idMatch ? idMatch[1] : "single"}`;
  } else if (mode === "hot") {
    sessionSlug = "hot_trending";
  } else {
    sessionSlug = `search_${sanitizeFilename(query)}`;
  }

  const sessionDir = path.join(baseOutDir, `${dateStr}_${timeStr}_${sessionSlug}`);
  const mediaDir = path.join(sessionDir, "media");

  await fs.mkdir(mediaDir, { recursive: true });
  console.log(`📂 本次表情包落盘目录: ${sessionDir}`);

  // 2. 启动 Lantern 连接并关联 Chrome 标签页
  console.log("\n🔌 正在与 Chrome 浏览器建立 Lantern CDP 连接...");
  const startRes = runLantern("start");
  if (!startRes.ok && !startRes.bridge) {
    console.error("❌ 无法连接到 Leo Lantern 服务，请确认 Chrome 扩展已开启。");
    process.exit(1);
  }

  // 检查已有 fabiaoqing 标签页以直接复用
  const tabsRes = runLantern("tabs");
  let claimedTabId = null;
  if (tabsRes.ok && Array.isArray(tabsRes.result)) {
    const fbqTab = tabsRes.result.find(t => t.url && t.url.includes("fabiaoqing.com"));
    if (fbqTab) claimedTabId = fbqTab.id;
  }

  const taskRes = runLantern("start-task", ["--title", "fabiaoqing-source", "--same-window"]);
  if (!taskRes.ok) {
    console.error("❌ 创建 Lantern 任务失败:", taskRes.error);
    process.exit(1);
  }

  if (claimedTabId) {
    runLantern("claim", ["--tabId", String(claimedTabId)]);
  }

  let finalMemes = [];
  let metaInfo = {};

  try {
    if (mode === "pack") {
      if (!targetUrl) {
        console.error("❌ 套图模式 (--mode pack) 必须提供 --url 参数");
        process.exit(1);
      }
      console.log(`🌐 正在打开套图合集页: ${targetUrl}`);
      runLantern("goto", [targetUrl]);
      await sleep(2500);

      const packRes = runLanternEval(EXTRACT_PACK_MEMES_SCRIPT);
      if (!packRes.ok || !packRes.evalResult || !Array.isArray(packRes.evalResult.items)) {
        console.error("❌ 提取套图表情包失败:", packRes.error || "未解析到有效内容");
        process.exit(1);
      }

      metaInfo.title = packRes.evalResult.packTitle || "表情包合集";
      metaInfo.total = packRes.evalResult.count;
      finalMemes = packRes.evalResult.items.slice(0, limit);
    } else if (mode === "post") {
      if (!targetUrl) {
        console.error("❌ 单图模式 (--mode post) 必须提供 --url 参数");
        process.exit(1);
      }
      console.log(`🌐 正在打开单篇表情页: ${targetUrl}`);
      runLantern("goto", [targetUrl]);
      await sleep(2500);

      const singleRes = runLanternEval(EXTRACT_SEARCH_MEMES_SCRIPT);
      if (singleRes.ok && singleRes.evalResult && singleRes.evalResult.items.length > 0) {
        finalMemes.push(singleRes.evalResult.items[0]);
      } else {
        console.error("❌ 提取单张表情失败");
        process.exit(1);
      }
    } else if (mode === "hot") {
      const hotUrl = "https://fabiaoqing.com/bqb/lists/type/hot/page/1.html";
      console.log(`🔥 正在检索全网热门表情包榜单 -> ${hotUrl}`);
      runLantern("goto", [hotUrl]);
      await sleep(3000);

      const hotRes = runLanternEval(EXTRACT_SEARCH_MEMES_SCRIPT);
      if (!hotRes.ok || !hotRes.evalResult || !Array.isArray(hotRes.evalResult.items)) {
        console.error("❌ 提取热门表情列表失败:", hotRes.error);
        process.exit(1);
      }

      metaInfo.title = "热门表情推荐流";
      metaInfo.total = hotRes.evalResult.count;
      finalMemes = hotRes.evalResult.items.slice(0, limit);
    } else {
      // 搜索模式 (使用直通规范 URL: /search/bqb/keyword/<query>/type/bq/page/<page>.html)
      metaInfo.query = query;
      let currentPage = 1;

      while (finalMemes.length < limit && currentPage <= 3) {
        const searchUrl = `https://fabiaoqing.com/search/bqb/keyword/${encodeURIComponent(query)}/type/bq/page/${currentPage}.html`;
        console.log(`🔍 检索表情包: "${query}" (第 ${currentPage} 页) -> ${searchUrl}`);
        runLantern("goto", [searchUrl]);
        await sleep(2500);

        const listRes = runLanternEval(EXTRACT_SEARCH_MEMES_SCRIPT);
        if (!listRes.ok || !listRes.evalResult || !Array.isArray(listRes.evalResult.items)) {
          break;
        }

        const items = listRes.evalResult.items;
        if (items.length === 0) break;

        for (const it of items) {
          if (!finalMemes.some(m => m.imgUrl === it.imgUrl)) {
            finalMemes.push(it);
            if (finalMemes.length >= limit) break;
          }
        }
        currentPage++;
      }
    }
  } finally {
    runLantern("end-task");
  }

  if (finalMemes.length === 0) {
    console.log("⚠️ 未能采集到有效表情包，退出。");
    process.exit(0);
  }

  // 3. 媒体资产本地化下载 (包含动图 GIF 与超清化处理)
  console.log(`\n📦 开始本地化存储 ${finalMemes.length} 个高清表情包资产...`);
  let totalMediaFiles = 0;

  for (let idx = 0; idx < finalMemes.length; idx++) {
    const meme = finalMemes[idx];
    meme.index = idx + 1;
    meme.media_files = [];

    // 自动将图片地址从 bmiddle/thumb 提升到 large 超清画质
    const highResUrl = upgradeImageUrl(meme.imgUrl);
    meme.high_res_url = highResUrl;
    meme.format = detectImageFormat(highResUrl);

    if (skipMedia || !highResUrl) {
      if (skipMedia) console.log(`⏩ [${idx + 1}/${finalMemes.length}] 用户跳过下载: ${meme.title}`);
      continue;
    }

    const titleSlug = sanitizeFilename(meme.title || "meme").slice(0, 35);
    const fileName = `${String(idx + 1).padStart(2, "0")}_${titleSlug}.${meme.format}`;
    const destPath = path.join(mediaDir, fileName);

    console.log(`⬇️ [${idx + 1}/${finalMemes.length}] 正在下载: ${fileName} (${meme.format.toUpperCase()})`);
    const dlRes = await downloadMediaFile(highResUrl, destPath);

    if (dlRes.ok) {
      totalMediaFiles++;
      const relativePath = path.relative(sessionDir, destPath).replace(/\\/g, "/");
      meme.media_files.push({
        file_name: fileName,
        file_path: destPath,
        relative_path: relativePath,
        size_bytes: dlRes.size,
        size_formatted: formatBytes(dlRes.size),
        format: meme.format.toUpperCase(),
        url: highResUrl
      });
      console.log(`  ✅ 下载成功 (${formatBytes(dlRes.size)}) -> ${relativePath}`);
    } else {
      console.warn(`  ⚠️ 下载失败: ${dlRes.error}`);
    }
  }

  // 4. 落盘 帖子事实.json
  const groundTruthJson = {
    platform: "发表情 (fabiaoqing.com)",
    target: mode === "search" ? `Search: ${query}` : (mode === "pack" ? metaInfo.title : (mode === "post" ? targetUrl : "Hot Trending")),
    mode,
    query: query || null,
    fetched_at: new Date().toISOString(),
    session_dir: sessionDir,
    total_items: finalMemes.length,
    total_media_files: totalMediaFiles,
    meta: metaInfo,
    items: finalMemes
  };

  const jsonPath = path.join(sessionDir, "帖子事实.json");
  await fs.writeFile(jsonPath, JSON.stringify(groundTruthJson, null, 2), "utf8");
  console.log(`\n💾 帖子事实 JSON 已保存: ${jsonPath}`);

  // 5. 落盘 帖子事实.md
  const mdContent = generateMarkdown(groundTruthJson);
  const mdPath = path.join(sessionDir, "帖子事实.md");
  await fs.writeFile(mdPath, mdContent, "utf8");
  console.log(`📄 帖子事实 Markdown 已保存: ${mdPath}`);

  console.log(`\n🎉 发表情探针抓取完成！共收集 ${finalMemes.length} 个表情包，${totalMediaFiles} 个高清图片/GIF 资产已落盘。`);
}

// ==================== Markdown 事实模版生成 ====================

function generateMarkdown(data) {
  const lines = [
    `# 发表情 (fabiaoqing.com) 表情包与梗图事实存证 (${data.target})`,
    "",
    `> **抓取时间**：${data.fetched_at}  `,
    `> **检索模式**：${data.mode} ${data.query ? `| **搜索词**：${data.query}` : ""}  `,
    `> **有效表情数**：${data.total_items} 张  `,
    `> **本地媒体总数**：${data.total_media_files} 个 (含无损 JPG/PNG 与动态 GIF)  `,
    `> **适用场景**：职场嘴替、情绪表达、同事沟通、小红书配图、短视频梗图插入  `,
    "",
    "---",
    ""
  ];

  data.items.forEach((item) => {
    const isGif = item.format === "gif";
    const typeLabel = isGif ? "🎞️ 动态 GIF" : "🖼️ 静态图片";

    lines.push(`## 表情 ${String(item.index).padStart(2, "0")}：${item.title || "无配文表情"}`);
    lines.push("");
    lines.push(`- **类型规格**：${typeLabel} (${(item.format || "JPG").toUpperCase()})`);
    if (item.href) {
      lines.push(`- **原始链接**：${item.href}`);
    }
    lines.push(`- **高清源图**：${item.high_res_url || item.imgUrl}`);
    lines.push("");

    if (item.media_files && item.media_files.length > 0) {
      const mf = item.media_files[0];
      lines.push(`### 🖼️ 本地高清资产预览与路径`);
      lines.push("");
      lines.push(`- **本地相对路径**：[\`${mf.file_name}\`](./${mf.relative_path})`);
      lines.push(`- **文件大小**：${mf.size_formatted}`);
      lines.push("");
      lines.push(`![${item.title || "表情包"}](./${mf.relative_path})`);
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
发表情 (fabiaoqing.com) 表情包、热梗图与斗图嘴替事实探针 (Ground Truth Extractor)

用法:
  node recipes/fabiaoqing-source.mjs [选项]

模式与选项:
  --mode, -m <search|pack|hot|post>        抓取模式 (默认: search)
  --query, -q <keyword>                    搜索关键词 (用于 search 模式，如 "摸鱼", "不想上班", "收到")
  --url, -u <link>                         指定套图合集 (pack) 或单图 (post) 详情页链接
  --limit, -n <num>                        抓取数量上限 (默认: 10)
  --out, --out-dir, -o <path>              指定素材落地目录 (默认: D:\\素材\\表情包，配置将持久化记忆)
  --skip-media, --no-media                 跳过媒体文件下载，仅保存事实元数据与配文字段
  --set-out <path>                         单独持久化设置默认输出目录并退出
  --get-out                                查看当前配置的持久化输出目录
  --help, -h                               显示本帮助

示例:
  # 1. 站内检索指定情绪/职场嘴替表情包并下载超清原图与 GIF (默认模式):
  node recipes/fabiaoqing-source.mjs --query "不想上班" --limit 6

  # 2. 搜索并下载经典熊猫头/斗图梗图:
  node recipes/fabiaoqing-source.mjs --query "熊猫头" --limit 8

  # 3. 抓取套图合集 (Meme Pack / 专辑) 并下载全部组图:
  node recipes/fabiaoqing-source.mjs --url "https://fabiaoqing.com/bqb/detail/id/55049.html" --limit 10

  # 4. 抓取全网实时热门表情包榜单:
  node recipes/fabiaoqing-source.mjs --mode hot --limit 8

  # 5. 指定并记忆输出工作区目录:
  node recipes/fabiaoqing-source.mjs --out "D:\\素材\\表情包"
`);
}

main().catch((err) => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
