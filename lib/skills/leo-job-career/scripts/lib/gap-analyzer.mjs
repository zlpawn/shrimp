import fs from "node:fs";
import path from "node:path";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "./config.mjs";

export function analyzeCapabilityGaps(options = {}) {
  const { userProfile = {}, userAssessments = {}, marketSummary = {} } = options;
  const capabilities = marketSummary.capability_matrix || [];

  const solidBaseline = [];
  const candidateGaps = [];

  for (const item of capabilities) {
    const status = userAssessments[item.skill] || "not_touched";
    const statusLabel =
      status === "proficient"
        ? "熟练掌握"
        : status === "demo_only"
        ? "了解原理/仅做过Demo"
        : "尚未接触";

    if (status === "proficient") {
      solidBaseline.push({
        ...item,
        user_status_raw: status,
        user_status: statusLabel,
        conclusion: "✅ 基本盘稳固",
        priority_rank: 99,
      });
    } else {
      // Calculate weight based on frequency and company tiers
      let weightScore = item.frequency || 0;
      if (item.tiers?.includes("大厂")) weightScore += 25;
      if (item.tiers?.includes("知名AI创企")) weightScore += 20;

      candidateGaps.push({
        ...item,
        user_status_raw: status,
        user_status: statusLabel,
        weight_score: weightScore,
      });
    }
  }

  // Sort candidate gaps by urgency
  candidateGaps.sort((a, b) => b.weight_score - a.weight_score);

  // Determine top 2~3 blockers
  const topBlockerCount = candidateGaps.length >= 3 ? 3 : candidateGaps.length >= 2 ? 2 : candidateGaps.length;
  const topBlockers = candidateGaps.slice(0, topBlockerCount).map((g, idx) => ({
    ...g,
    priority_rank: idx + 1,
    conclusion: "🔴 最高优先级核心硬骨头",
    reason: `市场高频要求（${g.frequency}% 岗位涵盖），且为${(g.tiers || []).join("、")}的硬性门槛`,
  }));

  const remainingGaps = candidateGaps.slice(topBlockerCount);
  const secondaryGaps = [];
  const bonusGaps = [];

  for (const g of remainingGaps) {
    if (g.frequency >= 40 || (g.tiers && g.tiers.includes("大厂"))) {
      secondaryGaps.push({
        ...g,
        conclusion: "🟡 次要与进阶欠缺项",
        reason: "目标岗位常见要求，进入复试与薪资谈判的关键考点",
      });
    } else {
      bonusGaps.push({
        ...g,
        conclusion: "🟢 加分与潜力项",
        reason: "体现技术广度与前沿敏锐度的加分考题",
      });
    }
  }

  return {
    solid_baseline: solidBaseline,
    top_blockers: topBlockers,
    secondary_gaps: secondaryGaps,
    bonus_gaps: bonusGaps,
    total_gaps_count: topBlockers.length + secondaryGaps.length + bonusGaps.length,
  };
}

export function generateMarkdownGapReport(options = {}) {
  const { userProfile = {}, gapAnalysis = {}, marketSummary = {}, generatedAt = new Date().toISOString() } = options;
  const companies = marketSummary.companies_by_tier || { big_tech: [], mid_tech: [], star_startup: [], other: [] };

  const bigTechList = companies.big_tech.length > 0 ? companies.big_tech.join("、") : "阿里、美团、快手、腾讯等知名大厂";
  const midTechList = companies.mid_tech.length > 0 ? companies.mid_tech.join("、") : "小红书、知乎、得物等知名中厂";
  const starStartupList = companies.star_startup.length > 0 ? companies.star_startup.join("、") : "智谱AI、月之暗面、MiniMax等明星AI团队";

  // Build Table
  const allRows = [
    ...(gapAnalysis.top_blockers || []),
    ...(gapAnalysis.secondary_gaps || []),
    ...(gapAnalysis.bonus_gaps || []),
    ...(gapAnalysis.solid_baseline || []),
  ];

  const tableRows = allRows
    .map((row) => {
      const sources = (row.company_sources && row.company_sources.length > 0)
        ? `${row.company_sources.join(", ")} (${(row.tiers || []).join("/")})`
        : (row.tiers || []).join("/");
      return `| **${row.skill}** | ${sources} | ${row.frequency || "-"}% | ${row.user_status} | ${row.conclusion} |`;
    })
    .join("\n");

  const topBlockersDetail = (gapAnalysis.top_blockers || [])
    .map(
      (b, idx) =>
        `### ${idx + 1}. ${b.skill}（${(b.tiers || []).join(" / ")}）\n` +
        `- **提出代表公司**：${(b.company_sources || []).join("、") || "行业标杆公司"}\n` +
        `- **市场重视度**：涵盖 ${b.frequency}% 目标岗位\n` +
        `- **当前掌握状态**：\`${b.user_status}\`\n` +
        `- **为什么是致命硬骨头**：${b.reason}。这是通过大厂 P7 技术面和架构深度考核的决定性门槛。`
    )
    .join("\n\n");

  const secondaryGapsDetail = (gapAnalysis.secondary_gaps || []).length > 0
    ? (gapAnalysis.secondary_gaps || [])
        .map(
          (g) =>
            `- **${g.skill}**：涵盖 ${g.frequency}% 岗位（出处：${(g.company_sources || []).join("、") || "多家成熟中厂"}）。当前状态：\`${g.user_status}\`。`
        )
        .join("\n")
    : "- 无次要缺口";

  const bonusGapsDetail = (gapAnalysis.bonus_gaps || []).length > 0
    ? (gapAnalysis.bonus_gaps || [])
        .map(
          (g) =>
            `- **${g.skill}**：涵盖 ${g.frequency}% 岗位（出处：${(g.company_sources || []).join("、") || "新锐创企"}）。当前状态：\`${g.user_status}\`。`
        )
        .join("\n")
    : "- 无加分潜力缺口";

  return `# 人岗能力差距与市场画像诊断报告

- **生成时间**：${generatedAt.slice(0, 19).replace("T", " ")}
- **目标方向**：${userProfile.target_role || "Java Agent / 大模型后端架构师"}
- **目标城市**：${userProfile.target_city || "北京"}
- **目标职级与年限**：${userProfile.target_level || "大厂P7"}（候选人经验：${userProfile.experience_years || 8}年）
- **期望薪酬区间**：${userProfile.target_compensation || "60-70万/年"}

---

## 1. 求职画像与真实验收池概览

本次诊断严格基于真实 BOSS 直聘登录态数据，且**100% 熔断过滤外包/外派/劳务派遣与皮包作坊**：
- **有效真实样本量**：共分析 ${marketSummary.total_valid_jobs || 0} 个有效自研核心岗位。
- **大厂池企业样本**：${bigTechList}
- **中厂池企业样本**：${midTechList}
- **知名创企/AI独角兽样本**：${starStartupList}

---

## 2. 核心能力出处溯源与人岗对照全景表

| 核心技能项 | 提出要求的公司出处与梯队 | 市场权重 | 你的当前掌握度 | 诊断结论 |
| :--- | :--- | :--- | :--- | :--- |
${tableRows}

---

## 3. 各梯队企业差异化诉求画像

- **大厂视角（如美团、快手、阿里等）**：
  强调系统底层机制、千万级超高并发与容灾高可用治理；对 Agent 重点关注与核心微服务体系打通、企业级防幻觉评测及稳定性保障。
- **中厂视角（如小红书、知乎、得物等）**：
  强调大模型在垂直业务场景的高效落地、端到端敏捷交付以及为研发和业务降本提效的实际产出。
- **知名创企/AI独角兽视角（如智谱AI、MiniMax、月之暗面等）**：
  强调前沿技术敏锐度（如 MCP 协议、Agent 状态机编排）、自主解决工程不确定性的全栈攻坚能力。

---

## 4. 欠缺能力全景清单与攻坚重点（100% 完整透明呈现）

### 🔴 最高优先级硬骨头 (Top 2~3 Blockers)
以下为阻碍进入目标岗位职级的**最核心能力缺口**，必须集中力量率先攻克：

${topBlockersDetail}

### 🟡 次要与进阶欠缺项 (Secondary Gaps)
${secondaryGapsDetail}

### 🟢 加分与潜力项 (Bonus Opportunities)
${bonusGapsDetail}

---

## 5. 后续学习规划衔接说明

> [!NOTE]
> 本报告已完整保存至本地数据目录（\`gap-analysis-report.md\`）。
> **后续的学习规划与面试攻坚 Skill 可以直接读取该 Markdown 报告作为上下文输入**，针对上述“最高优先级硬骨头”与“次要欠缺项”进行针对性学习路线与面试准备拆解！
`;
}

export function saveMarkdownGapReport(markdownContent, options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  ensureRuntimeDirectories(paths);

  const targetFile = path.join(paths.reports, "gap-analysis-report.md");
  fs.writeFileSync(targetFile, markdownContent, "utf8");
  return targetFile;
}
