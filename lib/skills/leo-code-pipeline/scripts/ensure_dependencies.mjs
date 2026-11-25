import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const DEFAULT_REPO = "zlpawn/shrimp";

const SEARCH_PATHS = [
  (name) => path.join(os.homedir(), ".agents", "skills", name),
  (name) => path.join(os.homedir(), ".gemini", "config", "skills", name),
  (name) => path.join(os.homedir(), ".claude", "skills", name),
  (name) => path.join(process.cwd(), "lib", "skills", name),
  (name) => path.join(process.cwd(), "skills", name),
];

export function isSkillInstalled(skillName) {
  for (const getPath of SEARCH_PATHS) {
    const candidate = getPath(skillName);
    const skillMd = path.join(candidate, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      return { installed: true, path: candidate };
    }
  }
  return { installed: false, path: null };
}

export async function installSkill(skillName, repo = DEFAULT_REPO) {
  console.log(`⚡ [leo-code-pipeline] 正在通过 npx skills 自动补齐子技能: ${skillName}...`);
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["-y", "skills", "add", repo, "-g", "--skill", skillName], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ [leo-code-pipeline] 子技能 ${skillName} 已成功就绪！`);
        resolve(true);
      } else {
        reject(new Error(`npx skills add exited with code ${code}`));
      }
    });
  });
}

export async function ensureSkills(skillNames = [], options = {}) {
  const repo = options.repo || DEFAULT_REPO;
  const autoInstall = options.autoInstall !== false;
  const status = {};

  for (const name of skillNames) {
    const check = isSkillInstalled(name);
    status[name] = check;
    if (!check.installed && autoInstall) {
      try {
        await installSkill(name, repo);
        status[name] = isSkillInstalled(name);
      } catch (err) {
        console.warn(`⚠️ [leo-code-pipeline] 自动安装 ${name} 失败:`, err.message);
      }
    }
  }
  return status;
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith("ensure_dependencies.mjs")) {
  const args = process.argv.slice(2);
  let targetSkills = ["leo-coding-standards", "leo-code-review", "leo-code-qa"];
  const skillIdx = args.indexOf("--skill");
  if (skillIdx !== -1 && args[skillIdx + 1]) {
    targetSkills = [args[skillIdx + 1]];
  }

  const checkOnly = args.includes("--check-only");
  ensureSkills(targetSkills, { autoInstall: !checkOnly }).then((res) => {
    console.log("=== 技能依赖检测结果 ===");
    for (const [k, v] of Object.entries(res)) {
      console.log(`- ${k}: ${v.installed ? "✅ 已就绪 (" + v.path + ")" : "❌ 未安装"}`);
    }
  });
}
