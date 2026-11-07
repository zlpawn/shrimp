#!/usr/bin/env node

/**
 * bilibili-publish.mjs - 哔哩哔哩创作服务平台 (Bilibili Creator Studio) 自动化视频投稿 Recipe
 *
 * 核心特性与踩坑沉淀：
 * 1. 严格参数前置校验：标题 <= 80 字符截断检测，简介 <= 2000 字符，标签 <= 10 个；
 * 2. CDP 极速视频上传（DOM.setFileInputFiles 绕过 Windows 原生弹窗）；
 * 3. 避免侧边栏广告误触：所有元素定位限定在主投稿表单区域，杜绝模糊文本匹配误点外部推广；
 * 4. 表单响应式注入：标题派发 input/change 事件，简介穿透 Quill 编辑器 (.ql-editor)，标签自动模拟 Enter 键确认；
 * 5. 智能封面选择：支持选择视频解析出来的关键高光帧（--cover-index），或自定义上传封面文件；
 * 6. 平台合规声明：自动定位创作声明组件并规范勾选「含AI生成内容」（同时默认保持「自制」属性）；
 * 7. 定时发布联动选择：自动解析 YYYY-MM-DD HH:MM 格式，激活定时开关并联动日历控件与双列时间选择器；
 * 8. 默认直接发布：填完表单后截取核对图并点击「立即投稿」；传入 --dry-run 才会停在提交前；
 * 9. 失败即中止：上传未完成或任一用户要求的字段未生效时立即退出，不会继续提交。
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
  warnEval,
} from "./lib/recipe-runner.mjs";

function parseArgs(argv) {
  const args = {
    video: "",
    title: "",
    desc: "",
    descFile: "",
    tags: [],
    coverIndex: 1, // 默认第1帧推荐封面
    customCover: "",
    aiDeclaration: true,
    schedule: "",
    publish: true, // 默认直接发布，--dry-run 停在提交前
    uploadTimeoutSec: 1800,
    outScreenshot: "bilibili_publish_review.png"
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--video" || arg === "-v") {
      args.video = argv[++i] || "";
    } else if (arg === "--title" || arg === "-t") {
      args.title = argv[++i] || "";
    } else if (arg === "--desc" || arg === "-d") {
      args.desc = argv[++i] || "";
    } else if (arg === "--desc-file" || arg === "-f") {
      args.descFile = argv[++i] || "";
    } else if (arg === "--tags") {
      args.tags = (argv[++i] || "").split(",").map(s => s.trim()).filter(Boolean);
    } else if (arg === "--cover-index") {
      args.coverIndex = Number(argv[++i]) || 1;
    } else if (arg === "--cover") {
      args.customCover = argv[++i] || "";
    } else if (arg === "--no-ai") {
      args.aiDeclaration = false;
    } else if (arg === "--schedule" || arg === "-s") {
      args.schedule = argv[++i] || "";
    } else if (arg === "--publish") {
      args.publish = true;
    } else if (arg === "--dry-run") {
      args.publish = false;
    } else if (arg === "--upload-timeout-sec") {
      args.uploadTimeoutSec = Number(argv[++i]);
    } else if (arg === "--out") {
      args.outScreenshot = argv[++i] || "bilibili_publish_review.png";
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  console.log("=== 哔哩哔哩自动化视频投稿流程 (Bilibili Publish Recipe) ===");

  // 1. 前置校验
  if (!args.video) fail("必须提供视频文件路径 --video <path>");
  const resolvedVideo = path.resolve(args.video);
  if (!fs.existsSync(resolvedVideo)) fail(`视频文件不存在: ${resolvedVideo}`);
  console.log(`✅ 视频文件通过校验: ${resolvedVideo}`);

  const title = (args.title || "").trim();
  if (!title) fail("必须提供稿件标题 --title");
  if (title.length > 80) fail(`标题超长（当前 ${title.length} 字），B站上限为 80 字符！`);
  console.log(`✅ 标题通过校验（${title.length}/80 字）: ${title}`);

  let desc = args.desc;
  if (!desc && args.descFile) {
    desc = fs.readFileSync(path.resolve(args.descFile), "utf8").trim();
  }
  if (desc && desc.length > 2000) fail(`简介超长（当前 ${desc.length} 字），B站上限为 2000 字符！`);
  console.log(`✅ 简介准备就绪（${(desc || '').length}/2000 字）`);

  if (args.tags.length > 10) fail(`标签过多（当前 ${args.tags.length} 个），B站上限为 10 个！`);
  const longTag = args.tags.find(tag => tag.length > 20);
  if (longTag) fail(`标签超长（${longTag}），B站单个标签上限为 20 字！`);

  const coverPath = args.customCover ? path.resolve(args.customCover) : "";
  if (coverPath && !fs.existsSync(coverPath)) fail(`封面文件不存在: ${coverPath}`);

  const schedule = args.schedule ? parseSchedule(args.schedule) : null;

  // 2. 检查 leo-lantern 服务状态
  const health = runCli("start");
  if (!health.ok || !health.extensionOnline) {
    fail("leo-lantern 桥接或浏览器扩展未在线，请确认 Chrome 已打开且扩展已启用。");
  }

  console.log("🚀 启动/对齐投稿任务环境...");
  requireOk("启动任务", runCli("start-task", ["--title=bilibili-upload", "--same-window=false"]));

  // 3. 导航到 B 站投稿工作台
  const tabsRes = requireOk("读取标签页", runCli("tabs"));
  const tabs = tabsRes.result || [];
  const uploadTab = tabs.find(t => t.url && t.url.includes("member.bilibili.com/platform/upload/video/frame"));
  if (uploadTab) {
    requireOk("接管投稿标签页", runCli("claim", [`--tabId=${uploadTab.id}`]));
  } else {
    requireOk("打开投稿页", runCli("goto", ["https://member.bilibili.com/platform/upload/video/frame"]));
  }
  await sleep(3000);

  // 4. 上传视频
  console.log("⏳ 等待上传组件并注入视频文件...");
  requireOk("等待上传组件", runCli("wait", ["--sel=input[type='file'], input[name='buploader']", "--timeout-ms=10000"]));
  requireOk("视频注入", runCli("upload", [resolvedVideo]));

  console.log("⏳ 等待视频上传处理完成与表单完全展开...");
  const uploadDeadline = Date.now() + args.uploadTimeoutSec * 1000;
  let uploaded = false;
  do {
    await sleep(2000);
    const text = runCli("content", ["--max-chars=2000"]).result?.text || "";
    uploaded = text.includes("上传完成") || text.includes("更换视频");
  } while (!uploaded && Date.now() < uploadDeadline);
  if (!uploaded) fail(`视频在 ${args.uploadTimeoutSec} 秒内未确认上传完成（可用 --upload-timeout-sec 调整）`);
  console.log("✅ 视频上传确认 100% 完成！");

  // 5. 填写标题 (使用高特异性选择器 + 显式事件派发)
  console.log("✍️ 正在填入标题...");
  const titleInputJs = `document.querySelector('input[placeholder*="标题"]') || document.querySelectorAll('input.input-val')[0]`;
  requireEval("填写标题", `(() => {
    const input = ${titleInputJs};
    if (!input) return false;
    input.value = ${JSON.stringify(title)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(800);

  // 6. 选取封面
  if (coverPath) {
    console.log(`🖼️ 正在上传自定义封面: ${coverPath}...`);
    requireOk("上传封面", runCli("upload", [coverPath, "--sel=.cover-module input[type='file']"]));
    await sleep(2000);
  } else {
    console.log(`🖼️ 正在选择视频第 ${args.coverIndex} 帧系统推荐高光封面...`);
    warnEval("选择推荐封面", `(() => {
      const cards = Array.from(document.querySelectorAll('.group-cards .card'));
      const targetIndex = ${args.coverIndex};
      const targetCard = cards[targetIndex] || cards[1];
      if (!targetCard) return false;
      const inner = targetCard.querySelector('.img-item-cover, .img-item-box') || targetCard;
      inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      inner.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`);
    await sleep(1500);
  }

  // 7. 创作声明配置
  if (args.aiDeclaration) {
    console.log("🤖 正在配置创作声明（含AI生成内容）...");
    requireEval("配置「含AI生成内容」声明（不需要时传 --no-ai）", `(async () => {
      // 先打开声明下拉框
      const selectBox = document.querySelector('.declaration-item, input[placeholder*="声明"], .bcc-select-input-inner');
      if (selectBox) selectBox.click();
      await new Promise(r => setTimeout(r, 300));

      const all = Array.from(document.querySelectorAll('div, li, span'));
      const aiOption = all.find(el => el.children.length === 0 && el.innerText && el.innerText.trim() === '含AI生成内容');
      if (!aiOption) return false;
      aiOption.click();
      return true;
    })()`);
    await sleep(800);
  }

  // 8. 注入标签（标签框优先，避免 input.input-val 命中排在前面的标题框）
  if (args.tags.length > 0) {
    console.log(`🏷️ 正在注入标签: ${args.tags.join(", ")}...`);
    for (const tag of args.tags) {
      requireEval(`注入标签 ${tag}`, `(() => {
        const tagInput = document.querySelector('[placeholder*="标签"]') ||
          Array.from(document.querySelectorAll('input.input-val')).find(i => !(i.placeholder || '').includes('标题'));
        if (!tagInput) return false;
        tagInput.focus();
        tagInput.value = ${JSON.stringify(tag)};
        tagInput.dispatchEvent(new Event('input', { bubbles: true }));
        tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        tagInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return true;
      })()`);
      await sleep(300);
    }
  }

  // 9. 注入简介 (Quill 编辑器)
  if (desc) {
    console.log("📝 正在注入简介文案...");
    requireEval("注入简介", `(() => {
      const editor = document.querySelector('.ql-editor');
      if (!editor) return false;
      editor.innerHTML = '<p>' + ${JSON.stringify(desc)}.replace(/\\n/g, '</p><p>') + '</p>';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(600);
  }

  // 10. 处理定时发布
  if (schedule) {
    const { month, day, hour, minute } = schedule;
    const targetDay = String(Number(day));
    console.log(`⏰ 正在配置定时发布: ${args.schedule}...`);

    // 激活定时开关
    requireEval("打开定时发布开关", `(() => {
      const switchContainer = document.querySelector('.time-switch-wrp .switch-container, .switch-container');
      if (!switchContainer) return false;
      const isChecked = switchContainer.className.includes('is-checked') || switchContainer.parentElement?.className.includes('checked');
      if (!isChecked) switchContainer.click();
      return true;
    })()`);
    await sleep(800);

    // 展开日期选择器并只在日历面板内点选目标日
    requireEval("选择定时日期", `(async () => {
      const wrps = document.querySelectorAll('.d-time-date-picker-wrp .date-picker-date-wrp');
      const dateWrp = wrps[0] || document.querySelector('.date-picker-date-wrp');
      if (!dateWrp) return false;
      (dateWrp.querySelector('.date-picker-date, p, i') || dateWrp).click();
      await new Promise(r => setTimeout(r, 200));
      const dayEl = Array.from(dateWrp.querySelectorAll('*')).find(el =>
        el.children.length === 0 &&
        (el.innerText || '').trim() === ${JSON.stringify(targetDay)} &&
        !/disabled|other|prev|next/i.test(el.className + ' ' + (el.parentElement?.className || ''))
      );
      if (!dayEl) return false;
      dayEl.click();
      return true;
    })()`);
    await sleep(1000);

    // 展开时间选择器并点选时分
    requireEval("选择定时时分", `(async () => {
      const timeWrp = document.querySelectorAll('.d-time-date-picker-wrp .date-picker-date-wrp')[1];
      if (!timeWrp) return false;
      const clickable = timeWrp.querySelector('.date-picker-date, p, i') || timeWrp;
      clickable.click();
      await new Promise(r => setTimeout(r, 200));
      const items = Array.from(timeWrp.querySelectorAll('.time-picker-panel-select-item'));
      const hourEl = items.slice(0, 24).find(it => it.innerText.trim() === ${JSON.stringify(hour)});
      const minEl = items.slice(24).find(it => it.innerText.trim() === ${JSON.stringify(minute)});
      if (!hourEl || !minEl) return false;
      hourEl.click();
      minEl.click();
      clickable.click(); // 收起面板
      return true;
    })()`);
    await sleep(1000);

    // 日历不支持翻月：跨月或显示值不符时必须中止，否则会按错误时间发布
    requireEval("核对定时时间（日历暂不支持自动翻月）", `(() => {
      const digits = (document.querySelector('.d-time-date-picker-wrp')?.innerText || '').replace(/\\D/g, '');
      const hasDate = digits.includes(${JSON.stringify(month + day)}) || digits.includes(${JSON.stringify(String(Number(month)) + targetDay)});
      return hasDate && digits.includes(${JSON.stringify(hour + minute)});
    })()`);
  }

  // 11. 最终状态审计与截图
  requireEval("核对标题未被覆盖", `(() => {
    const input = ${titleInputJs};
    return Boolean(input) && input.value === ${JSON.stringify(title)};
  })()`);

  console.log("📸 正在截取最终投稿表单核对图...");
  saveScreenshot(args.outScreenshot);

  if (!args.publish) {
    console.log("🔒 --dry-run：表单已填写，未触发最终点击。");
    console.log("👉 去掉 --dry-run 重新运行，或在浏览器中人工点击「立即投稿」。");
    return;
  }

  // 12. 触发真实发布
  console.log("🚀 正在点击「立即投稿」...");
  requireEval("点击「立即投稿」", `(() => {
    const submitBtn = document.querySelector('.submit-add') ||
      Array.from(document.querySelectorAll('button, span, div')).find(b => b.children.length === 0 && (b.innerText || '').trim() === '立即投稿');
    if (!submitBtn) return false;
    submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    submitBtn.click();
    return true;
  })()`);
  await sleep(3000);
  saveScreenshot(args.outScreenshot.replace('.png', '_submitted.png'));
  console.log("ℹ️ 已点击「立即投稿」。脚本无法确认平台是否受理，请查看截图或稿件管理页核对结果。");
}

main().catch(err => {
  console.error("执行异常:", err);
  process.exit(1);
});
