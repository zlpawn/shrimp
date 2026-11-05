#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  readConfig,
  updateConfig,
  resolveWorkspaceDir,
  resolvePostDir,
  getConfigPath,
  getDefaultOutputDir,
} from "./config.mjs";
import {
  detectAllSkillsStatus,
  installFromLocalSource,
  detectSourceRepoDir,
  formatMissingSkillCard,
} from "./install_xhs_skills.mjs";
import { auditPostDirectory, writeAuditRecord, decoupleMarkdown } from "./quality_guard.mjs";

function printHelp() {
  console.log(`
Leo XHS Router CLI (小红书智能路由与调度中枢管理工具)

用法:
  node scripts/cli.mjs status               查看当前配置、工作区与小红书技能安装状态
  node scripts/cli.mjs config [options]     查看或修改配置
  node scripts/cli.mjs install [options]    安装或同步小红书专属技能（仅限 XHS 模块）
  node scripts/cli.mjs init-post <topic>    初始化标准 YYYY-MM-DD-主题 帖子骨架
  node scripts/cli.mjs audit <postDir>      体检帖子目录与纯读者视角违禁词
  node scripts/cli.mjs decouple <postDir>   对帖子正文执行小红书原生脱壳清洗

选项 (config):
  --workspace <dir>      设置默认产物工作区（可指定任意目录路径）
  --source <dir>         设置本地源码仓目录（如存放 creator-buddy 或 xhs-writer 的路径）

选项 (install):
  --all                  安装全部 10 个小红书子技能
  --skill <name>         安装指定的单个小红书子技能（如 xhs-html）

选项 (init-post):
  --dir <dir>            指定本次生成的根目录（将自动记忆到配置）
`);
}

function parseArgs(args) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = arg.slice(2);
        if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          flags[key] = args[i + 1];
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

async function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  const command = positionals[0] || "status";

  switch (command) {
    case "status": {
      const cfg = readConfig();
      const skillsStatus = detectAllSkillsStatus();
      const detectedSource = detectSourceRepoDir();
      const effectiveWs = resolveWorkspaceDir();

      console.log(`\n================= Leo XHS Router 运行环境状态 =================`);
      console.log(`配置文件路径: ${getConfigPath()}`);
      console.log(`源码仓库路径: ${cfg.source_repo_dir || detectedSource || "未配置 (可通过 --source <path> 设置本地目录，或使用在线安装)"}`);
      console.log(`当前工作目录: ${effectiveWs.dir} (${effectiveWs.source})`);
      console.log(`视觉调度策略: 统一全权委托至 leo-imagine-router 动态决策画风与生成`);
      console.log(`推荐卡片数量: 至少 ${cfg.min_image_count || 5} 张 3:4 图卡 (1 封面 + 4 核心内页)`);
      console.log(`最佳发布窗口: ${cfg.preferred_publish_window || "15:00-17:00"} (下午茶摸鱼与冷启动累积期)`);
      console.log(`\n小红书专精技能安装状态 (已剔除公众号/视频等无关模块):`);

      let installedCount = 0;
      let totalCount = 0;
      for (const [key, item] of Object.entries(skillsStatus)) {
        totalCount++;
        if (item.installed) {
          installedCount++;
          console.log(`  ✅ [${key.padEnd(25)}] ${item.description.slice(0, 32)}...`);
        } else {
          console.log(`  ❌ [${key.padEnd(25)}] (未安装) ${item.description.slice(0, 28)}...`);
        }
      }
      console.log(`\n就绪度: ${installedCount}/${totalCount} 专精小红书技能已就绪`);
      break;
    }

    case "config": {
      if (flags.workspace) {
        updateConfig({ workspace_dir: flags.workspace });
        console.log(`已更新默认工作区为: ${flags.workspace}`);
      }
      if (flags.source) {
        updateConfig({ source_repo_dir: flags.source });
        console.log(`已更新源码仓库路径为: ${flags.source}`);
      }
      const current = readConfig();
      console.log("\n当前完整配置:\n", JSON.stringify(current, null, 2));
      break;
    }

    case "install": {
      const target = flags.skill || (flags.all ? "all" : null);
      if (!target) {
        console.log("请指定要安装的技能: --skill <name> 或 --all");
        process.exit(1);
      }
      const res = installFromLocalSource(target, flags.source);
      if (!res.success) {
        console.error("安装失败:", res.error);
        process.exit(1);
      }
      console.log(`\n从本地仓库安装成功 (${res.sourceDir}):`);
      for (const r of res.results) {
        if (r.success) {
          console.log(`  ✅ ${r.name} -> ${r.installedTo.join(", ")}`);
        } else {
          console.log(`  ❌ ${r.key}: ${r.error}`);
        }
      }
      break;
    }

    case "init-post": {
      const topic = positionals[1];
      if (!topic) {
        console.error("错误: 请提供帖子主题，如: node scripts/cli.mjs init-post \"AI时代程序员自费上班\"");
        process.exit(1);
      }
      const customDir = flags.dir || null;
      const res = resolvePostDir(topic, customDir);

      if (!fs.existsSync(res.postPath)) {
        fs.mkdirSync(res.postPath, { recursive: true });
      }
      const imagesPubDir = path.join(res.postPath, "图片", "发布版");
      if (!fs.existsSync(imagesPubDir)) {
        fs.mkdirSync(imagesPubDir, { recursive: true });
      }

      const contentSkeleton = `# 标题候选
1. 
2. 
3. 

## 推荐标题
${topic}

## 封面文案
${topic}

## 正文可复制版
（在这里撰写高密度正文，短段落、口语化、痛点导向）

## 话题标签
#小红书 #知识分享

## 图片顺序
- 01-封面.png

## 发布备注
`;

      const contentPath = path.join(res.postPath, "内容.md");
      if (!fs.existsSync(contentPath)) {
        fs.writeFileSync(contentPath, contentSkeleton, "utf-8");
      }

      console.log(`\n✅ 帖子工作区初始化成功:`);
      console.log(`  📁 目录路径: ${res.postPath}`);
      console.log(`  📄 包含文件: 内容.md, 图片/发布版/`);
      if (res.persisted) {
        console.log(`  💾 已记录该目录作为后续默认工作区: ${res.workspaceDir}`);
      }
      break;
    }

    case "audit": {
      const postDir = positionals[1];
      if (!postDir) {
        console.error("错误: 请提供待体检的帖子目录路径");
        process.exit(1);
      }
      const auditRes = auditPostDirectory(path.resolve(postDir));
      const recordPath = writeAuditRecord(path.resolve(postDir), auditRes);
      console.log(`\n体检完成: ${auditRes.pass ? "✅ 通过" : "⚠️ 存在问题"}`);
      console.log(`审核记录报告已写入: ${recordPath}`);
      if (!auditRes.pass) {
        for (const iss of auditRes.issues) {
          console.log(`  - ❌ [${iss.type}] ${iss.message}`);
        }
      }
      if (auditRes.warnings && auditRes.warnings.length > 0) {
        for (const w of auditRes.warnings) {
          console.log(`  - 💡 [${w.type}] ${w.message}`);
        }
      }
      break;
    }

    case "decouple": {
      const postDir = positionals[1];
      if (!postDir) {
        console.error("错误: 请提供帖子目录路径");
        process.exit(1);
      }
      const contentPath = path.join(path.resolve(postDir), "内容.md");
      if (!fs.existsSync(contentPath)) {
        console.error(`未找到内容文件: ${contentPath}`);
        process.exit(1);
      }
      const raw = fs.readFileSync(contentPath, "utf-8");
      // Decouple the copyable section if present, otherwise decouple the whole text
      const copyMatch = raw.match(/(##?\s*正文可复制版\n)([\s\S]*?)(?=\n##?\s*话题标签|$)/i);
      let updated = raw;
      if (copyMatch) {
        const cleanedBody = decoupleMarkdown(copyMatch[2]);
        updated = raw.replace(copyMatch[0], `${copyMatch[1]}${cleanedBody}\n`);
      } else {
        updated = decoupleMarkdown(raw);
      }
      fs.writeFileSync(contentPath, updated, "utf-8");
      console.log(`\n✅ 已完成 Markdown 脱壳清洗: ${contentPath}`);
      break;
    }

    default:
      printHelp();
      break;
  }
}

main().catch(err => {
  console.error("CLI 运行时发生异常:", err);
  process.exit(1);
});
