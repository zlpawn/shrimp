#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function resolveLocalDataDir(overrideDir = null) {
  if (overrideDir) return overrideDir;
  if (process.env.TREND_INTEL_DATA_DIR) return process.env.TREND_INTEL_DATA_DIR;

  const cwd = process.cwd();
  const localDir = path.join(cwd, "output", "trend-intel");
  if (fs.existsSync(localDir)) return localDir;

  const homeDir = path.join(os.homedir(), ".shrimp", "trend-intel");
  if (fs.existsSync(homeDir)) return homeDir;

  return localDir;
}

function parseArgs(args) {
  const options = {
    action: "brief",
    gatewayUrl: process.env.GATEWAY_URL || "http://127.0.0.1:8787",
    dataDir: null,
    format: "auto",
    limit: 10,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--brief") {
      options.action = "brief";
    } else if (arg === "--events") {
      options.action = "events";
    } else if (arg === "--crawl") {
      options.action = "crawl";
    } else if (arg === "--generate-brief") {
      options.action = "generate-brief";
    } else if (arg === "--status") {
      options.action = "status";
    } else if (arg === "--gateway-url" && i + 1 < args.length) {
      options.gatewayUrl = args[++i];
    } else if (arg === "--data-dir" && i + 1 < args.length) {
      options.dataDir = args[++i];
    } else if (arg === "--format" && i + 1 < args.length) {
      options.format = args[++i];
    } else if (arg === "--limit" && i + 1 < args.length) {
      options.limit = parseInt(args[++i], 10) || 10;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Trend Intelligence CLI Helper (trend_intel.mjs)

用法 (Usage):
  node trend_intel.mjs [options]

选项 (Options):
  --brief               获取最新热点简报 Markdown (默认)
  --events              获取跨平台聚类事件列表 (JSON / 文本)
  --crawl               触发网关立即执行一次全网热点采集
  --generate-brief      触发网关立即执行聚类、评分并生成新简报
  --status              检查网关连接与本地数据目录状态
  --gateway-url <url>   指定网关基础地址 (默认: http://127.0.0.1:8787)
  --data-dir <path>     覆盖本地热点数据存储目录
  --format <md|json>    输出格式 (默认: auto)
  --limit <n>           限制事件数量 (默认: 10)
  --help, -h            显示帮助说明

容灾降级机制:
  当网关不可用时，脚本将自动尝试从本地文件系统读取:
  - latest_brief.md
  - latest_events.json
`);
}

async function fetchFromGateway(gatewayUrl, endpoint, fetchOptions = {}) {
  const url = new URL(endpoint, gatewayUrl).toString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        ...(fetchOptions.headers || {}),
      },
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function readFallbackBrief(dataDir) {
  const candidateDirs = [
    dataDir,
    path.join(process.cwd(), "output", "trend-intel"),
    path.join(os.homedir(), ".shrimp", "trend-intel"),
  ].filter(Boolean);

  for (const dir of candidateDirs) {
    const briefFile = path.join(dir, "latest_brief.md");
    if (fs.existsSync(briefFile)) {
      return {
        source: briefFile,
        markdown: fs.readFileSync(briefFile, "utf-8"),
      };
    }
  }
  return null;
}

function readFallbackEvents(dataDir, limit = 10) {
  const candidateDirs = [
    dataDir,
    path.join(process.cwd(), "output", "trend-intel"),
    path.join(os.homedir(), ".shrimp", "trend-intel"),
  ].filter(Boolean);

  for (const dir of candidateDirs) {
    const eventsFile = path.join(dir, "latest_events.json");
    if (fs.existsSync(eventsFile)) {
      try {
        const list = JSON.parse(fs.readFileSync(eventsFile, "utf-8"));
        return {
          source: eventsFile,
          events: Array.isArray(list) ? list.slice(0, limit) : [],
        };
      } catch {}
    }
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const dataDir = resolveLocalDataDir(options.dataDir);

  if (options.action === "status") {
    console.log("Trend Intelligence 运行状态诊断:");
    console.log(`- 目标网关地址: ${options.gatewayUrl}`);
    console.log(`- 本地数据目录: ${dataDir} (${fs.existsSync(dataDir) ? "存在" : "未创建"})`);

    try {
      const config = await fetchFromGateway(options.gatewayUrl, "/v1/trend-intel/config");
      console.log("- 网关 REST API: 🟢 在线 (已连接)");
      console.log(`  - 调度器: ${config?.data?.scheduler?.enabled ? "已启用" : "未启用"}`);
    } catch (err) {
      console.log(`- 网关 REST API: 🔴 离线 (${err.message})`);
    }

    const fallbackBrief = readFallbackBrief(dataDir);
    console.log(`- 本地简报文件: ${fallbackBrief ? `🟢 找到 (${fallbackBrief.source})` : "⚪ 未找到"}`);

    const fallbackEvents = readFallbackEvents(dataDir);
    console.log(`- 本地事件文件: ${fallbackEvents ? `🟢 找到 (${fallbackEvents.source}, ${fallbackEvents.events.length}条)` : "⚪ 未找到"}`);
    return;
  }

  if (options.action === "crawl") {
    try {
      const res = await fetchFromGateway(options.gatewayUrl, "/v1/trend-intel/crawl", { method: "POST" });
      console.log("全网热点采集触发成功:", JSON.stringify(res, null, 2));
    } catch (err) {
      console.error(`无法触发网关采集: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (options.action === "generate-brief") {
    try {
      const res = await fetchFromGateway(options.gatewayUrl, "/v1/trend-intel/generate-brief", { method: "POST" });
      console.log("简报生成触发成功:", JSON.stringify(res, null, 2));
    } catch (err) {
      console.error(`无法触发简报生成: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (options.action === "events") {
    try {
      const res = await fetchFromGateway(options.gatewayUrl, `/v1/trend-intel/events?limit=${options.limit}`);
      const events = res?.data?.events || [];
      if (options.format === "json") {
        console.log(JSON.stringify(events, null, 2));
      } else {
        console.log(`=== 全网聚类热点事件 (${events.length} 条) [来源: 网关实时API] ===\n`);
        for (const evt of events) {
          const platforms = Array.isArray(evt.platforms) ? evt.platforms.join(",") : evt.platforms;
          console.log(`• [${evt.trend_state || "EVENT"}] ${evt.title}`);
          console.log(`  平台: [${platforms}] | 世界重要性: ${evt.world_importance_score ?? "-"} | 创作者价值: ${evt.creator_value_score ?? "-"}`);
          if (evt.summary) console.log(`  摘要: ${evt.summary}`);
          if (Array.isArray(evt.creator_angles) && evt.creator_angles.length > 0) {
            console.log(`  选题切入点: ${evt.creator_angles.join(" | ")}`);
          }
          console.log("");
        }
      }
      return;
    } catch (err) {
      // Fallback to local files
      const localData = readFallbackEvents(dataDir, options.limit);
      if (localData && localData.events.length > 0) {
        if (options.format === "json") {
          console.log(JSON.stringify(localData.events, null, 2));
        } else {
          console.log(`=== 全网聚类热点事件 (${localData.events.length} 条) [来源: 本地文件 ${localData.source}] ===\n`);
          for (const evt of localData.events) {
            const platforms = Array.isArray(evt.platforms) ? evt.platforms.join(",") : evt.platforms;
            console.log(`• [${evt.trend_state || "EVENT"}] ${evt.title}`);
            console.log(`  平台: [${platforms}] | 世界重要性: ${evt.world_importance_score ?? "-"} | 创作者价值: ${evt.creator_value_score ?? "-"}`);
            if (evt.summary) console.log(`  摘要: ${evt.summary}`);
            console.log("");
          }
        }
        return;
      }
      console.error(`获取事件列表失败 (网关离线且无本地数据): ${err.message}`);
      process.exit(1);
    }
  }

  // Default action: brief
  try {
    const res = await fetchFromGateway(options.gatewayUrl, "/v1/trend-intel/brief");
    const brief = res?.data;
    if (options.format === "json") {
      console.log(JSON.stringify(brief, null, 2));
    } else if (brief?.markdown) {
      console.log(brief.markdown);
    } else {
      console.log(JSON.stringify(brief, null, 2));
    }
  } catch (err) {
    const localBrief = readFallbackBrief(dataDir);
    if (localBrief) {
      console.log(localBrief.markdown);
    } else {
      console.error(`获取热点简报失败 (网关离线且未找到本地 latest_brief.md): ${err.message}`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("执行异常:", err);
  process.exit(1);
});
