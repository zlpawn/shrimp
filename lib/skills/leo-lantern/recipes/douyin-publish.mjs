#!/usr/bin/env node

/**
 * douyin-publish.mjs - 抖音创作者服务平台 (Douyin Creator Studio) 自动化视频/图文发布 Recipe
 *
 * 核心特性与踩坑沉淀：
 * 1. 双模合一：原生支持「视频投稿」与「多图图文」两种创作体裁自动分流；
 * 2. 严格参数前置校验：作品标题（视频 <= 30 字，图文 <= 20 字），作品描述 <= 1000 字符；
 * 3. CDP 极速文件上传：DOM.setFileInputFiles 绕过 Windows 原生弹窗；
 * 4. 自动草稿清理：进入上传页自动检测并安全清理未完成的遗留草稿提示（.give-up-Tv8CCI / 放弃）；
 * 5. Bytedance EditorKit 富文本注入：免命令行转义的 eval 引擎注入原生 insertText，确保字数统计与话题生效；
 * 6. 标签智能归纳：支持 --tags 批量注入，自动格式化为 #话题 规范并自动规避 autocomplete 浮层遮挡；
 * 7. 封面智能定制：支持上传自定义高保真封面，自动穿透裁剪弹层并联动横竖屏提示跳过；
 * 8. 平台合规声明：自动在「自主声明」中规范勾选「内容由AI生成」；
 * 9. 定时发布全自动化：支持 2小时~14天 定时发布联动，自动切换定时控件并填入标准格式；
 * 10. 默认直接发布：填完表单后截取全页核对图并点击「发布」；传入 --dry-run 才会停在提交前；
 * 11. 失败即中止：任一用户要求的字段未生效时立即退出，不会继续提交。
 */

import fs from "node:fs";
import path from "node:path";
import {
  appendMissingTags,
  fail,
  parseSchedule,
  requireEval,
  requireOk,
  runCli,
  runEval,
  saveScreenshot,
  sleep,
  warnEval,
} from "./lib/recipe-runner.mjs";

function parseArgs(argv) {
  const args = {
    video: "",
    images: [],
    title: "",
    desc: "",
    descFile: "",
    tags: [],
    customCover: "",
    aiDeclaration: true,
    visibility: "公开", // 公开 | 好友可见 | 仅自己可见
    schedule: "",
    publish: true, // 默认直接发布，--dry-run 停在提交前
    reuseForm: false, // 显式沿用已打开的编辑页，此时不上传 --video/--images
    outScreenshot: "douyin_publish_review.png"
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--video" || arg === "-v") {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.video = argv[++i];
    } else if (arg.startsWith("--video=")) {
      args.video = arg.slice(8);
    } else if (arg === "--images" || arg === "-i") {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.images = argv[++i].split(",").map(s => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--images=")) {
      args.images = arg.slice(9).split(",").map(s => s.trim()).filter(Boolean);
    } else if (arg === "--title" || arg === "-t") {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.title = argv[++i];
    } else if (arg.startsWith("--title=")) {
      args.title = arg.slice(8);
    } else if (arg === "--desc" || arg === "-d") {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.desc = argv[++i];
      else args.desc = "";
    } else if (arg.startsWith("--desc=")) {
      args.desc = arg.slice(7);
    } else if (arg === "--desc-file" || arg === "-f") {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.descFile = argv[++i];
    } else if (arg.startsWith("--desc-file=")) {
      args.descFile = arg.slice(12);
    } else if (arg === "--tags") {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.tags = argv[++i].split(",").map(s => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--tags=")) {
      args.tags = arg.slice(7).split(",").map(s => s.trim()).filter(Boolean);
    } else if (arg === "--cover") {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.customCover = argv[++i];
    } else if (arg.startsWith("--cover=")) {
      args.customCover = arg.slice(8);
    } else if (arg === "--no-ai") {
      args.aiDeclaration = false;
    } else if (arg === "--visibility") {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.visibility = argv[++i];
    } else if (arg.startsWith("--visibility=")) {
      args.visibility = arg.slice(13);
    } else if (arg === "--schedule" || arg === "-s") {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.schedule = argv[++i];
    } else if (arg.startsWith("--schedule=")) {
      args.schedule = arg.slice(11);
    } else if (arg === "--publish") {
      args.publish = true;
    } else if (arg === "--dry-run") {
      args.publish = false;
    } else if (arg === "--reuse-form") {
      args.reuseForm = true;
    } else if (arg === "--out") {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.outScreenshot = argv[++i];
    } else if (arg.startsWith("--out=")) {
      args.outScreenshot = arg.slice(6);
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

function dismissDraftPrompt() {
  runEval(`
    (() => {
      const el = document.querySelector('.give-up-Tv8CCI') ||
        Array.from(document.querySelectorAll('span, button, div')).find(s => (s.innerText || '').trim() === '放弃');
      if (el) el.click();
    })()
  `);
}

async function main() {
  const args = parseArgs(process.argv);

  console.log("=== 抖音创作者服务平台自动化发布流程 (Douyin Publish Recipe) ===");

  // 1. 模式判断与媒体前置校验
  const isVideo = Boolean(args.video);
  const isImage = Boolean(args.images && args.images.length > 0);

  if (!isVideo && !isImage) fail("必须提供视频文件 (--video <path>) 或图文列表 (--images <p1,p2...>)");

  let resolvedVideo = "";
  let resolvedImages = [];

  if (isVideo) {
    resolvedVideo = path.resolve(args.video);
    if (!fs.existsSync(resolvedVideo)) fail(`视频文件不存在: ${resolvedVideo}`);
    console.log(`🎬 模式：视频发布 | 文件: ${resolvedVideo}`);
  } else {
    resolvedImages = args.images.map(p => path.resolve(p));
    if (resolvedImages.length > 35) fail(`图片数量超过抖音单篇上限（当前 ${resolvedImages.length} 张，上限 35 张）！`);
    for (const img of resolvedImages) {
      if (!fs.existsSync(img)) fail(`图片文件不存在: ${img}`);
    }
    console.log(`🖼️ 模式：图文发布 | 共 ${resolvedImages.length} 张图片`);
  }

  const coverPath = isVideo && args.customCover ? path.resolve(args.customCover) : "";
  if (coverPath && !fs.existsSync(coverPath)) fail(`封面文件不存在: ${coverPath}`);

  // 2. 标题校验
  const title = (args.title || "").trim();
  if (!title) fail("必须提供稿件标题 --title");
  const maxTitleLen = isVideo ? 30 : 20;
  if (title.length > maxTitleLen) {
    fail(`标题超长（当前 ${title.length} 字），抖音${isVideo ? "视频" : "图文"}上限为 ${maxTitleLen} 字符！`);
  }
  console.log(`✅ 标题通过校验（${title.length}/${maxTitleLen} 字）: ${title}`);

  // 3. 简介与话题处理
  let desc = args.desc;
  if (!desc && args.descFile) {
    desc = fs.readFileSync(path.resolve(args.descFile), "utf8");
  }
  desc = appendMissingTags(cleanMarkdown(desc), args.tags);

  if (desc && desc.length > 1000) fail(`描述超长（当前 ${desc.length} 字），抖音硬性上限为 1000 字符！`);
  console.log(`✅ 描述配置就绪: ${desc ? `${desc.length}/1000 字` : "留空（不写描述，极简呈现）"}`);

  // 4. 定时发布校验
  if (args.schedule) {
    parseSchedule(args.schedule);
    console.log(`⏰ 定时发布已指定: ${args.schedule}`);
  }

  // 5. 检查 leo-lantern 服务状态
  const health = runCli("health");
  if (!health.ok || !health.extensionOnline) {
    fail("leo-lantern 服务或浏览器扩展未在线，请启动 server 并确认扩展运行中。");
  }

  console.log("🚀 启动/对齐抖音发布任务环境...");
  requireOk("启动任务", runCli("start-task", ["--title=douyin-publish", "--same-window=true"]));

  // 6. 导航到抖音创作者发布中心
  const tabs = requireOk("读取标签页", runCli("tabs")).result || [];
  const douyinTab = tabs.find(t => t.url && t.url.includes("creator.douyin.com"));

  // 只有显式 --reuse-form 才沿用已打开的编辑页，否则 --video/--images 会被忽略而发出旧媒体
  const reusingForm = args.reuseForm && douyinTab && douyinTab.url && (
    (isVideo && douyinTab.url.includes("/content/post/video")) ||
    (!isVideo && douyinTab.url.includes("/content/post/image"))
  );

  if (douyinTab) {
    requireOk("接管抖音标签页", runCli("claim", [`--tabId=${douyinTab.id}`]));
  }

  if (!reusingForm) {
    const targetUploadUrl = isVideo
      ? "https://creator.douyin.com/creator-micro/content/upload?default-tab=1"
      : "https://creator.douyin.com/creator-micro/content/upload?default-tab=3";

    requireOk("打开上传页", runCli("goto", [targetUploadUrl]));
    await sleep(3000);

    // 清理遗留草稿弹窗
    dismissDraftPrompt();
    await sleep(600);

    // 7. 媒体上传
    console.log("⏳ 等待上传组件就绪...");
    requireOk("等待上传组件", runCli("wait", ["--sel=input[type='file']", "--timeout-ms=10000"]));

    if (isVideo) {
      console.log(`📤 正在上传视频: ${resolvedVideo}...`);
      requireOk("视频注入", runCli("upload", [resolvedVideo]));

      console.log("⏳ 等待视频上传并进入表单编辑页...");
      let formReady = false;
      for (let i = 0; i < 40; i++) {
        await sleep(2000);
        const contentRes = runCli("content", ["--max-chars=500"]);
        const url = contentRes.result?.url || "";
        const text = contentRes.result?.text || "";
        if (url.includes("/content/post/video") || text.includes("作品描述") || text.includes("基础信息")) {
          formReady = true;
          console.log("✅ 视频已成功载入表单！");
          break;
        }
      }
      if (!formReady) fail("等待视频上传处理超时");
    } else {
      console.log(`📤 正在上传 ${resolvedImages.length} 张图片...`);
      requireOk("图片注入", runCli("upload", resolvedImages));

      console.log("⏳ 等待图片上传并进入表单编辑页...");
      let formReady = false;
      for (let i = 0; i < 30; i++) {
        await sleep(2000);
        const contentRes = runCli("content", ["--max-chars=500"]);
        const url = contentRes.result?.url || "";
        const text = contentRes.result?.text || "";
        if (url.includes("/content/post/image") || text.includes("作品描述") || text.includes("基础信息")) {
          formReady = true;
          console.log("✅ 图文已成功载入表单！");
          break;
        }
      }
      if (!formReady) fail("等待图文上传处理超时");
    }
  } else {
    console.log("ℹ️ --reuse-form：沿用已打开的编辑页，不上传媒体，直接填写内容...");
  }

  await sleep(1500);

  // 8. 填写标题 (使用原生 Prototype Setter 确保 Semi-UI 响应式生效)
  console.log(`✍️ 正在填入标题: ${title}...`);
  const fillTitleRes = runCli("fill", ["--sel=input[placeholder*='填写作品标题']", `--val=${title}`]);
  if (!fillTitleRes.ok) {
    requireEval("填写标题", `
      (() => {
        const input = document.querySelector("input[placeholder*='填写作品标题']") || document.querySelector("input.semi-input-default");
        if (!input) return false;
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, ${JSON.stringify(title)});
        else input.value = ${JSON.stringify(title)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
  }
  await sleep(800);

  // 9. 注入正文描述与话题（支持完全留空）
  console.log(desc ? "✍️ 正在填入作品描述与话题标签..." : "ℹ️ 作品描述留空（未提供），清空编辑器保持极简发布...");
  const fillEditor = `
    (() => {
      const editor = document.querySelector("div.zone-container[contenteditable='true'], div.editor-kit-container[contenteditable='true']");
      if (!editor) return false;
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(desc || "")});
      return ${desc ? "editor.innerText.trim().length > 0" : "true"};
    })()
  `;
  if (desc) requireEval("填写作品描述", fillEditor);
  else warnEval("清空作品描述", fillEditor);
  await sleep(800);
  if (desc) {
    // 关闭可能被触出的标签自动补全浮层
    runCli("press", ["Escape"]);
  }

  // 10. 自定义封面设置（仅视频模式，当提供 --cover 时）
  if (coverPath) {
    console.log(`🖼️ 正在上传自定义封面: ${coverPath}...`);
    // 点击第一个“选择封面”
    requireEval("打开封面弹窗", `
      (() => {
        const btns = Array.from(document.querySelectorAll('*')).filter(el =>
          el.children.length === 0 && (el.innerText || '').trim() === '选择封面'
        );
        if (btns.length === 0) return false;
        btns[0].click();
        return true;
      })()
    `);
    await sleep(2000);

    // 注入封面文件
    requireOk("上传封面", runCli("upload", [coverPath, "--sel=.semi-modal input[type='file'], input[type='file'][accept*='image']"]));
    await sleep(2000);

    // 点击弹窗中的“完成”
    requireEval("确认封面", `
      (() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => (b.innerText || '').trim() === '完成');
        if (btns.length === 0) return false;
        btns[0].click();
        return true;
      })()
    `);
    await sleep(1000);

    // 触发横封面提示时点击“暂不设置”（提示不一定出现）
    runEval(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button, div, span')).filter(b => (b.innerText || '').trim() === '暂不设置');
        if (btns.length > 0) btns[0].click();
      })()
    `);
    await sleep(800);
    runCli("press", ["Escape"]);
  }

  // 11. 自主声明配置（默认添加 AI 生成声明）
  if (args.aiDeclaration) {
    console.log("🤖 正在配置平台自主声明（内容由AI生成）...");
    runEval(`
      (() => {
        const trigger = Array.from(document.querySelectorAll('*')).find(el =>
          el.children.length === 0 && (el.innerText || '').trim() === '请选择自主声明'
        );
        if (trigger) trigger.click();
      })()
    `);
    await sleep(1000);

    requireEval("配置「内容由AI生成」声明（不需要时传 --no-ai）", `
      (async () => {
        const all = Array.from(document.querySelectorAll('*'));
        const aiOption = all.find(el => el.children.length === 0 && (el.innerText || '').trim() === '内容由AI生成');
        if (!aiOption) return false;
        aiOption.click();

        await new Promise(r => setTimeout(r, 300));
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === '确定');
        if (confirmBtn) confirmBtn.click();
        return true;
      })()
    `);
    await sleep(1000);
  }

  // 12. 可见性设置
  if (args.visibility && args.visibility !== "公开") {
    console.log(`🔒 正在设置可见权限: ${args.visibility}...`);
    requireEval(`设置可见权限 ${args.visibility}`, `
      (() => {
        const all = Array.from(document.querySelectorAll('*'));
        const opt = all.find(el => el.children.length === 0 && (el.innerText || '').trim() === ${JSON.stringify(args.visibility)});
        if (!opt) return false;
        opt.click();
        return true;
      })()
    `);
    await sleep(500);
  }

  // 13. 定时发布配置
  if (args.schedule) {
    console.log(`⏰ 正在配置定时发布: ${args.schedule}...`);
    requireEval("打开定时发布", `
      (() => {
        const all = Array.from(document.querySelectorAll('*'));
        const opt = all.find(el => el.children.length === 0 && (el.innerText || '').trim() === '定时发布');
        if (!opt) return false;
        opt.click();
        return true;
      })()
    `);
    await sleep(1200);

    const fillDateRes = runCli("fill", ["--sel=input[placeholder*='日期和时间']", `--val=${args.schedule}`]);
    if (!fillDateRes.ok) {
      requireEval("填写定时时间", `
        (() => {
          const input = document.querySelector("input[placeholder*='日期和时间']") ||
            Array.from(document.querySelectorAll("input")).find(i => /\\d{4}-\\d{2}-\\d{2}/.test(i.value));
          if (!input) return false;
          input.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(input, ${JSON.stringify(args.schedule)});
          else input.value = ${JSON.stringify(args.schedule)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          return true;
        })()
      `);
    } else {
      runCli("press", ["Enter", "--sel=input[placeholder*='日期和时间']"]);
    }
    await sleep(800);
  }

  // 14. 页面审查与截图存证
  runCli("press", ["Escape"]);
  await sleep(1000);

  console.log("📸 正在截取最终投稿表单核对图 (Full-Page)...");
  saveScreenshot(args.outScreenshot, ["--full-page"]);

  if (!args.publish) {
    console.log("🔒 --dry-run：表单已填写，未触发最终点击。");
    console.log("👉 去掉 --dry-run 重新运行，或在浏览器中人工核对后点击「发布」。");
    return;
  }

  // 15. 触发真实发布
  console.log("🚀 正在点击「发布」提交作品...");
  requireEval("点击「发布」", `
    (() => {
      const submitBtn = document.querySelector('button.button-dhlUZE.primary-cECiOJ') ||
        Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === '发布');
      if (!submitBtn) return false;
      submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      submitBtn.click();
      return true;
    })()
  `);

  console.log("⏳ 等待作品提交响应与状态跳转...");
  let submitted = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(1500);

    // 自动应对任何二次确认弹框（如“继续发布”、“确定发布”）
    runEval(`
      (() => {
        const dialogBtns = Array.from(document.querySelectorAll('.semi-modal button, [role="dialog"] button'));
        const confirmBtn = dialogBtns.find(b => {
          const t = (b.innerText || '').trim();
          return t === '确定' || t === '确认' || t === '继续发布' || t === '确定发布';
        });
        if (confirmBtn) confirmBtn.click();
      })()
    `);

    const contentRes = runCli("content", ["--max-chars=500"]);
    const url = contentRes.result?.url || "";
    const text = contentRes.result?.text || "";
    if (url.includes("/content/manage") || text.includes("作品管理") || text.includes("发布成功")) {
      submitted = true;
      console.log("✅ 稿件已成功提交并跳转至内容管理台！");
      break;
    }
  }

  if (submitted) {
    await sleep(2000);
    saveScreenshot(args.outScreenshot.replace(/\.png$/, "_submitted.png"), ["--full-page"]);
    console.log("🎉 抖音作品已成功发布！");
  } else {
    console.error("⚠️ 已点击发布，但页面未在预期时间内跳转至管理台，无法确认结果。请在浏览器中核对发布状态。");
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error("执行异常:", err);
  process.exit(1);
});
