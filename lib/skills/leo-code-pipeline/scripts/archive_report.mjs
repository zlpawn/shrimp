import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Archives a pipeline or review report to ~/.shrimp/skills/leo-code-pipeline/reports/
 * with standardized date and Chinese naming conventions.
 */

export function resolveReportsDir() {
  const baseDir = process.env.SHRIMP_HOME || path.join(os.homedir(), ".shrimp");
  return path.join(baseDir, "skills", "leo-code-pipeline", "reports");
}

export function generateReportFilename(type = "交付报告", customTitle = "") {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;

  const cleanTitle = (customTitle || "").trim().replace(/[\\/:*?"<>|]/g, "_");
  if (cleanTitle) {
    return `${dateStr}_${cleanTitle}_代码质量${type}.md`;
  }
  return `${dateStr}_代码质量${type}.md`;
}

export function saveReport(markdownContent, options = {}) {
  const reportsDir = resolveReportsDir();
  fs.mkdirSync(reportsDir, { recursive: true });

  const filename = generateReportFilename(options.type || "交付报告", options.title || "");
  const targetPath = path.join(reportsDir, filename);

  fs.writeFileSync(targetPath, markdownContent, "utf-8");
  return { ok: true, path: targetPath, filename };
}

// CLI invocation: node archive_report.mjs --title "登录鉴权重构" --type "审查报告" < content.md
if (process.argv[1] && process.argv[1].endsWith("archive_report.mjs")) {
  let content = "";
  const args = process.argv.slice(2);
  let title = "";
  let type = "交付报告";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--title" && args[i + 1]) title = args[++i];
    if (args[i] === "--type" && args[i + 1]) type = args[++i];
    if (args[i] === "--content" && args[i + 1]) content = args[++i];
  }

  const runSave = (text) => {
    if (!text.trim()) {
      console.error("Error: No markdown content provided to save.");
      process.exit(1);
    }
    const res = saveReport(text, { title, type });
    console.log(`✅ 报告已成功归档落盘: ${res.path}`);
  };

  if (content) {
    runSave(content);
  } else {
    // Read from stdin
    process.stdin.setEncoding("utf-8");
    let stdinData = "";
    process.stdin.on("data", (chunk) => (stdinData += chunk));
    process.stdin.on("end", () => runSave(stdinData));
  }
}
