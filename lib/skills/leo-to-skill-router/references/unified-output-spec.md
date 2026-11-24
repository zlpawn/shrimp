# 统一 Skill 输出规范 (Unified Output Spec)

无论上游是来自书籍、内部文档还是视频课程，`leo-to-skill-router` 产出的目标技能统一遵循以下标准文件架构：

---

## 1. 目录结构

```text
<output_skills_dir>/<skill_name>/
├── SKILL.md             # 主入口：核心思维模型 + 场景/章节路由索引 (<4,000 tokens)
├── cheatsheet.md        # 决策层：决策树、权衡矩阵（Trade-offs）、经验嗅觉（Tells & Smells）
├── patterns.md          # 执行套路：标准化 SOP、算法流程、实操模板
├── glossary.md          # 术语字典：全书/全课专有名词定义与反向引用
└── on-demand/           # 按需懒加载细节（平时不进入上下文，提问涉及特定主题才读）
    ├── ch01-*.md        # 或 step01-*.md / scenario-*.md
    ├── ch02-*.md
    └── ...
```

---

## 2. 核心文件撰写原则

### `SKILL.md`（控制在 4,000 Tokens 以内）
* **定位**：Agent 常驻的核心心智入口。
* **内容**：
  1. YAML Frontmatter（包含规范的 `name` 与 `description`）；
  2. **Core Mental Models**：作者/讲师最核心的 3~5 个命名思维框架（严格保留专有名词）；
  3. **Topic / Scenario Index**：关键词到 `on-demand/` 子文件的路由指引表；
  4. **How to Use**：告知 Agent 如何按需读取支持文件。

### `cheatsheet.md`（决策支持层，非单纯术语表）
* **定位**：赋予 Agent 像作者/专家一样的裁决能力。
* **内容**：
  * **决策规则**：“When X, do Y, because Z”；
  * **权衡矩阵**（Competing options scored on dimensions）；
  * **经验法则与阈值**（如“函数超过 20 行即重构”、“错误预算低于 10% 报警”）；
  * **嗅觉与警示（Tells & Smells）**：识别异常特征的快速启发法。

### `patterns.md`（动作执行层）
* 包含具体的操作步骤模板、算法逻辑、设计模式套路。

### `on-demand/`（按需懒加载切片）
* 每一个章节/场景文件保持独立，包含：
  1. **Core Idea**：1~2 句话概括最重要思想；
  2. **Frameworks & Methods**：具体步骤与标准；
  3. **Worked Example**：真实示范案例或实操代码演算（保证可模仿性）；
  4. **Anti-patterns**：常见错误与反模式。
