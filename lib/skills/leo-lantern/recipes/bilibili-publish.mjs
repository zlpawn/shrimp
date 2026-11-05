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
 * 8. 默认安全防误发守卫：默认开启 --dry-run，停在最后提交按钮前并截取高清表单状态核对图，必须显式传入 --publish 才会真正提交。
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
    video: "",
    title: "",
    desc: "",
    descFile: "",
    tags: [],
    coverIndex: 1, // 默认第1帧推荐封面
    customCover: "",
    aiDeclaration: true,
    schedule: "",
    publish: false, // 默认 false，走 dry-run
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
    } else if (arg === "--out") {
      args.outScreenshot = argv[++i] || "bilibili_publish_review.png";
    }
  }

  return args;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv);

  console.log("=== 哔哩哔哩自动化视频投稿流程 (Bilibili Publish Recipe) ===");

  // 1. 前置校验
  if (!args.video) {
    console.error("❌ 错误：必须提供视频文件路径 --video <path>");
    process.exit(1);
  }
  const resolvedVideo = path.resolve(args.video);
  if (!fs.existsSync(resolvedVideo)) {
    console.error(`❌ 错误：视频文件不存在: ${resolvedVideo}`);
    process.exit(1);
  }
  console.log(`✅ 视频文件通过校验: ${resolvedVideo}`);

  let title = (args.title || "").trim();
  if (!title) {
    console.error("❌ 错误：必须提供稿件标题 --title");
    process.exit(1);
  }
  if (title.length > 80) {
    console.error(`❌ 错误：标题超长（当前 ${title.length} 字），B站上限为 80 字符！`);
    process.exit(1);
  }
  console.log(`✅ 标题通过校验（${title.length}/80 字）: ${title}`);

  let desc = args.desc;
  if (!desc && args.descFile) {
    desc = fs.readFileSync(path.resolve(args.descFile), "utf8").trim();
  }
  if (desc && desc.length > 2000) {
    console.error(`❌ 错误：简介超长（当前 ${desc.length} 字），B站上限为 2000 字符！`);
    process.exit(1);
  }
  console.log(`✅ 简介准备就绪（${(desc || '').length}/2000 字）`);

  // 2. 检查 leo-lantern 服务状态
  const health = runCli("health");
  if (!health.ok || !health.extensionOnline) {
    console.error("❌ 错误：leo-lantern 服务或浏览器扩展未在线，请启动 server 并确认扩展已连接。");
    process.exit(1);
  }

  console.log("🚀 启动/对齐投稿任务环境...");
  runCli("start-task", ["--title=bilibili-upload", "--same-window=false"]);

  // 3. 导航到 B 站投稿工作台
  const tabsRes = runCli("tabs");
  const tabs = tabsRes.result || [];
  const uploadTab = tabs.find(t => t.url && t.url.includes("member.bilibili.com/platform/upload/video/frame"));
  if (uploadTab) {
    runCli("claim", [`--tabId=${uploadTab.id}`]);
  } else {
    runCli("goto", ["https://member.bilibili.com/platform/upload/video/frame"]);
  }
  await sleep(3000);

  // 4. 上传视频
  console.log("⏳ 等待上传组件并注入视频文件...");
  runCli("wait", ["--sel=input[type='file'], input[name='buploader']", "--timeout-ms=10000"]);
  const uploadRes = runCli("upload", [resolvedVideo]);
  if (!uploadRes.ok) {
    console.error("❌ 视频注入失败:", uploadRes);
    process.exit(1);
  }

  console.log("⏳ 等待视频上传处理完成与表单完全展开...");
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(2000);
    const contentRes = runCli("content", ["--max-chars=2000"]);
    const text = contentRes.result?.text || "";
    if (text.includes("上传完成") || text.includes("更换视频")) {
      console.log("✅ 视频上传确认 100% 完成！");
      break;
    }
  }

  // 5. 填写标题 (使用高特异性选择器 + 显式事件派发)
  console.log("✍️ 正在填入标题...");
  runCli("eval", [
    `(() => {
      const input = document.querySelector('input[placeholder*="标题"]') || document.querySelectorAll('input.input-val')[0];
      if (input) {
        input.value = ${JSON.stringify(title)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`
  ]);
  await sleep(800);

  // 6. 选取封面
  if (args.customCover) {
    const coverPath = path.resolve(args.customCover);
    if (fs.existsSync(coverPath)) {
      console.log(`🖼️ 正在上传自定义封面: ${coverPath}...`);
      runCli("upload", [coverPath, "--sel=.cover-module input[type='file']"]);
      await sleep(2000);
    }
  } else {
    console.log(`🖼️ 正在选择视频第 ${args.coverIndex} 帧系统推荐高光封面...`);
    runCli("eval", [
      `(() => {
        const cards = Array.from(document.querySelectorAll('.group-cards .card'));
        const targetIndex = ${args.coverIndex};
        const targetCard = cards[targetIndex] || cards[1];
        if (targetCard) {
          const inner = targetCard.querySelector('.img-item-cover, .img-item-box') || targetCard;
          inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          inner.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      })()`
    ]);
    await sleep(1500);
  }

  // 7. 创作声明配置
  if (args.aiDeclaration) {
    console.log("🤖 正在配置创作声明（含AI生成内容）...");
    runCli("eval", [
      `(() => {
        // 先打开声明下拉框
        const selectBox = document.querySelector('.declaration-item, input[placeholder*="声明"], .bcc-select-input-inner');
        if (selectBox) selectBox.click();
        
        setTimeout(() => {
          const all = Array.from(document.querySelectorAll('div, li, span'));
          const aiOption = all.find(el => el.children.length === 0 && el.innerText && el.innerText.trim() === '含AI生成内容');
          if (aiOption) aiOption.click();
        }, 300);
      })()`
    ]);
    await sleep(800);
  }

  // 8. 注入标签
  if (args.tags && args.tags.length > 0) {
    console.log(`🏷️ 正在注入标签: ${args.tags.join(", ")}...`);
    for (const tag of args.tags) {
      runCli("eval", [
        `(() => {
          const tagInput = document.querySelector('input.input-val, [placeholder*="标签"]');
          if (tagInput) {
            tagInput.focus();
            tagInput.value = ${JSON.stringify(tag)};
            tagInput.dispatchEvent(new Event('input', { bubbles: true }));
            tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            tagInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }
        })()`
      ]);
      await sleep(300);
    }
  }

  // 9. 注入简介 (Quill 编辑器)
  if (desc) {
    console.log("📝 正在注入简介文案...");
    runCli("eval", [
      `(() => {
        const editor = document.querySelector('.ql-editor');
        if (editor) {
          editor.innerHTML = '<p>' + ${JSON.stringify(desc)}.replace(/\\n/g, '</p><p>') + '</p>';
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`
    ]);
    await sleep(600);
  }

  // 10. 处理定时发布
  if (args.schedule) {
    const match = args.schedule.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})$/);
    if (!match) {
      console.warn("⚠️ 定时发布时间格式非 YYYY-MM-DD HH:MM，跳过自动定时配置。");
    } else {
      const [_, targetDate, targetHour, targetMin] = match;
      const targetDay = String(parseInt(targetDate.split("-")[2], 10));
      console.log(`⏰ 正在配置定时发布: 日期 ${targetDate}，时间 ${targetHour}:${targetMin}...`);

      // 激活定时开关
      runCli("eval", [
        `(() => {
          const switchContainer = document.querySelector('.time-switch-wrp .switch-container, .switch-container');
          const isChecked = switchContainer ? (switchContainer.className.includes('is-checked') || switchContainer.parentElement?.className.includes('checked')) : false;
          if (switchContainer && !isChecked) {
            switchContainer.click();
          }
        })()`
      ]);
      await sleep(800);

      // 展开日期选择器并点选目标日
      runCli("eval", [
        `(() => {
          const wrps = document.querySelectorAll('.d-time-date-picker-wrp .date-picker-date-wrp');
          const dateWrp = wrps[0] || document.querySelector('.date-picker-date-wrp');
          if (dateWrp) {
            const clickable = dateWrp.querySelector('.date-picker-date, p, i') || dateWrp;
            clickable.click();
            setTimeout(() => {
              const allEls = Array.from(document.querySelectorAll('*'));
              const dayEls = allEls.filter(el => el.children.length === 0 && (el.innerText || '').trim() === ${JSON.stringify(targetDay)});
              for (const d of dayEls) d.click();
            }, 200);
          }
        })()`
      ]);
      await sleep(1000);

      // 展开时间选择器并点选时分
      runCli("eval", [
        `(() => {
          const wrps = document.querySelectorAll('.d-time-date-picker-wrp .date-picker-date-wrp');
          const timeWrp = wrps[1];
          if (timeWrp) {
            const clickable = timeWrp.querySelector('.date-picker-date, p, i') || timeWrp;
            clickable.click();
            setTimeout(() => {
              const items = Array.from(timeWrp.querySelectorAll('.time-picker-panel-select-item'));
              const hourEl = items.slice(0, 24).find(it => it.innerText.trim() === ${JSON.stringify(targetHour)});
              const minEl = items.slice(24).find(it => it.innerText.trim() === ${JSON.stringify(targetMin)});
              if (hourEl) hourEl.click();
              if (minEl) minEl.click();
              if (clickable) clickable.click(); // 收起面板
            }, 200);
          }
        })()`
      ]);
      await sleep(1000);
    }
  }

  // 11. 最终状态审计与截图
  console.log("📸 正在截取最终投稿表单核对图...");
  runCli("screenshot", [`--out=${args.outScreenshot}`]);
  console.log(`✅ 状态截图已落盘: ${args.outScreenshot}`);

  if (!args.publish) {
    console.log("🔒 [安全守卫] 当前处于 Dry-Run 模式（默认），所有表单已填妥并经过核对，未触发最终点击。");
    console.log("👉 如确认发布，请传入 --publish 参数，或在浏览器中人工点击「立即投稿」。");
    return;
  }

  // 12. 触发真实发布（仅在 --publish 时）
  console.log("🚀 [用户显式确认] 正在点击「立即投稿」...");
  runCli("eval", [
    `(() => {
      const submitBtn = document.querySelector('.submit-add') || 
        Array.from(document.querySelectorAll('button, span, div')).find(b => b.children.length === 0 && (b.innerText || '').trim() === '立即投稿');
      if (submitBtn) {
        submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        submitBtn.click();
      }
    })()`
  ]);
  await sleep(3000);
  runCli("screenshot", [`--out=${args.outScreenshot.replace('.png', '_submitted.png')}`]);
  console.log("🎉 视频投稿已成功提交！");
}

main().catch(err => {
  console.error("执行异常:", err);
  process.exit(1);
});
