# Market Analysis & P7 Benchmark (大厂 P7 AI Agent 能力标杆与分析规范)

## 1. 角色分类 (Role Families)
1. `ai_application_backend`: Enterprise Agent apps, RAG knowledge systems, MCP tools, business workflows.
2. `agent_platform_infrastructure`: Runtime, model gateway, vector DB, multi-tenant agent platforms.
3. `technical_lead`: Architecture, core modules, tech decisions, cross-team technical influence.
4. `technical_management`: Team leadership + substantive technical ownership and project delivery.

---

## 2. 市场权重定义与计算规则 (Market Weight Formula)
- **概念定义**：在目标城市（如北京）采集的真实有效自研岗位样本池中，某能力维度被明确列入“核心职责”或“硬性要求”的渗透率。
- **计算公式**：
  $$\text{Market Weight (\%)} = \left( \frac{N_{\text{dimension}}}{N_{\text{total}}} \right) \times 100\%$$
- **判定阈值与梯队标准**：
  - **$\ge 70\%$（🔴 极高权重 / 核心生死线）**：绝大多数大厂与知名 AI 独角兽的硬性技术门槛，候选人未达到熟练掌握直接列为 **Top Blockers**。
  - **$50\% \sim 69\%$（🟡 高权重 / 进阶工程攻坚项）**：决定技术复试与定薪评级（P7 薪资 60W vs 75W）的核心区分项，列为 **Secondary Engineering Gaps**。
  - **$25\% \sim 45\%$（✅ 底座权重 / 企业级生产基石）**：用于考察高可用与高并发底层稳定性，9年后端老兵的 **Solid Baseline**。

---

## 3. AI Agent 研发工程与架构核心 7 大维度 (AI Agent Core Dimensions)

| 核心技能维度 | 真实大厂 JD 原文表述 | 大厂 P7 真实技术考核点（技术面深挖内核） |
| :--- | :--- | :--- |
| **1. Agent 核心范式编排与状态机容错** | “负责企业级 Agent 框架设计，主导复杂任务的多智能体规划、决策与调度流转，保障复杂业务流顺利交付” | 严审非快乐路径（Sad Path）：ReAct/Plan-and-Solve 状态机流转、死循环环路检测、工具调用非预期返回的自愈降级与不可变消息驱动架构。 |
| **2. Tool Calling、协议工程与 MCP 落地** | “负责基于 LLM 的 Tool/Plugin 工具链体系建设，支持 Function Call，提高工具调用的准确率与稳定性” | 底层 Logits 约束机制、JSON 损坏的自动修复重试（JSON repair）、Anthropic MCP 标准协议对接、工具调用的超时与幂等防重机制。 |
| **3. 长上下文工程与注意力治理 (Context Engineering)** | “负责长文档解析、长对话历史管理与提示词工程，优化推理延迟与上下文利用效率” | 突破无脑长上下文思维，解决 Transformer $O(S^2)$ Attention 算力悬崖与 Softmax 分母注意力稀释（Lost in the Middle）；掌握滑动状态机分页与 Prefix Caching（公共前缀缓存命中提升 80%），大幅降低 TTFT 首字延迟与 Token 开销。 |
| **4. 生产级流式传输与网关治理 (SSE & BPE乱码)** | “负责大模型应用服务与网关研发，支持流式交互（SSE），保障千万级高并发下的低延迟与高可用” | Netty/WebFlux 流式管道设计、Byte-level BPE 多字节乱码机制（中文 3 字节跨 Token 截断防御与 CharsetDecoder 状态恢复）、全链路 Trace 观测与分布式限流熔断。 |
| **5. 企业级 RAG 检索增强与防幻觉体系** | “负责企业知识库建设，结合向量数据库与检索引擎，优化召回精度与排序，解决大模型生成幻觉” | 拒绝简单单向量检索；考核 Hybrid Search（Dense Vector + BM25 稀疏检索）、Cross-Encoder Rerank 二次精排、文档层级分块（Chunking）与 Grounding 事实校验评测体系。 |
| **6. 大模型底层物理账本与成本延迟核算** | “深入理解 LLM 生成原理，具备模型推理加速、吞吐优化与 Token 成本控制经验” | Prefill（并行/计算受限）vs Decode（串行/访存受限）本质差异；严控输出 Token 收益远超压缩输入 Prompt；KV Cache 显存占用与商业成本核算。 |
| **7. 计算卸载与代码解释器安全沙箱** | “负责代码执行沙箱建设，支持多语言脚本动态运行，保障执行安全与环境隔离” | 区分大模型概率型语义推理与图灵确定性计算；将算术与统计运算降级为编写 Python 脚本，由 Java 调度 Docker 断网隔离沙箱执行，解耦推理与执行防线。 |

---

## 4. 资深 Java 候选人基本盘护城河 (Solid Baseline)
- Java 底层机制与高并发治理（JMM、线程池、CompletableFuture、JVM GC）
- 企业级微服务与分布式系统（Spring Boot/Cloud、RPC、分布式锁/事务、高可用）
- 海量数据高并发存储与缓存（MySQL 调优、Redis 缓存架构、Kafka 消息吞吐）
- 容器化与运维基础设施（Docker、Linux 性能排查、CI/CD）
- 大型系统架构设计（DDD 领域驱动设计、技术权衡）
- **核心定位**：这不是 gap，是大厂 P7 研发用以兜底大模型不确定性的绝对立足底牌。
