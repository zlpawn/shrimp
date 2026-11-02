import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readConfig, updateConfig } from "./config.mjs";

/**
 * Registry of targeted Xiaohongshu sub-skills.
 * Note: From creator-buddy, we ONLY target xhs-Skills (strictly excluding gzh-Skills and video-Skills).
 */
export const XHS_SKILLS_CATALOG = {
  // --- From creator-buddy/xhs-Skills ---
  "space-xhs-positioning": {
    name: "space-xhs-positioning",
    suite: "creator-buddy",
    relPath: path.join("creator-buddy", "xhs-Skills", "space-xhs-positioning"),
    description: "起号定位：赛道选择、定位句、人设三件套、内容支柱与冷启动",
    github: "https://github.com/SpaceZephyr/creator-buddy",
    npx: "npx skills add SpaceZephyr/creator-buddy --path xhs-Skills/space-xhs-positioning -g",
  },
  "space-xhs-hotspot": {
    name: "space-xhs-hotspot",
    suite: "creator-buddy",
    relPath: path.join("creator-buddy", "xhs-Skills", "space-xhs-hotspot"),
    description: "热点选题：拉高互动笔记、趋势研判、爆款共性提取（支持API或公开搜索）",
    github: "https://github.com/SpaceZephyr/creator-buddy",
    npx: "npx skills add SpaceZephyr/creator-buddy --path xhs-Skills/space-xhs-hotspot -g",
  },
  "space-xhs-title": {
    name: "space-xhs-title",
    suite: "creator-buddy",
    relPath: path.join("creator-buddy", "xhs-Skills", "space-xhs-title"),
    description: "爆款标题：15 种小红书方法批量出候选、评分、合规校验与 A/B 建议",
    github: "https://github.com/SpaceZephyr/creator-buddy",
    npx: "npx skills add SpaceZephyr/creator-buddy --path xhs-Skills/space-xhs-title -g",
  },
  "space-xhs-writer": {
    name: "space-xhs-writer",
    suite: "creator-buddy",
    relPath: path.join("creator-buddy", "xhs-Skills", "space-xhs-writer"),
    description: "笔记正文：7 种笔记体裁、标签策略、合规改写与发布前 14 项体检",
    github: "https://github.com/SpaceZephyr/creator-buddy",
    npx: "npx skills add SpaceZephyr/creator-buddy --path xhs-Skills/space-xhs-writer -g",
  },
  "space-xhs-cover": {
    name: "space-xhs-cover",
    suite: "creator-buddy",
    relPath: path.join("creator-buddy", "xhs-Skills", "space-xhs-cover"),
    description: "封面制作：标题提炼、原创风格推荐、主体保真、背景合成与反差检测",
    github: "https://github.com/SpaceZephyr/creator-buddy",
    npx: "npx skills add SpaceZephyr/creator-buddy --path xhs-Skills/space-xhs-cover -g",
  },
  "xhs-html": {
    name: "xhs-html",
    suite: "creator-buddy",
    relPath: path.join("creator-buddy", "xhs-Skills", "xhs-html"),
    description: "图文排版：62 套 3:4 单文件 HTML 高颜值杂志级卡片与无损渲染（绝不崩字）",
    github: "https://github.com/SpaceZephyr/creator-buddy",
    npx: "npx skills add SpaceZephyr/creator-buddy --path xhs-Skills/xhs-html -g",
  },
  "space-xhs-image": {
    name: "space-xhs-image",
    suite: "creator-buddy",
    relPath: path.join("creator-buddy", "xhs-Skills", "space-xhs-image"),
    description: "AI 信息图：用生图引擎制作单图或 6-9 张 3:4 科技感信息组图",
    github: "https://github.com/SpaceZephyr/creator-buddy",
    npx: "npx skills add SpaceZephyr/creator-buddy --path xhs-Skills/space-xhs-image -g",
  },
  "space-xhs-account-audit": {
    name: "space-xhs-account-audit",
    suite: "creator-buddy",
    relPath: path.join("creator-buddy", "xhs-Skills", "space-xhs-account-audit"),
    description: "账号体检：八维打分、竞品对标、卡点定位与改进建议",
    github: "https://github.com/SpaceZephyr/creator-buddy",
    npx: "npx skills add SpaceZephyr/creator-buddy --path xhs-Skills/space-xhs-account-audit -g",
  },
  "space-xhs-note-analytics": {
    name: "space-xhs-note-analytics",
    suite: "creator-buddy",
    relPath: path.join("creator-buddy", "xhs-Skills", "space-xhs-note-analytics"),
    description: "笔记复盘：六层漏斗归因（曝光/CTR/阅读/互动/转粉/转化）找规律",
    github: "https://github.com/SpaceZephyr/creator-buddy",
    npx: "npx skills add SpaceZephyr/creator-buddy --path xhs-Skills/space-xhs-note-analytics -g",
  },

  // --- From xhs-writer-skill ---
  "xhs-writer": {
    name: "xhs-writer",
    suite: "xhs-writer-skill",
    relPath: "xhs-writer-skill",
    description: "深度单篇爆款：卖点打分模型（稀缺×实用×感知）+ 真实素材图生图 + 去AI味（humanizer-zh）",
    github: "https://github.com/JuneYaooo/xhs-writer-skill",
    npx: "npx skills add JuneYaooo/xhs-writer-skill -g",
  },
};

/**
 * Returns list of search directories for installed skills.
 */
export function getSkillSearchRoots() {
  const home = os.homedir();
  return [
    path.join(home, ".agents", "skills"),
    path.join(home, ".gemini", "config", "skills"),
    path.resolve("lib", "skills"),
  ];
}

/**
 * Checks whether a specific skill is installed in the environment.
 */
export function checkSkillInstalled(skillKey) {
  const meta = XHS_SKILLS_CATALOG[skillKey];
  if (!meta) return { installed: false, path: null };

  const aliases = [meta.name];
  if (skillKey === "xhs-writer") {
    aliases.push("xhs-writer-skill");
  }

  const roots = getSkillSearchRoots();
  for (const root of roots) {
    for (const alias of aliases) {
      const candidate = path.join(root, alias);
      const skillMd = path.join(candidate, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        return { installed: true, path: candidate, skillMd };
      }
    }
  }

  return { installed: false, path: null };
}

/**
 * Scans status of all registered XHS sub-skills.
 */
export function detectAllSkillsStatus() {
  const results = {};
  for (const [key, meta] of Object.entries(XHS_SKILLS_CATALOG)) {
    const status = checkSkillInstalled(key);
    results[key] = {
      ...meta,
      installed: status.installed,
      installedPath: status.path,
    };
  }
  return results;
}

/**
 * Detects local source repo directory from config or environment variable.
 * Returns null if not configured, rather than hardcoding personal machine paths.
 */
export function detectSourceRepoDir() {
  const cfg = readConfig();
  if (cfg.source_repo_dir && fs.existsSync(cfg.source_repo_dir)) {
    return cfg.source_repo_dir;
  }

  if (process.env.LEO_XHS_SOURCE_DIR && fs.existsSync(process.env.LEO_XHS_SOURCE_DIR)) {
    return process.env.LEO_XHS_SOURCE_DIR;
  }

  // Check common sibling paths relative to home directory
  const home = os.homedir();
  const potentialPaths = [
    path.join(home, "AI-ZMT"),
    path.join(home, "projects", "AI-ZMT"),
  ];

  for (const p of potentialPaths) {
    if (fs.existsSync(p)) {
      updateConfig({ source_repo_dir: p });
      return p;
    }
  }

  return null;
}

/**
 * Installs one or all XHS skills from a local source repository into ~/.agents/skills and ~/.gemini/config/skills.
 * Note: Only installs XHS skills, completely ignores gzh-Skills and video-Skills.
 */
export function installFromLocalSource(skillKey = "all", customSourceDir = null) {
  const sourceDir = customSourceDir || detectSourceRepoDir();
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return {
      success: false,
      error: `Source repository directory not found. Please configure ~/.shrimp/skills/leo-xhs-router/config.json with source_repo_dir.`,
    };
  }

  const targetKeys = skillKey === "all" ? Object.keys(XHS_SKILLS_CATALOG) : [skillKey];
  const home = os.homedir();
  const installTargets = [
    path.join(home, ".agents", "skills"),
    path.join(home, ".gemini", "config", "skills"),
  ];

  const results = [];

  for (const key of targetKeys) {
    const meta = XHS_SKILLS_CATALOG[key];
    if (!meta) {
      results.push({ key, success: false, error: `Unknown skill key: ${key}` });
      continue;
    }

    const srcPath = path.join(sourceDir, meta.relPath);
    if (!fs.existsSync(srcPath)) {
      results.push({ key, success: false, error: `Source path not found: ${srcPath}` });
      continue;
    }

    const installedTo = [];
    for (const tgtRoot of installTargets) {
      try {
        const dest = path.join(tgtRoot, meta.name);
        if (!fs.existsSync(tgtRoot)) {
          fs.mkdirSync(tgtRoot, { recursive: true });
        }
        fs.cpSync(srcPath, dest, { recursive: true, force: true });
        installedTo.push(dest);
      } catch (err) {
        console.warn(`[leo-xhs-router] Failed to copy to ${tgtRoot}:`, err.message);
      }
    }

    results.push({
      key,
      name: meta.name,
      success: installedTo.length > 0,
      installedTo,
    });
  }

  return { success: true, sourceDir, results };
}

/**
 * Formats a clean, targeted installation card for missing skills, strictly targeting only XHS modules.
 */
export function formatMissingSkillCard(skillKey) {
  const meta = XHS_SKILLS_CATALOG[skillKey];
  if (!meta) return "";

  const localSource = detectSourceRepoDir();

  return `💡 **方案推荐**：当前需求最适合使用专精技能 **【${meta.name}】**（${meta.description}）。

当前环境尚未安装该小红书技能：
* **开源地址**：${meta.github}
* **定向安装方式（仅安装小红书模块，绝不引入无关内容）**：
${localSource ? `  - **本地快速同步（推荐）**：
    从本地 \`${localSource}\` 直接安装该技能到用户环境。` : `  - **在线安装命令**：
    \`${meta.npx}\``}

**是否需要我帮您安装？**
* 回复 **"安装"**：我将代劳完成该技能安装并直接继续；
* 回复 **"安装全部XHS套件"**：一键安装全部 10 个小红书技能；
* 回复 **"直接出"**：使用 Router 内置的小红书通用方法论立即出稿。`;
}
