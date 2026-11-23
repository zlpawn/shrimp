# Leo Interview Clown (`leo-interview-clown`)

将**外部技术文档/多模态资料**与**本地代码仓库/核心方法**统一内化为可推导的因果认知、长期知识库页面以及可直接用于面试讲解、技术分享与新人理解的实战武器库（30s/2m/10m 口述、八要素难点卡片、分层追问树、三轮自测与纠偏闭环）。

本技能由原 `leo-internalize-knowledge` 与 `leo-project-mastery` 融合升级而来，采用**精简主路由 + 核心门禁层 + 可插拔输入源模块**的可扩展架构。

## 目录结构

```text
lib/skills/leo-interview-clown/
├── SKILL.md                              # 精简主路由、uv 环境与两阶段总控（<90 行）
├── package.json
├── agents/openai.yaml
├── scripts/
│   └── workspace_cli.py                  # 目录持久化、uv .venv 管理与隔离运行区 CLI
├── references/
│   ├── core/                             # 所有模式共用的核心规则
│   │   ├── evidence-and-gates.md         # 8级证据标签、指标8条件、视觉门禁与反向审计
│   │   ├── teaching-and-interview.md     # 因果模型、6个为什么、八要素难点卡、话术与纠偏闭环
│   │   ├── proposal-and-publish.md       # 两阶段提案模板、轻量目录/覆盖确认与发布清理
│   │   └── output-templates.md           # 8种页面角色、跨库代码锚点与档案模板
│   └── modes/                            # 可插拔输入源模块（按需扩展新来源）
│       ├── doc-mode.md                   # 对接 leo-article-relay / leo-md-router / leo-craft-api / leo-lantern
│       ├── repo-mode.md                  # 整仓测绘、双向追踪与 7 类旁路检查
│       ├── method-mode.md                # 单方法/接口/Consumer/Job 上下文下钻
│       └── hybrid-mode.md                # 设计文档 vs 代码实现交叉比对
└── tests/
    └── test_workspace_cli.py
```

## 存储与环境规范（统一隔离在 `~/.shrimp/skills/leo-interview-clown/`）

- `config.json`：持久化记忆用户指定的知识库根目录（支持 `--once` 单次不覆盖）。未配置时先提醒用户配置；用户不配置则走保底目录 `output/`。
- `output/`：默认保底输出目录，彻底与业务代码仓库隔离。
- `runs/`：Phase 1 临时抓取、台账与提案目录，发布并通过审计后自动安全清理。
- `.venv/`：通过 `uv` 维护的专属 Python 虚拟环境（`workspace_cli.py venv ensure`）。

## 常用命令

```bash
# 查看配置、目录与 .venv 状态
python3 lib/skills/leo-interview-clown/scripts/workspace_cli.py config get

# 初始化或检查 ~/.shrimp/skills/leo-interview-clown/.venv
python3 lib/skills/leo-interview-clown/scripts/workspace_cli.py venv ensure

# 设置永久知识库目录
python3 lib/skills/leo-interview-clown/scripts/workspace_cli.py config set --target-root "~/Documents/Obsidian/Knowledge"

# 运行单元测试
python3 -m unittest discover -s lib/skills/leo-interview-clown/tests -v
```
