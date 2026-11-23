# 两阶段提案审批、目录确认与发布清理规范

所有模式（`doc`、`repo`、`method`、`hybrid`）统一执行**「先提案审批 → 再入库发布」**两阶段门禁。

## Phase 1：全量读取、分析与提案（对目标目录零写入）

1. **解析输出目录**（执行 `scripts/workspace_cli.py config resolve`）：
   - 若用户本轮显式指定目录：直接采用并写入 `~/.shrimp/skills/leo-interview-clown/config.json` 持久化（加 `--once` 则仅本次生效）。
   - 若 `config.json` 已记录 `knowledgebase_root`：自动复用，不重复打扰用户。
   - 若**从未配置过**（`source == "fallback"` 且 `needs_config_reminder == true`）：
     - 在呈现提案时**主动提醒用户**：“当前尚未配置长期知识库目录，你可以回复你的知识库根目录（如 Obsidian Vault 路径，我将永久记住在 `~/.shrimp/skills/leo-interview-clown/config.json`），若不配置则本次将自动落盘到保底目录 `~/.shrimp/skills/leo-interview-clown/output/`。”
2. **创建隔离运行区**（严禁把临时草稿写进被分析的代码仓库或目标知识库）：
   ```bash
   python3 <skill-dir>/scripts/workspace_cli.py run init \
     --mode <doc|repo|method|hybrid> \
     --source "<source>"
   ```
3. **探测目标目录既有规范**（若目标目录已存在）：
   - 学习其文件夹层级、命名规范、Frontmatter 字段与链接风格（`[[双链]]` 还是标准 Markdown `[text](path)`）。
   - 检索是否已有相关主题页面，**优先增量合并/更新，避免重复建页**。
4. **按所选模式读取分析**（`references/modes/*.md`），结合 `evidence-and-gates.md` 与 `teaching-and-interview.md` 完成建模。
5. **生成提案**至 `<run-dir>/proposal/knowledge-proposal.md`，更新状态为 `proposal-ready`（或 `blocked`），向用户展示提案并**暂停等待明确批准**。

### 统一提案模板

```markdown
# 知识内化提案：<主题/项目名称>

- 模式：doc | repo | method | hybrid
- 状态：READY | BLOCKED
- 目标输出目录：<target_root>（来源：本次指定 | 历史配置记忆 | 保底目录 ~/.shrimp/skills/leo-interview-clown/output）
- 配置提醒：<若 needs_config_reminder=true，提示用户可指定永久知识库目录或确认走保底目录>

## 1. 输入范围与读取完整性
- 来源清单（URL / 文档标识 / 仓库路径 / 分支或 commit / 聚焦方法）
- 统计摘要（章节/表格/代码/图片/白板/附件数量，或模块/入口/数据锚点/测试覆盖情况）
- 未读取、受限或明确排除的范围及原因

## 2. 核心因果模型与结构大纲
- 一句话定位 + 六个大白话入门问题摘要
- 核心因果链路 / 代表性端到端业务流
- 真实深水区与亮点候选（标出已剔除的普通框架包装项）

## 3. 证据与交叉验证（按模式裁剪）
### [Doc / Hybrid] 核心图片逐张解读（每张 3-6 条）
#### 核心图片 N：<名称>
- <3-6 条专业解读>
- 来源块：<anchor> | 重要性：load-bearing | 读取状态：complete | 理解置信度：high/medium/low | 知识去向：<page roles>

### [Doc / Hybrid] 图文与表格交叉验证
- <一致、补充、冲突、缺失说明>

### [Code / Hybrid] 核心数据/状态锚点与关键代码证据摘要
### [Hybrid] 设计文档 vs 代码实现交叉比对（一致 / 文档超前未实现 / 代码偏离）

## 4. 工程判断与一手比对
- **原作者/原项目明确事实**：<原文声明 / 直接证实>
- **知识化综合**：<跨章节/跨模块归纳>
- **Agent 工程评估**：<合理性、缺失条件、风险、可改进点、面试高频坑点>
- **一手资料比对**（light/targeted 模式）：<高价值外部比对结论或未执行原因>

## 5. 覆盖矩阵与待确认项
### 内容 / 区域覆盖矩阵
| 来源章节或代码区域 | 重要性/角色 | 读取/追踪状态 | 处理方式（curated/source-only/excluded/blocked） | 知识去向 | 备注 |
|---|---|---|---|---|---|

### 媒体覆盖矩阵（Doc / Hybrid）
| 媒体项 | 重要性 | 读取状态 | 本地资产 | 知识去向 | 置信度 |
|---|---|---|---|---|---|

### 缺口、冲突与待用户确认项
- <阻塞项、指标收集清单、个人贡献归属待确认项>

## 6. 面试输出规划
- 拟生成的页面角色与面试武器库（30s/2m/10m 讲述、八要素难点卡、追问树、三轮自测）

## 7. 轻量目录与覆盖确认（待你批准）
### 即将新建的文件/页面
| 目标相对路径 | 页面角色 | 核心问题 | 关联本地媒体/图表 |
|---|---|---|---|

### 即将更新或覆盖的现有文件（重要）
| 现有文件相对路径 | 操作类型（增量合并 / 章节更新 / 覆盖替换） | 变更内容与原内容保留策略 |
|---|---|---|

### 明确不创建的内容及原因
- <避免重复、粒度过细或证据不足的部分>
```

---

## Phase 2：审批后归档、审计与安全清理

**仅在用户明确批准提案（且确认输出目录及文件更新/覆盖方式）后开始**：

1. **落定目录与审批状态**：若用户在审批时新指定了知识库目录或确认走保底目录，先同步 `config set` 或 `run set-status --status approved --target-root "<path>"`。
2. **保存源头证据与媒体**：
   - `doc` / `hybrid`：在目标知识库约定位置保存完整源文档快照、元信息与高清原图。
   - `repo` / `method`：不拷贝整个代码仓库，在文档证据表内严格记录 `仓库名 :: 相对路径:行号`（及 commit/分支）。
3. **创建或合并批准的页面**：按 `references/core/output-templates.md` 写入；合并现有页面时保留用户原有手写笔记，禁止盲目全文件覆盖。
4. **建立链接与索引**：按目标知识库风格补充有意义的互链/反向链接；仅当目标库原本维护索引/MOC/日志时才同步更新。
5. **执行反向完备性与仓储完整性审计**：核验 `evidence-and-gates.md` 第 7 节全部条目，并在 `<run-dir>/extraction/audit.yaml` 记录结构化结果：
   ```yaml
   result: pass | fail
   checked_at: <timestamp>
   load_bearing_sections_total: 0
   load_bearing_sections_covered: 0
   load_bearing_media_total: 0
   load_bearing_media_covered: 0
   broken_links: []
   temporary_references: []
   notes: []
   ```
6. **标记发布并清理本次受控运行区**：
   ```bash
   python3 <skill-dir>/scripts/workspace_cli.py run set-status \
     --run-dir "<run-dir>" --status published --artifact "<published-file>"
   python3 <skill-dir>/scripts/workspace_cli.py run record-audit \
     --run-dir "<run-dir>" --result pass
   python3 <skill-dir>/scripts/workspace_cli.py run cleanup --run-dir "<run-dir>"
   ```
   若发生中断、阻塞、审计失败或用户拒绝提案，**禁止执行 cleanup**，保留现场供排查。
