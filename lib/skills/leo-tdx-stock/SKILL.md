---
name: leo-tdx-stock
description: 通过 leo-tdx CLI 查询通达信行情、K 线、选股、指标、公告、研报、资讯、宏观与 F10 数据，并管理与供数通达信 SkillHub 下游投研及量化技能（财报速读、个股深度分析、公司质地打分、估值导航员、龙虎榜掘金、业绩预告博弈、AiData）。
---

# Leo TDX Stock

触发时机：用户询问股票/期货/期权行情、K 线、选股、技术指标、公告研报、新闻宏观、基本面投研报告或 `tdx-aidata` 量化脚本。

## 核心工作流

1. 不知道代码先 `leo-tdx lookup <名称>`（港股 `--market HK`、美股 `--market US`、期货 `--range QH`、期权 `--range QQ`）。
2. 核心子命令：`quotes`、`kline`、`screener`、`notice` / `report` / `news`、`macro`、`futures` / `futures-info`、`option`、`deep`、`tech-lookup` / `tech`、`listen`、`api`。完整用法与示例见 [references/README.md](references/README.md)。
3. 参数不确定时先 `leo-tdx tools --name-only` 与 `leo-tdx schema <tool>`，不要猜测服务端 schema。
4. 市场映射：`SH=1`、`SZ=0`、`BJ=2`、`HK=31`、`US=74`（6/68 沪，00/30 深，43/83/87 北；港股 5 位数字、美股字母代码均支持 `quotes` / `kline`）。
5. 选项参数（`--xxx`）放位置参数之后；程序化处理用默认 JSON，`--output text` 仅用于展示。

## 下游技能管理与路由

`leo-tdx skills` 管理 SkillHub 外部技能（安装至 `~/.agents/skills/<id>/` 并软链至 `~/.gemini/config/skills/<id>`，无需 TDX token）：`list`、`status --remote`、`install [--research|--all|<id>]`、`update`、`remove <id>`。

命中以下场景先 `leo-tdx skills status` 检查是否已安装；未安装时提示或确认后 `leo-tdx skills install <id>`；已安装则读取 `~/.agents/skills/<id>/SKILL.md` 并按 [references/data-mapping.md](references/data-mapping.md) 供数：

| 场景意图 | 下游技能 ID | 供数 / 运行方式 |
|---|---|---|
| 财报速读 / 三表异常 / 杜邦 | `tdx-financial-quick-read` | `leo-tdx` MCP（见 `data-mapping.md`） |
| 个股深度分析 / 一页纸研报 | `tdx-stock-analysis` | `leo-tdx` MCP（见 `data-mapping.md`） |
| 公司质地打分 / 好公司评估 | `tdx-gszddf` | `leo-tdx` MCP（见 `data-mapping.md`） |
| 估值方法 / 市场预期 / 重估 | `tdx-valuation-navigator` | `leo-tdx` MCP（见 `data-mapping.md`） |
| 龙虎榜席位 / 游资机构博弈 | `tdx-dragon-tiger-miner` | `leo-tdx` MCP（见 `data-mapping.md`） |
| 业绩预告 / 预期差博弈 | `tdx-yjygby` | `leo-tdx` MCP（见 `data-mapping.md`） |
| 本地量化 / Python 高频取数 | `tdx-aidata` | `uv` + `~/.shrimp/skills/leo-tdx-stock/.venv`（非 MCP） |

- **Python 量化环境约定**：涉及 `tdx-aidata` 安装依赖或运行脚本时，一律使用 `uv` 和 `~/.shrimp/skills/leo-tdx-stock/.venv`（安装：`uv pip install --python ~/.shrimp/skills/leo-tdx-stock/.venv <pkg>`；运行：`~/.shrimp/skills/leo-tdx-stock/.venv/bin/python ...`），不要污染系统全局 Python；`tdxaidata` 与 `leo-tdx` 共用 `~/.shrimp/skills/leo-tdx-stock/token`（保存或重装依赖后可用 `leo-tdx token sync` 同步至 `TdxAiData.ini`）。

## 安全与边界

- 只能通过 `leo-tdx` 调 MCP，不要直接发 HTTP 请求；永远不要读取、输出或让用户把 token 发到聊天里。
- 认证失败提示运行 `leo-tdx token extract` 或 `pbpaste | leo-tdx token set --stdin`。
- 单次返回不超过 100 条（明确要求除外）。
- `leo-tdx call` 仅用于 schema 明确后的低频兜底；脱离网关时可用 `node ./scripts/cli/index.mjs <command>`。
