#!/usr/bin/env node
/**
 * scrape.mjs
 * 
 * 旅行路书多平台抓取统一调度入口 (Unified Travel Scraper Orchestrator)
 * 职责：
 * 1. 统一调度各个平台的专项抓取模块 (XHS 小红书, eHi 一嗨租车, 以及未来新增平台)
 * 2. 支持单平台按需调用 (`--platform=xhs` 或 `--platform=ehi`) 或全量综合调用 (`--platform=all`)
 * 3. 自动将结果持久化至 skill 的相对 output 目录：`output/latest_scraped_data.json`
 * 4. 全程无污染退出，自动清理 Chrome 标签组
 * 
 * CLI 用法：
 *   # 综合一键全量抓取 (小红书 + 一嗨租车)
 *   node ./lib/skills/leo-travel-planner/scripts/scrape.mjs --keyword="川西大环线 避坑" --city="成都" --days=10
 * 
 *   # 单独抓取小红书
 *   node ./lib/skills/leo-travel-planner/scripts/scrape.mjs --platform=xhs --keyword="稻城亚丁 9月 避坑"
 * 
 *   # 单独查询一嗨租车
 *   node ./lib/skills/leo-travel-planner/scripts/scrape.mjs --platform=ehi --city="成都" --type="SUV"
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { scrapeXiaohongshu } from "./scrapers/xhs.mjs";
import { scrapeEhiCarRental } from "./scrapers/ehi.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, "../output");
const OUTPUT_FILE = path.resolve(OUTPUT_DIR, "latest_scraped_data.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    platform: "all",
    keyword: "川西大环线 避坑",
    city: "成都",
    type: "SUV",
    days: 10,
    save: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--platform=")) options.platform = arg.slice(11).toLowerCase();
    else if (arg === "--platform" && args[i + 1]) options.platform = args[++i].toLowerCase();
    else if (arg.startsWith("--keyword=")) options.keyword = arg.slice(10);
    else if (arg === "--keyword" && args[i + 1]) options.keyword = args[++i];
    else if (arg.startsWith("--city=")) options.city = arg.slice(7);
    else if (arg === "--city" && args[i + 1]) options.city = args[++i];
    else if (arg.startsWith("--type=")) options.type = arg.slice(7);
    else if (arg === "--type" && args[i + 1]) options.type = args[++i];
    else if (arg.startsWith("--days=")) options.days = Number(args[i].slice(7));
    else if (arg === "--days" && args[i + 1]) options.days = Number(args[++i]);
    else if (arg === "--no-save") options.save = false;
  }
  return options;
}

async function main() {
  const options = parseArgs();
  console.log("=================================================");
  console.log(" 🧭 Leo 旅行规划师 · 多源真实数据统一抓取流水线");
  console.log(` 调度模式: ${options.platform.toUpperCase()} | 关键词: "${options.keyword}" | 城市: "${options.city}"`);
  console.log("=================================================\n");

  const finalOutput = {
    scrapedAt: new Date().toISOString(),
    params: options,
    results: {},
  };

  const startTime = Date.now();

  // 1. 小红书抓取
  if (options.platform === "all" || options.platform === "xhs") {
    console.log("▶ [1/2] 正在提取小红书素人真实避坑笔记...");
    try {
      const xhsData = await scrapeXiaohongshu({
        keyword: options.keyword,
        limit: 8,
      });
      finalOutput.results.xiaohongshu = xhsData;
      console.log(`✔ [小红书] 成功捕获 ${xhsData.total} 篇真实避坑笔记\n`);
    } catch (err) {
      console.error(`✖ [小红书] 抓取异常: ${err.message}\n`);
      finalOutput.results.xiaohongshu = { error: err.message };
    }
  }

  // 2. 一嗨租车抓取
  if (options.platform === "all" || options.platform === "ehi") {
    console.log("▶ [2/2] 正在查询一嗨租车官方车型库与全险保障...");
    try {
      const ehiData = await scrapeEhiCarRental({
        city: options.city,
        type: options.type,
        days: options.days,
      });
      finalOutput.results.ehiRental = ehiData;
      console.log(`✔ [一嗨租车] 成功匹配 ${ehiData.vehicles.length} 款车型 (用户: ${ehiData.loggedInUser})\n`);
    } catch (err) {
      console.error(`✖ [一嗨租车] 查询异常: ${err.message}\n`);
      finalOutput.results.ehiRental = { error: err.message };
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("-------------------------------------------------");
  console.log(`✨ 全部抓取完成！耗时: ${durationSec} 秒 (Chrome 标签组已自动全部解散)`);

  // 3. 持久化缓存至 output 目录
  if (options.save) {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(finalOutput, null, 2), "utf8");
    console.log(`💾 数据已自动固化至产物文件: ${path.relative(process.cwd(), OUTPUT_FILE)}`);
  }
  console.log("-------------------------------------------------\n");
}

main().catch((err) => {
  console.error("Fatal error in scrape.mjs:", err);
  process.exit(1);
});
