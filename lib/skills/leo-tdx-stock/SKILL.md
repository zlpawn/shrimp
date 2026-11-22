---
name: leo-tdx-stock
description: 通过 leo-tdx CLI 查询通达信股票、K 线、选股、指标、公告、研报、资讯与宏观数据。
---

# Leo TDX Stock

触发时机：用户询问股票行情、走势、K 线、选股、估值、公司公告、研报、财经新闻或宏观数据。

## 工作流

1. 不知道代码时先执行 `leo-tdx lookup <名称>`。
2. 行情使用 `leo-tdx quotes <code> --market SH|SZ|BJ|HK`。
3. 历史走势使用 `leo-tdx kline <code> --market ... --period day|week|month|1m|5m --count N`。
4. 参数不确定时执行 `leo-tdx schema <tool>`，不要猜测服务端 schema。
5. 枚举工具时优先使用 `leo-tdx tools --name-only`，避免完整 schema 消耗上下文。
6. 公告、研报、资讯使用结构化参数：`--name`、`--from`、`--to`、`--keywords`；宏观必须使用管道式 `主体|开始日期|结束日期|关键词|描述`。
7. 程序化处理使用默认 JSON 输出；`--output text` 仅用于给人类展示。
8. 选项参数（`--xxx`）放在位置参数之后。

## 扩展场景

| 场景 | 命令 |
|---|---|
| 期货/期权查代码 | `leo-tdx lookup 黄金 --range QH`；期权标的 `--range QQ`；其他：`ZS` 指数、`JJ` 基金、`HK-GP` 港股、`MG-GP` 美股 |
| 期货多合约行情 | `leo-tdx futures <setDomain> <subCode> [--limit N] [--contracts-only]`，如 `futures 30 AU`；省略 subCode 为整个市场排行 |
| 期货深度资料（规则、持仓排行、仓单、基差、CTD 等） | `leo-tdx futures-info "查询 AU 基差走势"`，query 必须含品种/合约代码，不要只写中文名 |
| 期权 T 型报价 | `leo-tdx option <underlyMarket> <underlyCode> [--month 2612] [--near 现价]`；不带 `--month` 只返回可选月份 |
| 证券/基金/指数深度资料（财报、股东、分红、成分股等） | `leo-tdx deep "查询 600519 资产负债表" --type A`（可选 A / HK / US / FUND / INDEX），type 取 lookup 返回的 entity_type |
| 技术指标时间序列（MACD、KDJ、BOLL 等，仅日线） | 先 `leo-tdx tech-lookup 随机指标`，再 `leo-tdx tech <code> --market SZ --indicators KDJ --count 10`；需带参数时用 `--indicators-json` 原样传 lookup 的 id/set/parameters |
| 近期资讯 AI 摘要与多空分析 | `leo-tdx listen <code> --market SH [--date YYYY-MM-DD]`；默认今天，缓存约 3 天；返回空时如实告知，不要编造 |

## 市场映射

- SH / 沪市 → `setcode=1`
- SZ / 深市 → `setcode=0`
- BJ / 北交所 → `setcode=2`
- HK / 港股 → `setcode=31`

常见推断：6/68 沪市，00/30 深市，43/83/87 北交所。无法判断时先 lookup。

## 安全与边界

- 只能通过 `leo-tdx` 调用，不要直接发 HTTP 请求。
- 永远不要读取、输出或让用户把 TDX token 发到聊天里。
- 认证失败时提示用户运行 `leo-tdx token extract`（WorkBuddy），或自行在终端运行 `pbpaste | leo-tdx token set --stdin`。
- 港股不支持实时 quotes / K 线，改用 lookup、report、news、listen。
- 单次返回不超过 100 条，除非用户明确要求更多。
- 优先使用具体子命令；`leo-tdx call` 仅用于 schema 明确后的低频兜底（如 `tdx_add_favorite` 等客户端联动工具）。

> **提示（脱离网关自包含运行）**：
> 若未注册全局 `leo-tdx` 命令，可在技能目录直接通过 Node.js 执行：
> `node ./scripts/cli/index.mjs <command>`

