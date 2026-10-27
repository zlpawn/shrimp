---
name: leo-coding-standards
description: Use when writing, modifying, refactoring, testing, or reviewing Java code, including requests involving Java code quality, coding standards, API usage, design principles, or maintainability.
---

# Leo Java 编码规范

## 核心目标

在 Java 编写、修改、重构、测试和代码审查中应用一致的 API 偏好与工程原则。优先保证正确性、安全性、兼容性和可读性，不把工具方法或设计模式当作机械替换目标。

本 skill 仅适用于 Java。不要将其中的 API 规则套用到 Kotlin、JavaScript 或其他语言。

## 执行流程

### 1. 读取项目上下文

在修改代码前：

1. 读取项目级指令和邻近 Java 代码。
2. 从 Maven、Gradle、toolchain、编译器配置或等效位置识别 Java 版本。
3. 确认项目是否已经依赖 Guava、Commons Lang 和 Commons Collections。
4. 观察与正确性及高优先级规则不冲突的局部风格。
5. 无法确认 Java 版本时，沿用项目已有兼容写法，不主动升级版本。

### 2. 按任务加载规范

- 编写、修改、重构或补充 Java 测试：必须读取 [Java API 规则](references/java-api-rules.md) 和 [工程原则](references/engineering-principles.md)。
- 涉及库表设计（DDL）、MyBatis/JPA 实体与持久层持久化：必须严格遵循 [工程原则](references/engineering-principles.md) 中的库表与持久层设计规范。
- 涉及 Apollo 等配置注入与读取：必须严格遵循 [工程原则](references/engineering-principles.md) 中的 Apollo 配置注入规范（必须有默认兜底值、复杂 JSON 优先 `@ApolloJsonValue`）。
- 审查 Java 代码或执行规范整改：除上述文件外，必须读取 [审查清单](references/review-checklist.md)。
- 只讨论 Java 设计：优先读取 [工程原则](references/engineering-principles.md)；涉及 API 选择时再读取 [Java API 规则](references/java-api-rules.md)。

### 3. 应用规则等级

- `MUST`：正确性、安全性、兼容性、依赖、资源管理、库表约束（字段非空+默认值、禁止唯一索引）、配置注入（必须提供默认兜底值、复杂 JSON 优先 `@ApolloJsonValue`）或契约要求。违反即为缺陷。
- `SHOULD`：默认 API、结构和可读性偏好。有更清晰、更安全或更符合项目约定的方案时允许例外。
- `CONSIDER`：需要证明实际收益后才采用的模式或优化。

不要仅因未采用 `CONSIDER` 而报告问题。只有当偏离 `SHOULD` 造成具体的语义、一致性、可读性、可测试性或维护成本时，才将其作为审查发现。

### 4. 解决规则冲突

按以下优先级决策：

1. 用户明确要求和项目级指令。
2. 正确性、安全性、Java 版本兼容性和依赖约束。
3. 本 skill 的 `MUST`。
4. 项目一致的局部风格。
5. 本 skill 的 `SHOULD`。
6. 本 skill 的 `CONSIDER`。

项目约定可以覆盖 `SHOULD`，但不能无声覆盖正确性或 `MUST`。

### 5. 控制修改范围

只规范新增代码和任务实际触及的代码。可以修复紧邻且低风险的问题；其他存量问题只报告，不进行全文件或全项目清理。在既有/历史类中追加新方法或新代码时，默认放置在类定义的最下方，避免在历史逻辑中间穿插修改打乱既有结构和版本追溯。

### 6. 控制输出

- 编码时静默应用规范，只解释重要例外和设计取舍。
- 审查时按 [审查清单](references/review-checklist.md) 显式报告具体问题。
- 不在每次编码任务后输出逐项规范清单。
- 本 skill 不主动启动编译、测试、格式化或静态分析；用户明确要求或其他开发、验证 skill 可以执行这些工作。

### 7. 提交规范（Commit Message）

执行代码提交时：

1. 必须先查阅项目近期的 Git 提交记录（如 `git log -n 5`），提取并遵循当前项目既有的 Commit Message 格式规范（如类型前缀、作用域 scope、中英文习惯、Issue 关联等）。
2. 若历史提交风格不统一、无法明确推断规范，或对本次提交的信息格式与范围有任何不清楚之处，必须主动向用户提问确认，不得自行臆测。
