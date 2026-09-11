# Cloudflare Tunnel 跨平台集成与多端对等互联设计

## 背景

当前网关（`@wuhezhizhong/shrimp`）已在 `lib/nat-traversal` 中实现了基于 FRP（`frpc`）的穿透能力。然而，FRP 方案对普通开发者存在一定门槛：
1. **基础设施负担**：用户必须自购具有公网 IP 的云服务器并自建 `frps`；
2. **证书与域名配置繁琐**：外部现代客户端调用 AI 接口时普遍强制要求 HTTPS，FRP 下需自行配置 Nginx/Caddy 及 ACME 证书；
3. **缺乏即时共享能力**：无法做到“无需账号一键生成临时公网访问链接”。

同时，项目早期在 `.env.example` 中沉淀了大量模型相关的环境变量（如 `ARK_*`、`OFFICIAL_ANTHROPIC_*`、`TAVILY_*`），与现有的 `gateway.config.json` / `gateway.secrets.json` 职责发生重叠，需要进行彻底的极简精简。

此外，用户在笔记本与台式机双机协作时，需要跨机器的会话查看与双向同步能力。引入 Cloudflare Tunnel 作为底层跨公网加密通道，可以实现无公网 IP 限制的对等互联（Peer-to-Peer）。

---

## 目标

1. **跨平台 Cloudflare 穿透组件（Windows & macOS）**：
   - 推荐使用统一跨平台命令 `npm install -g cloudflared`（基于 `node-cloudflared`，自动根据系统与 CPU 架构下载官方二进制并缓存）；同时智能兼容原生 `brew`（Mac）与 `winget`/静态安装（Windows）。
   - 实现平级 Provider：`lib/nat-traversal/providers/cloudflared.mjs`，接入 `createProviderRegistry`。
   - 实现跨平台子进程守护器 `lib/nat-traversal/process/cloudflared-supervisor.mjs`。
   - 支持两种工作模式：
     - **Quick Tunnel（快速临时隧道）**：零配置、无需账号，一键生成 `https://*.trycloudflare.com`，自动从输出中正则捕获并回显在面板与 API 中。
     - **Token 模式（具名固定隧道）**：支持使用 Cloudflare Zero Trust 后台生成的 Token，实现稳定域名与长期后台运行。
2. **严格凭证隔离与数据兼容**：
   - 穿透 Token **严禁写入 `gateway.secrets.json`**（该文件专属于模型 API 密钥）；
   - 存入专用的 `nat-traversal.secrets.json`，扩展现有结构为：
     ```json
     {
       "frpc": { "token": "..." },
       "frpsDashboard": { "username": "...", "password": "..." },
       "cloudflared": { "token": "..." }
     }
     ```
   - 优先支持读取环境变量 `CLOUDFLARE_TUNNEL_TOKEN`。
3. **极简 `.env` 方案**：
   - 将 `.env.example` 彻底精简为基础运行时变量（`PORT`、`HOST`、`GATEWAY_API_KEY`），确立模型配置与上游路由完全由 `gateway.config.json` 与 `gateway.secrets.json` 掌管的单一事实来源。
4. **多端对等互联（Peer-to-Peer 会话双向同步）**：
   - 在 `lib/nat-traversal` 和 `lib/remote-session` 中扩展 Peer 定义，支持 `transport.type: "cloudflare"` 与 `services.gatewayApi` 填写对端 Cloudflare 域名。
   - 提供基于最后写入时间戳（LWW）的安全增量会话同步协议，支持 CLI 命令行与 Web 面板一键同步。
   - 全双工特性利用 Cloudflare Tunnel 底层 HTTP/2 / QUIC 与 WebSocket 穿透实现，对已有 Remote Session 提供天然连通支持。
5. **前端 Web UI (Desktop Panel) 升级**：
   - Catalog 视图并列展示 FRP 与 Cloudflare 两张卡片。
   - 增加 Cloudflare 详情页面，支持一键启停、Quick/Token 模式切换、临时公网链接一键复制与实时运行日志。

---

## 非目标

1. 不废弃现有 FRP 功能：FRP 与 Cloudflare Tunnel 并存且各司其职（FRP 专注于复杂内网纯 TCP/SSH 穿透，Cloudflare 专注于 HTTP/HTTPS/WebSocket 协议网关服务）。
2. 不重新开发终端模拟器/新 PTY 协议：双工通信利用 Tunnel 固有管道特性，本期不重写终端层，专注穿透与会话同步。
3. 不在构建期打包捆绑庞大的 `cloudflared` 预编译全平台二进制，避免导致 npm 包体积膨胀，采用按需检测与 npm/包管理器安装指引。

---

## 详细架构与实现方案

### 1. 跨平台二进制探测与安装体系

跨平台二进制检测算法：
- **Windows**：
  1. 检测配置中指定的 `cloudflared.binPath`；
  2. 检测 `which cloudflared` / `where cloudflared`；
  3. 检测 `%APPDATA%\npm\cloudflared.cmd`、`%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe`、`C:\Program Files\cloudflared\cloudflared.exe`；
- **macOS / Linux**：
  1. 检测配置中指定的 `cloudflared.binPath`；
  2. 检测 `which cloudflared`；
  3. 检测 Homebrew 常见路径：`/opt/homebrew/bin/cloudflared`、`/usr/local/bin/cloudflared`；
  4. 检测 npm 全局路径：`~/.npm-global/bin/cloudflared`、`$(npm prefix -g)/bin/cloudflared`。

安装指引呈现：
- 面板检测到未安装时，提供复制按钮：
  - 推荐全平台：`npm install -g cloudflared`
  - macOS 备选：`brew install cloudflared`
  - Windows 备选：`winget install --id Cloudflare.cloudflared`

---

### 2. Provider 与 Supervisor 设计

#### `lib/nat-traversal/domain/config-schema.mjs`
扩展配置模式：
```js
export function defaultNatTraversalConfig() {
  return {
    enabled: false,
    activeProvider: "frpc", // "frpc" | "cloudflared"
    frpc: { ... },
    cloudflared: {
      binPath: "",
      mode: "quick", // "quick" | "token"
      localUrl: "http://127.0.0.1:8787",
      logLevel: "info",
    },
    ...
  };
}
```

#### `lib/nat-traversal/process/cloudflared-supervisor.mjs`
- 启动命令参数规范：
  - Quick 模式：`cloudflared tunnel --url <localUrl> --no-autoupdate`
  - Token 模式：`cloudflared tunnel run --token <token> --no-autoupdate`
- 管理子进程 `spawn(binPath, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] })`。
- 将子进程 PID 写入 `nat-traversal/cloudflared.pid`，并在退出时清理。
- 日志管道追加至 `nat-traversal/cloudflared.log`。
- **Quick Tunnel URL 抓取**：
  - 启动后监听 stdout/stderr 行流；
  - 正则匹配：`https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com`；
  - 抓取到后保存至内存状态并通知前端，超时未抓取则记录最近错误。

#### `lib/nat-traversal/infra/secret-store.mjs`
- 遵循现有的嵌套数据结构，向下兼容：
  ```json
  {
    "frpc": { "token": "..." },
    "frpsDashboard": { "username": "...", "password": "..." },
    "cloudflared": { "token": "..." }
  }
  ```
- 环境变量优先级：若存在 `process.env.CLOUDFLARE_TUNNEL_TOKEN`，优先取环境变量。

---

### 3. 极简 `.env` 改造

重构 `.env.example`：
```bash
# Shrimp Gateway 核心运行配置
PORT=8787
HOST=127.0.0.1

# 可选：外网访问本网关时的身份鉴权密钥（Bearer Token / x-api-key）
# 若设置，所有通过 Cloudflare Tunnel 或外网的客户端请求必须携带该 Key
# GATEWAY_API_KEY=your-strong-secret-token

# 注意：模型提供商（火山方舟、Anthropic、OpenAI 等）与网络搜索配置
# 已全面收归至 gateway.config.json 与 gateway.secrets.json 管理，无需在此配置。
```

---

### 4. 多端对等互联（P2P 会话同步与安全规范）

#### 拓扑设计
- 机器 A（台式机）与 机器 B（笔记本）各运行一个 Shrimp Gateway。
- 至少一端开启 Cloudflare Tunnel（例如台式机暴露为 `https://desktop.yourdomain.com`，或临时 Quick Tunnel `https://xxxx.trycloudflare.com`）。
- 笔记本添加 Peer：
  ```json
  {
    "id": "desktop-peer",
    "name": "Home Desktop",
    "transport": {
      "type": "cloudflare",
      "host": "desktop.yourdomain.com",
      "port": 443
    },
    "services": {
      "gatewayApi": "https://desktop.yourdomain.com"
    },
    "auth": {
      "gatewayToken": "your-desktop-gateway-api-key"
    }
  }
  ```

#### 鉴权与安全防护契约
1. **端点强制鉴权**：所有 `/v1/session-sync/*` 接口必须校验请求头：
   - 检查 `Authorization: Bearer <token>` 或 `x-api-key: <token>`；
   - 必须匹配本地配置的 `GATEWAY_API_KEY` 或已授权 Peer 的 `auth.gatewayToken`；未通过鉴权立即返回 HTTP 401。
2. **防路径穿越（Path Traversal Guard）**：
   - `:sessionId` 必须符合白名单正则 `/^[a-zA-Z0-9_\-\.]+$/`；
   - 文件操作前强制验证：`path.resolve(targetFile).startsWith(path.resolve(hubStore.sessionsDir))`；
   - 任何越界行为均直接抛出 HTTP 400 Bad Request。

#### 同步协议接口与触发机制
1. **接口定义**：
   - `GET /v1/session-sync/manifest`：返回本地所有会话元信息列表 `[{ sessionId, filename, updatedAt, workspace, size }]`。
   - `GET /v1/session-sync/file/:sessionId`：安全读取并返回该会话完整 JSON。
   - `POST /v1/session-sync/push`：接收会话 JSON 并写入本地 Hub。
2. **触发机制**：
   - **CLI 触发**：`shrimp sync peer pull <peerId>` / `shrimp sync peer push <peerId>`。
   - **Web UI 触发**：在 Peer 卡片上提供「同步会话」操作按钮。
3. **冲突解决策略（LWW - Last-Write-Wins）**：
   - 对比两端的 `updated_at` 时间戳；
   - 仅当来源端的 `updated_at` 大于本地会话时才进行覆盖更新；若本地较新则保留本地，避免旧文件覆盖新会话。

---

### 5. 前端 Web UI (Desktop Panel)

1. **`nat-traversal` 模块 Catalog 改造**：
   - 展示两张大卡片：`FRP` 与 `Cloudflare Tunnel`。
   - 卡片上实时展示运行状态（运行中/已停止）、当前模式、公网地址徽标（可点击打开或复制）。
2. **Cloudflare 详情页**：
   - 顶部操作栏：启动、停止、重启、刷新。
   - 模式切换单选按钮：【一键临时公网 (Quick Tunnel)】vs【正式固定隧道 (Token 模式)】。
   - 状态看板：PID、当前公网 URL、运行模式、二进制路径。
   - 实时日志展示区。

---

## 阶段划分与实施计划

- **Phase 1（核心穿透与基石）**：
  1. `lib/nat-traversal/process/cloudflared-supervisor.mjs` 跨平台进程守护与 URL 提取；
  2. `lib/nat-traversal/providers/cloudflared.mjs` Provider 接入与凭证管理；
  3. 极简 `.env.example` 整理；
  4. Desktop Panel 前端卡片与详情页扩展；
  5. 自动化测试编写与验证。
- **Phase 2（P2P 会话同步）**：
  1. `/v1/session-sync/manifest`、`pull`、`push` 接口安全实现；
  2. PeerClient 适配 Cloudflare 域名与鉴权头注入；
  3. CLI / Panel 同步指令接入；
  4. 端到端互联测试验证。

---

## 验证计划

1. **单元测试**：
   - `tests/unit/nat-traversal-cloudflared-provider.test.mjs`：测试 provider 接口、二进制解析规则、参数构建、Token 隔离逻辑。
   - `tests/unit/nat-traversal-cloudflared-supervisor.test.mjs`：测试 supervisor 的进程生命周期模拟、trycloudflare 临时 URL 提取正则。
   - `tests/unit/session-sync-peer-protocol.test.mjs`：测试 manifest 接口、鉴权校验、路径穿越拦截、以及 LWW 冲突合并逻辑。
2. **集成测试**：
   - `tests/integration/nat-traversal-cloudflared-api.test.mjs`：测试 `/v1/nat-traversal/config`、`/v1/nat-traversal/status`、启动/停止 API 请求响应。
3. **前端构建验证**：
   - 运行 `npm run build:panel`，确保 bundle 编译无错误。
4. **整体回归**：
   - 运行全量 `npm test` 确保无回归。
