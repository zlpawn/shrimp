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

export function appendMissingTags(desc, tags) {
  const formatted = tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
  return [desc, ...formatted.filter((tag) => !(desc || "").includes(tag))].filter(Boolean).join(" ");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
