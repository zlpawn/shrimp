#!/usr/bin/env node

/**
 * Google Antigravity / Gemini Veo 视频生成与自动归档 CLI
 * 支持一键文生视频、多比例控制、视频捕获与全媒体归档存证。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, resolveOutputDir, getConfigPath } from "./lib/config.mjs";
import { LanternDriver } from "./lib/lantern-driver.mjs";
import { archiveVideo } from "./lib/archiver.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printHelp() {
  console.log(`
Google Antigravity / Gemini Veo 视频生成与归档 Skill

用法:
  leo-antigravity-video --prompt "<描述>" [选项]
  leo-antigravity-video --download-only [选项]
  leo-antigravity-video config [get | set]

主要选项:
  -p, --prompt <text>         视频生成提示词 (必填，除非使用 --download-only)
  -r, --ratio <16:9|9:16>     画面比例 (默认: 16:9，支持 16:9 / 9:16)
  -k, --thinking <high|mid|low> 思考等级 (默认: high，支持 high / mid / low)
  -f, --format <mp4|gif>      导出格式 (默认: mp4，支持 mp4 / gif)
  -o, --out <dir>             归档输出目录 (默认: ~/素材/gemini-videos)
  -d, --download-only         不提交新生成，仅下载归档当前标签页中的最新视频
  -t, --timeout <sec>         最大生成等待时间 (秒，默认: 180)
  -h, --help                  显示帮助信息

配置命令:
  leo-antigravity-video config get
  leo-antigravity-video config set --output-dir "<dir>" --default-ratio "16:9" --thinking-level "high"

示例:
  leo-antigravity-video --prompt "两只机械赛博猫在霓虹街道上跑酷" --ratio 16:9
  leo-antigravity-video --prompt "雨滴落在绿色荷叶上的微距特写" --ratio 9:16
  leo-antigravity-video --download-only --out ~/素材/gemini-videos
`);
}

function parseArgs(args) {
  const flags = {
    prompt: null,
    ratio: null,
    thinking: null,
    format: null,
    out: null,
    downloadOnly: false,
    timeout: null,
    help: false,
    subcommand: null,
    subArgs: {}
  };

  if (args[0] === "config") {
    flags.subcommand = "config";
    flags.action = args[1] || "get";
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--output-dir" && args[i + 1]) flags.subArgs.output_dir = args[++i];
      if (args[i] === "--default-ratio" && args[i + 1]) flags.subArgs.default_ratio = args[++i];
      if (args[i] === "--default-format" && args[i + 1]) flags.subArgs.default_format = args[++i];
      if ((args[i] === "--thinking-level" || args[i] === "--default-thinking") && args[i + 1]) flags.subArgs.thinking_level = args[++i];
    }
    return flags;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") flags.help = true;
    else if ((arg === "-p" || arg === "--prompt") && args[i + 1]) flags.prompt = args[++i];
    else if (arg.startsWith("--prompt=")) flags.prompt = arg.slice(9);
    else if ((arg === "-r" || arg === "--ratio") && args[i + 1]) flags.ratio = args[++i];
    else if (arg.startsWith("--ratio=")) flags.ratio = arg.slice(8);
    else if ((arg === "-k" || arg === "--thinking" || arg === "--thinking-level") && args[i + 1]) flags.thinking = args[++i];
    else if (arg.startsWith("--thinking=")) flags.thinking = arg.slice(11);
    else if ((arg === "-f" || arg === "--format") && args[i + 1]) flags.format = args[++i];
    else if (arg.startsWith("--format=")) flags.format = arg.slice(9);
    else if ((arg === "-o" || arg === "--out") && args[i + 1]) flags.out = args[++i];
    else if (arg.startsWith("--out=")) flags.out = arg.slice(6);
    else if (arg === "-d" || arg === "--download-only") flags.downloadOnly = true;
    else if ((arg === "-t" || arg === "--timeout") && args[i + 1]) flags.timeout = Number(args[++i]);
    else if (!flags.prompt && !arg.startsWith("-")) flags.prompt = arg;
  }

  return flags;
}

async function handleConfigCommand(flags) {
  const cfg = loadConfig();
  if (flags.action === "get") {
    console.log(`\n📋 当前配置文件: ${getConfigPath()}`);
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }
  if (flags.action === "set") {
    const updated = saveConfig(flags.subArgs);
    console.log(`\n✅ 配置已更新:`);
    console.log(JSON.stringify(updated, null, 2));
    return;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = parseArgs(args);

  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  if (flags.subcommand === "config") {
    await handleConfigCommand(flags);
    process.exit(0);
  }

  if (!flags.prompt && !flags.downloadOnly) {
    console.error("❌ 错误: 请提供 --prompt 提示词，或者使用 --download-only 下载当前视频。");
    printHelp();
    process.exit(1);
  }

  const cfg = loadConfig();
  const ratio = flags.ratio || cfg.default_ratio || "16:9";
  const format = flags.format || cfg.default_format || "mp4";
  const thinking = flags.thinking || cfg.thinking_level || "high";
  const timeout = flags.timeout || cfg.timeout_sec || 180;
  const baseOutDir = resolveOutputDir(flags.out);

  console.log(`🎬 Google Antigravity / Gemini Veo 视频服务启动`);
  console.log(`📁 归档基础目录: ${baseOutDir}`);
  console.log(`🧠 思考等级: ${thinking.toUpperCase()} | 📐 画面比例: ${ratio} | 格式: ${format.toUpperCase()}`);

  const driver = new LanternDriver();

  try {
    console.log("🔗 正在连接 Chrome 并接管 Gemini 会话...");
    await driver.initSession(!flags.downloadOnly);

    let finalPrompt = flags.prompt;
    let videoData = null;

    if (!flags.downloadOnly) {
      console.log("⚙️  切换至视频生成模式与设置参数...");
      await driver.activateVideoMode(ratio, format, thinking);

      console.log(`💬 发送提示词: "${finalPrompt}"`);
      await driver.submitPrompt(finalPrompt);

      videoData = await driver.waitForVideoReady(timeout, (elapsed) => {
        console.log(`⏳ Veo 云端渲染中... 已耗时 ${elapsed} 秒`);
      });
    } else {
      console.log("🔍 检测当前页面视频状态...");
      videoData = await driver.waitForVideoReady(10);
      if (!finalPrompt) {
        finalPrompt = "gemini_video_archived";
      }
    }

    console.log("⬇️  正在触发下载并捕获视频文件...");
    const downloadedFile = await driver.triggerDownloadAndCapture();
    console.log(`📥 视频原始文件已接收: ${downloadedFile}`);

    console.log("📦 正在整理归档资产（抽取封面、生成元数据）...");
    const archiveResult = await archiveVideo({
      sourceVideoPath: downloadedFile,
      prompt: finalPrompt,
      ratio,
      format,
      baseOutputDir: baseOutDir,
      extra: {
        sourceUrl: videoData?.pageUrl || null,
        cdnUrl: videoData?.src || null,
        model: "Gemini Omni / Veo"
      }
    });

    console.log("\n==================== 归档完成 ====================");
    console.log(`📂 目标文件夹: ${archiveResult.targetDir}`);
    console.log(`🎥 视频文件:   ${archiveResult.videoPath}`);
    if (archiveResult.coverPath) {
      console.log(`🖼️  视频封面:   ${archiveResult.coverPath}`);
    }
    console.log(`📜 元数据文件: ${archiveResult.metadataPath}`);
    if (archiveResult.metadata?.video_info?.resolution) {
      console.log(`📊 规格: ${archiveResult.metadata.video_info.resolution} @ ${archiveResult.metadata.video_info.fps}fps, 时长 ${archiveResult.metadata.video_info.duration}s`);
    }
    console.log("==================================================\n");

  } catch (err) {
    console.error(`\n❌ 执行失败: ${err.message}`);
    process.exit(1);
  } finally {
    driver.endSession();
  }
}

main();
