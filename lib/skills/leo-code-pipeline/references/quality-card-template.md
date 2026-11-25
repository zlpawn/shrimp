# Quality Card Templates (交付体检卡模板)

The pipeline dynamically renders the final Quality Report Card based on which stages were actually executed. Skipped stages are clearly marked or omitted so the user is never confused.

---

## Template A: Full Pipeline Mode (全流程交付卡)

```markdown
### 🛡️ Leo 研发质量交付卡 (全流程闭环)

| 阶段 | 负责中枢 / Skill | 状态 | 核心产出 / 判定结论 |
| :--- | :--- | :--- | :--- |
| **1. 编码前规范** | `leo-coding-standards` | ✅ 通过 | 已注入 Java/架构规范（库表非空约束、Apollo 兜底值） |
| **2. 编码执行** | Host Coding Agent | ✅ 完成 | 严格遵循规范落地，完成 X 处核心逻辑修改 |
| **3. 编码后质检** | `leo-code-review` | ✅ 通过 | 零高危逻辑 Bug，已通过独立反方证伪，无 TODO 桩代码 |
| **4. 测试门禁** | `leo-code-qa` | ✅ 通过 | E2E 浏览器联调、写操作强验落库、三端交叉测试无异常 |

👉 **总体结论**：代码质量健康，架构合规，具备安全 Commit / Push 条件！
```

---

## Template B: Review-Only Mode (仅审查模式交付卡)

```markdown
### 🔍 Leo 研发质量交付卡 (Review-Only 快速质检)

- [—] **阶段 1：编码前规范** ➔ ⏩ 已跳过（当前为事后独立审查）
- [x] **阶段 2：编码后反方审查 (`leo-code-review`)** ➔ ✅ 零高危运行时缺陷，通过独立反方证伪，无虚假桩代码
- [—] **阶段 3：自动化测试** ➔ ⏩ 未启用

👉 **总体结论**：已对本地改动进行高信噪比质检，未发现阻塞性缺陷，可安全提交！
```

---

## Template C: Guide-Only Mode (仅规范咨询卡)

```markdown
### 📋 Leo 架构与编码规范指南 (Guide-Only)

- [x] **目标技术栈**：Java / Spring Boot / MyBatis
- [x] **核心架构红线 (MUST)**：
  1. 库表字段必须显式声明非空约束并提供合理默认值；
  2. 严禁线上库表添加物理唯一索引，防并发锁死；
  3. Apollo 配置注入必须带有缺省兜底值，复杂对象优先使用 `@ApolloJsonValue`；
- [x] **推荐 API 偏好 (SHOULD)**：
  - 优先复用 Guava / Commons 工具类，杜绝手写重复轮子。

👉 **下一步建议**：请参考上述约束动笔编写代码；写完后可随时唤醒 `leo-code-pipeline --review` 进行事后反方质检！
```

---

## 💾 报告归档与落盘规范 (On-Demand Persistence)

1. **默认规则**：所有报告默认直接在终端/对话窗口以 Markdown 渲染，**禁止在当前 Git 工作区生成任何临时文件**。
2. **显式要求落盘时**：
   - 必须存储至全局隔离目录：`~/.shrimp/skills/leo-code-pipeline/reports/`
   - 命名规范：**日期 + 中文描述**
     - 全流程模式：`YYYY-MM-DD_代码质量交付报告.md`（或 `YYYY-MM-DD_<功能名>_代码质量交付报告.md`）
     - 仅审查模式：`YYYY-MM-DD_代码审查报告.md`
     - 仅规范模式：`YYYY-MM-DD_架构规范指南.md`
   - 保存命令支持：`node scripts/archive_report.mjs --title "<功能名>" --type "<类型>" --content "<Markdown内容>"`

