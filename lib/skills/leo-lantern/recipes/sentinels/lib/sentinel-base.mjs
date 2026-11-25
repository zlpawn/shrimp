import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 通用哨兵参数解析
 */
export function parseSentinelArgs(defaults = {}) {
  const args = process.argv.slice(2);
  const parsed = {
    archive: defaults.defaultArchive || "",
    limit: defaults.defaultLimit || 8,
    out: defaults.defaultOut || path.join(os.homedir(), "素材", "sentinel-output"),
    type: defaults.defaultType || "latest",
    skipMedia: defaults.skipMedia !== undefined ? defaults.skipMedia : true,
    jsonOutput: false,
    extra: {}
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "archive") parsed.archive = args[++i];
      else if (key === "limit") parsed.limit = parseInt(args[++i], 10);
      else if (key === "out") parsed.out = args[++i];
      else if (key === "type") parsed.type = args[++i];
      else if (key === "skip-media") parsed.skipMedia = true;
      else if (key === "no-skip-media") parsed.skipMedia = false;
      else if (key === "json") parsed.jsonOutput = true;
      else if (key.startsWith("track")) {
        parsed.extra[key] = args[++i];
      } else {
        const nextVal = args[i + 1];
        if (nextVal && !nextVal.startsWith("-")) {
          parsed.extra[key] = args[++i];
        } else {
          parsed.extra[key] = true;
        }
      }
    } else if (arg.startsWith("-")) {
      const k = arg.slice(1);
      if (k === "a") parsed.archive = args[++i];
      else if (k === "n") parsed.limit = parseInt(args[++i], 10);
      else if (k === "o") parsed.out = args[++i];
      else if (k === "t") parsed.type = args[++i];
    }
  }

  return parsed;
}

/**
 * 存量档案去重 ID 提取器
 */
export function loadArchivedIds(archivePath, regex = /https:\/\/[^\s)\]]+/g) {
  if (!archivePath || !syncFs.existsSync(archivePath)) {
    return new Set();
  }
  try {
    const content = syncFs.readFileSync(archivePath, "utf8");
    const ids = new Set();
    let match;
    while ((match = regex.exec(content)) !== null) {
      // 若正则包含捕获组，优先取捕获组（如推文 ID）；否则取完整匹配
      const captured = match[1] || match[0];
      ids.add(captured);
    }
    return ids;
  } catch (err) {
    console.warn(`⚠️ [sentinel-base] 读取档案 ${archivePath} 失败:`, err.message);
    return new Set();
  }
}

/**
 * 解析配方脚本绝对路径 (基于 recipes/ 或技能根目录)
 */
export function resolveRecipePath(recipeName) {
  if (path.isAbsolute(recipeName)) return recipeName;
  const skillRoot = path.resolve(__dirname, "../../../");
  if (recipeName.startsWith("recipes/")) {
    return path.join(skillRoot, recipeName);
  }
  const recipesDir = path.resolve(__dirname, "../../");
  return path.join(recipesDir, recipeName);
}

/**
 * 运行底层平台采集配方 (如 x-source.mjs, github-source.mjs 等)
 */
export function runPlatformRecipe(recipeName, cliArgs) {
  const recipePath = resolveRecipePath(recipeName);
  if (!syncFs.existsSync(recipePath)) {
    throw new Error(`找不到底层平台配方脚本: ${recipePath}`);
  }

  const res = spawnSync("node", [recipePath, ...cliArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || ""
  };
}

/**
 * 递归/子目录查找并读取【帖子事实.json】
 */
export async function findFactsJsonInDir(baseDir) {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(baseDir, e.name));
    dirs.unshift(baseDir);

    for (const d of dirs) {
      const targetJson = path.join(d, "帖子事实.json");
      if (syncFs.existsSync(targetJson)) {
        const raw = await fs.readFile(targetJson, "utf8");
        return JSON.parse(raw);
      }
    }
  } catch {}
  return null;
}

/**
 * 标准哨兵核心调度器
 * 
 * @param {Object} config
 * @param {string} config.name - 哨兵展示名称
 * @param {string} config.defaultArchive - 默认存量对比档案路径
 * @param {string} config.defaultOut - 默认输出目录
 * @param {RegExp} [config.idExtractorRegex] - 提取历史档案 ID 的正则
 * @param {Function} [config.idGetter] - 从采集到的 item 中提取用于去重的 ID
 * @param {Function} config.resolveTracks - 动态解析或返回轨道列表: (options) => [{ name, recipe, args }]
 * @param {Function} [config.formatMarkdown] - 自定义 Markdown 生成函数
 */
export async function runSentinel(config) {
  const options = parseSentinelArgs(config);
  const startTime = Date.now();

  console.log(`======================================================`);
  console.log(`📡 [Sentinel] ${config.name} 启动`);
  console.log(`📁 产物目录: ${options.out}`);
  console.log(`📚 对比档案: ${options.archive || "(未指定档案，不执行存量去重)"}`);
  console.log(`🎯 单轨上限: ${options.limit}`);
  console.log(`======================================================\n`);

  // 1. 提取存量 ID
  const archivedIds = config.idExtractorRegex
    ? loadArchivedIds(options.archive, config.idExtractorRegex)
    : new Set();
  
  if (options.archive && syncFs.existsSync(options.archive)) {
    console.log(`ℹ️ 已提取历史已收录条目: ${archivedIds.size} 条（用于实时过滤）\n`);
  }

  // 2. 准备临时工作缓存
  const cacheBase = path.join(os.tmpdir(), `sentinel_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(cacheBase, { recursive: true });

  try {
    // 3. 执行所有轨道采集
    const tracks = config.resolveTracks ? config.resolveTracks(options) : [];
    const rawItemsAll = [];

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const trackDir = path.join(cacheBase, `track_${i + 1}`);
      await fs.mkdir(trackDir, { recursive: true });

      console.log(`🚀 [${i + 1}/${tracks.length}] 正在运行【${t.name}】采集...`);

      // 构建传给底层 Recipe 的 CLI 参数
      const recipeArgs = [];
      const recipeParams = { ...t.args, out: trackDir };
      if (options.skipMedia && !recipeParams["skip-media"]) {
        recipeParams["skip-media"] = true;
      }

      for (const [k, v] of Object.entries(recipeParams)) {
        if (v === true) {
          recipeArgs.push(`--${k}`);
        } else if (v !== false && v !== undefined && v !== null) {
          recipeArgs.push(`--${k}`, String(v));
        }
      }

      const res = runPlatformRecipe(t.recipe, recipeArgs);
      if (res.status !== 0) {
        console.warn(`⚠️ 【${t.name}】采集返回非零退出码 (${res.status}):`, res.stderr || res.stdout);
      }

      const facts = await findFactsJsonInDir(trackDir);
      const items = facts?.tweets || facts?.items || facts?.posts || [];
      console.log(`✅ 【${t.name}】获取到 ${items.length} 条原始事实\n`);

      rawItemsAll.push(...items);
    }

    // 4. 数据清洗与跨轨 + 存量去重
    const idGetter = config.idGetter || ((item) => item.id || item.url);
    const seenIds = new Set();
    const newCandidates = [];
    let duplicateCount = 0;
    let archivedCount = 0;

    for (const item of rawItemsAll) {
      const id = idGetter(item);
      if (!id) continue;

      if (seenIds.has(id)) {
        duplicateCount++;
        continue;
      }
      seenIds.add(id);

      if (archivedIds.has(String(id))) {
        archivedCount++;
        continue;
      }

      newCandidates.push(item);
    }

    console.log(`------------------------------------------------------`);
    console.log(`📊 哨兵数据清洗汇总:`);
    console.log(`- 原始采集总数: ${rawItemsAll.length} 条`);
    console.log(`- 跨轨重复数: ${duplicateCount} 条`);
    console.log(`- 历史档案已收录: ${archivedCount} 条`);
    console.log(`- 🆕 未收录新候选: ${newCandidates.length} 条`);
    console.log(`------------------------------------------------------\n`);

    // 5. 结果产物落盘
    const targetDir = path.resolve(options.out);
    await fs.mkdir(targetDir, { recursive: true });

    const finalJsonPath = path.join(targetDir, "帖子事实.json");
    const finalMdPath = path.join(targetDir, "帖子事实.md");

    const resultPayload = {
      metadata: {
        sentinelName: config.name,
        capturedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startTime,
        totalRaw: rawItemsAll.length,
        alreadyArchivedCount: archivedCount,
        newCandidateCount: newCandidates.length,
        outputDir: targetDir
      },
      tweets: newCandidates
    };

    await fs.writeFile(finalJsonPath, JSON.stringify(resultPayload, null, 2), "utf8");

    // Markdown 呈现
    let mdContent = "";
    if (config.formatMarkdown) {
      mdContent = config.formatMarkdown(newCandidates, resultPayload.metadata, rawItemsAll.length, archivedCount);
    } else {
      mdContent = `# ${config.name} 巡检候选事实\n\n`;
      mdContent += `> **巡检时间**：${new Date().toLocaleString("zh-CN")}\n`;
      mdContent += `> **原始采集**：${rawItemsAll.length} 条 | **历史已收录**：${archivedCount} 条 | **未收录候选**：${newCandidates.length} 条\n\n`;
      mdContent += `---\n\n`;

      if (newCandidates.length === 0) {
        mdContent += `### ℹ️ 本次巡检未发现任何未收录的有效新条目，无需更新，保持静默。\n`;
      } else {
        for (let i = 0; i < newCandidates.length; i++) {
          const item = newCandidates[i];
          mdContent += `## #${i + 1} ${item.author?.name || item.title || "条目"}\n\n`;
          if (item.url) mdContent += `- 🔗 链接: [查看原帖](${item.url})\n`;
          if (item.publishedAt) mdContent += `- 🕒 时间: \`${item.publishedAt}\`\n`;
          mdContent += `\`\`\`text\n${(item.rawText || item.content || "").trim()}\n\`\`\`\n\n---\n\n`;
        }
      }
    }

    await fs.writeFile(finalMdPath, mdContent, "utf8");

    if (options.jsonOutput) {
      console.log(JSON.stringify(resultPayload.metadata));
      return;
    }

    // 6. 统一终端信号
    if (newCandidates.length === 0) {
      console.log(`✅ [Sentinel] 巡检完成：未发现任何未收录的新内容。`);
      console.log(`🤫 历史档案已覆盖全部最新内容，保持静默退出。`);
    } else {
      console.log(`🎉 [Sentinel] 巡检完成！发现 ${newCandidates.length} 条新候选：`);
      console.log(`📄 事实文档: ${finalMdPath}`);
      console.log(`📋 机器数据: ${finalJsonPath}`);
      console.log(`➡️ 请 Agent 读取上述产物，执行深度甄别并追加至档案。`);
    }
  } finally {
    try {
      await fs.rm(cacheBase, { recursive: true, force: true });
    } catch {}
  }
}
