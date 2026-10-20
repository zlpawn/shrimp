# 阿里 AgentScope 2.0 Java 官方源码对齐与编排范式

> **物理源码锚点**：读取 `~/.shrimp/skills/leo-ai-transcoder/config.json` 的 `anchors.agentscope_java_repo`（路径缺失或无效时，按 `SKILL.md` §零.4 询问用户并写回 config）。
> **核心法则**：当业务从“单点 API 调用”演进为“多智能体（Multi-Agent）协同决策与对话”时，纯手写 `while` 循环会迅速导致代码膨胀与状态混乱。此时，阿里巴巴开源的 **AgentScope Java 2.0** 提供的消息驱动（Message-Driven）体系，是 Java 工程师最容易无缝吸收的企业级范式。

---

## 零、 写 AgentScope 代码前的铁律：先查源码，不凭记忆

本文件**刻意不放可复制的 API 示例代码**——框架会随版本变化，写死的示例会过时，且曾因此出现过错误（例如把 `call(Msg)` 记成 `reply(Msg)`、把 `textContent(...)` 记成 `text(...)`、杜撰 `Pipeline` / `MsgHub`）。

任何需要写出或讲解 AgentScope API 的场景，必须：

1. 先从 config 取 `agentscope_java_repo`，到 `agentscope-core/src/main/java/io/agentscope/core/` 下确认**真实的类名、方法签名、返回类型**；
2. 需要完整用法时，优先看该仓库的 `agentscope-examples/` 与各类的 Javadoc（如 `middleware/MiddlewareBase.java` 里自带示例）；
3. 讲解时标明所依据的版本（读源码仓库的版本号），不要说“2.0 一直如此”。

---

## 一、 核心组件与经典 Java 设计模式映射（已按 2.0.3 源码核对）

| AgentScope Java 核心类 | 源码包（相对 `agentscope-core`） | Java 经典设计模式对照 | 要点（以源码为准） |
| :--- | :--- | :--- | :--- |
| **`Msg`** | `core/message/Msg` | **值对象 (Value Object)** | 智能体之间流转的数据契约。字段 `id / name / role(MsgRole) / content(List<ContentBlock>) / metadata / timestamp / usage` 均为 `final`，带 Jackson 多态注解（USER / ASSISTANT / SYSTEM / TOOL 子类）。构造用 `Msg.builder()`，纯文本用 `.textContent(...)`。是否线程安全取决于 `content` / `metadata` 容器是否被外部修改，不要笼统断言“天然线程安全”。 |
| **`Agent`** | `core/agent/Agent` | **接口组合** | 由 `CallableAgent`（`Mono<Msg> call(Msg)`，响应式）+ `StreamableAgent` + `ObservableAgent` 组合而成。**核心接口不含 Memory**，记忆由需要它的具体 Agent 自己持有。 |
| **`AgentBase` / `ReActAgent`** | `core/agent/AgentBase`、`core/ReActAgent` | **模板方法 + 建造者** | `ReActAgent extends AgentBase`，内部持有 `Memory`、`Toolkit`、`SkillBox`，用 Builder 装配（含 `.middlewares(...)`）。 |
| **`MiddlewareBase`** | `core/middleware/MiddlewareBase` | **洋葱模型 / 责任链（AOP 拦截）** | 5 个拦截点：`onAgent`（整次调用）、`onReasoning`（推理阶段）、`onActing`（单次工具执行）、`onModelCall`（原始模型调用）为洋葱式环绕；`onSystemPrompt` 为顺序变换。每个钩子默认直接放行，只需重写关心的。**多 Agent 之前的“前后置逻辑、日志、限流、观测”首选放这里。** |
| **`AgentSkill` / `SkillRegistry` / `SkillBox`** | `core/skill/*` | **插件化机制 / 门面模式** | 可插拔技能包与注册表；仓库实现有 `FileSystemSkillRepository`、`ClasspathSkillRepository`（扩展模块另有 Git / MySQL / PostgreSQL 仓库）。 |
| **`OtelTracingMiddleware`** | `core/tracing/OtelTracingMiddleware` | **AOP 中间件** | 基于 `MiddlewareBase` 的 OpenTelemetry 链路观测，配合 `Tracer / TracerRegistry`。 |

> ⚠️ **2.0.3 中不存在** `Pipeline`、`MsgHub`、`reply(Msg)`（早期/他框架的印象）。需要“按顺序串联多个 Agent”时，就是**自己编排 `call(...)` 返回的 `Mono<Msg>`**（`flatMap` 串联），不要告诉用户有现成的 Pipeline 类。

---

## 二、 业务落地：从纯原生 Java 到 AgentScope 的平滑演进思路

1. **纯原生 Java 阶段（单 Agent / ReAct 循环）**：一个接口 + 一个 `while` 循环 + 工具表（POJO + `Map<String, Tool>`），零第三方依赖。适用单点文本生成、离线语义质检、极简工具调用。
2. **引入 AgentScope 的触发条件**：出现多角色协作（如“ASR 质检员”审风险 → “销售教练”出带教建议）、需要统一的消息契约（`Msg`）、需要在推理/工具调用前后统一加观测与治理（`MiddlewareBase`）、或需要插件化技能（`AgentSkill`）。
3. **多 Agent 串联的心智模型**：上游 Agent 的输出 `Msg` 作为下游 Agent 的输入；这在 Java 里就是一条由 `Mono<Msg>` 组成的异步管道，而不是某个框架自带的 Pipeline 类。具体写法一律以第零节的“先查源码”为准。

---

## 三、 面试应答建议

在被问及 **“你们如何选型和落地多智能体框架？”** 时：
> “我们架构选型遵循**『渐进式演进』**：
> 1. 在单 Agent 任务和简单工具调用链路中，我们坚持**纯原生 Java** 实现（POJO + 接口 + CompletableFuture），保证对 Prompt / 状态机的绝对掌控，避免引入重量级依赖；
> 2. 当进入复杂角色协作（如多专家并行质检与多轮演练对抗）时，我们对齐**阿里巴巴开源的 AgentScope Java**：以不可变风格的 `Msg` 作为统一消息契约，用 `MiddlewareBase` 的洋葱式拦截点统一接入链路观测（`OtelTracingMiddleware`）和治理，用 `AgentSkill` 做技能插拔。它是类型安全、响应式（`Mono<Msg>`）的，与 Java 的面向对象契约和责任链思路契合。”
>
> 追问“和自研相比差在哪”时，诚实回答：自研胜在对状态机和上下文预算的完全可控；框架胜在消息契约、中间件、观测与技能生态现成——**这个取舍本身就是好的面试故事**。
