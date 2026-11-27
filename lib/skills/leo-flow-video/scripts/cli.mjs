#!/usr/bin/env node

/**
 * Google Flow (flow.google.com) AI 视频生成与自动归档 CLI
 * 支持一键文生视频、多比例/清晰度控制、B站存证规范目录归档。
 */

import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig, resolveOutputDir, getConfigPath } from "./lib/config.mjs";
import { FlowDriver } from "./lib/flow-driver.mjs";
import { archiveVideoAsset, sanitizeTitle, formatDateTime } from "./lib/archiver.mjs";

function printHelp() {
  console.log(`
Google Flow AI 视频生成与归档 Skill (leo-flow-video)

用法:
  leo-flow-video --prompt "<描述>" [选项]
  leo-flow-video config [get | set]

主要选项:
  -p, --prompt <text>         视频生成提示词 (必填)
  -f, --prompt-file <file>    从外部文件读取提示词 (与 --prompt 二选一)
  -r, --ratio <16:9|9:16>     画面比例 (默认: 16:9，支持 16:9 / 9:16)
  --res, --resolution <720p>  视频清晰度 (默认: 720p，支持 720p / 360p)
  -n, --count <1|2|3|4>       单次生成批次 (默认: 1，强制纠偏省点数)
  -u, --project, --url <url>  指定 Flow 项目 URL 或 ID (缺省自动复用当前打开的项目)
  -o, --out <dir>             输出根目录 (默认: ~/google-flow，会自动记住配置)
  -t, --timeout <sec>         最大生成等待时间 (秒，默认: 360)
  --dry-run                   预览模式：配置参数并填入提示词，核对后截停，不扣点数
  -h, --help                  显示帮助信息

配置命令:
  leo-flow-video config get
  leo-flow-video config set --output-dir "<dir>" --default-ratio "16:9" --default-resolution "720p"

示例:
  leo-flow-video --prompt "两只机械赛博猫在霓虹街道上跑酷，4k电影质感" --ratio 16:9
  leo-flow-video --prompt "雨滴落在荷叶上的微距特写" --ratio 9:16 --out ~/google-flow
  leo-flow-video --prompt "太空飞船穿过星云" --dry-run
`);
}

function parseArgs(args) {
  const flags = {
    prompt: null,
    promptFile: null,
    ratio: null,
    resolution: null,
    count: null,
    project: null,
    out: null,
    timeout: null,
    dryRun: false,
    help: false,
    subcommand: null,
    action: null,
    subArgs: {}
  };

  if (args[0] === "config") {
    flags.subcommand = "config";
    flags.action = args[1] || "get";
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--output-dir" && args[i + 1]) flags.subArgs.output_dir = args[++i];
      if (args[i] === "--default-ratio" && args[i + 1]) flags.subArgs.default_ratio = args[++i];
      if (args[i] === "--default-resolution" && args[i + 1]) flags.subArgs.default_resolution = args[++i];
      if (args[i] === "--default-count" && args[i + 1]) flags.subArgs.default_count = parseInt(args[++i], 10);
      if (args[i] === "--timeout" && args[i + 1]) flags.subArgs.timeout_sec = parseInt(args[++i], 10);
    }
    return flags;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") flags.help = true;
    else if ((arg === "-p" || arg === "--prompt") && args[i + 1]) flags.prompt = args[++i];
    else if (arg.startsWith("--prompt=")) flags.prompt = arg.slice(9);
    else if ((arg === "-f" || arg === "--prompt-file") && args[i + 1]) flags.promptFile = args[++i];
    else if ((arg === "-r" || arg === "--ratio" || arg === "--aspect") && args[i + 1]) flags.ratio = args[++i];
    else if ((arg === "--res" || arg === "--resolution") && args[i + 1]) flags.resolution = args[++i];
    else if ((arg === "-n" || arg === "--count") && args[i + 1]) flags.count = parseInt(args[++i], 10);
    else if ((arg === "-u" || arg === "--project" || arg === "--url") && args[i + 1]) flags.project = args[++i];
    else if ((arg === "-o" || arg === "--out" || arg === "--out-dir") && args[i + 1]) flags.out = args[++i];
    else if ((arg === "-t" || arg === "--timeout") && args[i + 1]) flags.timeout = parseInt(args[++i], 10);
    else if (arg === "--dry-run") flags.dryRun = true;
  }

  return flags;
}

async function handleConfig(action, subArgs) {
  if (action === "get") {
    const cfg = loadConfig();
    console.log("当前 leo-flow-video 配置:");
    console.log(JSON.stringify(cfg, null, 2));
    console.log(`配置文件路径: ${getConfigPath()}`);
    return;
  }
  if (action === "set") {
    if (Object.keys(subArgs).length === 0) {
      console.warn("⚠️ 未提供要设置的配置项。示例: leo-flow-video config set --output-dir \"~/google-flow\"");
      return;
    }
    const updated = saveConfig(subArgs);
    console.log("✅ 配置已更新:");
    console.log(JSON.stringify(updated, null, 2));
    return;
  }
  console.error(`未知子命令: config ${action}，支持: config get 或 config set`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    printHelp();
    return;
  }

  if (flags.subcommand === "config") {
    await handleConfig(flags.action, flags.subArgs);
    return;
  }

  // 1. 提取提示词
  let prompt = flags.prompt ? flags.prompt.trim() : "";
  if (!prompt && flags.promptFile) {
    if (fs.existsSync(flags.promptFile)) {
      prompt = fs.readFileSync(path.resolve(flags.promptFile), "utf8").trim();
    } else {
      console.error(`❌ 指定的提示词文件不存在: ${flags.promptFile}`);
      process.exit(1);
    }
  }

  if (!prompt) {
    console.error("❌ 必须提供提示词，通过 --prompt \"...\" 或 --prompt-file \"...\" 传入。使用 --help 查看帮助。");
    process.exit(1);
  }

  // 2. 加载配置并补全参数
  const cfg = loadConfig();
  const ratio = flags.ratio || cfg.default_ratio || "16:9";
  const resolution = flags.resolution || cfg.default_resolution || "720p";
  const count = flags.count || cfg.default_count || 1;
  const timeoutSec = flags.timeout || cfg.timeout_sec || 360;
  const outputRoot = resolveOutputDir(flags.out);

  console.log("=================================================");
  console.log("  Google Flow AI 视频生成 Skill (leo-flow-video) ");
  console.log("=================================================");
  console.log(`📂 输出根目录: ${outputRoot}`);

  const driver = new FlowDriver();

  // 3. 确保底层 bridge 就绪
  await driver.ensureBridge();

  // 4. 打开/接管 Google Flow 项目
  const projectUrl = await driver.prepareProject(flags.project);

  // 5. 配置参数 (比例、清晰度、单批次省点数)
  const pointsCost = await driver.configureSettings({ ratio, resolution, count });

  // 6. 注入提示词
  await driver.injectPrompt(prompt);

  // 7. 处理 --dry-run 预览截停（纯净，无截图）
  const { timestamp } = formatDateTime();
  const safeTitle = sanitizeTitle(prompt);
  const plannedDir = path.join(outputRoot, `${timestamp}_flow_${safeTitle}`);

  if (flags.dryRun) {
    console.log("🔍 --dry-run 模式：参数配置与提示词已就绪，未触发真实生成与扣点。");
    console.log(JSON.stringify({
      ok: true,
      mode: "dry-run",
      prompt,
      ratio,
      resolution,
      count,
      pointsCost,
      plannedDir
    }, null, 2));
    driver.endTask();
    return;
  }

  // 8. 触发真实生成并监听完成
  const beforeState = await driver.getMediaState();
  await driver.triggerGeneration();

  await driver.waitForVideoGeneration({
    beforeState,
    timeoutSec,
    pollIntervalMs: 3000
  });

  // 9. 通过 Flow 编辑器下载捕获视频 Buffer
  const downloadResult = await driver.downloadFromEditor();

  // 10. B 站存证规范落盘归档
  const archiveResult = await archiveVideoAsset({
    videoBuffer: downloadResult.buffer,
    prompt,
    ratio,
    resolution,
    count,
    pointsCost,
    projectUrl,
    baseOutputDir: outputRoot
  });

  // 11. 重置页面提示框并退出任务组
  await driver.resetPrompt();
  driver.endTask();

  console.log(`\n🎉 Google Flow 视频生成已完成！`);
  console.log(`📁 归档工程目录: ${archiveResult.saveDir}`);
  console.log(`📹 原画成片路径: ${archiveResult.videoPath} (${archiveResult.fileSizeMB} MB)`);
  console.log(`📋 交付记录报告: ${archiveResult.mdPath}`);
  console.log(`📝 分镜脚本规格: ${archiveResult.scriptPath}`);
  console.log(`📊 结构化元数据: ${archiveResult.jsonPath}`);

  // 12. 纯净结构化 JSON 返回
  const output = {
    ok: true,
    videoPath: archiveResult.videoPath,
    saveDir: archiveResult.saveDir,
    fileSizeMB: archiveResult.fileSizeMB,
    prompt,
    ratio,
    resolution,
    count,
    pointsCost,
    metadataPath: archiveResult.jsonPath,
    deliveryReportPath: archiveResult.mdPath,
    scriptPath: archiveResult.scriptPath
  };

  console.log("\n✨ 生成完毕交付结果:");
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error("❌ 发生未捕获异常:", err.message || err);
  process.exit(1);
});
