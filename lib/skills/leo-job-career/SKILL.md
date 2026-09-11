---
name: leo-job-career
description: "面向资深 Java 工程师向 AI Agent 转型与求职进阶的专属 Copilot Skill。基于真实 BOSS 直聘登录态数据，进行北京 Java + Agent 岗位深度采集、排除外包与伪AI包装、提炼市场能力矩阵与P7标杆门槛；结合候选人背景一问一答提取实战证据、做能力差距推演，并产出按周末循序渐进的面试攻坚计划。触发词包括“分析招聘要求”、“找Java Agent工作”、“分析岗位要求”、“采集Boss岗位”、“准备AI求职”、“评估P7差距”。"
---

# Leo Job Career (Phase 1)

以真实岗位证据为依据的求职决策与面试准备中枢。不凭空捏造经历，不脱离市场需求备考；先摸清市场真实要求，再补足证据，最后形成攻坚行动路线。

## 运行前准备与原则

1. **零网关依赖**：本 Skill 的底层采集与分析由独立 Node.js 脚本驱动，不依赖 local-ai-gateway 常驻服务或 8787 端口。
2. **私密与安全**：所有个人画像、Cookie 凭证及抓取的岗位数据全部保存在本地 `~/.shrimp/leo-job-career/`，严禁在聊天对话中输出任何 Cookie 明文。
3. **只读安全**：严禁调用任何可能修改账户状态的写接口（如打招呼、收藏、投递等）；如遇滑块验证码或安全拦截，立即保存检查点并暂停，引导用户手动验证。

## 核心工作流与命令

本 Skill 的所有确定性操作统一由底层脚本支撑：

```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs <command>
```

### 1. 环境与鉴权检查 (Doctor & Auth)

在执行任何采集前，先检查环境和登录态：

```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs doctor
node lib/skills/leo-job-career/scripts/leo_job_career.mjs auth status
```

- **凭证导入指引**：如果凭证缺失，提示用户在 Chrome 中使用已有的 `Leo cookie.txt Locally` 浏览器扩展，进入 `zhipin.com` 后点击 **Copy Cookie Header**。
- 用户复制后，执行剪贴板静默导入：
  ```bash
  node lib/skills/leo-job-career/scripts/leo_job_career.mjs auth import-clipboard
  ```

### 2. 市场岗位侦察与采集 (Market Init & Update)

开始采集北京 Java + Agent 岗位（默认目标约 100 个有效岗位）：

```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs market init --city 北京 --target 100
```

- **采集策略**：按初始检索词族（Java Agent、Java 智能体、Java 大模型应用、Java RAG、Java MCP、AI应用技术负责人等）逐页采集。
- **质量门禁**：自动排除明确驻场、外派、人力派遣外包公司；自动跳过纯 Python 算法研发岗；对同公司相似岗位进行语义去重；标记岗位时效（A/B/C/D/E级）。
- **查看状态与报告**：
  ```bash
  node lib/skills/leo-job-career/scripts/leo_job_career.mjs market status
  node lib/skills/leo-job-career/scripts/leo_job_career.mjs market report
  ```

### 3. 候选岗位检索与分析 (Jobs List & Show)

查看已采集的岗位摘要或完整详情：

```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs jobs list --limit 20
node lib/skills/leo-job-career/scripts/leo_job_career.mjs jobs show --id <jobId>
```

### 4. 个人能力盘点与结构化访谈 (Profile & Evidence)

初始化并查看你的求职画像：

```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs profile status
```

- 默认预设：8年以上Java、P6职级、目标60-70万（涨幅30%~40%）、目标大厂P7或同级Tech Lead、周末循序渐进（从5小时启动）、截止2026-12-31。
- **一问一答访谈**：LLM 参照 [references/career-interview.md](references/career-interview.md)，每次只提一个具体问题，萃取你在复杂业务、架构设计、跨系统治理、带队交付方面的真实事件，并沉淀证据：
  ```bash
  node lib/skills/leo-job-career/scripts/leo_job_career.mjs profile record-evidence --project "某核心系统" --role "技术负责人" --problem "跨系统数据一致性"
  ```

### 5. 能力差距推演与周末攻坚计划 (Prepare Plan)

对比市场真实能力矩阵与个人证据库，输出四维能力归类与渐进式周末计划：

```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs prepare plan
```

- **四维归类**：
  1. `evidenced_now`：已有扎实证据的基本盘（Java核心、复杂业务系统、跨系统治理、带队）；
  2. `needs_refresh`：需按P7深度进行推演复习（JVM、高可用分布式架构、系统设计题）；
  3. `buildable_by_deadline`：年底前可通过一个高含金量企业级实战项目打透（RAG防幻觉、MCP工具调用、状态机工作流、评测体系、可观测性）；
  4. `experience_bound`：短期无法速成的非主线领域（大规模底层模型训练、亿级QPS内核改造），坚决不浪费时间。
- **周末计划**：从前两个周末的 4~5 小时/周，递增到实战阶段的 6~8 小时与 8~10 小时，每个周末锁定 1 个可验证的确定性交付物。

## 参考规范与文档

- 数据接口与字段规范：[references/boss-data-contract.md](references/boss-data-contract.md)
- 岗位质量与外包过滤规范：[references/job-quality-policy.md](references/job-quality-policy.md)
- 市场分析与P7标杆定义：[references/market-analysis.md](references/market-analysis.md)
- 结构化经历访谈指南：[references/career-interview.md](references/career-interview.md)
- 渐进式备考规划指南：[references/preparation-planning.md](references/preparation-planning.md)
- 二期与三期路线规划：[references/roadmap-phases-2-3.md](references/roadmap-phases-2-3.md)
