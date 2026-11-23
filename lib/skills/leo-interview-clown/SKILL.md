---
name: leo-interview-clown
description: 将外部多模态文档（Craft、飞书/Lark、公众号/网页、PDF、Office、含图资料）与本地代码库（整仓或指定方法）深度内化为因果认知模型、知识库结构化沉淀，以及可用于面试讲解、技术分享和新人学习的深挖防御体系。触发词包括“内化/沉淀文档”、“看懂这个项目”、“梳理项目业务逻辑”、“分析项目难点亮点”、“准备面试讲项目”、“解释这个方法的业务逻辑”。所有模式统一执行两阶段审批（先出覆盖审计提案并确认输出目录与覆盖风险 → 用户批准后才落盘并审计清理）；输出目录持久化在 ~/.shrimp/skills/leo-interview-clown/config.json（未配置时先提醒设置，用户不设置则走保底目录 ~/.shrimp/skills/leo-interview-clown/output/）。普通翻译、浅层摘要或生成 `.leo_business` 团队工程库请勿触发。
---

# Leo Interview Clown（知识内化与项目吃透引擎）

把复杂技术资料或陌生代码仓库转化为**可推导的因果模型、长期知识库页面、新人技术分享脉络与抗追问的面试防御体系**。

## 模块化与可扩展架构

本技能将主路由（`SKILL.md`）、共用门禁与面试标准（`references/core/`）、以及可插拔输入源模块（`references/modes/`）彻底解耦。后续新增来源渠道（如视频、Issue、论文库等），只需在 `references/modes/` 新增模块并在路由表登记，无需膨胀主文件。

## Python 环境约定（`uv` + `.venv`）

运行或扩展本技能的 Python 脚本时，统一使用 `uv` 与固定虚拟环境 `~/.shrimp/skills/leo-interview-clown/.venv`（绝不污染系统全局 Python）：
- 初始化/补齐环境：`python3 <skill-dir>/scripts/workspace_cli.py venv ensure`（或 `uv venv ~/.shrimp/skills/leo-interview-clown/.venv`）
- 优先使用该 `.venv` 中的 Python（POSIX：`.venv/bin/python`；Windows：`.venv\Scripts\python.exe`），当前纯标准库阶段亦可直接用 `python3`。

## 不可妥协的铁律

1. **全模式两阶段门禁**：无论读文档还是读代码，Phase 1 **严禁写入目标知识库**；必须先出覆盖审计提案与**轻量目录/覆盖确认**，获用户明确批准后才进入 Phase 2 落盘。
2. **证据诚实与四层隔离**：严格区分 `直接证实`、`原文声明`、`用户确认`、`知识化综合`、`工程评估`、`交叉推断`、`发现冲突`、`待确认`。详见 [references/core/evidence-and-gates.md](references/core/evidence-and-gates.md)。
3. **视觉诚实**：图片、架构图、白板是核心证据；禁止只读周边正文就声称“看懂了图片”。
4. **先教懂再压缩话术**：按因果模型与 6 个入门问题建立认知，再生成 30s/2m/10m 讲述与追问树。详见 [references/core/teaching-and-interview.md](references/core/teaching-and-interview.md)。
5. **反包装与归属安全**：普通框架常规用法不算难点；严禁编造指标或未经确认的“我设计/我实现”。
6. **运行区完全隔离**：临时抓取、草稿与提案统一存放在 `~/.shrimp/skills/leo-interview-clown/runs/<run-id>/`，绝不写进被分析的代码仓库或目标知识库。

## Step 1：解析输出目录（Smart Persistence）

启动任务前先解析目录：

```bash
python3 <skill-dir>/scripts/workspace_cli.py config resolve [--target-root "<path>"]
```

三级决策（配置持久化在 `~/.shrimp/skills/leo-interview-clown/config.json`）：
1. **本次用户显式指定**：直接采用并写入 `config.json` 永久记住（仅本次临时指定可加 `--once`）。
2. **已有历史配置**：自动复用 `knowledgebase_root`，免去重复询问。
3. **从未配置过（`source == "fallback"` 且 `needs_config_reminder == true`）**：
   - 在 Phase 1 提案中**主动提醒用户**可提供永久知识库根目录（如 Obsidian Vault 路径）；
   - **若用户不选择配置或跳过**，自动落盘到保底目录 `~/.shrimp/skills/leo-interview-clown/output/`。

## Step 2：选择可插拔输入模式

按输入材料类型路由，**按需只加载对应模式规范**：

| 输入形态 | 模式 | 规范文件 |
|---|---|---|
| Craft、飞书/Lark、公众号/网页、PDF、Office、本地图文资料 | `doc` | [references/modes/doc-mode.md](references/modes/doc-mode.md) |
| 整个代码仓库、微服务、模块或 Monorepo | `repo` | [references/modes/repo-mode.md](references/modes/repo-mode.md) |
| 指定的方法、类、接口、MQ 消费者、定时任务或 SQL | `method` | [references/modes/method-mode.md](references/modes/method-mode.md) |
| 同时提供设计/架构文档 **与** 代码仓库/方法 | `hybrid` | [references/modes/hybrid-mode.md](references/modes/hybrid-mode.md) |

## Step 3：执行两阶段工作流

完整遵循 [references/core/proposal-and-publish.md](references/core/proposal-and-publish.md) 与 [references/core/output-templates.md](references/core/output-templates.md)：

### Phase 1：全量读取、分析与提案
1. 初始化隔离运行区：
   ```bash
   python3 <skill-dir>/scripts/workspace_cli.py run init \
     --mode <doc|repo|method|hybrid> --source "<source>" [--target-root "<path>"]
   ```
2. 若目标目录已存在，先探测其文件夹布局、Frontmatter 与链接风格，检索可合并更新的既有页面（避免重复建页）。
3. 执行所选模式采集/追踪，结合 `evidence-and-gates.md` 与 `teaching-and-interview.md` 完成建模。
4. 将提案写入 `<run-dir>/proposal/knowledge-proposal.md`，更新状态为 `proposal-ready`（或 `blocked`），向用户展示提案（重点标出**目标目录、新建文件与待更新/覆盖的现有文件**）并**暂停等待批准**。

### Phase 2：审批后发布、审计与清理
1. 按用户确认结果落定目录与修改范围（必要时执行 `config set` 或 `run set-status --status approved`）。
2. 保存源文档快照/原图（`doc`/`hybrid`）或仓库代码锚点（`repo`/`method`），温和合并或新建页面。
3. 执行反向完备性与仓储完整性审计，记录 `audit.yaml`。
4. 标记发布、登记审计通过并安全清理本次运行区：
   ```bash
   python3 <skill-dir>/scripts/workspace_cli.py run set-status --run-dir "<run-dir>" --status published
   python3 <skill-dir>/scripts/workspace_cli.py run record-audit --run-dir "<run-dir>" --result pass
   python3 <skill-dir>/scripts/workspace_cli.py run cleanup --run-dir "<run-dir>"
   ```
   发生中断、阻塞、审计失败或提案被拒时，**禁止清理**，保留现场供排查。
