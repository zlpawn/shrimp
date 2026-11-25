# 多项目扩展与路径解耦协议 (Project Extension Protocol)

> **核心原则**：`SKILL.md` 只维护通用的教学/转译/沉淀逻辑，**严禁在 `SKILL.md` 中硬编码任何具体业务项目名称或本机绝对路径**。所有项目登记与物理路径统一放在 `~/.shrimp/skills/leo-ai-transcoder/config.json`，项目自身的进度与知识卡片存放在 Obsidian（或项目自定义档案）中。

---

## 一、 `config.json` 数据结构（v1.2.0+）

```json
{
  "version": "1.2.0",
  "anchors": {
    "agentscope_java_repo": "/path/to/agentscope-java-2.0.3",
    "ai_theory_course_repo": "/path/to/ai-engineering-from-scratch",
    "java_sdk_root": "~/.sdkman/candidates/java/current",
    "obsidian_vault_root": "/path/to/obsidian-vault",
    "learning_plan_subpath": "AI-Agent-Wiki/LEARNING.md",
    "shrimp_skill_state": "~/.shrimp/skills/leo-ai-transcoder"
  },
  "active_project": "project-key",
  "projects": {
    "<project-key>": {
      "name": "项目展示名称",
      "workspace_root": "/path/to/project-workspace",
      "repos": {
        "main": "./sub-repo",
        "optional_external": "/optional/path/to/external-repo"
      },
      "vault_subpath": "项目知识库子目录",
      "learning_plan_subpath": "项目知识库子目录/LEARNING.md",
      "entry_doc_subpath": "项目知识库子目录/README.md"
    }
  }
}
```

### 字段约定
1. **`anchors`（全局共享底座）**：所有项目共用的工具链、框架源码、AI 理论课程与 Obsidian 根目录。
   * `learning_plan_subpath`：全局 AI 理论冲刺总计划相对于 `obsidian_vault_root` 的路径（如 `AI-Agent-Wiki/LEARNING.md`）。
2. **`projects.<key>`（可插拔项目注册表）**：每增加一个新项目，仅在此处追加一个键，不动 `SKILL.md`。
   * `workspace_root`：该项目在当前机器上的工作区根目录；
   * `repos`：项目关联的代码仓，以 `./` 或相对路径表示时相对于 `workspace_root` 解析；绝对路径通常用于可选的外部关联仓；
   * `vault_subpath` / `learning_plan_subpath` / `entry_doc_subpath`：均**相对于 `anchors.obsidian_vault_root` 解析**，确保换机时只改 `obsidian_vault_root` 即可。

---

## 二、 多 Agent 项目识别与路径解析流程

任何 Agent 进入工作或被 `leo-ai-transcoder` 唤醒时，按以下顺序定位上下文：

1. **确定当前项目**：
   * 若当前工作目录（`cwd`）落在某个 `projects.<key>.workspace_root` 之下（或其子目录），优先自动匹配该 `<key>`；
   * 否则若用户在对话中显式点名某项目，匹配对应 `<key>`；
   * 否则回退到 `active_project`（仅学习通用理论时不强制绑定项目）。
2. **解析知识与进度路径**：
   * **通用理论学习进度**：`${anchors.obsidian_vault_root}/${anchors.learning_plan_subpath}`；
   * **项目专属学习进度**：`${anchors.obsidian_vault_root}/${projects.<key>.learning_plan_subpath}`；
   * **项目架构与面试题库**：`${anchors.obsidian_vault_root}/${projects.<key>.entry_doc_subpath}`（及 `vault_subpath` 下各文档）。
3. **缺失路径、未登记项目与可选仓库容错**：
   * **核心路径缺失或项目未登记**（如换到新电脑后 `obsidian_vault_root` / `workspace_root` 为空或磁盘不存在，或用户在具体项目中学习/温习但 `projects` 中尚无该项目条目）：立即暂停并**主动提醒用户**确认或提供当前机器上的实际目录（可附上自动探测到的候选），用户确认后写回 `config.json` 并更新 `updated_at`；
   * **可选外部仓缺失**（如跨设备只拷贝了主工程目录、未拷贝外部关联仓）：若 `repos` 中某外部路径在磁盘不存在或为 `null`，**静默跳过该外部仓的同步/读取**，基于当前可见代码与 Obsidian 卡片正常推进，严禁阻塞或报错卡死。

---

## 三、 新增项目接入清单（零代码改动 `SKILL.md`）

1. 在 Obsidian（`${anchors.obsidian_vault_root}/<项目目录>/`）下创建该项目的架构/题库入口 `README.md` 与独立进度页 `LEARNING.md`（若共享求职时间窗口，通过 Obsidian 双链对齐主计划，如 `[[AI-Agent-Wiki/LEARNING]]`）；
2. 在 `~/.shrimp/skills/leo-ai-transcoder/config.json` 的 `projects` 下登记 `<project-key>`；
3. 若项目仓库自身需要让任意进入该目录的 Agent（如 Claude Code、Codex、Cursor）也能感知到上述配置，仅在项目根目录放一个不含绝对路径的轻量 `AGENTS.md`（指引 Agent 读取 `~/.shrimp/skills/leo-ai-transcoder/config.json`），不要在项目仓库内硬编码本机路径或跨目录绝对软链接。
