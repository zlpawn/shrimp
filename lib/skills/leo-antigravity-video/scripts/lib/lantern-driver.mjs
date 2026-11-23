import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 动态发现与定位 leo-lantern CLI 入口（零固定写死目录）
 * 优先级：
 * 1. 环境变量 LEO_LANTERN_CLI
 * 2. 系统 PATH 中的 leo-lantern
 * 3. 动态扫描同级/各标准技能目录
 * 4. 若均未找到，抛出友好指引，提示大模型去定位 leo-lantern 技能
 */
export function resolveLanternCli() {
  if (process.env.LEO_LANTERN_CLI && fs.existsSync(process.env.LEO_LANTERN_CLI)) {
    return process.env.LEO_LANTERN_CLI;
  }

  try {
    const whichCmd = process.platform === "win32" ? "where leo-lantern" : "which leo-lantern";
    const binPath = execSync(whichCmd, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim().split("\n")[0];
    if (binPath && fs.existsSync(binPath)) {
      return binPath;
    }
  } catch {}

  const candidateDirs = [
    path.resolve(__dirname, "../../../leo-lantern"),
    path.resolve(__dirname, "../../leo-lantern"),
    path.join(os.homedir(), ".gemini", "config", "skills", "leo-lantern"),
    path.join(os.homedir(), ".agents", "skills", "leo-lantern"),
    path.join(os.homedir(), ".shrimp", "skills", "leo-lantern")
  ];

  for (const dir of candidateDirs) {
    const cliFile = path.join(dir, "scripts", "cli", "index.mjs");
    if (fs.existsSync(cliFile)) {
      return cliFile;
    }
  }

  throw new Error(
    "未找到 leo-lantern 技能 CLI！\n" +
    "【Agent 依赖调度指引】：本技能依赖 leo-lantern 提供的 Chrome CDP 自动化通道。\n" +
    "请大模型通过以下方式定位并加载：\n" +
    "1. 检索已安装技能中的 leo-lantern（参考其 SKILL.md 中的执行入口）；\n" +
    "2. 或设置环境变量 LEO_LANTERN_CLI 指向 leo-lantern 的 scripts/cli/index.mjs；\n" +
    "3. 若尚未安装，请引导用户安装或启用 leo-lantern 技能。"
  );
}

function runLantern(cmd, args = []) {
  const cliPath = resolveLanternCli();
  const isDirectBin = !cliPath.endsWith(".mjs") && !cliPath.endsWith(".js");
  const spawnBin = isDirectBin ? cliPath : "node";
  const spawnArgs = isDirectBin ? [cmd, ...args] : [cliPath, cmd, ...args];

  const res = spawnSync(spawnBin, spawnArgs, { encoding: "utf8" });
  if (res.status !== 0) {
    try {
      return { ok: false, error: JSON.parse(res.stderr || res.stdout || "{}").error };
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

function runLanternEval(code) {
  const tmpFile = path.join(os.tmpdir(), `gemini_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmpFile, code, "utf8");
    return runLantern("eval", ["--file", tmpFile]);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LanternDriver {
  constructor(options = {}) {
    this.taskId = null;
    this.claimedTabId = null;
    this.options = options;
  }

  // 1. 初始化会话并定位/打开 Gemini 标签页
  async initSession(newChat = true) {
    runLantern("start");

    const tabsRes = runLantern("tabs");
    let existingTab = null;
    if (tabsRes.ok && Array.isArray(tabsRes.result)) {
      existingTab = tabsRes.result.find(t => t.url && t.url.includes("gemini.google.com"));
    }

    const taskRes = runLantern("start-task", ["--title", "gemini-video", "--same-window"]);
    if (!taskRes.ok) {
      throw new Error(`无法启动 Leo Lantern 任务: ${JSON.stringify(taskRes.error || taskRes)}`);
    }

    if (existingTab) {
      this.claimedTabId = existingTab.id;
      runLantern("claim", ["--tabId", String(existingTab.id)]);
      if (newChat && existingTab.url && existingTab.url.includes("/app/")) {
        runLantern("goto", ["https://gemini.google.com/app?pli=1"]);
        await sleep(2500);
      }
    } else {
      runLantern("goto", ["https://gemini.google.com/app?pli=1"]);
      await sleep(3500);
    }

    return true;
  }

  // 2. 检查并激活「制作视频」模式与参数配置
  async activateVideoMode(ratio = "16:9", format = "mp4") {
    const isVideoModeActiveCode = `(() => {
      const chip = document.querySelector('button[aria-label*="取消选择“视频”"]');
      const input = document.querySelector('rich-textarea, div[contenteditable="true"]');
      return !!chip || (input && input.innerText.includes("视频"));
    })()`;

    const activeRes = runLanternEval(isVideoModeActiveCode);
    const alreadyActive = activeRes?.evalResult;

    if (!alreadyActive) {
      runLanternEval(`(() => {
        const btn = document.querySelector('button[aria-label="上传和工具"]');
        if (btn) btn.click();
      })()`);
      await sleep(1000);

      runLanternEval(`(() => {
        const items = Array.from(document.querySelectorAll('gem-menu-item'));
        const target = items.find(el => el.innerText.includes("制作视频"));
        if (target) target.click();
      })()`);
      await sleep(1000);

      runLanternEval(`(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const expBtn = btns.find(b => b.innerText.includes("立即体验"));
        if (expBtn) expBtn.click();
      })()`);
      await sleep(1000);
    }

    // 检查并调整宽高比（横向 16:9 / 纵向 9:16）
    const targetRatioKeyword = ratio === "9:16" ? "纵向" : "横向";
    runLanternEval(`(() => {
      const ratioBtn = document.querySelector('button[aria-label*="宽高比"]');
      if (ratioBtn && !ratioBtn.innerText.includes("${targetRatioKeyword}")) {
        ratioBtn.click();
        setTimeout(() => {
          const options = Array.from(document.querySelectorAll('.cdk-overlay-container button, .mat-mdc-menu-panel button'));
          const targetOpt = options.find(b => b.innerText.includes("${targetRatioKeyword}"));
          if (targetOpt) targetOpt.click();
        }, 300);
      }
    })()`);
    await sleep(800);

    // 检查并调整格式（视频 MP4 / GIF）
    const isGif = format.toLowerCase() === "gif";
    const targetFormatKeyword = isGif ? "GIF" : "视频";
    runLanternEval(`(() => {
      const formatBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === "格式" || b.innerText.trim() === "视频" || b.innerText.trim() === "GIF");
      if (formatBtn && !formatBtn.innerText.includes("${targetFormatKeyword}")) {
        formatBtn.click();
        setTimeout(() => {
          const options = Array.from(document.querySelectorAll('.cdk-overlay-container button, .mat-mdc-menu-panel button'));
          const targetOpt = options.find(b => b.innerText.includes("${targetFormatKeyword}"));
          if (targetOpt) targetOpt.click();
        }, 300);
      }
    })()`);
    await sleep(600);

    return true;
  }

  // 3. 注入 Prompt 并发送
  async submitPrompt(promptText) {
    const fillCode = `(() => {
      const input = document.querySelector('rich-textarea div[contenteditable="true"], div[contenteditable="true"]');
      if (input) {
        input.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(promptText)});
        return true;
      }
      return false;
    })()`;

    const fillRes = runLanternEval(fillCode);
    if (!fillRes?.evalResult) {
      throw new Error("无法在页面中找到输入框注入 Prompt");
    }
    await sleep(800);

    // 优先点击发送按钮
    const sendClickRes = runLanternEval(`(() => {
      const sendBtn = document.querySelector('button[aria-label*="发送"], button.send-button, [data-test-id="send-button"]');
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        return true;
      }
      return false;
    })()`);

    if (!sendClickRes?.evalResult) {
      runLantern("press", ["Enter", "--sel=div[contenteditable='true']"]);
    }

    return true;
  }

  // 4. 等待视频生成完成
  async waitForVideoReady(timeoutSec = 180, onProgress = null) {
    const startTime = Date.now();
    let lastLoggedSec = 0;

    while ((Date.now() - startTime) / 1000 < timeoutSec) {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      if (elapsedSec - lastLoggedSec >= 10) {
        lastLoggedSec = elapsedSec;
        if (onProgress) onProgress(elapsedSec);
      }

      const pollRes = runLanternEval(`(() => {
        // 1. 检查是否存在错误或拦截提示
        const errorEl = document.querySelector('.error-message, .model-response-error, [role="alert"]');
        if (errorEl && errorEl.innerText.length > 5) {
          return { error: errorEl.innerText.trim() };
        }

        // 2. 检查是否有生成的视频播放器
        const video = document.querySelector('generated-video video[src]');
        if (video && video.src && !video.src.startsWith('blob:') && video.src.startsWith('http')) {
          return {
            ready: true,
            src: video.src,
            pageUrl: window.location.href,
            duration: video.duration || null
          };
        }

        // 3. 检查是否有明确提示在生成中
        const inProgress = Array.from(document.querySelectorAll('model-response, .model-response-text')).some(
          el => el.innerText && el.innerText.includes("正在生成视频")
        );

        // 4. 如果没有视频且回答了纯文本（非在生成中），说明 Prompt 触发了模型拒绝
        const lastResp = document.querySelector('model-response:last-of-type');
        if (lastResp && !inProgress && !video) {
          const text = lastResp.innerText?.trim();
          if (text && text.includes("设计用途只是处理和生成文本")) {
            return { error: "Gemini 拒绝生成视频（可能触发了影视名称/版权保护）：" + text };
          }
        }

        return { ready: false, inProgress };
      })()`);

      const res = pollRes?.evalResult;
      if (res?.error) {
        throw new Error(res.error);
      }
      if (res?.ready) {
        return res;
      }

      await sleep(3000);
    }

    throw new Error(`等待视频生成超时（超过 ${timeoutSec} 秒），请检查当前网页状态。`);
  }

  // 5. 触发下载并捕获落盘文件
  async triggerDownloadAndCapture(downloadsDir = path.join(os.homedir(), "Downloads"), waitTimeoutSec = 40) {
    const getDownloadFiles = () => {
      if (!fs.existsSync(downloadsDir)) return [];
      return fs.readdirSync(downloadsDir);
    };

    const beforeSet = new Set(getDownloadFiles());

    const clickRes = runLantern("click", ["--sel=button[aria-label='下载视频']"]);
    if (!clickRes.ok) {
      runLanternEval(`(() => {
        const btn = document.querySelector('button[aria-label="下载视频"]');
        if (btn) btn.click();
      })()`);
    }

    const startWait = Date.now();
    while ((Date.now() - startWait) / 1000 < waitTimeoutSec) {
      await sleep(1000);
      const currentFiles = getDownloadFiles();
      const newFiles = currentFiles.filter(f =>
        !beforeSet.has(f) &&
        (f.endsWith(".mp4") || f.endsWith(".gif")) &&
        !f.endsWith(".crdownload") &&
        !f.endsWith(".tmp")
      );

      if (newFiles.length > 0) {
        const fullPath = path.join(downloadsDir, newFiles[0]);
        const stat = fs.statSync(fullPath);
        if (stat.size > 1024) {
          return fullPath;
        }
      }
    }

    throw new Error(`在 ${downloadsDir} 中未捕获到新下载的视频文件`);
  }

  // 6. 结束任务
  endSession() {
    runLantern("end-task");
  }
}
