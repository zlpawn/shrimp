import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/cli/index.mjs");

export function runCli(cmd, args = []) {
  const res = spawnSync("node", [CLI_PATH, cmd, ...args], { encoding: "utf8" });
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

/** Runs page code from a temp file, which avoids shell quoting damage to Chinese text and newlines. */
export function runEval(code) {
  const tmpFile = path.join(os.tmpdir(), `leo_recipe_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmpFile, code, "utf8");
    return runCli("eval", ["--file", tmpFile]);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

export function fail(message, detail) {
  if (detail === undefined) console.error(`❌ ${message}`);
  else console.error(`❌ ${message}:`, typeof detail === "string" ? detail : JSON.stringify(detail));
  console.error("ℹ️ 流程已中止，未继续提交；浏览器页面保持原样，可人工核对。");
  process.exit(1);
}

export function requireOk(step, res) {
  if (!res?.ok) fail(`${step}失败`, res?.error ?? res);
  return res;
}

/** The page code must return exactly true: its element was found and the action was applied. */
export function requireEval(step, code) {
  const res = requireOk(step, runEval(code));
  if (res.evalResult !== true) fail(`${step}失败：页面上未找到目标元素或校验未通过`);
  return res;
}

export function warnEval(step, code) {
  const res = runEval(code);
  if (!res.ok || res.evalResult !== true) console.warn(`⚠️ ${step}未生效，已跳过，请在核对图中确认。`);
  return res;
}

export function saveScreenshot(outPath, extraArgs = []) {
  const res = runCli("screenshot", [...extraArgs, `--out=${outPath}`]);
  if (res.savedTo) console.log(`✅ 状态截图已落盘: ${outPath}`);
  else console.warn(`⚠️ 截图失败，未生成 ${outPath}:`, JSON.stringify(res.error ?? res));
  return Boolean(res.savedTo);
}

/** Returns the parts of a "YYYY-MM-DD HH:MM" schedule, or stops the recipe on any other format. */
export function parseSchedule(schedule) {
  const match = schedule.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) fail(`定时发布时间格式必须为 YYYY-MM-DD HH:MM（当前: ${schedule}）`);
  const [, year, month, day, hour, minute] = match;
  return { year, month, day, hour, minute };
}

function extractPreferredTimeFromConfig(cfgPath, mdFallbackPath = "") {
  let preferredTime = "";
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (typeof cfg.default_publish_time === "string" && /^\d{2}:\d{2}$/.test(cfg.default_publish_time.trim())) {
        return cfg.default_publish_time.trim();
      }
      if (typeof cfg.preferred_publish_window === "string") {
        const winMatch = cfg.preferred_publish_window.match(/^(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})$/);
        if (winMatch) {
          const startMin = Number(winMatch[1]) * 60 + Number(winMatch[2]);
          const endMin = Number(winMatch[3]) * 60 + Number(winMatch[4]);
          const midMin = Math.round((startMin + endMin) / 2 / 5) * 5;
          const hh = String(Math.floor(midMin / 60)).padStart(2, "0");
          const mm = String(midMin % 60).padStart(2, "0");
          preferredTime = `${hh}:${mm}`;
        }
      }
    }
  } catch {
    // ignore malformed json
  }

  if (mdFallbackPath) {
    try {
      if (fs.existsSync(mdFallbackPath)) {
        const md = fs.readFileSync(mdFallbackPath, "utf8");
        const recMatch = md.match(/默认推荐\s*(\d{2}:\d{2})/);
        if (recMatch) {
          preferredTime = recMatch[1];
        }
      }
    } catch {
      // ignore
    }
  }

  return preferredTime;
}

/**
 * 按发布平台路由读取对应的 skill 偏好配置：
 * - xhs（小红书）：优先读取 ~/.shrimp/skills/leo-xhs-router/config.json
 * - bilibili / douyin（B站 / 抖音）：优先读取 ~/.shrimp/skills/leo-video-router/config.json（及 style-preferences.md）
 * - 其他平台或找不到对应配置时：直接中止并提示询问用户希望什么时间定时发布。
 * 仅当显式传入 --now / --immediate 或 --schedule now 时返回 ""（立即发布）。
 */
export function resolveDefaultSchedule(
  explicitSchedule = "",
  { platform = "", now = false, nowDate = new Date(), homeDir = os.homedir() } = {}
) {
  const trimmed = (explicitSchedule || "").trim();
  if (now || /^(now|immediate|立即|立即发布)$/i.test(trimmed)) {
    return "";
  }
  if (trimmed) {
    parseSchedule(trimmed);
    return trimmed;
  }

  const skillsDir = path.join(homeDir, ".shrimp", "skills");
  const normPlatform = (platform || "").trim().toLowerCase();
  let preferredTime = "";

  if (normPlatform === "xhs" || normPlatform === "xiaohongshu") {
    const xhsCfg = path.join(skillsDir, "leo-xhs-router", "config.json");
    preferredTime = extractPreferredTimeFromConfig(xhsCfg);
  } else if (normPlatform === "bilibili" || normPlatform === "douyin" || normPlatform === "video") {
    const videoCfg = path.join(skillsDir, "leo-video-router", "config.json");
    const videoMd = path.join(skillsDir, "leo-video-router", "style-preferences.md");
    preferredTime = extractPreferredTimeFromConfig(videoCfg, videoMd);
  }

  if (!preferredTime) {
    fail(
      `未找到平台 [${platform || "未知"}] 的默认定时发布配置，请先询问用户希望什么时间定时发布，并通过 --schedule "YYYY-MM-DD HH:MM" 传入（或传 --now 立即发布）`
    );
  }

  const [prefH, prefM] = preferredTime.split(":").map(Number);
  const candidate = new Date(nowDate.getTime());
  candidate.setHours(prefH, prefM, 0, 0);

  // 确保距离当前时间至少 2.5 小时（兼容抖音 >= 2小时、B站 >= 5分钟要求），否则自动顺延至次日该黄金时段
  const minLeadMs = 150 * 60 * 1000;
  if (candidate.getTime() - nowDate.getTime() < minLeadMs) {
    candidate.setDate(candidate.getDate() + 1);
  }

  const yyyy = String(candidate.getFullYear());
  const mm = String(candidate.getMonth() + 1).padStart(2, "0");
  const dd = String(candidate.getDate()).padStart(2, "0");
  const hh = String(candidate.getHours()).padStart(2, "0");
  const min = String(candidate.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function appendMissingTags(desc, tags) {
  const formatted = tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
  return [desc, ...formatted.filter((tag) => !(desc || "").includes(tag))].filter(Boolean).join(" ");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
