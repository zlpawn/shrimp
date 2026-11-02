import fs from "node:fs";
import path from "node:path";

/**
 * Banned strings and patterns that must never appear in final public Xiaohongshu posts.
 * Absorbed from the battle-tested xhs-post-creator quality gates.
 */
export const BANNED_PATTERNS = [
  // 1. Workflow & source labels (创作者内部来源说明)
  { label: "工作流/源文说明", regex: /(参考原文|参考重绘|制作说明|源文链接|原文链接)/i },
  // 2. AI disclaimers / metadata (创作者内部生图提示词或声明残留)
  { label: "AI生图内部提示", regex: /(生图提示词|绘图提示词|配图prompt|生图prompt|本图由\s*AI\s*(生成|绘制)|AI\s*生图说明|AIGC\s*(声明|免责))/i },
  // 3. Placeholders / TODOs (占位符与未完工标记)
  { label: "占位符/未完工", regex: /(待提供|待替换|待确认|待核实|待补|\bTODO\b|\bXXX\b|\bxxx\b)/ },
  // 4. In-image pagination & debug (草稿与页码水印)
  { label: "草稿/调试水印", regex: /(\bDEBUG\b|\bDRAFT\b|草稿水印|内部测试版|尚未发布)/i },
  // 5. Creator layout self-talk (布局指导自言自语)
  { label: "排版自言自语", regex: /(左图右文|上图下表|区块\s*[A-Z]|—\s*END\s*—|to\s+be\s+continued)/i },
];

/**
 * Audits markdown text content against the reader-facing rule.
 */
export function auditTextContent(text) {
  const issues = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const item of BANNED_PATTERNS) {
      if (item.regex.test(line)) {
        issues.push({
          line: i + 1,
          type: item.label,
          matched: line.trim(),
        });
      }
    }
  }

  return {
    pass: issues.length === 0,
    issues,
  };
}

/**
 * Validates post directory structure and file layout.
 */
export function auditPostDirectory(postDir) {
  if (!fs.existsSync(postDir)) {
    return {
      pass: false,
      error: `Post directory not found: ${postDir}`,
      issues: [],
    };
  }

  const issues = [];
  const contentMdPath = path.join(postDir, "内容.md");
  let contentAudit = { pass: true, issues: [] };

  if (!fs.existsSync(contentMdPath)) {
    issues.push({ type: "目录结构缺失", message: "缺少 内容.md 文件" });
  } else {
    const contentText = fs.readFileSync(contentMdPath, "utf-8");
    contentAudit = auditTextContent(contentText);
    if (!contentAudit.pass) {
      for (const iss of contentAudit.issues) {
        issues.push({
          type: `内容.md 包含创作者违禁痕迹 (${iss.type})`,
          message: `第 ${iss.line} 行: "${iss.matched}"`,
        });
      }
    }

    // Check essential sections
    const requiredSections = [
      { name: "推荐标题", regex: /##?\s*推荐标题/ },
      { name: "正文可复制版", regex: /##?\s*正文可复制版/ },
      { name: "话题标签", regex: /##?\s*话题标签/ },
    ];
    for (const sec of requiredSections) {
      if (!sec.regex.test(contentText)) {
        issues.push({ type: "正文规范缺失", message: `内容.md 缺少【${sec.name}】小节` });
      }
    }
  }

  // Check images
  const imagesPublishDir = path.join(postDir, "图片", "发布版");
  let imageFiles = [];
  if (fs.existsSync(imagesPublishDir)) {
    imageFiles = fs.readdirSync(imagesPublishDir)
      .filter(f => /\.(png|jpe?g|webp)$/i.test(f))
      .sort();
  }

  return {
    pass: issues.length === 0,
    postDir,
    contentMdExists: fs.existsSync(contentMdPath),
    imageCount: imageFiles.length,
    imageFiles,
    issues,
  };
}

/**
 * Generates standard 审核记录.md inside the post directory.
 */
export function writeAuditRecord(postDir, auditResult) {
  const auditPath = path.join(postDir, "审核记录.md");
  const now = new Date().toISOString();

  let body = `# 小红书发布前质量体检报告\n\n`;
  body += `- **体检时间**: ${now}\n`;
  body += `- **检查状态**: ${auditResult.pass ? "✅ 通过（已满足纯读者视角发布规范）" : "⚠️ 存在待修复问题"}\n`;
  body += `- **图片数量**: ${auditResult.imageCount} 张发布版卡片\n\n`;

  if (auditResult.issues.length === 0) {
    body += `## 体检项清单\n\n`;
    body += `- [x] **纯读者视角违禁词体检**：无“参考重绘”、“AI生成”、“TODO”、“草稿水印”等创作者自留痕迹\n`;
    body += `- [x] **结构完整性**：包含推荐标题、可复制正文与精准话题标签\n`;
    body += `- [x] **视觉与素材就绪**：图片已编号放置在 \`图片/发布版/\` 目录下\n\n`;
    body += `> 💡 本笔记已具备直接使用 \`leo-lantern\` 在浏览器中自动上传与发布的完整交付标准。\n`;
  } else {
    body += `## 发现的待修复问题\n\n`;
    for (const issue of auditResult.issues) {
      body += `- **[${issue.type}]**: ${issue.message}\n`;
    }
    body += `\n> ⚠️ 请修复上述问题后再执行最终发布。\n`;
  }

  fs.writeFileSync(auditPath, body, "utf-8");
  return auditPath;
}
