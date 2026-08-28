# Leo TDX CLI

通过通达信 MCP 查询 A 股 / 港股行情、K 线、选股、指标、公告、研报、资讯和宏观数据。

## 配置

```bash
leo-tdx token extract
```

CLI 会从本机 WorkBuddy 凭据中提取 TDX token，并保存到 `~/.shrimp/secrets/tdx/token`。支持 macOS / Linux 的 `~/.workbuddy/connectors`，也支持 Windows 的 `%APPDATA%/WorkBuddy/connectors` 和 `%LOCALAPPDATA%/WorkBuddy/connectors`，还可用 `WORKBUDDY_CONNECTORS_DIR` 显式指定。

临时注入使用 `TDX_TOKEN`。不会接受 token 命令行参数，避免进入 shell history 或进程列表。

## 用法

```bash
leo-tdx whoami
leo-tdx tools
leo-tdx tools --name-only
leo-tdx schema tdx_quotes
leo-tdx lookup 茅台
leo-tdx quotes 600519 --market SH
leo-tdx kline 600519 --market SH --period day --count 30
leo-tdx screener "市盈率低于20"
leo-tdx notice 600519 --name 贵州茅台 --from 20260101 --to 20260131
leo-tdx report 600519 --name 贵州茅台 --keywords 评级
leo-tdx news --name 机器人 --from 20260801 --to 20260828
leo-tdx macro "GDP|20240101|20241231||年度GDP"
```

市场映射：SH=1，SZ=0，BJ=2，HK=31。默认输出 JSON，程序化处理不要解析 text 输出。
