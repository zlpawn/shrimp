import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 动态发现与定位 leo-lantern CLI 入口（零固定写死目录）
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
    "请确认已安装 leo-lantern 技能，或设置环境变量 LEO_LANTERN_CLI。"
  );
}

export function runLantern(cmd, args = []) {
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

export function runEval(code) {
  const tmpFile = path.join(os.tmpdir(), `flow_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmpFile, code, "utf8");
    return runLantern("eval", ["--file", tmpFile]);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FlowDriver {
  constructor(options = {}) {
    this.options = options;
    this.claimedTabId = null;
    this.projectUrl = null;
  }

  async ensureBridge() {
    const health = runLantern("health");
    if (health.ok && health.result?.extensionOnline) {
      return true;
    }
    console.log("ℹ️ 正在启动 Leo Lantern 桥接服务并连接 Chrome 扩展...");
    const start = runLantern("start");
    if (!start.ok) {
      throw new Error(`Leo Lantern 启动失败: ${JSON.stringify(start.error)}`);
    }
    return true;
  }

  async prepareProject(projectInput) {
    let targetUrl = "https://flow.google.com/";
    if (projectInput) {
      if (projectInput.startsWith("http://") || projectInput.startsWith("https://")) {
        targetUrl = projectInput;
      } else {
        targetUrl = `https://flow.google.com/project/${projectInput}`;
      }
    }

    const tabsRes = runLantern("tabs");
    let existingTabId = null;
    if (tabsRes.ok && Array.isArray(tabsRes.result)) {
      const match = tabsRes.result.find(t => {
        if (projectInput) {
          return t.url && t.url.includes(projectInput);
        }
        return t.url && t.url.includes("flow.google.com/project/");
      });
      if (match) {
        existingTabId = match.id;
        targetUrl = match.url;
      }
    }

    console.log(`🌐 任务目标页面: ${targetUrl}`);
    runLantern("start-task", ["--title=Google Flow Video Generator"]);

    if (existingTabId) {
      console.log(`🔄 接入已有 Flow 标签页 (TabId: ${existingTabId})`);
      runLantern("claim", ["--tabId", String(existingTabId)]);
      this.claimedTabId = existingTabId;
    } else {
      console.log(`🧭 正在导航至: ${targetUrl}`);
      runLantern("goto", [targetUrl]);
    }

    this.projectUrl = targetUrl;

    console.log("⏳ 等待 Google Flow 编辑器就绪...");
    let ready = false;
    for (let i = 0; i < 15; i++) {
      const check = runEval(`(() => {
        const input = document.querySelector('div.ProseMirror');
        const settingsBtn = document.querySelector('button.settings-trigger-button');
        return {
          ready: !!input && !!settingsBtn,
          title: document.title,
          url: location.href
        };
      })()`);
      if (check.ok && check.evalResult?.ready) {
        ready = true;
        break;
      }
      await sleep(1500);
    }

    if (!ready) {
      throw new Error("Google Flow 页面加载超时或未能在页面上找到 Prompt 编辑框与设置按钮");
    }
    console.log("✅ Google Flow 编辑器已成功加载并就绪");
    return targetUrl;
  }

  async configureSettings({ ratio = "16:9", resolution = "720p", count = 1 }) {
    console.log(`⚙️ 正在配置生成参数 (画幅: ${ratio}, 分辨率: ${resolution}, 批次: x${count})...`);

    const openRes = runEval(`(() => {
      const btn = document.querySelector('button.settings-trigger-button');
      if (btn) btn.click();
      return !!btn;
    })()`);

    if (!openRes.ok || !openRes.evalResult) {
      throw new Error("无法点击设置触发器按钮 (button.settings-trigger-button)");
    }

    await sleep(1000);

    const setRes = runEval(`(async () => {
      const toggles = Array.from(document.querySelectorAll('.cdk-overlay-container mat-button-toggle'));
      if (!toggles.length) return { ok: false, error: "未找到设置浮层中的开关按钮" };

      const triggerClick = (el) => {
        const btn = el?.querySelector('button');
        if (btn) {
          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        }
        return false;
      };

      let selectedAspect = null;
      let selectedRes = null;
      let selectedCount = null;

      // 1. 画幅选择
      const targetAspect = "${ratio}";
      const aspectToggle = toggles.find(t => t.innerText.trim().includes(targetAspect));
      if (aspectToggle) {
        triggerClick(aspectToggle);
        selectedAspect = targetAspect;
      }

      // 2. 分辨率选择
      const targetRes = "${resolution}";
      const resToggle = toggles.find(t => t.innerText.trim().includes(targetRes));
      if (resToggle) {
        triggerClick(resToggle);
        selectedRes = targetRes;
      }

      // 3. 数量批次选择 (强制纠偏为 x1 节省点数)
      const targetCount = "x${count}";
      const countToggle = toggles.find(t => t.innerText.trim().startsWith(targetCount));
      if (countToggle) {
        triggerClick(countToggle);
        selectedCount = targetCount;
      }

      await new Promise(r => setTimeout(r, 200));

      const costMatch = document.querySelector('.cdk-overlay-container')?.innerText?.match(/消耗\\s*(\\d+)\\s*个点数/);
      const pointsCost = costMatch ? parseInt(costMatch[1], 10) : null;

      return {
        ok: true,
        selectedAspect,
        selectedRes,
        selectedCount,
        pointsCost
      };
    })()`);

    runLantern("press", ["Escape"]);
    await sleep(300);

    let pointsCost = 60;
    if (!setRes.ok || !setRes.evalResult?.ok) {
      console.warn("⚠️ 参数配置选择可能有未完全生效项，将继续使用当前选定参数");
    } else {
      const { selectedAspect, selectedRes, selectedCount, pointsCost: cost } = setRes.evalResult;
      pointsCost = cost ?? 60;
      console.log(`✅ 参数配置完毕 [画幅: ${selectedAspect || ratio}, 分辨率: ${selectedRes || resolution}, 批次: ${selectedCount || ("x" + count)}]，单次消耗点数: ${pointsCost}`);
    }
    return pointsCost;
  }

  async injectPrompt(promptText) {
    console.log(`✍️ 正在输入提示词: "${promptText.slice(0, 80)}${promptText.length > 80 ? "..." : ""}"`);

    const injectRes = runEval(`(async () => {
      const el = document.querySelector('div.ProseMirror');
      if (!el) return { ok: false, error: "未找到 div.ProseMirror 输入框" };

      const prompt = ${JSON.stringify(promptText)};
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, prompt);

      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: prompt }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: prompt }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      let isGenBtnEnabled = false;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 100));
        const genBtn = document.querySelector('button.generate-icon-button');
        if (genBtn && !genBtn.hasAttribute('disabled') && !genBtn.classList.contains('mat-mdc-button-disabled')) {
          isGenBtnEnabled = true;
          break;
        }
      }

      return {
        ok: true,
        textLength: el.innerText.trim().length,
        isGenBtnEnabled
      };
    })()`);

    if (!injectRes.ok || !injectRes.evalResult?.ok) {
      throw new Error(`提示词注入失败: ${injectRes.error || "未知异常"}`);
    }

    if (!injectRes.evalResult.isGenBtnEnabled) {
      throw new Error("提示词注入后，生成按钮仍处于禁用状态，请核查输入内容与当前项目状态");
    }

    console.log("✅ 提示词已成功注入，生成按钮已处于激活状态");
  }

  async getMediaState() {
    const res = runEval(`(() => {
      const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
      const completedTiles = tiles.filter(t => {
        const img = t.querySelector('img.thumbnail');
        const hasSpinner = t.querySelector('mat-progress-bar, mat-spinner, .loading');
        return img && img.src && !hasSpinner;
      });

      return {
        tilesCount: completedTiles.length,
        totalTiles: tiles.length
      };
    })()`);

    return res.ok && res.evalResult ? res.evalResult : { tilesCount: 0, totalTiles: 0 };
  }

  async triggerGeneration() {
    console.log("🚀 正在点击生成按钮 (button.generate-icon-button)...");
    const clickRes = runLantern("click", ["--sel=button.generate-icon-button"]);
    if (!clickRes.ok) {
      throw new Error(`点击生成按钮失败: ${JSON.stringify(clickRes.error)}`);
    }
    console.log("✅ 生成任务已触发，开始监听渲染进度...");
  }

  async waitForVideoGeneration({ beforeState = { tilesCount: 0 }, timeoutSec = 360, pollIntervalMs = 3000 } = {}) {
    const startTime = Date.now();
    const maxWaitMs = timeoutSec * 1000;
    let lastProgressLog = 0;

    console.log(`⏱️ 正在轮询视频生成结果 (最长等待 ${timeoutSec} 秒)...`);

    while (Date.now() - startTime < maxWaitMs) {
      await sleep(pollIntervalMs);

      const check = runEval(`(() => {
        const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
        const completedTiles = tiles.filter(t => {
          const img = t.querySelector('img.thumbnail');
          const hasSpinner = t.querySelector('mat-progress-bar, mat-spinner, .loading');
          return img && img.src && !hasSpinner;
        });

        const isGenerating = tiles.some(t => {
          return t.querySelector('mat-progress-bar, mat-spinner, .loading') || (t.innerText && (t.innerText.includes('正在生成') || t.innerText.includes('生成中')));
        });

        const isEditPage = location.href.includes('/edit/');
        const editHeaderDl = document.querySelector('button[aria-label="下载媒体内容"]');

        return {
          totalTiles: tiles.length,
          completedCount: completedTiles.length,
          isGenerating,
          isEditPage,
          hasHeaderDl: !!editHeaderDl
        };
      })()`);

      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      if (elapsedSec - lastProgressLog >= 15) {
        console.log(`⏳ 视频渲染中... 已等待 ${elapsedSec} 秒`);
        lastProgressLog = elapsedSec;
      }

      if (check.ok && check.evalResult) {
        const { completedCount, hasHeaderDl, isEditPage } = check.evalResult;
        if (completedCount > beforeState.tilesCount || (isEditPage && hasHeaderDl)) {
          console.log(`🎉 视频已完成渲染并处于可下载状态！`);
          return true;
        }
      }
    }

    throw new Error(`视频生成超时：在 ${timeoutSec} 秒内未能检测到新视频生成完毕。请核查浏览器当前界面是否有错误提示。`);
  }

  async downloadFromEditor() {
    console.log("📥 正在通过 Google Flow 触发 720p 原画视频下载...");
    const downloadsDir = path.join(os.homedir(), "Downloads");
    const beforeFiles = new Set(fs.existsSync(downloadsDir) ? fs.readdirSync(downloadsDir) : []);

    // 1. 若当前不在编辑页，点击第一个 flow-video-tile 进入编辑页
    runEval(`(() => {
      const isEditPage = location.href.includes('/edit/');
      if (!isEditPage) {
        const tile = document.querySelector('flow-video-tile');
        if (tile) tile.click();
      }
    })()`);

    await sleep(2000);

    // 2. 点击顶部“下载媒体内容”按钮
    let clickedDownloadBtn = false;
    for (let i = 0; i < 5; i++) {
      const clickDl = runLantern("click", ["--sel=button[aria-label='下载媒体内容']"]);
      if (clickDl.ok) {
        clickedDownloadBtn = true;
        break;
      }
      await sleep(1000);
    }

    if (!clickedDownloadBtn) {
      runEval(`(() => {
        const moreBtn = document.querySelector('flow-video-tile')?.closest('flow-grid-tile-container')?.querySelector('button[aria-label="更多选项"]');
        if (moreBtn) moreBtn.click();
      })()`);
      await sleep(1000);
      runEval(`(() => {
        const items = Array.from(document.querySelectorAll('.cdk-overlay-container [role="menuitem"]'));
        const dl = items.find(t => t.innerText.includes('下载'));
        if (dl) dl.click();
      })()`);
    }

    await sleep(1000);

    // 3. 点击“原始尺寸”或“720p”
    const click720 = runLantern("click", ["--text=原始尺寸"]);
    if (!click720.ok) {
      runLantern("click", ["--text=720p"]);
    }

    // 4. 等待 Downloads 目录出现新 .mp4 文件 (最长等 60 秒)
    console.log("⏳ 正在等待 Chrome 下载完成并捕获文件...");
    let downloadedFile = null;
    const startDl = Date.now();
    while (Date.now() - startDl < 60000) {
      await sleep(1500);
      if (!fs.existsSync(downloadsDir)) continue;
      const currentFiles = fs.readdirSync(downloadsDir);
      const newFiles = currentFiles.filter(f => !beforeFiles.has(f));

      const hasCrdownload = newFiles.some(f => f.endsWith('.crdownload') || f.endsWith('.tmp'));
      if (hasCrdownload) continue;

      const mp4File = newFiles.find(f => f.endsWith('.mp4'));
      if (mp4File) {
        const fullPath = path.join(downloadsDir, mp4File);
        const stat = fs.statSync(fullPath);
        if (stat.size > 1024 * 1024) {
          downloadedFile = fullPath;
          break;
        }
      }
    }

    if (!downloadedFile) {
      throw new Error("未能成功从 Chrome 下载捕获到新生成的 MP4 视频文件");
    }

    const buffer = fs.readFileSync(downloadedFile);
    try {
      fs.unlinkSync(downloadedFile);
    } catch {}

    return {
      buffer,
      originalName: path.basename(downloadedFile)
    };
  }

  async resetPrompt() {
    runEval(`(() => {
      const el = document.querySelector('div.ProseMirror');
      if (el) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
  }

  endTask() {
    runLantern("end-task");
  }
}
