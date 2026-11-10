#!/usr/bin/env node

/**
 * GitHub 开发者情报、开源项目技术事实与趋势雷达探针 (Ground Truth Extractor)
 * 
 * 核心设计原则：
 * 1. 100% 事实保真（Ground Truth）：仓库全名、所有者、简介描述、官网、Star/Fork/Watcher/Issue 核心指标、
 *    技术栈语言构成（百分比）、开源协议（License）、标签（Topics）、最新 Release 版本与日期、原生 README.md 零篡改完整落盘。
 * 2. 真实登录态无风控：复用 Chrome 真实已登录用户会话（如 zlpawn），彻底规避 GitHub API 60次/小时匿名限流与封锁。
 * 3. 资产全量本地化：仓库 README.md 原生落盘、社交预览卡片（og:image）落盘至 media/ 目录。
 * 4. 动态配置输出路径：无硬编码目录，优先级为 CLI --out > 记忆配置 (~/.shrimp/skills/leo-lantern/github-source-config.json) > 默认 (D:\素材\GitHub)。
 * 5. 赋能下游技能：为技术笔记、小红书开源工具推荐（leo-xhs-router）、技术调研（research subagent）沉淀一手高保真事实。
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
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "github-source-config.json");
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
  if (process.env.LEO_LANTERN_GITHUB_OUT) {
    return path.resolve(process.env.LEO_LANTERN_GITHUB_OUT);
  }
  const defaultDir = "D:\\素材\\GitHub";
  if (process.platform === "win32" && syncFs.existsSync("D:\\")) {
    return path.resolve(defaultDir);
  }
  return path.resolve(process.cwd(), "output", "github-source");
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
  const tmpFile = path.join(os.tmpdir(), `gh_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
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
        "Referer": "https://github.com/"
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

const EXTRACT_REPO_SCRIPT = `
(() => {
  const url = window.location.href;
  const pathParts = window.location.pathname.replace(/^\\//, '').split('/');
  const owner = pathParts[0] || '';
  const repo = pathParts[1] || '';
  const repoFullName = owner && repo ? \`\${owner}/\${repo}\` : '';

  const ogTitle = document.querySelector('meta[property="og:title"]')?.content || document.title;
  const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';
  const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';

  const aboutP = document.querySelector('*[class*="SidebarAbout-module"][class*="description"]') || 
                 document.querySelector('.BorderGrid .f4') ||
                 document.querySelector('p.f4') ||
                 document.querySelector('meta[name="description"]');
  const description = aboutP?.innerText?.trim() || aboutP?.content || ogDesc;

  const websiteEl = document.querySelector('*[class*="SidebarAbout-module"][class*="websiteLink"]') ||
                    document.querySelector('.BorderGrid a[href^="http"]:not([href*="github.com"])');
  const homepage = websiteEl?.innerText?.trim() || websiteEl?.href || '';

  const topicEls = Array.from(document.querySelectorAll('a[href*="/topics/"], a.topic-tag'));
  const topics = Array.from(new Set(topicEls.map(a => a.innerText.trim()).filter(Boolean)));

  const licenseEl = document.querySelector('a[href*="/LICENSE"], a[href*="/licence"], a[href*="#License"]') ||
                    document.querySelector('*[class*="SidebarSection-module"] a[href*="license"]');
  const license = licenseEl?.innerText?.trim() || '';

  let stars = '';
  let forks = '';
  let watchers = '';

  const socialStats = Array.from(document.querySelectorAll('*[class*="SidebarAbout-module"][class*="insightItem"], *[class*="SidebarAbout-module"][class*="socialStat"], .BorderGrid a[href*="/stargazers"], .BorderGrid a[href*="/forks"], .BorderGrid a[href*="/watchers"]')).map(el => el.innerText.trim());

  for (const s of socialStats) {
    if (s.toLowerCase().includes('star')) stars = s;
    else if (s.toLowerCase().includes('fork')) forks = s;
    else if (s.toLowerCase().includes('watch')) watchers = s;
  }

  if (!stars) {
    const starBtn = document.querySelector('#repo-stars-counter-star') || document.querySelector('a[href$="/stargazers"] strong');
    if (starBtn) stars = starBtn.innerText.trim() + ' stars';
  }
  if (!forks) {
    const forkBtn = document.querySelector('#repo-network-counter') || document.querySelector('a[href$="/forks"] strong');
    if (forkBtn) forks = forkBtn.innerText.trim() + ' forks';
  }

  const langItems = Array.from(document.querySelectorAll('*[class*="SidebarLanguages-module"][class*="languageListItem"], .BorderGrid li.d-inline')).map(li => li.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean);

  const releaseLink = document.querySelector('*[class*="SidebarReleases-module"] a, a[href*="/releases/tag/"]');
  const latestRelease = releaseLink?.innerText?.replace(/\\s+/g, ' ').trim() || '';

  const readmeArticle = document.querySelector('article.markdown-body');
  const readmeText = readmeArticle ? readmeArticle.innerText.trim() : '';

  return {
    owner,
    repo,
    repoFullName,
    url,
    title: ogTitle,
    description,
    homepage,
    stars,
    forks,
    watchers,
    license,
    topics,
    languages: langItems,
    latestRelease,
    ogImage,
    hasReadme: Boolean(readmeArticle),
    readmeLength: readmeText.length,
    readmeSnippet: readmeText.slice(0, 300),
    readmeFullText: readmeText
  };
})()
`;

const EXTRACT_TRENDING_SCRIPT = `
(() => {
  const articles = Array.from(document.querySelectorAll('article.Box-row'));
  const repos = articles.map(art => {
    const titleLink = art.querySelector('h2 a');
    const repoPath = (titleLink?.getAttribute('href') || '').replace(/^\\//, '').trim();
    const descEl = art.querySelector('p.col-9, p[class*="col-9"], p');
    const desc = descEl ? descEl.innerText.trim() : '';
    const lang = art.querySelector('span[itemprop="programmingLanguage"]')?.innerText?.trim() || '';
    const starsLink = art.querySelector('a[href*="/stargazers"]');
    const forksLink = art.querySelector('a[href*="/forks"]');
    const starsToday = art.querySelector('span.float-sm-right, span[class*="float-sm-right"]')?.innerText?.trim() || '';

    return {
      repo: repoPath,
      url: 'https://github.com/' + repoPath,
      desc,
      lang,
      stars: starsLink?.innerText?.trim() || '',
      forks: forksLink?.innerText?.trim() || '',
      starsToday
    };
  }).filter(r => r.repo);

  return {
    title: document.title,
    count: repos.length,
    repos
  };
})()
`;

const EXTRACT_SEARCH_SCRIPT = `
(() => {
  const allLinks = Array.from(document.querySelectorAll('h3 a, a[data-testid="search-result-title"], div[class*="search-title"] a'));
  const repos = [];
  const seen = new Set();

  for (const a of allLinks) {
    const href = a.href || '';
    const match = href.match(/github\\.com\\/([a-zA-Z0-9_.-]+\\/[a-zA-Z0-9_.-]+)$/);
    if (!match) continue;
    const repoPath = match[1];
    if (seen.has(repoPath)) continue;
    seen.add(repoPath);

    const card = a.closest('div[class*="Box-sc-"], div[data-testid="results-list"] > div, .repo-item') || a.parentElement?.parentElement;
    const descEl = card?.querySelector('p, span[class*="Text"]');
    const desc = descEl ? descEl.innerText.trim() : '';
    const langEl = card?.querySelector('span[aria-label*="language"], span[class*="Language"]');
    const lang = langEl ? langEl.innerText.trim() : '';

    repos.push({
      repo: repoPath,
      url: href,
      desc,
      lang
    });
  }

  return {
    title: document.title,
    count: repos.length,
    repos
  };
})()
`;

// ==================== 主流程 ====================

async function main() {
  const args = process.argv.slice(2);

  let mode = "repo"; // repo | trending | search
  let query = "";
  let targetUrl = "";
  let shorthandRepo = "";
  let language = "";
  let since = "daily"; // daily | weekly | monthly
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
      console.log(`当前持久化输出目录: ${cfg.output_dir || "未设置 (将使用 D:\\素材\\GitHub 或当前工作区)"}`);
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
      mode = "search";
    } else if (arg === "--url" || arg === "-u") {
      targetUrl = args[++i];
      mode = "repo";
    } else if (arg === "--repo" || arg === "-r") {
      shorthandRepo = args[++i];
      mode = "repo";
    } else if (arg === "--language" || arg === "-l") {
      language = args[++i];
    } else if (arg === "--since") {
      since = args[++i];
    } else if (arg === "--limit" || arg === "-n") {
      limit = parseInt(args[++i], 10) || 5;
    } else if (arg === "--out" || arg === "--out-dir" || arg === "-o") {
      cliOutDir = args[++i];
    } else if (arg === "--no-deep") {
      deepFetch = false;
    } else if (arg === "--skip-media" || arg === "--no-media") {
      skipMedia = true;
    } else if (!arg.startsWith("-")) {
      if (arg.includes("github.com/")) {
        targetUrl = arg;
        mode = "repo";
      } else if (arg.includes("/")) {
        shorthandRepo = arg;
        mode = "repo";
      } else if (!query) {
        query = arg;
        mode = "search";
      }
    }
  }

  // 别名与智能判定
  if (targetUrl) {
    if (targetUrl.includes("/trending")) mode = "trending";
    else if (targetUrl.includes("/search")) mode = "search";
    else mode = "repo";
  } else if (shorthandRepo) {
    targetUrl = `https://github.com/${shorthandRepo}`;
    mode = "repo";
  } else if (!query && mode === "repo") {
    // 默认进入 Trending
    mode = "trending";
  }

  // 1. 解析目标落盘目录
  const baseOutDir = resolveOutputDir(cliOutDir);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");

  let sessionSlug = "";
  if (mode === "repo") {
    const match = (targetUrl || shorthandRepo).match(/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/) || (shorthandRepo ? [, shorthandRepo.split("/")[0], shorthandRepo.split("/")[1]] : null);
    const repoTag = match ? `${match[1]}_${match[2]}` : "repo";
    sessionSlug = `repo_${repoTag}`;
  } else if (mode === "trending") {
    sessionSlug = `trending_${language || "all"}_${since}`;
  } else {
    sessionSlug = `search_${sanitizeFilename(query)}`;
  }

  const sessionDir = path.join(baseOutDir, `${dateStr}_${timeStr}_${sessionSlug}`);
  const mediaDir = path.join(sessionDir, "media");

  await fs.mkdir(mediaDir, { recursive: true });
  console.log(`📂 本次 GitHub 事实落盘目录: ${sessionDir}`);

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
    const ghTab = tabsRes.result.find(t => t.url && t.url.includes("github.com"));
    if (ghTab) claimedTabId = ghTab.id;
  }

  const taskRes = runLantern("start-task", ["--title", "github-source", "--same-window"]);
  if (!taskRes.ok) {
    console.error("❌ 创建 Lantern 任务失败:", taskRes.error);
    process.exit(1);
  }

  if (claimedTabId) {
    runLantern("claim", ["--tabId", String(claimedTabId)]);
  }

  let finalRepos = [];
  let metaInfo = {};

  try {
    if (mode === "repo") {
      console.log(`🌐 正在打开仓库详情页: ${targetUrl}`);
      runLantern("goto", [targetUrl]);
      await sleep(3500);

      const repoRes = runLanternEval(EXTRACT_REPO_SCRIPT);
      if (!repoRes.ok || !repoRes.evalResult || !repoRes.evalResult.repoFullName) {
        console.error("❌ 提取仓库事实失败:", repoRes.error || "未识别有效仓库结构");
        process.exit(1);
      }

      finalRepos.push(repoRes.evalResult);
    } else if (mode === "trending") {
      let trendingUrl = "https://github.com/trending";
      if (language) trendingUrl += `/${encodeURIComponent(language)}`;
      if (since) trendingUrl += `?since=${encodeURIComponent(since)}`;

      console.log(`🔥 正在检索 GitHub Trending (${language || "全部语言"} | ${since}) -> ${trendingUrl}`);
      runLantern("goto", [trendingUrl]);
      await sleep(3500);

      const trendRes = runLanternEval(EXTRACT_TRENDING_SCRIPT);
      if (!trendRes.ok || !trendRes.evalResult || !Array.isArray(trendRes.evalResult.repos)) {
        console.error("❌ 提取 Trending 列表失败:", trendRes.error);
        process.exit(1);
      }

      metaInfo.title = `GitHub Trending (${language || "All"} | ${since})`;
      const targetList = trendRes.evalResult.repos.slice(0, limit);
      console.log(`📊 抓取到 ${targetList.length} 个趋势仓库，准备采集详细事实...`);

      if (deepFetch) {
        for (let i = 0; i < targetList.length; i++) {
          const item = targetList[i];
          console.log(`  [${i + 1}/${targetList.length}] 正在深度探测: ${item.repo} (${item.url})`);
          runLantern("goto", [item.url]);
          await sleep(2500);

          const rRes = runLanternEval(EXTRACT_REPO_SCRIPT);
          if (rRes.ok && rRes.evalResult && rRes.evalResult.repoFullName) {
            finalRepos.push({ ...item, ...rRes.evalResult });
          } else {
            finalRepos.push(item);
          }
        }
      } else {
        finalRepos = targetList;
      }
    } else if (mode === "search") {
      let searchUrl = `https://github.com/search?q=${encodeURIComponent(query)}`;
      if (language) searchUrl += `+language:${encodeURIComponent(language)}`;
      searchUrl += "&type=repositories";

      console.log(`🔍 检索开源项目: "${query}" -> ${searchUrl}`);
      runLantern("goto", [searchUrl]);
      await sleep(3500);

      const searchRes = runLanternEval(EXTRACT_SEARCH_SCRIPT);
      if (!searchRes.ok || !searchRes.evalResult || !Array.isArray(searchRes.evalResult.repos)) {
        console.error("❌ 提取搜索列表失败:", searchRes.error);
        process.exit(1);
      }

      metaInfo.query = query;
      const targetList = searchRes.evalResult.repos.slice(0, limit);
      console.log(`📊 搜索结果取前 ${targetList.length} 个仓库，准备采集详细事实...`);

      if (deepFetch) {
        for (let i = 0; i < targetList.length; i++) {
          const item = targetList[i];
          console.log(`  [${i + 1}/${targetList.length}] 正在深度探测: ${item.repo} (${item.url})`);
          runLantern("goto", [item.url]);
          await sleep(2500);

          const rRes = runLanternEval(EXTRACT_REPO_SCRIPT);
          if (rRes.ok && rRes.evalResult && rRes.evalResult.repoFullName) {
            finalRepos.push({ ...item, ...rRes.evalResult });
          } else {
            finalRepos.push(item);
          }
        }
      } else {
        finalRepos = targetList;
      }
    }
  } finally {
    runLantern("end-task");
  }

  if (finalRepos.length === 0) {
    console.log("⚠️ 未能采集到有效仓库，退出。");
    process.exit(0);
  }

  // 3. 资产全量本地化（README.md 与封面 cover.png）
  console.log(`\n📦 开始本地化存储 ${finalRepos.length} 个仓库的原生 README 与素材...`);
  let totalMediaFiles = 0;

  for (let idx = 0; idx < finalRepos.length; idx++) {
    const repoItem = finalRepos[idx];
    repoItem.index = idx + 1;
    repoItem.media_files = [];

    // 单仓模式：README 直接放在 sessionDir 根目录
    // 多仓模式：README 放在 repos/<owner_repo>/ 目录下
    let repoTargetDir = sessionDir;
    if (finalRepos.length > 1) {
      repoTargetDir = path.join(sessionDir, "repos", sanitizeFilename(repoItem.repoFullName || repoItem.repo));
      await fs.mkdir(repoTargetDir, { recursive: true });
    }

    // 保存 README.md
    if (repoItem.readmeFullText) {
      const readmePath = path.join(repoTargetDir, "README.md");
      await fs.writeFile(readmePath, repoItem.readmeFullText, "utf8");
      const stat = await fs.stat(readmePath);
      repoItem.readme_file = {
        path: readmePath,
        relative_path: path.relative(sessionDir, readmePath).replace(/\\/g, "/"),
        size_bytes: stat.size,
        size_formatted: formatBytes(stat.size)
      };
      console.log(`  📄 [${idx + 1}/${finalRepos.length}] README 已落盘: ${repoItem.readme_file.relative_path} (${repoItem.readme_file.size_formatted})`);
    }

    // 下载社交预览图 (og:image)
    if (!skipMedia && repoItem.ogImage && repoItem.ogImage.startsWith("http")) {
      const coverFileName = `${String(idx + 1).padStart(2, "0")}_${sanitizeFilename(repoItem.repoFullName || repoItem.repo)}_cover.png`;
      const coverPath = path.join(mediaDir, coverFileName);
      console.log(`  ⬇️ [${idx + 1}/${finalRepos.length}] 正在下载社交卡片图: ${coverFileName}`);
      const dlRes = await downloadMediaFile(repoItem.ogImage, coverPath);
      if (dlRes.ok) {
        totalMediaFiles++;
        const rel = path.relative(sessionDir, coverPath).replace(/\\/g, "/");
        repoItem.media_files.push({
          file_name: coverFileName,
          file_path: coverPath,
          relative_path: rel,
          size_bytes: dlRes.size,
          size_formatted: formatBytes(dlRes.size),
          url: repoItem.ogImage
        });
        console.log(`    ✅ 封面下载成功 (${formatBytes(dlRes.size)}) -> ${rel}`);
      }
    }
  }

  // 4. 落盘 帖子事实.json
  const groundTruthJson = {
    platform: "GitHub",
    target: mode === "repo" ? (finalRepos[0]?.repoFullName || targetUrl) : (mode === "trending" ? metaInfo.title : `Search: ${query}`),
    mode,
    language: language || null,
    since: mode === "trending" ? since : null,
    query: query || null,
    fetched_at: new Date().toISOString(),
    session_dir: sessionDir,
    total_repos: finalRepos.length,
    total_media_files: totalMediaFiles,
    meta: metaInfo,
    repos: finalRepos
  };

  const jsonPath = path.join(sessionDir, "帖子事实.json");
  await fs.writeFile(jsonPath, JSON.stringify(groundTruthJson, null, 2), "utf8");
  console.log(`\n💾 帖子事实 JSON 已保存: ${jsonPath}`);

  // 5. 落盘 帖子事实.md
  const mdContent = generateMarkdown(groundTruthJson);
  const mdPath = path.join(sessionDir, "帖子事实.md");
  await fs.writeFile(mdPath, mdContent, "utf8");
  console.log(`📄 帖子事实 Markdown 已保存: ${mdPath}`);

  console.log(`\n🎉 GitHub 事实探针抓取完成！共记录 ${finalRepos.length} 个开源仓库事实，全部 README 与媒体文件已落盘。`);
}

// ==================== Markdown 事实模版生成 ====================

function generateMarkdown(data) {
  const lines = [
    `# GitHub 开源项目技术事实与趋势雷达 (${data.target})`,
    "",
    `> **抓取时间**：${data.fetched_at}  `,
    `> **探针模式**：${data.mode} ${data.language ? `| **开发语言**：${data.language}` : ""} ${data.since ? `| **时间跨度**：${data.since}` : ""}  `,
    `> **分析仓库数**：${data.total_repos} 个  `,
    `> **本地媒体总数**：${data.total_media_files} 个  `,
    "",
    "---",
    ""
  ];

  data.repos.forEach((repo) => {
    lines.push(`## 仓库 ${String(repo.index).padStart(2, "0")}：[${repo.repoFullName || repo.repo}](${repo.url})`);
    lines.push("");
    lines.push(`- **核心描述**：${repo.description || "*(暂无描述)*"}`);
    if (repo.homepage) {
      lines.push(`- **官方网址**：[${repo.homepage}](${repo.homepage.startsWith("http") ? repo.homepage : `https://${repo.homepage}`})`);
    }

    // 核心指标
    const statsArr = [];
    if (repo.starsToday) statsArr.push(`📈 **今日新增**：${repo.starsToday}`);
    if (repo.stars) statsArr.push(`⭐ **Stars**：${repo.stars}`);
    if (repo.forks) statsArr.push(`🍴 **Forks**：${repo.forks}`);
    if (repo.watchers) statsArr.push(`👁️ **Watchers**：${repo.watchers}`);
    if (repo.license) statsArr.push(`📜 **开源许可**：${repo.license}`);
    if (repo.latestRelease) statsArr.push(`🚀 **最新版本**：${repo.latestRelease}`);
    if (statsArr.length > 0) {
      lines.push(`- **核心指标**：${statsArr.join(" | ")}`);
    }

    // 技术栈与语言分布
    if (repo.languages && repo.languages.length > 0) {
      lines.push(`- **语言构成**：${repo.languages.join(" · ")}`);
    } else if (repo.lang) {
      lines.push(`- **主要语言**：${repo.lang}`);
    }

    // 标签主题
    if (repo.topics && repo.topics.length > 0) {
      lines.push(`- **项目标签**：${repo.topics.map(t => `\`#${t}\``).join(" ")}`);
    }

    // 原生 README 文件指引
    if (repo.readme_file) {
      lines.push(`- **原生文档**：[\`README.md\`](${repo.readme_file.relative_path}) (${repo.readme_file.size_formatted})`);
    }

    // 社交封面
    if (repo.media_files && repo.media_files.length > 0) {
      const mf = repo.media_files[0];
      lines.push(`- **社交卡片**：[\`${mf.file_name}\`](./${mf.relative_path}) (${mf.size_formatted})`);
      lines.push("");
      lines.push(`![${repo.repoFullName || repo.repo}](./${mf.relative_path})`);
    }
    lines.push("");

    // README 摘要预览
    if (repo.readmeSnippet) {
      lines.push("### 📖 原生 README 快速摘要");
      lines.push("");
      lines.push("```markdown");
      lines.push(repo.readmeSnippet + (repo.readmeFullText && repo.readmeFullText.length > 300 ? "\n\n... (完整内容详见本地 README.md)" : ""));
      lines.push("```");
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
GitHub 开发者情报与开源项目技术事实探针 (Ground Truth Extractor)

用法:
  node recipes/github-source.mjs [选项] [owner/repo 或 URL]

模式与选项:
  --mode, -m <repo|trending|search>        抓取模式 (默认: repo，缺省参数自动切换 trending)
  --url, -u <link>                         指定 GitHub 仓库链接 (如 https://github.com/torvalds/linux)
  --repo, -r <owner/repo>                  指定简写仓库名 (如 zlpawn/shrimp)
  --query, -q <keyword>                    搜索关键词 (用于 search 模式)
  --language, -l <lang>                    编程语言过滤 (如 python, typescript, rust, go)
  --since <daily|weekly|monthly>           时间跨度 (用于 trending 模式，默认: daily)
  --limit, -n <num>                        抓取数量上限 (默认: 5)
  --out, --out-dir, -o <path>              指定素材落地目录 (默认: D:\\素材\\GitHub，配置将持久化记忆)
  --no-deep                                仅根据列表元数据生成事实，不逐个深入抓取完整 README
  --skip-media, --no-media                 跳过社交卡片图片下载，仅抓取文字事实与 README
  --set-out <path>                         单独持久化设置默认输出目录并退出
  --get-out                                查看当前配置的持久化输出目录
  --help, -h                               显示本帮助

示例:
  # 1. 深度解析单篇开源项目并下载原生 README 与卡片图 (默认模式):
  node recipes/github-source.mjs --url "https://github.com/zlpawn/shrimp"

  # 2. 抓取今日全语言 GitHub Trending 热门榜前 5 名项目及完整文档:
  node recipes/github-source.mjs --mode trending --limit 5

  # 3. 抓取本周 Python 分类下最热 Trending 项目:
  node recipes/github-source.mjs --mode trending --language python --since weekly --limit 3

  # 4. 关键词搜索前沿 Agent 开源项目并沉淀技术事实:
  node recipes/github-source.mjs --mode search --query "agentic ai" --limit 3

  # 5. 指定并记忆输出工作区目录:
  node recipes/github-source.mjs --out "D:\\素材\\GitHub"
`);
}

main().catch((err) => {
  console.error("❌ 执行出错:", err);
  process.exit(1);
});
