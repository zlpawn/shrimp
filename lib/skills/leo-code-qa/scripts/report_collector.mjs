import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * 实时追加报告收集器 (Live Incremental Report Collector)
 * 移植自 gstack: 发现一条立刻追加落盘，杜绝长会话中断丢失进度
 */
export function getReportDir() {
  const reportDir = path.join(os.homedir(), ".shrimp", "skills", "leo-code-qa", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  return reportDir;
}

export function initReportFile(title = "代码质检测试报告", metadata = {}) {
  const dir = getReportDir();
  const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `qa-report-${dateStr}.md`;
  const filePath = path.join(dir, fileName);

  const initialContent = `# ${title}

- **执行时间**：${new Date().toLocaleString()}
- **执行模式**：${metadata.mode || "qa-only (只测不改)"}
- **被测目标**：${metadata.target || "本地工作区"}
- **报告路径**：file://${filePath}

---

## 缺陷追踪清单（实时追加）

`;

  fs.writeFileSync(filePath, initialContent, "utf-8");
  return filePath;
}

export function appendBugFinding(filePath, bug = {}) {
  if (!fs.existsSync(filePath)) {
    initReportFile("代码质检测试报告");
  }

  const entry = `
### 缺陷 [${bug.id || "BUG-" + Date.now().toString(36).toUpperCase()}]: ${bug.title || "未命名缺陷"}
- **严重等级**：${bug.severity || "High"}
- **所属模块/路由**：\`${bug.module || "/"}\`
- **两遍复现确认**：${bug.reproPass ? "✅ 稳定复现 (Pass 2)" : "⚠️ 单次观测"}
- **前置条件**：${bug.preconditions || "无特殊前置"}
- **复现步骤**：
${(bug.steps || []).map((s, idx) => `  ${idx + 1}. ${s}`).join("\n")}
- **三端证据核验**：
  - **Console 状态**：${bug.console || "无未捕获异常"}
  - **Network 抓包**：${bug.network || "无异常请求"}
  - **后端日志探针**：${bug.backend || "未捕获异常堆栈"}
- **持久态校验结果**：${bug.persistence || "未进行页面刷新/重拉接口校验"}
- **预期 vs 实际**：
  - **预期行为**：${bug.expected || "操作成功并持久化"}
  - **实际表现**：${bug.actual || "操作失败或假成功"}
${bug.screenshot ? `- **现场证据截图**：\`file://${bug.screenshot}\`` : ""}

---
`;

  fs.appendFileSync(filePath, entry, "utf-8");
  return true;
}

export function appendPassFinding(filePath, passCase = {}) {
  if (!fs.existsSync(filePath)) return;
  const entry = `- [PASS] **${passCase.title}**：${passCase.details || "交互正常，三端校验无报错，持久态验证通过。"}\n`;
  fs.appendFileSync(filePath, entry, "utf-8");
}
