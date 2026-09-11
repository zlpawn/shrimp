import { loadCareerProfile, loadExperienceEvidence } from "./profile-engine.mjs";

export function generatePreparationPlan(options = {}) {
  const { paths, jobStore } = options;
  const profile = loadCareerProfile({ paths });
  const evidenceList = loadExperienceEvidence({ paths });
  const facts = jobStore.loadJobFacts();

  // Extract skills from valid jobs
  const capabilityMap = new Map();
  for (const job of facts) {
    const labels = job.requirements?.labels || [];
    for (const label of labels) {
      const clean = label.trim();
      if (!clean) continue;
      capabilityMap.set(clean, (capabilityMap.get(clean) || 0) + 1);
    }
  }

  // 4 gap states
  const evidenced_now = [];
  const needs_refresh = [];
  const buildable_by_deadline = [];
  const experience_bound = [];

  const evidencedKeywords = ["java", "spring", "业务", "架构", "mysql", "redis", "治理", "团队", "带队"];
  const refreshKeywords = ["jvm", "高并发", "系统设计", "分布式", "锁", "事务", "可用性"];
  const buildableKeywords = ["agent", "rag", "mcp", "智能体", "知识库", "工作流", "评测", "prompt", "大模型应用"];
  const experienceBoundKeywords = ["预训练", "训练", "微调", "内核", "推理加速", "中间件内核"];

  for (const [skill, count] of capabilityMap.entries()) {
    const lower = skill.toLowerCase();

    if (experienceBoundKeywords.some(k => lower.includes(k))) {
      experience_bound.push({
        capability: skill,
        frequency_in_jobs: count,
        advice: "需多年底层算法或超大规模集群实战，短期准备性价比极低，不作为近两月攻坚主线",
      });
    } else if (buildableKeywords.some(k => lower.includes(k))) {
      buildable_by_deadline.push({
        capability: skill,
        frequency_in_jobs: count,
        proof_strategy: "通过一个具备权限控制、MCP工具调用、RAG与评测的企业级Agent项目形成代码与架构证据",
      });
    } else if (refreshKeywords.some(k => lower.includes(k))) {
      needs_refresh.push({
        capability: skill,
        frequency_in_jobs: count,
        proof_strategy: "梳理过去项目中实际面对的并发、一致性与系统边界问题，结合P7追问深度进行推演复习",
      });
    } else {
      evidenced_now.push({
        capability: skill,
        frequency_in_jobs: count,
        proof_strategy: "已有8年以上Java核心业务研发底盘，直接作为基本盘佐证",
      });
    }
  }

  // Ensure high-priority Agent skills exist even if sample size is small
  if (!buildable_by_deadline.some(x => x.capability.toLowerCase().includes("agent"))) {
    buildable_by_deadline.push({
      capability: "Agent",
      frequency_in_jobs: facts.length || 1,
      proof_strategy: "通过企业级智能体工作流项目提供落地证据",
    });
  }
  if (!buildable_by_deadline.some(x => x.capability.toLowerCase().includes("rag"))) {
    buildable_by_deadline.push({
      capability: "RAG",
      frequency_in_jobs: facts.length || 1,
      proof_strategy: "掌握企业级知识库召回、上下文压缩与防幻觉设计",
    });
  }
  if (!buildable_by_deadline.some(x => x.capability.toLowerCase().includes("mcp"))) {
    buildable_by_deadline.push({
      capability: "MCP",
      frequency_in_jobs: facts.length || 1,
      proof_strategy: "掌握Model Context Protocol与企业内部系统工具调用",
    });
  }

  // Progressive 8-weekend roadmap
  const weekend_roadmap = [
    {
      weekend: 1,
      allocated_hours: 5,
      stage: "市场侦察与经历盘点",
      deliverable: "完成目标岗位能力矩阵核对，梳理出 2 个最能证明业务复杂度与架构设计的历史项目",
      workstreams: [
        { name: "岗位复盘", hours: 2, task: "通过 market report 审阅 60-70万 岗位的技术标签分布" },
        { name: "经历萃取", hours: 3, task: "使用 profile record-evidence 沉淀历史核心项目的业务难点与决策取舍" },
      ],
    },
    {
      weekend: 2,
      allocated_hours: 5,
      stage: "定向 Agent 项目方案与选型",
      deliverable: "产出与个人优势高度互补的 Agent 实战项目架构文档（推荐：企业生产排障或业务工作流 Agent）",
      workstreams: [
        { name: "技术选型", hours: 2, task: "敲定技术栈（Spring Boot + LangChain4j/MCP + 向量存储）" },
        { name: "架构设计", hours: 3, task: "绘制架构图：多系统集成、权限隔离、Audit审计与Human-in-the-loop设计" },
      ],
    },
    {
      weekend: 3,
      allocated_hours: 6,
      stage: "Agent 核心研发：RAG 与向量检索",
      deliverable: "跑通知识库召回、重排、Prompt组装与防幻觉验证",
      workstreams: [
        { name: "工程编码", hours: 4, task: "实现分块、向量化与混合检索（关键词+语义）" },
        { name: "知识复习", hours: 2, task: "掌握 RAG 常见故障与上下文工程核心考点" },
      ],
    },
    {
      weekend: 4,
      allocated_hours: 6,
      stage: "Agent 核心研发：MCP 与工具调用",
      deliverable: "跑通多工具调用、状态机长任务与审批拦截",
      workstreams: [
        { name: "工程编码", hours: 4, task: "实现 Function Calling / MCP 协议客户端与幂等补偿" },
        { name: "权限与安全", hours: 2, task: "落实企业级鉴权与人工确认中断机制" },
      ],
    },
    {
      weekend: 5,
      allocated_hours: 8,
      stage: "Agent 稳定性、评测与可观测性",
      deliverable: "产出评测集、延迟与 Token 成本指标、链路追踪数据",
      workstreams: [
        { name: "评测体系", hours: 4, task: "构建基准评测用例，验证准确率与幻觉率" },
        { name: "可观测性", hours: 4, task: "引入 Trace 审计日志与系统监控指标" },
      ],
    },
    {
      weekend: 6,
      allocated_hours: 8,
      stage: "Java 后端核心深度与系统设计复习",
      deliverable: "完成 JVM、并发编程、高可用分布式架构面试考点体系梳理",
      workstreams: [
        { name: "系统设计", hours: 5, task: "演练高并发与跨系统治理设计题（分库分表、分布式事务、降级容灾）" },
        { name: "底层复习", hours: 3, task: "复习 JVM 垃圾回收、内存模型与生产问题排查" },
      ],
    },
    {
      weekend: 7,
      allocated_hours: 8,
      stage: "P7 级别影响力故事与主简历定稿",
      deliverable: "完成技术选型推演演练，主简历（包含Agent项目与历史核心项目）定稿",
      workstreams: [
        { name: "简历成型", hours: 4, task: "将 Agent 项目与历史经验整合成可验证的简历内容" },
        { name: "模拟答辩", hours: 4, task: "准备 P7 级别追问：为什么这么做、放弃了什么、团队如何推进" },
      ],
    },
    {
      weekend: 8,
      allocated_hours: 8,
      stage: "少量试投与市场反馈校准",
      deliverable: "投递 3-5 家次优目标岗位，根据面试初筛反馈定向补充薄弱环节",
      workstreams: [
        { name: "定向试投", hours: 3, task: "筛选非第一梯队但真实的 Java + Agent 机会试投" },
        { name: "动态复盘", hours: 5, task: "根据 HR/猎头与面试官提问微调知识点权重" },
      ],
    },
  ];

  return {
    target_role: profile.direction.join(" / "),
    target_band: profile.compensation.target_band,
    deadline: profile.deadline,
    gap_analysis: {
      evidenced_now,
      needs_refresh,
      buildable_by_deadline,
      experience_bound,
    },
    weekend_roadmap,
  };
}
