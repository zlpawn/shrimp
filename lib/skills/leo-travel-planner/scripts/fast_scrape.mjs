#!/usr/bin/env node
/**
 * fast_scrape.mjs
 * 
 * 高性能自动化脚本：一键快速抓取小红书素人避坑与一嗨租车数据，并自动清理浏览器标签组。
 * 运行方式：
 *   node ./lib/skills/leo-travel-planner/scripts/fast_scrape.mjs --keyword="川西大环线 避坑" --city="成都"
 */

import http from "node:http";

const BRIDGE_PORT = 19527;
const BRIDGE_HOST = "127.0.0.1";

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    keyword: "川西大环线 避坑",
    city: "成都",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--keyword=")) params.keyword = arg.slice(10);
    else if (arg === "--keyword" && args[i + 1]) { params.keyword = args[++i]; }
    else if (arg.startsWith("--city=")) params.city = arg.slice(7);
    else if (arg === "--city" && args[i + 1]) { params.city = args[++i]; }
  }
  return params;
}

function sendBridge(path, method = "GET", data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const req = http.request(
      {
        hostname: BRIDGE_HOST,
        port: BRIDGE_PORT,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          Connection: "close",
          ...(postData ? { "Content-Length": Buffer.byteLength(postData) } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({ raw: body });
          }
        });
      }
    );
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runCmd(type, params = {}, timeoutMs = 15000) {
  const res = await sendBridge("/cmd", "POST", { type, params, timeoutMs });
  return res.result !== undefined ? res.result : res;
}

async function main() {
  const { keyword, city } = parseArgs();
  console.log(`[Leo Scraper] 启动快速抓取 -> 目标: 小红书关键词="${keyword}", 一嗨城市="${city}"`);

  // 1. 健康检查
  const health = await sendBridge("/health").catch(() => null);
  if (!health || !health.ok || !health.extensionOnline) {
    console.error("[Leo Scraper] 错误: Chrome 扩展未在线或 19527 端口未监听！");
    process.exit(1);
  }

  // 2. 检查现有 Tab
  const tabsList = await runCmd("tabs.list");
  const tabs = tabsList || [];
  
  let xhsTab = tabs.find((t) => t.url && t.url.includes("xiaohongshu.com"));
  let ehiTab = tabs.find((t) => t.url && t.url.includes("booking.1hai.cn")) || tabs.find((t) => t.url && t.url.includes("1hai.cn"));

  // 3. 启动后台任务（sameWindow=true，不抢焦点）
  await runCmd("task.start", { title: "travel-fast-sync", sameWindow: true, focus: false });

  const resultData = {
    scrapedAt: new Date().toISOString(),
    xhsNotes: [],
    ehiVehicles: [],
  };

  try {
    // 4. 小红书快速检索
    if (!xhsTab) {
      const newTabRes = await runCmd("tabs.new", {
        url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}`,
        focus: false,
      });
      xhsTab = { id: newTabRes.id };
    } else {
      await runCmd("tabs.claim", { tabId: xhsTab.id, focus: false });
      await runCmd("tabs.goto", {
        tabId: xhsTab.id,
        url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}`,
        focus: false,
      });
    }

    // 等待搜索结果卡片加载 (最多等 5 秒，毫秒级轮询)
    await runCmd("dom.wait", {
      tabId: xhsTab.id,
      selector: "section.note-item, .note-card, a.title, .title",
      timeoutMs: 5000,
    }).catch(() => null);

    const xhsContent = await runCmd("dom.content", { tabId: xhsTab.id, maxChars: 6000 });
    const text = xhsContent?.text || "";

    // 结构化提取素人笔记 (匹配常见标题与作者)
    const regex = /(川西[^\n|]+|避坑[^\n|]+|稻城[^\n|]+|高反[^\n|]+)\s+([^\s\d]{2,10})\s+(\d{1,2}-\d{1,2}|\d+天前|\d{4}-\d{2}-\d{2})/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      resultData.xhsNotes.push({
        title: m[1].trim(),
        author: m[2].trim(),
        date: m[3].trim(),
      });
    }
    console.log(`[Leo Scraper] 小红书素人笔记捕获完成，已提取 ${resultData.xhsNotes.length} 条真实避坑！`);

    // 5. 一嗨租车车型与配置抓取
    if (ehiTab) {
      await runCmd("tabs.claim", { tabId: ehiTab.id, focus: false });
      const ehiContent = await runCmd("dom.content", { tabId: ehiTab.id, maxChars: 6000 });
      const ehiText = ehiContent?.text || "";
      
      const vRegex = /(大众探岳|大众途观L|问界M7|别克GL8|理想L6|丰田RAV4荣放|奇瑞瑞虎8|大众帕萨特)[^\n|]*\s*\|\s*([^\s|]+)\s*\|\s*([^\s|]+)\s*\|\s*(\d座)/g;
      let vm;
      while ((vm = vRegex.exec(ehiText)) !== null) {
        resultData.ehiVehicles.push({
          model: vm[1].trim(),
          body: vm[2].trim(),
          type: vm[3].trim(),
          seats: vm[4].trim(),
        });
      }
      console.log(`[Leo Scraper] 一嗨租车车型库读取完成，捕获 ${resultData.ehiVehicles.length} 款可用车型！`);
    }

  } finally {
    // 6. 重点：彻底解绑并清理标签组，绝不残留红色/青色分组标签
    await runCmd("task.end", { closeGroup: true });
    console.log("[Leo Scraper] 任务结束，已自动解散/清理 Chrome 标签组，浏览器已恢复清爽！");
  }

  // 输出结果
  console.log("\n====== 抓取结构化结果 Summary ======");
  console.log(JSON.stringify(resultData, null, 2));
}

main().catch(console.error);
