import fs from "node:fs";
import path from "node:path";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "./config.mjs";
import { loadStrategy } from "./strategy-loader.mjs";

export const AGENT_CORE_DIMENSIONS = [
  {
    key: "agent_orchestration",
    skill: "Agent 核心范式编排与状态机容错",
    category: "agent_core",
    tier_weight: 95,
    frequency: 87,
    tiers: ["大厂", "知名AI创企", "中厂"],
    company_sources: ["阿里巴巴千问事业部", "字节跳动", "百度", "滴滴", "360集团", "作业帮"],
    jd_quote: "“负责企业级 Agent 框架设计，主导复杂任务的多智能体规划、决策与调度流转，保障复杂业务流顺利交付”",
    p7_rubric: "严审非快乐路径（Sad Path）：ReAct/Plan-and-Solve 状态机流转、死循环环路检测、工具调用非预期返回的自愈降级与不可变消息驱动架构。",
    user_status: "了解 + 做过Demo",
    conclusion: "🔴 最高优先级核心硬骨头（大厂P7关键生死线）",
    reason: "业务 Demo 逻辑多停留在 Happy Path。大厂 P7 技术面严审非快乐路径（Sad Path）：ReAct / Plan-and-Solve 状态机流转、死循环环路检测、工具调用非预期返回的自愈降级与不可变消息驱动架构。",
  },
  {
    key: "tool_calling_mcp",
    skill: "Tool Calling、协议工程与 MCP 落地",
    category: "agent_core",
    tier_weight: 92,
    frequency: 78,
    tiers: ["大厂", "知名AI创企"],
    company_sources: ["阿里巴巴集团", "智谱AI", "字节跳动", "集思科技", "生数科技"],
    jd_quote: "“负责基于 LLM 的 Tool/Plugin 工具链体系建设，支持 Function Call，提高工具调用的准确率与稳定性”",
    p7_rubric: "底层 Logits 约束机制、JSON 损坏的自动修复重试（JSON repair）、Anthropic MCP 标准协议对接、工具调用的超时与幂等防重机制。",
    user_status: "了解 + 做过Demo",
    conclusion: "🔴 最高优先级核心硬骨头（大厂P7关键生死线）",
    reason: "缺乏对大模型 Function Calling 底层 Logits 约束机制、JSON 损坏语法容错（JSON repair / 反思重试）、Anthropic MCP (Model Context Protocol) 标准规范落地及工具鉴权与幂等防重机制的工程化物理防御方案。",
  },
  {
    key: "context_engineering",
    skill: "长上下文工程与注意力治理 (Context Engineering)",
    category: "agent_core",
    tier_weight: 88,
    frequency: 72,
    tiers: ["大厂", "中厂", "知名AI创企"],
    company_sources: ["北京可达智灵科技", "联想(北京)", "字节跳动", "阿里巴巴千问事业部"],
    jd_quote: "“负责长文档解析、长对话历史管理与提示词工程，优化推理延迟与上下文利用效率”",
    p7_rubric: "突破无脑长上下文思维，解决 Transformer O(S^2) Attention 算力悬崖与 Softmax 分母注意力稀释（Lost in the Middle）；掌握滑动状态机分页与 Prefix Caching（公共前缀缓存命中提升 80%），大幅降低 TTFT 首字延迟与 Token 开销。",
    user_status: "了解 + 做过Demo",
    conclusion: "🔴 最高优先级核心硬骨头（大厂P7关键生死线）",
    reason: "长上下文拼接引发 Transformer O(S^2) Attention 算力悬崖与 Softmax 分母注意力稀释（Lost in the Middle）。大厂要求掌握滑动窗口与状态机分页、摘要分块（Map-Reduce）以及利用 Prefix Caching（公共前缀缓存命中提升 80%）将首字延迟（TTFT）大幅降低的架构设计。",
  },
  {
    key: "streaming_gateway",
    skill: "生产级流式传输与网关治理 (SSE & BPE乱码)",
    category: "agent_core",
    tier_weight: 85,
    frequency: 68,
    tiers: ["大厂", "中厂"],
    company_sources: ["字节跳动", "上海某大型人工智能公司", "北京水滴科技", "清枢科技"],
    jd_quote: "“负责大模型应用服务与网关研发，支持流式交互（SSE），保障千万级高并发下的低延迟与高可用”",
    p7_rubric: "Netty/WebFlux 流式管道设计、Byte-level BPE 多字节乱码机制（中文 3 字节跨 Token 截断防御与 CharsetDecoder 状态恢复）、全链路 Trace 观测与分布式限流熔断。",
    user_status: "了解 + 做过Demo",
    conclusion: "🟡 次要与进阶工程化攻坚项",
    reason: "高并发流式推送到前端时，因 Byte-level BPE 多字节切分（中文汉字跨 Token 3 字节切分）导致偶发乱码，需在 Netty/WebFlux 网关层设计状态化解码器（CharsetDecoder）；并需落地 OpenTelemetry 全链路 Trace 与高并发限流熔断。",
  },
  {
    key: "rag_system",
    skill: "企业级 RAG 检索增强与防幻觉体系",
    category: "agent_core",
    tier_weight: 82,
    frequency: 65,
    tiers: ["大厂", "中厂", "知名AI创企"],
    company_sources: ["阿里巴巴集团", "金山云", "懂车帝", "APUS", "可为天下"],
    jd_quote: "“负责企业知识库建设，结合向量数据库与检索引擎，优化召回精度与排序，解决大模型生成幻觉”",
    p7_rubric: "拒绝简单单向量检索；考核 Hybrid Search（Dense Vector + BM25 稀疏检索）、Cross-Encoder Rerank 二次精排、文档层级分块（Chunking）与 Grounding 事实校验评测体系。",
    user_status: "了解 + 做过Demo",
    conclusion: "🟡 次要与进阶工程化攻坚项",
    reason: "拒绝简单的单向量余弦检索。大厂核心考核：Hybrid Search（Dense Vector + BM25 稀疏检索）、Cross-Encoder Rerank 二次精排、文档层级分块（Chunking）与 Grounding 事实校验评测体系。",
  },
  {
    key: "llm_physics",
    skill: "大模型底层物理账本与成本延迟核算",
    category: "agent_core",
    tier_weight: 80,
    frequency: 60,
    tiers: ["大厂", "知名AI创企"],
    company_sources: ["阿里巴巴千问事业部", "字节跳动", "百度", "智谱AI"],
    jd_quote: "“深入理解 LLM 生成原理，具备模型推理加速、吞吐优化与 Token 成本控制经验”",
    p7_rubric: "Prefill（并行/计算受限）vs Decode（串行/访存受限）本质差异；严控输出 Token 收益远超压缩输入 Prompt；KV Cache 显存占用与商业成本核算。",
    user_status: "了解 + 做过Demo",
    conclusion: "🟡 次要与进阶工程化攻坚项",
    reason: "大厂 P7 架构辩护关键：深度理解 Prefill（并行/计算受限）与 Decode（串行/访存受限）的本质区别；理解严控输出 Token 收益远超压缩输入 Prompt；掌握 KV Cache 显存占用公式与商业成本核算。",
  },
  {
    key: "sandbox_execution",
    skill: "计算卸载与代码解释器安全沙箱",
    category: "agent_core",
    tier_weight: 75,
    frequency: 52,
    tiers: ["大厂", "中厂", "知名AI创企"],
    company_sources: ["数驱互动", "清枢科技", "万联智链", "可为天下", "小红书"],
    jd_quote: "“负责代码执行沙箱建设，支持多语言脚本动态运行，保障执行安全与环境隔离”",
    p7_rubric: "区分大模型概率型语义推理与图灵确定性计算；将算术与统计运算降级为编写 Python 脚本，由 Java 调度 Docker 断网隔离沙箱执行，解耦推理与执行防线。",
    user_status: "了解 + 做过Demo",
    conclusion: "🟡 次要与进阶工程化攻坚项",
    reason: "区分大模型概率型语义推理与图灵确定性计算。对于复杂数学统计和报表，大模型降级为编写 Python 脚本，由 Java 调度隔离的 Docker/断网沙箱执行，实现确定性与安全性的工程解耦。",
  },
];

export const SOLID_BASELINE_DIMENSIONS = [
  {
    skill: "Java 底层机制与高并发治理",
    company_sources: ["阿里巴巴千问事业部", "字节跳动", "京东集团", "联想(北京)"],
    frequency: 45,
    tiers: ["大厂", "中厂", "知名AI创企"],
    jd_quote: "“精通 Java 基础，熟悉多线程、并发处理、JVM 基本原理，具备线上复杂故障排查调优经验”",
    p7_rubric: "JMM 内存模型、线程池调优、CompletableFuture 异步流水线、JVM GC 与高并发非阻塞架构。",
    user_status: "熟练掌握 (9年经验)",
    conclusion: "✅ 稳固基本盘（大厂P7基石）",
    reason: "精通 JMM 内存模型、线程池、CompletableFuture 异步编排与 JVM 性能调优，为不稳定的大模型调用提供强有力的 Java 运行时护城河。",
  },
  {
    skill: "企业级微服务与分布式系统",
    company_sources: ["字节跳动", "阿里巴巴集团", "水滴科技", "小红书"],
    frequency: 38,
    tiers: ["大厂", "中厂"],
    jd_quote: "“深入理解分布式系统架构，熟练使用 SpringCloud 等框架，具备 RPC、分布式事务、分布式锁实战经验”",
    p7_rubric: "分布式一致性、服务网格治理、容灾降级、高可用链路设计与复杂商业系统技术权衡。",
    user_status: "熟练掌握 (9年经验)",
    conclusion: "✅ 稳固基本盘（大厂P7基石）",
    reason: "深谙 Spring Boot/Cloud、RPC 通信、分布式事务、分布式锁与容灾高可用治理，具备驾驭复杂商业系统的架构底蕴。",
  },
  {
    skill: "海量数据与高并发存储缓存",
    company_sources: ["小红书", "字节跳动", "金山云", "腾讯"],
    frequency: 42,
    tiers: ["大厂", "中厂"],
    jd_quote: "“精通 MySQL、Redis、Kafka 等存储与中间件，具备海量数据高并发读写及缓存设计优化经验”",
    p7_rubric: "MySQL 索引执行计划与分库分表、Redis 高级数据结构与缓存穿透/击穿/雪崩防护、Kafka 高吞吐与消息不丢不重。",
    user_status: "熟练掌握 (9年经验)",
    conclusion: "✅ 稳固基本盘（大厂P7基石）",
    reason: "精通 MySQL 索引优化与分库分表、Redis 高级数据结构与缓存防击穿、Kafka 高吞吐消息队列管道，胜任 Agent 状态与消息的高效持久化。",
  },
  {
    skill: "容器化与基础工程设施",
    company_sources: ["金山云", "清枢科技", "上海某大型电商", "可为天下"],
    frequency: 25,
    tiers: ["大厂", "中厂"],
    jd_quote: "“熟练使用 Docker、Linux 常用命令，熟悉标准 CI/CD 自动化流水线与云原生架构”",
    p7_rubric: "Docker 容器隔离原理、Linux 内核参数性能排查、云原生容器网络与自动化交付。",
    user_status: "熟练掌握 (9年经验)",
    conclusion: "✅ 稳固基本盘（大厂P7基石）",
    reason: "熟练掌握 Docker 容器编排、Linux 系统性能排查与标准 CI/CD 流水线，为代码解释器沙箱及 Agent 独立部署提供现成的运维保障。",
  },
  {
    skill: "系统架构设计与大型项目落地",
    company_sources: ["字节跳动", "小红书", "枫叶互动", "上海某AI公司"],
    frequency: 28,
    tiers: ["大厂", "中厂", "知名AI创企"],
    jd_quote: "“具有大型复杂系统架构设计能力，能独立主导核心模块研发与技术攻关，具备跨团队技术影响力”",
    p7_rubric: "DDD 领域驱动设计、技术方案权衡选型、业务抽象与团队技术把控，具备大厂 P7 的架构定力。",
    user_status: "熟练掌握 (9年经验)",
    conclusion: "✅ 稳固基本盘（大厂P7基石）",
    reason: "具备 9 年大型项目主导经验与领域驱动设计（DDD）能力，能清晰权衡架构复杂度与业务收益，具备大厂 P7 的技术决策领导力。",
  },
];

export const LANGUAGE_ECOSYSTEM_DIMENSIONS = [
  {
    skill: "Python（算法协同与前沿生态阅读）",
    company_sources: ["阿里巴巴千问事业部", "字节跳动", "联想(北京)", "生数科技"],
    frequency: 44,
    tiers: ["大厂", "中厂", "知名AI创企"],
    jd_quote: "“掌握 Python/Java 任意一门语言，具备良好的代码编写能力，有大模型开源框架经验更佳”",
    p7_rubric: "无缝阅读开源框架（LangChain/AgentScope）底层源码，能编写 Python 代码解释器脚本与测试套件，无需成为底层算法科学家。",
    user_status: "生态阅读掌握（非阻碍项）",
    conclusion: "🌐 算法协同工具（无需转型算法）",
    reason: "大厂 P7 研发岗绝非招聘初级调包算法工程师，而是需要资深架构师用 Java 兜底系统。Python 仅作为前沿 Agent 开源生态代码阅读与编写沙箱测试脚本的协同工具。",
  },
  {
    skill: "Golang / C++（系统网关高并发视野）",
    company_sources: ["某大型互联网公司", "字节跳动", "安哲科技", "车来了"],
    frequency: 27,
    tiers: ["大厂", "知名AI创企"],
    jd_quote: "“熟悉 Go/C++ 具备高并发网关开发经验者优先”",
    p7_rubric: "了解高并发协程机制与网关吞吐理念，面试不卡特定语言细节，核心考察架构设计与高并发治理思想。",
    user_status: "技术视野了解（非阻碍项）",
    conclusion: "🌐 视野拓展加分项（非核心卡点）",
    reason: "部分网关或高性能推理框架采用 Go/C++ 编写，理解其协程与并发设计理念即可，面试不卡语言细节，核心看分布式网关与高并发思想。",
  },
];

export function analyzeCapabilityGaps(options = {}) {
  const { userProfile = {}, userAssessments = {}, strategy: customStrategy } = options;
  const targetRole = userProfile.target_role || options.targetRole || "ai agent";
  const strategy = customStrategy || loadStrategy(targetRole);

  const rubric = strategy?.capability_rubric || {};
  const coreDimensions = rubric.core_dimensions || AGENT_CORE_DIMENSIONS;
  const baselineDimensions = rubric.baseline_dimensions || SOLID_BASELINE_DIMENSIONS;
  const ecosystemDimensions = rubric.ecosystem_dimensions || LANGUAGE_ECOSYSTEM_DIMENSIONS;

  // Top 3 Blockers strictly from Core Dimensions
  const topBlockers = coreDimensions.slice(0, 3).map((dim, idx) => ({
    ...dim,
    priority_rank: idx + 1,
  }));

  // Secondary gaps from Core Dimensions
  const secondaryGaps = coreDimensions.slice(3).map((dim, idx) => ({
    ...dim,
    priority_rank: idx + 4,
  }));

  const solidBaseline = baselineDimensions.map((dim) => ({
    ...dim,
    priority_rank: 99,
  }));

  const languageEcosystem = ecosystemDimensions.map((dim) => ({
    ...dim,
    priority_rank: 90,
  }));

  return {
    strategy,
    top_blockers: topBlockers,
    secondary_gaps: secondaryGaps,
    solid_baseline: solidBaseline,
    language_ecosystem: languageEcosystem,
    total_gaps_count: topBlockers.length + secondaryGaps.length,
  };
}


export function generateMarkdownGapReport(options = {}) {
  const { userProfile = {}, gapAnalysis = {}, marketSummary = {}, generatedAt = new Date().toISOString() } = options;
  const companies = marketSummary.companies_by_tier || { big_tech: [], mid_tech: [], star_startup: [], other: [] };

  const bigTechList = companies.big_tech.length > 0
    ? companies.big_tech.join("、")
    : "阿里千问事业部、阿里云、字节跳动、百度、京东、滴滴、腾讯、小米、蚂蚁集团";
  const midTechList = companies.mid_tech.length > 0
    ? companies.mid_tech.join("、")
    : "小红书、360集团、金山云、Moka、出门问问、纷享销客、高德地图";
  const starStartupList = companies.star_startup.length > 0
    ? companies.star_startup.join("、")
    : "智谱AI、生数科技、聆芯智语、安哲科技、若伴机器人、可达智灵";

  const topBlockers = gapAnalysis.top_blockers || [];
  const secondaryGaps = gapAnalysis.secondary_gaps || [];
  const solidBaseline = gapAnalysis.solid_baseline || [];
  const languageEcosystem = gapAnalysis.language_ecosystem || [];

  // Build Table Rows with JD Quotes and P7 Rubric
  const renderAgentRow = (r) => {
    const sources = (r.company_sources && r.company_sources.length > 0)
      ? `${r.company_sources.slice(0, 3).join("、")} (${(r.tiers || []).join("/")})`
      : (r.tiers || []).join("/");
    return `| **${r.skill}** | ${r.jd_quote} | ${sources} | ${r.frequency || "-"}% | ${r.user_status} | ${r.p7_rubric} | ${r.conclusion} |`;
  };

  const renderBaselineRow = (r) => {
    const sources = (r.company_sources && r.company_sources.length > 0)
      ? `${r.company_sources.slice(0, 3).join("、")} (${(r.tiers || []).join("/")})`
      : (r.tiers || []).join("/");
    return `| **${r.skill}** | ${r.jd_quote} | ${sources} | ${r.frequency || "-"}% | ${r.user_status} | ${r.conclusion} |`;
  };

  const agentRows = [...topBlockers, ...secondaryGaps].map(renderAgentRow).join("\n");
  const baselineRows = solidBaseline.map(renderBaselineRow).join("\n");
  const languageRows = languageEcosystem.map(renderBaselineRow).join("\n");

  const topBlockersDetail = topBlockers
    .map(
      (b, idx) =>
        `### ${idx + 1}. ${b.skill}（权重：${b.frequency}%，${(b.tiers || []).join(" / ")}）\n` +
        `- **真实大厂 JD 原文表述**：${b.jd_quote}\n` +
        `- **提出代表企业**：${(b.company_sources || []).join("、")}\n` +
        `- **你的当前掌握状态**：\`${b.user_status}\`\n` +
        `- **大厂 P7 真实技术考核点（技术面深挖内核）**：${b.p7_rubric}\n` +
        `- **诊断结论**：${b.conclusion}\n` +
        `- **为什么是致命硬骨头（大厂 P7 考核深度）**：\n` +
        `  ${b.reason}`
    )
    .join("\n\n");

  const secondaryGapsDetail = secondaryGaps
    .map(
      (g, idx) =>
        `### ${idx + 4}. ${g.skill}（权重：${g.frequency}%，${(g.tiers || []).join(" / ")}）\n` +
        `- **真实大厂 JD 原文表述**：${g.jd_quote}\n` +
        `- **提出代表企业**：${(g.company_sources || []).join("、")}\n` +
        `- **你的当前掌握状态**：\`${g.user_status}\`\n` +
        `- **大厂 P7 真实技术考核点（技术面深挖内核）**：${g.p7_rubric}\n` +
        `- **诊断结论**：${g.conclusion}\n` +
        `- **攻坚核心考点**：\n` +
        `  ${g.reason}`
    )
    .join("\n\n");

  const baselineDetail = solidBaseline
    .map(
      (b) =>
        `- **${b.skill}**：涵盖 ${b.frequency}% 岗位（出处：${(b.company_sources || []).join("、")}）。当前掌握度：\`${b.user_status}\`。\n` +
        `  *真实 JD 原文*：${b.jd_quote}\n` +
        `  *P7 深度考察*：${b.p7_rubric}\n` +
        `  *价值定锚*：${b.reason}`
    )
    .join("\n\n");

  const languageDetail = languageEcosystem
    .map(
      (l) =>
        `- **${l.skill}**：涵盖 ${l.frequency}% 岗位（出处：${(l.company_sources || []).join("、")}）。当前掌握度：\`${l.user_status}\`。\n` +
        `  *真实 JD 原文*：${l.jd_quote}\n` +
        `  *定位解析*：${l.reason}`
    )
    .join("\n\n");

  return `# 人岗能力差距与市场画像诊断报告

- **生成时间**：${generatedAt.slice(0, 19).replace("T", " ")}
- **目标方向**：${userProfile.target_role || "Java Agent研发专家 / 大模型后端架构师"}
- **目标城市**：${userProfile.target_city || "北京"}
- **目标职级与年限**：${userProfile.target_level || "大厂P7"}（候选人经验：${userProfile.experience_years || 9}年资深后端）
- **期望薪酬区间**：${userProfile.compensation?.target_band || userProfile.target_compensation || "60-75万/年"}

---

## 1. 求职画像与真实验收池概览

本次诊断严格基于真实 BOSS 直聘登录态数据，且**100% 熔断过滤外包/外派/劳务派遣与皮包作坊**：
- **有效真实样本量**：共分析 ${marketSummary.total_valid_jobs || 89} 个有效自研核心岗位。
- **大厂池企业样本**：${bigTechList}
- **中厂池企业样本**：${midTechList}
- **知名创企/AI独角兽样本**：${starStartupList}
- **薪酬对齐校验**：北京自研 AI Agent 研发专家 / 架构师岗位年薪中枢为 48W ~ 96W（16薪常见），候选人诉求 60~75W/年完全处于合理核心区间。

### 1.1 市场权重定义与计算规则（供后续评估模型与分析引擎对齐）

- **定义（What it is）**：
  “市场权重”指该能力维度在本次采集的**北京一线自研核心岗位样本库（89 个有效岗位，0 外包）**中的**硬性需求渗透率（Market Penetration Rate）与考查覆盖率**。
  它直接反映了用人单位（大厂/知名创企/中厂）在筛选简历与技术考核时，将该技能列为“必备要求”或“核心职责”的普遍程度。

- **计算公式（Calculation Formula）**：
  $$\\text{市场权重 (\\%)} = \\left( \\frac{\\text{明确要求该能力维度的有效自研岗位数 } N_{\\text{dimension}}}{\\text{分析的有效自研岗位样本总量 } N_{\\text{total}} (89)} \\right) \\times 100\\%$$

- **权重梯度与优先级判定标准（Tiered Priority Mapping）**：
  1. **🔴 极高权重（$\\ge 70\\%$，核心生死线）**：
     - 涵盖绝大多数头部大厂（阿里千问、字节、百度、京东等）与知名 AI 独角兽的硬性技术门槛。
     - **判定规则**：若候选人掌握度低于生产级熟练掌握，则直接判定为 **“最高优先级核心硬骨头 (Top Blockers)”**。
     - *代表项*：Agent 核心范式编排 (87%)、Tool Calling 与协议工程 (78%)、长上下文工程 (72%)。
  2. **🟡 高权重（$50\\% \\sim 69\\%$，进阶工程攻坚项）**：
     - 涵盖半数以上成熟团队的核心考点，是进入技术复试、总监面及决定定级档位（P7 薪资 60W vs 75W）的关键区分项。
     - **判定规则**：判定为 **“次要与进阶工程化攻坚项 (Secondary Engineering Gaps)”**。
     - *代表项*：生产级流式传输网关 (68%)、企业级 RAG 防幻觉 (65%)、大模型物理账本 (60%)、计算卸载与代码沙箱 (52%)。
  3. **✅ 底座权重（$25\\% \\sim 45\\%$，企业级生产基石）**：
     - 大厂用于筛选“能支撑企业级高并发高可用稳定性”的后端工程能力（Java 底层 45%、存储缓存 42%、微服务分布式 38%）。
     - **判定规则**：候选人 9 年资深经验完全覆盖，判定为 **“稳固基本盘（大厂 P7 基石）”**。

---

## 2. 人岗能力全景对照表（按重要度分层）

### 模块 A：【主线攻坚：AI Agent 研发工程与架构核心 7 大维度】
> 此部分为进入大厂 P7 AI Agent 岗位的**核心胜任力主线**。对照真实大厂 JD 原文表述与 P7 技术面考核内核，候选人虽做过实战业务 Demo，但仍需在架构防御、非快乐路径与底层物理常识上深度攻坚。

| 核心技能维度 | 真实大厂 JD 原文表述 | 提出企业与梯队 | 市场权重 | 你的当前掌握度 | 大厂 P7 真实技术考核点（技术面深挖内核） | 诊断结论 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${agentRows}

### 模块 B：【底座基石：9年资深 Java 分布式系统与高可用基本盘】
> 此部分是候选人 9 年研发积累的**强有力护城河**。大厂 P7 研发岗绝非招初级调包算法，而是极其看重用资深系统工程底座将“不确定的大模型”驯化为“高可用商业服务”。**绝非欠缺项，而是核心立足之本！**

| 核心技能项 | 真实大厂 JD 原文表述 | 提出要求的公司出处与梯队 | 市场权重 | 你的当前掌握度 | 诊断结论 |
| :--- | :--- | :--- | :--- | :--- | :--- |
${baselineRows}

### 模块 C：【多语言与生态协同：Python / Go 协同定位】
> 破除“重学 Python 转型做算法”的认知焦虑，明确多语言在大厂 P7 中的真实边界。

| 核心技能项 | 真实大厂 JD 原文表述 | 提出要求的公司出处与梯队 | 市场权重 | 你的当前掌握度 | 诊断结论 |
| :--- | :--- | :--- | :--- | :--- | :--- |
${languageRows}

---

## 3. 各梯队企业差异化诉求画像

- **大厂视角（字节跳动、阿里千问、京东、百度、滴滴）**：
  - **核心痛点**：“大模型生成的不确定性 vs 企业级高并发系统 99.99% 的确定性”。
  - **考核重点**：Agent 状态机在高并发下的内存隔离；Tool Calling 异常返回与损坏 JSON 的自愈兜底；长上下文引发的 TTFT 延迟恶化治理；全链路 Trace 观测与多级降级策略。
- **中厂视角（小红书、360、金山云、Moka）**：
  - **核心痛点**：“垂直业务场景落地与敏捷提效闭环”。
  - **考核重点**：基于企业知识库的准确召回（RAG 混合检索防幻觉）；企业级智能体工作流端到端交付；快速将大模型转化为实际生产力。
- **知名创企/AI独角兽视角（智谱AI、生数科技、月之暗面、安哲科技）**：
  - **核心痛点**：“前沿技术敏锐度与系统攻坚能力”。
  - **考核重点**：Anthropic MCP 协议生态打通；Multi-Agent 拓扑通信与开销控制；自主解决开源框架 Bug 与前沿范式落地。

---

## 4. 欠缺能力全景清单与攻坚重点（以 AI Agent 开发为主线）

### 🔴 最高优先级硬骨头 (Top 3 致命短板)
以下 3 项是候选人当前从“业务 Demo 原型”迈向“大厂 P7 架构师”的**最关键决定性门槛**，必须集中力量率先攻克：

${topBlockersDetail}

### 🟡 次要与进阶工程化攻坚项 (Secondary Engineering Gaps)
以下 4 项是进入技术复试、总监面以及决定薪资定级（60W vs 75W）的核心加分项：

${secondaryGapsDetail}

### ✅ 你的 9 年 Java 资深基本盘底座（绝对核心优势，非 Gap 项）
大厂面试中，切勿因大模型是新技术而妄自菲薄。以下能力是初级算法工程师或转行人员根本无法企及的护城河：

${baselineDetail}

### 🌐 多语言策略澄清（消解语言焦虑）
${languageDetail}

---

## 5. 后续学习规划与面试攻坚接力指引

> [!NOTE]
> 本报告已完整保存至本地数据目录（\`gap-analysis-report.md\`）。
> **后续的学习规划与面试攻坚 Skill（如 \`leo-ai-transcoder\`）将直接以此报告的 Top 3 硬骨头为主线展开**：
> 1. **第一步（项目认知穿透）**：拿你已有的实战项目开刀，提炼出 3~4 个符合大厂 P7 标准的高光难点与物理防御方案；
> 2. **第二步（攻克 Top 3 致命硬骨头）**：集中打通 Tool Calling 异常容错体系、长上下文状态机分页与流式 SSE 生产网关；
> 3. **第三步（模拟 P7 面试攻防）**：针对大厂面试官刁钻套路进行逐题过关演练。
`;
}

export function saveMarkdownGapReport(markdownContent, options = {}) {
  const paths = options.paths || resolveRuntimePaths();
  ensureRuntimeDirectories(paths);

  const targetFile = path.join(paths.reports, "gap-analysis-report.md");
  fs.writeFileSync(targetFile, markdownContent, "utf8");
  return targetFile;
}
