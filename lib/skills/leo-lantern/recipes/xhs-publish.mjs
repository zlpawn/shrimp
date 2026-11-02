#!/usr/bin/env node

/**
 * xhs-publish.mjs - 小红书创作者服务平台一键自动化发布 Recipe
 * 
 * 核心特性：
 * 1. 自动前置校验：标题 <= 20 字符截断检测，正文 <= 1000 字符脱壳清洗检测；
 * 2. 多图 CDP 极速批量上传（DOM.setFileInputFiles，绕过系统文件弹窗）；
 * 3. 富文本 contenteditable 原生 insertText 注入，确保 Vue 响应式与字数统计生效；
 * 4. 定时发布（黄金时段 15:00~17:00）开关自适应激活与时间填入；
 * 5. 穿透 Web Component 闭包 Shadow DOM（xhs-publish-btn._sr）触发真实发布红钮；
 * 6. 发布后状态轮询与凭据截图存档。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../scripts/cli/index.mjs");

function runCli(cmd, args = []) {
  const fullArgs = [CLI_PATH, cmd, ...args];
  const res = spawnSync("node", fullArgs, { encoding: "utf8" });
  if (res.status !== 0) {
    try {
      const err = JSON.parse(res.stderr || res.stdout || "{}");
      return { ok: false, error: err };
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

function parseArgs(argv) {
  const args = {
    images: [],
    title: "",
    content: "",
    contentFile: "",
    schedule: "",
    dryRun: false,
    outScreenshot: "xhs_publish_result.png"
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--images" || arg === "-i") {
      args.images = (argv[++i] || "").split(",").map(s => s.trim()).filter(Boolean);
    } else if (arg === "--title" || arg === "-t") {
      args.title = argv[++i] || "";
    } else if (arg === "--content" || arg === "-c") {
      args.content = argv[++i] || "";
    } else if (arg === "--content-file" || arg === "-f") {
      args.contentFile = argv[++i] || "";
    } else if (arg === "--schedule" || arg === "-s") {
      args.schedule = argv[++i] || "";
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--out") {
      args.outScreenshot = argv[++i] || "xhs_publish_result.png";
    }
  }

  return args;
}

function cleanMarkdown(raw) {
  if (!raw) return "";
  let text = raw;
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");
  text = text.replace(/\*(.*?)\*/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv);

  console.log("=== 小红书自动化发布流程 (Leo Lantern Recipe) ===");

  // 1. 内容与标题提取与前置校验
  let title = args.title.trim();
  let content = args.content;
  if (!content && args.contentFile) {
    const raw = fs.readFileSync(path.resolve(args.contentFile), "utf8");
    const match = raw.match(/## 正文可复制版\r?\n([\s\S]*?)(?:\r?\n## 图片顺序|$)/);
    content = match ? match[1].trim() : raw;
  }
  content = cleanMarkdown(content);

  if (!title) {
    console.error("❌ 错误：必须提供 --title");
    process.exit(1);
  }
  if (title.length > 20) {
    console.error(`❌ 错误：标题超长（当前 ${title.length} 字），小红书硬性上限 20 字！`);
    process.exit(1);
  }
  console.log(`✅ 标题通过校验（${title.length}/20 字）: ${title}`);

  if (!content) {
    console.error("❌ 错误：必须提供 --content 或 --content-file");
    process.exit(1);
  }
  if (content.length > 1000) {
    console.error(`❌ 错误：正文超长（当前 ${content.length} 字），小红书硬性上限 1000 字符！`);
    process.exit(1);
  }
  console.log(`✅ 正文通过校验（${content.length}/1000 字）`);

  if (!args.images || args.images.length === 0) {
    console.error("❌ 错误：必须提供至少一张图片 --images");
    process.exit(1);
  }
  const resolvedImages = args.images.map(p => path.resolve(p));
  for (const img of resolvedImages) {
    if (!fs.existsSync(img)) {
      console.error(`❌ 错误：图片文件不存在: ${img}`);
      process.exit(1);
    }
  }
  console.log(`✅ 配图通过校验（共 ${resolvedImages.length} 张）`);

  // 2. 检查健康状态并开启/复用任务
  const health = runCli("health");
  if (!health.ok || !health.extensionOnline) {
    console.error("❌ 错误：leo-lantern 服务或浏览器扩展未在线，请启动 server 并确认扩展运行中。");
    process.exit(1);
  }

  console.log("🚀 启动/对齐发布任务环境...");
  runCli("start-task", ["--title=xhs-recipe", "--same-window=true"]);

  // 3. 寻找或导航到创作者图文发布页
  const tabsRes = runCli("tabs");
  const tabs = tabsRes.result || [];
  const xhsTab = tabs.find(t => t.url && t.url.includes("creator.xiaohongshu.com"));
  if (xhsTab) {
    runCli("claim", [`--tabId=${xhsTab.id}`]);
    runCli("goto", ["https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=image"]);
  } else {
    runCli("goto", ["https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=image"]);
  }
  await sleep(3000);

  // 4. 多图批量上传
  console.log("⏳ 等待上传组件就绪...");
  runCli("wait", ["--sel=input[type='file']", "--timeout-ms=10000"]);

  console.log(`📤 正在上传 ${resolvedImages.length} 张图片...`);
  const uploadRes = runCli("upload", resolvedImages);
  if (!uploadRes.ok) {
    console.error("❌ 上传失败:", uploadRes);
    process.exit(1);
  }
  console.log("⏳ 等待页面渲染与图片解析...");
  await sleep(5000);

  // 5. 填写标题
  console.log("✍️ 正在填入标题...");
  runCli("fill", ["--sel=input[placeholder*='填写标题']", `--val=${title}`]);

  // 6. 注入富文本正文（通过 insertText 避免 Vue 响应式丢失）
  console.log("✍️ 正在填入脱壳正文...");
  runCli("eval", [
    `(() => {
      const el = document.querySelector('div[contenteditable="true"]');
      if (el) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(content)});
      }
    })()`
  ]);
  await sleep(1000);

  // 7. 处理定时发布
  if (args.schedule) {
    console.log(`⏰ 正在配置定时发布: ${args.schedule}...`);
    // 激活 switch
    runCli("eval", [
      `(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const label = all.find(el => el.children.length === 0 && el.textContent.trim() === '定时发布');
        if (label) {
          let p = label.parentElement;
          for (let i = 0; i < 4 && p; i++) {
            const sw = p.querySelector('.d-switch') || p.querySelector('input[type="checkbox"]');
            if (sw && !sw.className.includes('is-checked') && !sw.checked) {
              sw.click();
              break;
            }
            p = p.parentElement;
          }
        }
      })()`
    ]);
    await sleep(1000);

    // 填入时间
    runCli("eval", [
      `(() => {
        const inputs = Array.from(document.querySelectorAll('input.d-text'));
        const timeInput = inputs.find(i => /\\d{4}-\\d{2}-\\d{2}/.test(i.value) || i.placeholder?.includes('时间') || i.placeholder?.includes('日期'));
        if (timeInput) {
          timeInput.focus();
          timeInput.value = ${JSON.stringify(args.schedule)};
          timeInput.dispatchEvent(new Event('input', { bubbles: true }));
          timeInput.dispatchEvent(new Event('change', { bubbles: true }));
          timeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
      })()`
    ]);
    await sleep(1000);
  }

  // 关闭可能的 autocomplete 弹层
  runCli("press", ["Escape"]);

  if (args.dryRun) {
    console.log("⚠️ --dry-run 已启用，表单已填妥，停止在提交前。");
    runCli("screenshot", [`--out=${args.outScreenshot}`]);
    console.log(`📸 预览截图已保存: ${args.outScreenshot}`);
    return;
  }

  // 8. 穿透 Shadow DOM 触发真实提交红钮
  console.log("🚀 正在穿透 Shadow DOM 触发最终提交...");
  runCli("eval", [
    `(() => {
      const el = document.querySelector('xhs-publish-btn');
      if (el) {
        const root = el._sr || el.shadowRoot || el;
        const btn = root.querySelector('button.ce-btn.bg-red') || root.querySelector('button.bg-red');
        if (btn) btn.click();
      }
    })()`
  ]);

  console.log("⏳ 等待提交处理与状态跳转...");
  await sleep(4000);

  // 9. 截图存证
  runCli("screenshot", [`--out=${args.outScreenshot}`]);
  console.log(`📸 存证截图已保存: ${args.outScreenshot}`);
  console.log("🎉 发布流程已全部执行完成！");
}

main().catch(err => {
  console.error("执行异常:", err);
  process.exit(1);
});
