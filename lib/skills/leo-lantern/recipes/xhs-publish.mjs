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
 * 6. 发布后凭据截图存档；
 * 7. 失败即中止：任一用户要求的字段未生效时立即退出，不会继续提交。
 */

import fs from "node:fs";
import path from "node:path";
import {
  fail,
  parseSchedule,
  requireEval,
  requireOk,
  runCli,
  saveScreenshot,
  sleep,
} from "./lib/recipe-runner.mjs";

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

async function main() {
  const args = parseArgs(process.argv);

  console.log("=== 小红书自动化发布流程 (Leo Lantern Recipe) ===");

  // 1. 内容与标题提取与前置校验
  const title = args.title.trim();
  let content = args.content;
  if (!content && args.contentFile) {
    const raw = fs.readFileSync(path.resolve(args.contentFile), "utf8");
    const match = raw.match(/## 正文可复制版\r?\n([\s\S]*?)(?:\r?\n## (?:话题标签|图片顺序)|$)/);
    content = match ? match[1].trim() : raw;

    // 若正文末尾未包含 # 标签，且存在单独的“## 话题标签”模块，则自动补齐
    const tagMatch = raw.match(/## 话题标签\r?\n([\s\S]*?)(?:\r?\n## (?:图片顺序)|$)/);
    if (tagMatch && !content.includes("#")) {
      const tags = tagMatch[1].trim();
      if (tags) {
        content = `${content}\n\n${tags}`;
      }
    }
  }
  content = cleanMarkdown(content);

  if (!title) fail("必须提供 --title");
  if (title.length > 20) fail(`标题超长（当前 ${title.length} 字），小红书硬性上限 20 字！`);
  console.log(`✅ 标题通过校验（${title.length}/20 字）: ${title}`);

  if (!content) fail("必须提供 --content 或 --content-file");
  if (content.length > 1000) fail(`正文超长（当前 ${content.length} 字），小红书硬性上限 1000 字符！`);
  console.log(`✅ 正文通过校验（${content.length}/1000 字）`);

  if (!args.images || args.images.length === 0) fail("必须提供至少一张图片 --images");
  if (args.images.length > 18) fail(`图片过多（当前 ${args.images.length} 张），小红书上限为 18 张！`);
  const resolvedImages = args.images.map(p => path.resolve(p));
  for (const img of resolvedImages) {
    if (!fs.existsSync(img)) fail(`图片文件不存在: ${img}`);
  }
  console.log(`✅ 配图通过校验（共 ${resolvedImages.length} 张）`);

  if (args.schedule) parseSchedule(args.schedule);

  // 2. 检查健康状态并开启/复用任务
  const health = runCli("start");
  if (!health.ok || !health.extensionOnline) {
    fail("leo-lantern 桥接或浏览器扩展未在线，请确认 Chrome 已打开且扩展已启用。");
  }

  console.log("🚀 启动/对齐发布任务环境...");
  requireOk("启动任务", runCli("start-task", ["--title=xhs-recipe", "--same-window=true"]));

  // 3. 寻找或导航到创作者图文发布页
  const tabs = requireOk("读取标签页", runCli("tabs")).result || [];
  const xhsTab = tabs.find(t => t.url && t.url.includes("creator.xiaohongshu.com"));
  if (xhsTab) {
    requireOk("接管发布标签页", runCli("claim", [`--tabId=${xhsTab.id}`]));
  }
  requireOk("打开发布页", runCli("goto", ["https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=image"]));
  await sleep(3000);

  // 4. 多图批量上传
  console.log("⏳ 等待上传组件就绪...");
  requireOk("等待上传组件", runCli("wait", ["--sel=input[type='file']", "--timeout-ms=10000"]));

  console.log(`📤 正在上传 ${resolvedImages.length} 张图片...`);
  requireOk("上传图片", runCli("upload", resolvedImages));
  console.log("⏳ 等待页面渲染与图片解析...");
  await sleep(5000);

  // 5. 填写标题
  console.log("✍️ 正在填入标题...");
  requireOk("填写标题", runCli("fill", ["--sel=input[placeholder*='填写标题']", `--val=${title}`]));

  // 6. 注入富文本正文（通过 insertText 避免 Vue 响应式丢失）
  console.log("✍️ 正在填入脱壳正文...");
  requireEval("填写正文", `(() => {
    const el = document.querySelector('div[contenteditable="true"]');
    if (!el) return false;
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(content)});
    return el.innerText.trim().length > 0;
  })()`);
  await sleep(1000);

  // 7. 处理定时发布
  if (args.schedule) {
    console.log(`⏰ 正在配置定时发布: ${args.schedule}...`);
    // 激活 switch
    requireEval("打开定时发布开关", `(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const label = all.find(el => el.children.length === 0 && el.textContent.trim() === '定时发布');
      let p = label?.parentElement;
      for (let i = 0; i < 4 && p; i++) {
        const sw = p.querySelector('.d-switch') || p.querySelector('input[type="checkbox"]');
        if (sw) {
          if (!sw.className.includes('is-checked') && !sw.checked) sw.click();
          return true;
        }
        p = p.parentElement;
      }
      return false;
    })()`);
    await sleep(1000);

    // 填入时间
    requireEval("填写定时时间", `(() => {
      const inputs = Array.from(document.querySelectorAll('input.d-text'));
      const timeInput = inputs.find(i => /\\d{4}-\\d{2}-\\d{2}/.test(i.value) || i.placeholder?.includes('时间') || i.placeholder?.includes('日期'));
      if (!timeInput) return false;
      timeInput.focus();
      timeInput.value = ${JSON.stringify(args.schedule)};
      timeInput.dispatchEvent(new Event('input', { bubbles: true }));
      timeInput.dispatchEvent(new Event('change', { bubbles: true }));
      timeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);
    await sleep(1000);
  }

  // 关闭可能的 autocomplete 弹层
  runCli("press", ["Escape"]);

  if (args.dryRun) {
    console.log("⚠️ --dry-run 已启用，表单已填写，停止在提交前。");
    saveScreenshot(args.outScreenshot);
    return;
  }

  // 8. 穿透 Shadow DOM 触发真实提交红钮
  console.log("🚀 正在穿透 Shadow DOM 触发最终提交...");
  requireEval("点击发布按钮", `(() => {
    const el = document.querySelector('xhs-publish-btn');
    if (!el) return false;
    const root = el._sr || el.shadowRoot || el;
    const btn = root.querySelector('button.ce-btn.bg-red') || root.querySelector('button.bg-red');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);

  console.log("⏳ 等待提交处理与状态跳转...");
  await sleep(4000);

  // 9. 截图存证
  saveScreenshot(args.outScreenshot);
  console.log("ℹ️ 已点击发布按钮。脚本无法确认平台是否受理，请查看截图或笔记管理页核对结果。");
}

main().catch(err => {
  console.error("执行异常:", err);
  process.exit(1);
});
