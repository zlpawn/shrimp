# Leo TDX CLI

通过通达信 MCP 查询 A 股 / 港股行情、K 线、选股、指标、公告、研报、资讯和宏观数据。

## 配置

```bash
leo-tdx token extract
```

CLI 会从本机 WorkBuddy 凭据中提取 TDX token，并保存到 `~/.shrimp/skills/leo-tdx-stock/token`。支持 macOS / Linux 的 `~/.workbuddy/connectors`，也支持 Windows 的 `%APPDATA%/WorkBuddy/connectors` 和 `%LOCALAPPDATA%/WorkBuddy/connectors`，还可用 `WORKBUDDY_CONNECTORS_DIR` 显式指定。

临时注入使用 `TDX_TOKEN`。不会接受 token 命令行参数，避免进入 shell history 或进程列表。

## 用法

```bash
leo-tdx whoami
leo-tdx tools
leo-tdx tools --name-only
leo-tdx schema tdx_quotes
leo-tdx lookup 茅台
leo-tdx quotes 600519 --market SH
leo-tdx quotes 00100 --market HK
leo-tdx quotes TSLA --market US
leo-tdx kline 600519 --market SH --period day --count 30   # --period: 5s|1m|5m|15m|30m|1h|day|week|month|quarter|year; --adj: none|front|back
leo-tdx screener "市盈率低于20"
leo-tdx notice 600519 --name 贵州茅台 --from 20260101 --to 20260131
leo-tdx report 600519 --name 贵州茅台 --keywords 评级
leo-tdx news --name 机器人 --from 20260801 --to 20260828
leo-tdx macro "GDP|20240101|20241231||年度GDP"

# 期货 / 期权 / 扩展检索（--range: AG|HK-GP|HK-JJ|JJ|MG-GP|ZS|QH|QQ）
leo-tdx lookup 黄金 --range QH
leo-tdx futures 30 AU --limit 10                    # 省略 subCode 为全市场排行
leo-tdx futures 30 AU --contracts-only
leo-tdx futures-info "查询 AU 基差走势"              # query 须含品种/合约代码
leo-tdx lookup 50ETF --range QQ
leo-tdx option 1 510050 --month 2612 --near 3.1     # 省略 --month 返回可选月份

# 深度资料 / 技术指标 / AI 资讯摘要
leo-tdx deep "查询 600519 资产负债表" --type A      # --type: A|HK|US|FUND|INDEX
leo-tdx tech-lookup 随机指标 布林线
leo-tdx tech 000001 --market SZ --indicators MACD,KDJ --count 10  # 或 --indicators-json 原样传参数
leo-tdx listen 600519 --market SH --date 2026-11-20 # 默认今天，缓存约 3 天

# F10 结构化接口（更多入口见 references/data-mapping.md）
leo-tdx api TdxShareCW.ph_agf10_gzfx --code 600519 --extra-one 3Y --extra-two PE
leo-tdx api TdxSharePCCW.tdxf10_gg_jyds --fixed-tag zjlx --code 600519
leo-tdx api TdxSharePCCW.tdxsj_lhbd_lhbzl --branch 0 --code 000001

# SkillHub 下游技能管理（安装至 ~/.agents/skills/ 并链接至 ~/.gemini/config/skills/）
leo-tdx skills list
leo-tdx skills status --remote
leo-tdx skills install --research
leo-tdx skills install tdx-aidata
leo-tdx skills install --all
leo-tdx skills update
leo-tdx skills remove <id>
```

手动保存 token（只接受标准输入）：`pbpaste | leo-tdx token set --stdin`。

市场映射：SH=1，SZ=0，BJ=2，HK=31，US=74（常见前缀：6/68 沪市，00/30 深市，43/83/87 北交所）。默认输出 JSON，程序化处理不要解析 text 输出；选项参数放位置参数之后。

## Python 量化环境（tdx-aidata）

统一使用 `uv` 与固定虚拟环境 `~/.shrimp/skills/leo-tdx-stock/.venv`：

```bash
uv venv ~/.shrimp/skills/leo-tdx-stock/.venv
uv pip install --python ~/.shrimp/skills/leo-tdx-stock/.venv tdxaidata
~/.shrimp/skills/leo-tdx-stock/.venv/bin/python your_script.py
```

`tdxaidata` 与 `leo-tdx` 共用 `~/.shrimp/skills/leo-tdx-stock/token`；执行 `leo-tdx token set` / `extract` 时会自动同步到 `.venv` 内的 `TdxAiData.ini`，升级 `tdxaidata` 后可运行 `leo-tdx token sync` 重新同步。
