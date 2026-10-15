# leo-job-career 瘦身与人岗差距分析重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `leo-job-career` 深度瘦身，移除繁重多轮面试与周末日历排期，强化零外包拦截与企业客观动态分级，实现两阶段轻量交互与全景透明的单一 Markdown 人岗差距报告。

**Architecture:** 
- 零容忍外包与皮包公司拦截（黑名单 + 关键词 + 资质校验）；
- 企业客观特征动态分级算法（大厂/中厂/知名AI创企，绝不遗漏优质公司）；
- 核心能力与企业出处双向溯源（映射到具体真实公司名）；
- 差距分析引擎输出全景透明的 Markdown 报告（突出 Top 2~3 硬骨头并公开所有欠缺项）；
- 彻底清理废弃模块（`prepare-engine`、`career-interview` 等）。

**Tech Stack:** Node.js (ESM), Node.js native test runner (`node --test`), Boss API Client, JSON Schema.

## Global Constraints

- 严禁调用任何 BOSS 写操作接口（保持只读安全）。
- 所有个人画像与报表存储在本地 `~/.shrimp/leo-job-career/`，严禁上传云端或对话泄露 Cookie。
- 零外包是绝对红线：任何具有外包外派属性的企业（哪怕万人规模、已上市）一律 100% 熔断剔除。
- 交付物必须为单一 Markdown 文件（既在对话中渲染，也落盘到本地）。
- 缺口必须全景透明呈现，不得隐瞒任何欠缺项，且高亮 Top 2~3 核心硬骨头。

---

### Task 1: 零外包拦截门禁强化 (Zero-Outsourcing Gate Enhancement)

**Files:**
- Modify: `lib/skills/leo-job-career/scripts/lib/freshness.mjs`
- Modify: `lib/skills/leo-job-career/tests/unit/freshness.test.mjs`
- Modify: `lib/skills/leo-job-career/references/job-quality-policy.md`

**Interfaces:**
- Consumes: `job` (normalized job fact or raw job object with `title`, `description`, `company`, `requirements`)
- Produces: `detectDeterministicExclusions(job)` returning `{ excluded: boolean, reasons: string[] }`

- [ ] **Step 1: 编写外包与皮包公司拦截的失败测试**

在 `lib/skills/leo-job-career/tests/unit/freshness.test.mjs` 中添加对外包巨头（如中软国际、软通动力、法本等上市外包）以及新型外派关键词（如“派驻客户”、“现场驻场”、“客户现场办公”、“介意外包勿投”）的严苛拦截用例：

```javascript
test("detectDeterministicExclusions strictly blocks listed outsourcing mega-companies and client-site keywords", () => {
  const listedOutsourcingJob = {
    title: "Java资深开发",
    company: { name: "中软国际科技服务有限公司", industry: "计算机软件" },
    description: "参与核心系统研发，团队稳定",
  };
  const res1 = detectDeterministicExclusions(listedOutsourcingJob);
  assert.equal(res1.excluded, true);
  assert.ok(res1.reasons.some(r => r.includes("outsourcing_company")));

  const dispatchKeywordJob = {
    title: "Java架构师（非外包项目）",
    company: { name: "某科技自研团队", industry: "互联网" },
    description: "需要派驻客户现场办公，介意外包勿投",
  };
  const res2 = detectDeterministicExclusions(dispatchKeywordJob);
  assert.equal(res2.excluded, true);
  assert.ok(res2.reasons.some(r => r.includes("outsourcing_keyword")));
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`node --test lib/skills/leo-job-career/tests/unit/freshness.test.mjs`
预期：FAIL（缺少针对中软国际等上市外包公司名的直接匹配或特定原因字段）。

- [ ] **Step 3: 扩充拦截黑名单与模式匹配**

在 `lib/skills/leo-job-career/scripts/lib/freshness.mjs` 中完善 `KNOWN_OUTSOURCING_COMPANIES` 与 `OUTSOURCING_KEYWORDS`：

```javascript
export const KNOWN_OUTSOURCING_COMPANIES = [
  "中软国际",
  "软通动力",
  "法本信息",
  "诚迈科技",
  "博彦科技",
  "拓保软件",
  "文思海辉",
  "润和软件",
  "易宝软件",
  "宇信科技",
  "中科创达",
  "上海思芮",
  "北京先进数通",
  "亚信科技",
  "信必优",
  "柯莱特",
  "千方科技",
];

export const OUTSOURCING_KEYWORDS = [
  "驻场开发",
  "派驻客户",
  "客户现场",
  "现场办公",
  "人力外包",
  "劳务派遣",
  "软件外包",
  "介意外包勿投",
  "项目驻点",
  "驻场",
  "外派",
  "项目制外派",
];
```

并在 `detectDeterministicExclusions(job)` 中增加对公司全名包含已知外包名单的匹配，以及无自研产品小微作坊的判定。

- [ ] **Step 4: 运行测试验证通过**

运行：`node --test lib/skills/leo-job-career/tests/unit/freshness.test.mjs`
预期：PASS，所有用例通过。

- [ ] **Step 5: 提交更改**

```bash
git add lib/skills/leo-job-career/scripts/lib/freshness.mjs lib/skills/leo-job-career/tests/unit/freshness.test.mjs lib/skills/leo-job-career/references/job-quality-policy.md
git commit -m "feat(leo-job-career): strengthen zero-outsourcing gate and hard exclusions"
```

---

### Task 2: 企业客观资质动态分级引擎 (Dynamic Company Tiering Engine)

**Files:**
- Create: `lib/skills/leo-job-career/scripts/lib/company-tier.mjs`
- Create: `lib/skills/leo-job-career/tests/unit/company-tier.test.mjs`

**Interfaces:**
- Consumes: `job` (containing `company: { name, scale, financing_stage, industry }`, `salary`, `title`, `description`)
- Produces: `classifyCompanyTier(job)` -> `{ tier: "big_tech" | "mid_tech" | "star_startup" | "other", tier_label: string, is_reputable: boolean, confidence: string }`

- [ ] **Step 1: 编写企业动态分级单元测试**

在 `lib/skills/leo-job-career/tests/unit/company-tier.test.mjs` 中编写测试：

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { classifyCompanyTier } from "../../scripts/lib/company-tier.mjs";

test("classifyCompanyTier dynamically classifies Big Tech by scale and listing", () => {
  const job = {
    title: "Java技术专家",
    company: { name: "某上市科技集团", size: "10000人以上", financing_stage: "已上市", industry: "互联网" },
    salary: { annual_cash_max_cny: 800000 },
  };
  const res = classifyCompanyTier(job);
  assert.equal(res.tier, "big_tech");
  assert.equal(res.is_reputable, true);
});

test("classifyCompanyTier dynamically classifies Mid Tech by scale and round", () => {
  const job = {
    title: "Java Agent后端",
    company: { name: "某知名科技", size: "1000-9999人", financing_stage: "D轮及以上", industry: "互联网" },
    salary: { annual_cash_max_cny: 600000 },
  };
  const res = classifyCompanyTier(job);
  assert.equal(res.tier, "mid_tech");
  assert.equal(res.is_reputable, true);
});

test("classifyCompanyTier classifies Star Startup with venture funding and high salary", () => {
  const job = {
    title: "AI Agent研发专家",
    company: { name: "智谱华章", size: "100-499人", financing_stage: "B轮", industry: "人工智能" },
    salary: { annual_cash_min_cny: 400000, annual_cash_max_cny: 700000 },
  };
  const res = classifyCompanyTier(job);
  assert.equal(res.tier, "star_startup");
  assert.equal(res.is_reputable, true);
});

test("classifyCompanyTier rejects unbacked micro workshop without funding", () => {
  const job = {
    title: "Java工程师",
    company: { name: "某微型工作室", size: "0-20人", financing_stage: "未融资", industry: "企业服务" },
    salary: { annual_cash_max_cny: 200000 },
  };
  const res = classifyCompanyTier(job);
  assert.equal(res.tier, "other");
  assert.equal(res.is_reputable, false);
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`node --test lib/skills/leo-job-career/tests/unit/company-tier.test.mjs`
预期：FAIL（文件不存在或模块未实现）。

- [ ] **Step 3: 实现企业动态分级逻辑**

在 `lib/skills/leo-job-career/scripts/lib/company-tier.mjs` 中实现：
- 种子大厂名单（美团、阿里、腾讯、字节、快手、百度、京东、微软、亚马逊等）；
- 种子中厂与知名初创名单（小红书、得物、知乎、滴滴、爱奇艺、智谱、月之暗面、MiniMax、百川等）；
- 客观资质规则分级（结合 `scale`、`financing_stage`、`annual_cash_max_cny`）；
- 防坑防皮包逻辑（未融资无背书微型企业标记为 `is_reputable: false`）。

- [ ] **Step 4: 运行测试验证通过**

运行：`node --test lib/skills/leo-job-career/tests/unit/company-tier.test.mjs`
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add lib/skills/leo-job-career/scripts/lib/company-tier.mjs lib/skills/leo-job-career/tests/unit/company-tier.test.mjs
git commit -m "feat(leo-job-career): add dynamic company tiering engine"
```

---

### Task 3: 市场管道能力归因与企业溯源映射 (Market Pipeline Attribution)

**Files:**
- Modify: `lib/skills/leo-job-career/scripts/lib/market-pipeline.mjs`
- Modify: `lib/skills/leo-job-career/tests/unit/normalize.test.mjs`

**Interfaces:**
- Consumes: Collected job facts from `jobStore`
- Produces: `generateMarketReport(options)` enriched with:
  - `companies_by_tier`: `{ big_tech: string[], mid_tech: string[], star_startup: string[] }`
  - `capability_matrix`: `Array<{ skill: string, count: number, tiers: string[], company_sources: string[] }>`

- [ ] **Step 1: 编写能力溯源与公司名映射测试**

在 `lib/skills/leo-job-career/tests/unit/normalize.test.mjs` 或添加独立用例：
验证 `generateMarketReport` 产出的 `capability_matrix` 中的每一项都包含真实公司名称和梯队标签。

- [ ] **Step 2: 运行测试验证缺失属性**

运行：`node --test lib/skills/leo-job-career/tests/unit/normalize.test.mjs`
预期：现有报告缺少 `company_sources` 与 `tiers` 溯源字段。

- [ ] **Step 3: 更新 market-pipeline.mjs 中的报表生成逻辑**

在 `generateMarketReport` 中：
1. 遍历有效职位时调用 `classifyCompanyTier(job)`；
2. 聚合 `companies_by_tier`（按大厂、中厂、AI创企分别收录去重的知名公司名）；
3. 聚合能力标签时，记录该能力对应的公司名列表与梯队列表（限制每项展示前 3~5 家典型代表公司）。

- [ ] **Step 4: 运行测试验证通过**

运行：`node --test lib/skills/leo-job-career/tests/unit/normalize.test.mjs`
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add lib/skills/leo-job-career/scripts/lib/market-pipeline.mjs lib/skills/leo-job-career/tests/unit/normalize.test.mjs
git commit -m "feat(leo-job-career): enrich market report with capability company attribution and tiering"
```

---

### Task 4: 人岗差距推演引擎与 Markdown 报告生成 (Gap Analyzer Engine)

**Files:**
- Create: `lib/skills/leo-job-career/scripts/lib/gap-analyzer.mjs`
- Create: `lib/skills/leo-job-career/tests/unit/gap-analyzer.test.mjs`

**Interfaces:**
- Consumes:
  - `userProfile`: `{ target_role, target_city, target_level, experience_years, target_compensation }`
  - `userAssessments`: `Record<string, "proficient" | "demo_only" | "not_touched">`
  - `marketSummary`: Output of `generateMarketReport`
- Produces:
  - `analyzeGaps(input)` -> `{ top_blockers: [], secondary_gaps: [], bonus_gaps: [], solid_baseline: [] }`
  - `generateMarkdownGapReport(analysisResult, options)` -> `string` (Markdown text)
  - `saveMarkdownGapReport(markdown, paths)` -> `string` (filepath)

- [ ] **Step 1: 编写全景透明差距诊断与 Top 硬骨头提取的单元测试**

在 `lib/skills/leo-job-career/tests/unit/gap-analyzer.test.mjs` 中编写测试：
- 验证当用户自评为 `not_touched` 或 `demo_only` 时，高权重技能被划入缺口；
- 验证高亮出 Top 2~3 个核心硬骨头（最高优先级），同时将所有其他欠缺项归入次要与进阶清单，不做任何信息隐瞒；
- 验证生成的 Markdown 文本包含公司出处表格、各梯队偏好分析及后续衔接说明。

- [ ] **Step 2: 运行测试验证失败**

运行：`node --test lib/skills/leo-job-career/tests/unit/gap-analyzer.test.mjs`
预期：FAIL。

- [ ] **Step 3: 实现 gap-analyzer.mjs 核心逻辑**

实现：
1. `analyzeGaps(...)`：根据技能在目标岗位中的出现频次与企业梯队权重，结合用户掌握状态进行差距分类；
2. 筛选权重最高、企业最关切的前 2~3 个欠缺项作为 `top_blockers`（核心硬骨头）；
3. 将其余所有未掌握/仅Demo的技能全量收入 `secondary_gaps` 和 `bonus_gaps`；
4. `generateMarkdownGapReport(...)`：渲染符合第三部分规范的 Markdown 文本；
5. `saveMarkdownGapReport(...)`：将内容写入 `paths.reports/gap-analysis-report.md`。

- [ ] **Step 4: 运行测试验证通过**

运行：`node --test lib/skills/leo-job-career/tests/unit/gap-analyzer.test.mjs`
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add lib/skills/leo-job-career/scripts/lib/gap-analyzer.mjs lib/skills/leo-job-career/tests/unit/gap-analyzer.test.mjs
git commit -m "feat(leo-job-career): implement gap analyzer and transparent markdown report generator"
```

---

### Task 5: 全面瘦身与废弃模块清理 (Pruning & CLI Integration)

**Files:**
- Delete: `lib/skills/leo-job-career/scripts/lib/prepare-engine.mjs`
- Delete: `lib/skills/leo-job-career/references/career-interview.md`
- Delete: `lib/skills/leo-job-career/references/preparation-planning.md`
- Delete: `lib/skills/leo-job-career/references/roadmap-phases-2-3.md`
- Delete: `lib/skills/leo-job-career/schemas/experience-evidence.schema.json`
- Modify: `lib/skills/leo-job-career/scripts/lib/profile-engine.mjs` (清理旧 evidence 逻辑)
- Modify: `lib/skills/leo-job-career/scripts/lib/cli.mjs`
- Modify: `lib/skills/leo-job-career/scripts/leo_job_career.mjs`
- Modify: `lib/skills/leo-job-career/SKILL.md`

**Interfaces:**
- Consumes: New commands `gap analyze`, `gap report`
- Removes: Obsolete commands `profile record-evidence`, `prepare plan`

- [ ] **Step 1: 删除冗余文件与废弃测试**

删除 `prepare-engine.mjs`、`career-interview.md`、`preparation-planning.md`、`roadmap-phases-2-3.md`、`experience-evidence.schema.json` 以及旧的 `tests/integration/profile-prepare.test.mjs`。

- [ ] **Step 2: 重构 profile-engine.mjs**

移除 `recordExperienceEvidence` 和 `loadExperienceEvidence`，保留轻量化的 `careerProfile`（仅记录意向、年限、核心技能自评）。

- [ ] **Step 3: 更新 CLI 命令入口 leo_job_career.mjs**

将废弃的 `prepare` 和 `profile record-evidence` 命令移除，替换为干净的 `gap` 命令组：
- `gap analyze [--self-eval <json>]`：触发差距分析推演并输出全景 Markdown 报告；
- `gap report`：读取并展示最近生成的 `gap-analysis-report.md`。

- [ ] **Step 4: 更新 SKILL.md**

将 Skill 描述和指引彻底精简为：
- 触发词与意向定锚；
- 两阶段对齐交互（目标确认 -> 技能自评）；
- 输出带有真实公司溯源（大厂/中厂/知名创企）的单 Markdown 人岗差距报告。

- [ ] **Step 5: 提交更改**

```bash
git add -u
git commit -m "refactor(leo-job-career): prune obsolete interview and prepare engines, wire up gap CLI"
```

---

### Task 6: 端到端集成验证与测试收敛 (Integration Verification)

**Files:**
- Create: `lib/skills/leo-job-career/tests/integration/gap-analysis-flow.test.mjs`
- Verify: All tests under `tests/unit/` and `tests/integration/`

- [ ] **Step 1: 编写完整的端到端集成测试**

在 `lib/skills/leo-job-career/tests/integration/gap-analysis-flow.test.mjs` 中模拟：
1. 录入真实岗位样本（包含大厂美团、知名创企智谱、以及外包公司中软国际）；
2. 验证外包公司在管道中被 100% 过滤；
3. 执行 `generateMarketReport` 提炼出核心能力出处列表；
4. 模拟用户针对 6 项技能进行两阶段自评；
5. 调用 `analyzeGaps` 与 `generateMarkdownGapReport`，验证：
   - 生成的 Markdown 文件存在于本地；
   - 包含 Top 2~3 个核心硬骨头；
   - 包含所有欠缺项的透明分类；
   - 表格中清晰列出出处公司名（如美团、智谱）。

- [ ] **Step 2: 运行全量单元测试与集成测试**

运行：
```bash
node --test lib/skills/leo-job-career/tests/unit/*.test.mjs
node --test lib/skills/leo-job-career/tests/integration/*.test.mjs
```
预期：全部用例一次性 PASS，0 failure。

- [ ] **Step 3: 运行 CLI doctor 与 gap 验证真实环境**

运行：
```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs doctor
node lib/skills/leo-job-career/scripts/leo_job_career.mjs help
```
预期：输出结构清晰，无废弃命令。

- [ ] **Step 4: 提交最终集成代码**

```bash
git add lib/skills/leo-job-career/tests/integration/gap-analysis-flow.test.mjs
git commit -m "test(leo-job-career): add end-to-end integration test for gap analysis flow"
```
