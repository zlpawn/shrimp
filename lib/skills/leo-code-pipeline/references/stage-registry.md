# Pipeline Stage Registry (可插拔阶段插槽定义)

This registry defines the modular slots supported by `leo-code-pipeline`. Each slot represents an isolated stage of the engineering lifecycle and can be toggled, skipped, or substituted.

---

## 1. Supported Stage Slots

| Slot ID | Role | Timing | Default Provider | Skipping Condition |
| :--- | :--- | :--- | :--- | :--- |
| **`pre-code`** | 编码前架构与规范注入 | 动笔编码前 | `leo-coding-standards` | 当用户仅请求事后审查（`review-only`）时跳过动笔前指导；但若审查涉及 Java，其审查清单会自动转入 `post-review` 阶段并网执行 |
| **`impl`** | 编码落地执行 | 编写/修改代码中 | Host Coding Agent | 当用户仅咨询规范（`guide-only`）、或代码已写完仅做质检时跳过 |
| **`post-review`** | 编码后缺陷、需求与架构合规反方证伪 | 产生 `git diff` 之后 | `leo-code-review`（联动 `leo-coding-standards`） | 当用户仅咨询事前架构规范（`guide-only`）时跳过 |
| **`test`** | 自动化测试与黑盒质检 | 交付前 | `leo-code-qa` | 默认可选；当未配置环境或用户指定跳过质检时略过 |
| **`delivery`** | 交付体检卡生成 | 流水线终局 | Built-in | 始终执行（仅汇总已跑阶段） |

---

## 2. Dynamic Execution Modes (动态执行模式)

The pipeline dynamically determines which slots are active based on explicit user intent or workspace state:

### Mode 1: Full-Pipeline (`full`)
- **Use Case**: From scratch to production. User asks to implement a complete feature or rewrite a module.
- **Active Slots**: `[pre-code]` $\rightarrow$ `[impl]` $\rightarrow$ `[post-review]` $\rightarrow$ `[test]` $\rightarrow$ `[delivery]`.

### Mode 2: Review-Only (`review-only` / Fast-Check)
- **Use Case**: Code is already written by human or other AI. User says: "帮我 review 一下", "准备提交了查查 Bug", "看看改动有没有问题".
- **Active Slots**: `[post-review]` $\rightarrow$ `[delivery]`.
- **Optimization**: Skips `[pre-code]` guidance. Ensures `leo-code-review` is installed. When changes involve Java files, also attaches `leo-coding-standards` review checklist into `post-review` to enforce MUST architectural standards.

### Mode 3: Guide-Only (`guide-only` / Architecture Consulting)
- **Use Case**: User is planning a new database schema, API signature, or technical stack and needs architectural red lines before writing.
- **Active Slots**: `[pre-code]`.
- **Optimization**: Skips `[impl]` and `[post-review]`. Only ensures `leo-coding-standards` is installed.

### Mode 4: Selective (`custom`)
- **Use Case**: User explicitly asks for specific steps, e.g., "只跑规范和单测", "只跑 review 和 test".
- **Active Slots**: User-designated subsets.

---

## 3. How to Plug in New Stages in the Future (扩展新插槽)

To register a new capability (e.g. `security-scan` or `frontend-e2e`):
1. Add the stage identifier and default provider skill to this registry.
2. In `scripts/ensure_dependencies.mjs`, register the skill name in the optional dependency resolver.
3. In `SKILL.md`, invoke the slot conditionally when active.
4. The core pipeline state machine remains untouched.
