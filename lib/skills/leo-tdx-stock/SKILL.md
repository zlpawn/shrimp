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
5. 程序化处理使用默认 JSON 输出；`--output text` 仅用于给人类展示。

## 市场映射

- SH / 沪市 → `setcode=1`
- SZ / 深市 → `setcode=0`
- BJ / 北交所 → `setcode=2`
- HK / 港股 → `setcode=31`

常见推断：6/68 沪市，00/30 深市，43/83/87 北交所。无法判断时先 lookup。

## 安全与边界

- 只能通过 `leo-tdx` 调用，不要直接发 HTTP 请求。
- 永远不要读取、输出或让用户把 TDX token 发到聊天里。
- 认证失败时提示用户运行 `leo-tdx token extract`。
- 港股不支持实时 quotes / K 线，改用 lookup、report、news。
- 单次返回不超过 100 条，除非用户明确要求更多。
- 优先使用具体子命令；`leo-tdx call` 仅用于 schema 明确后的低频兜底。
