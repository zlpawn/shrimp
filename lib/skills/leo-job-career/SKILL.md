---
name: leo-job-career
description: "面向资深 Java 工程师向 AI Agent 转型与求职进阶的专属 Copilot Skill。基于真实 BOSS 直聘登录态数据，进行目标岗位深度采集、100%排除外包与皮包公司、客观动态评定大厂/中厂/知名AI创企并溯源真实公司要求；通过两阶段轻量交互（意向定锚 + 核心技能自评），输出全景透明的单一 Markdown 人岗差距诊断报告（突出 Top 2~3 核心硬骨头并完整呈现所有维度缺口），供后续独立学习规划 Skill 无缝消费。触发词包括“分析招聘要求”、“找Java Agent工作”、“分析岗位要求”、“采集Boss岗位”、“评估P7差距”、“分析人岗差距”。"
---

# Leo Job Career

以真实岗位证据为依据的求职决策与人岗能力差距诊断中枢。拒绝盲目刷题，拒绝脱离市场实际；先摸清真实岗位硬性门槛，再精准推演个人差距。

## 核心设计与原则

1. **零网关依赖**：本 Skill 的底层采集与分析由独立 Node.js 脚本驱动，不依赖 local-ai-gateway 常驻服务或 8787 端口。
2. **私密与安全**：所有个人画像、Cookie 凭证及抓取的岗位数据全部保存在本地 `~/.shrimp/skills/leo-job-career/`，严禁在聊天对话中输出任何 Cookie 明文。
3. **只读安全红线**：严禁调用任何可能修改账户状态的写接口（如打招呼、收藏、投递等）；遇验证码立即安全暂停。
4. **100% 零容忍外包拦截**：无论公司规模多大、是否上市，只要具有外包外派或劳务派遣属性，一律绝对熔断过滤。
5. **全景透明单一 Markdown 交付**：对话中直接渲染完整诊断报告，同时本地保存 `gap-analysis-report.md`，完整呈现所有维度的技能差距（突出 Top 2~3 核心硬骨头，同时公开所有次要缺口与加分项），供后续独立的学习规划 Skill 直接作为上下文输入。

## 核心工作流与命令

所有确定性操作统一由底层脚本支撑：

```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs <command>
```

### 1. 环境与鉴权检查 (Doctor & Auth)

在执行任何采集前，先检查环境和登录态：

```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs doctor
node lib/skills/leo-job-career/scripts/leo_job_career.mjs auth status
```

- **凭证全自动获取（首选）**：若 Chrome 浏览器已登录并开启 `leo-lantern` 桥接，直接执行全自动提取：
  ```bash
  node lib/skills/leo-job-career/scripts/leo_job_career.mjs auth auto
  ```
- **手动剪贴板导入（备用）**：在 Chrome 中点击 `Leo cookie.txt Locally` 扩展的 **Copy Cookie Header**，然后执行导入：
  ```bash
  node lib/skills/leo-job-career/scripts/leo_job_career.mjs auth import-clipboard
  ```


### 2. 市场岗位侦察与采集 (Market Init & Update)

开始采集目标城市（默认北京）的 Java + Agent 核心岗位：

```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs market init --city 北京 --target 100
node lib/skills/leo-job-career/scripts/leo_job_career.mjs market status
node lib/skills/leo-job-career/scripts/leo_job_career.mjs market report
```

- **质量门禁**：自动排除所有外包/外派公司；自动跳过纯 Python 算法岗；对同公司相似岗位语义去重；标记岗位时效。
- **动态分级与溯源**：自动基于规模、融资阶段与行业属性动态评定大厂（如美团、快手、阿里）、中厂（如小红书、知乎、得物）以及知名AI创企（如智谱AI、MiniMax、月之暗面），记录每项核心技能的出处公司名单。

### 3. 两阶段轻量人岗对齐 (Two-Stage Alignment)

对话助手通过两阶段快速收敛：

1. **阶段 1：求职意向定锚**
   - 快速确认目标方向、城市、职级（如大厂P7/Tech Lead）、经验年限及期望薪资：
   ```bash
   node lib/skills/leo-job-career/scripts/leo_job_career.mjs profile init --city 北京 --role "Java Agent架构师" --target-level "大厂P7" --exp 8
   ```
2. **阶段 2：核心技能自评**
   - Agent 列出当前真实市场提炼出的 6~8 项关键硬核要求，向用户快速确认掌握程度（熟练 / 了解原理仅做Demo / 尚未接触）。
   - 用户自然回复后，快速记录自评结果：
   ```bash
   node lib/skills/leo-job-career/scripts/leo_job_career.mjs profile set-eval --skill "Agent工作流编排" --level "demo_only"
   ```

### 4. 人岗差距推演与 Markdown 报告 (Gap Analyze & Report)

对比市场各梯队真实要求与个人掌握状态，生成全景透明的诊断报告：

```bash
node lib/skills/leo-job-career/scripts/leo_job_career.mjs gap analyze
node lib/skills/leo-job-career/scripts/leo_job_career.mjs gap report
```

- **报告特色**：
  - **AI Agent 研发工程为主线**：以智能体范式与状态机容错、Tool Calling/MCP、长上下文工程、流式网关、企业级RAG、推理物理账本与代码沙箱 7 大维度为主轴，坚决杜绝原始标签（MySQL/Docker/Oracle）对核心能力画像的噪音干扰；
  - **真实大厂 JD 原文 1:1 映射**：溯源阿里千问、字节、京东、小红书等一线大厂真实招聘原文，并对照大厂 P7 技术面深挖考核内核；
  - **9年资深底座护城河定锚**：自动将 Java 底层、分布式微服务、海量存储与高并发治理对齐为“稳固基本盘（大厂P7基石）”，杜绝误判为“尚未接触”；
  - **市场权重数学计算标准化**：显式提供渗透率计算公式与分层判定标准，供下游大模型与学习规划 Skill 精确消费；
  - **全景透明缺口归类**：高亮 Top 3 致命硬骨头，并完整列出进阶工程化攻坚项与语言生态协同定位；
  - 本地单一文件落盘（`~/.shrimp/skills/leo-job-career/reports/gap-analysis-report.md`），无缝接力后续学习规划 Skill。

## 参考规范与文档

- 数据接口与反爬防御规范：[references/boss-data-contract.md](references/boss-data-contract.md)
- 岗位质量与零外包拦截规范：[references/job-quality-policy.md](references/job-quality-policy.md)
- 市场分析、能力画像与P7标杆定义：[references/market-analysis.md](references/market-analysis.md)

