# BOSS Data Contract & Anti-Scraping Protection (数据契约与反爬防御规范)

## 1. 核心接口规范 (Endpoints)

- **安全搜索列表接口 (Recommended)**:
  `https://www.zhipin.com/wapi/zpgeek/search/joblist.json`
  - Query parameters: `scene=1`, `query=<string>`, `city=101010100`, `page=<int>`, `pageSize=30`
  - *注意*：切勿使用 `recommend/job/list.json`（极易触发 `code: 37` 滑块风控）。
- **岗位详情接口 (Detail)**:
  `https://www.zhipin.com/wapi/zpgeek/job/detail.json`
  - Query parameters: `securityId=<string>`, `lid=<string>`, `jobId=<string>`

---

## 2. 状态码与异常处理契约 (Status Codes)

- `code: 0` / `code: 200`: 请求成功并返回有效数据。
- `code: 37`: 触发安全拦截（滑块验证码或风控）。立即安全暂停任务，严禁盲目高频重试。
- `code: 1` / `code: 100` / `message: 未登录`: 鉴权凭证过期或缺失。提示通过 `auth import-clipboard` 重新导入 Cookie。
- `code: 9`: 触发限流，需增加请求间隔（默认 `min_interval_ms: 1200`）。

---

## 3. 客户端指纹与反爬防御最佳实践 (Client Fingerprint Matching)

1. **跨平台 OS 指纹动态适配**：
   - BOSS 直聘后端会校验 Cookie 与 HTTP 请求头中的操作系统平台属性。
   - 在 Windows 环境下（`process.platform === 'win32'`），必须发送：
     - `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...`
     - `Sec-Ch-Ua-Platform: "Windows"`
   - 在 macOS 环境下，必须发送：
     - `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...`
     - `Sec-Ch-Ua-Platform: "macOS"`
   - 严禁在 Windows 环境下硬编码 macOS User-Agent，否则会因平台不一致直接判定为爬虫异常。

2. **跨平台剪贴板凭证导入**：
   - Windows 环境：使用 PowerShell 的 `Get-Clipboard` 与 `Set-Clipboard`。
   - macOS 环境：使用 `pbpaste` 与 `pbcopy`。
   - 导入后立即清空剪贴板，防止 Cookie 明文驻留。

3. **搜索词族矩阵（避开 JVM Bytecode JavaAgent 关键词陷阱）**：
   - 搜 “Java Agent” 90% 会搜出 JVM APM 监控工具（SkyWalking、Arthas、-javaagent 字节码插桩）；
   - 正确的 Agent 搜索词族：`ai agent`、`agent`、`大模型agent`、`智能体`、`AI Agent架构师`、`大模型应用 架构`、`Java 智能体`、`AI 平台 后端`。
