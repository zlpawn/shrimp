# Antigravity Remote Session + NAT Traversal 设计

**日期：** 2026-08-14  
**状态：** Phase 1 已实现，待 Phase 2  
**分支：** `codex/antigravity-remote-session`  
**工作区：** `.worktrees/antigravity-remote-session`  
**实现路线：** 方案 1 — Gateway 控制面 + 挂接对端已运行 Antigravity 后端  
**交付顺序：** 先完整设计，再优先实现 NAT Traversal / frpc 管理台，后做 Remote Session  
**Phase 2 计划：** `docs/superpowers/plans/2026-08-14-antigravity-remote-session.md`

---

## 1. 背景与目标

### 1.1 用户要的体验

对标 Codex Desktop 的 Remote / Joint Session：

- A 电脑的客户端连接 B 电脑
- 在 B 的真实工作区里开会话
- 体验接近本地：发 prompt、看流式输出、改文件、跑命令、审批
- 会话本体在 B；B 本机 Antigravity 也能看到同一会话
- 双向对等：任意一端都可当控制端或 Host

这不是远程桌面，也不是 CDP 点选 UI，而是：

> **Client ↔ multi-host agent backend**

### 1.2 终局目标

做成 Antigravity 的正式产品能力：

1. 网关开启远程能力与通道
2. 控制端尽量在 Antigravity UI 中操作
3. Host 端会话、执行、额度、权限全在被控端
4. 未来支持设备配对码、自动拉起、目录浏览、更多穿透 provider

### 1.3 第一期目标

只服务个人两台机器，验收线是：

1. **NAT Traversal / frpc 管理台可用**
2. 在稳定通道之上，Remote Session 达到**写代码闭环**

写代码闭环定义：

- A 发 prompt
- B 改文件、跑命令
- A 看 diff / 终端输出
- 高危操作在 A 审批
- 会话落在 B，权限继承 B 当前项目/全局设置

### 1.4 第一期明确不做

- 设备市场 / 多租户 / 复杂账号体系
- 修改 Antigravity `app.asar` 或安装包内部
- 自动设备发现列表
- 自动拉起 Antigravity（B 需已手动打开）
- 设备配对码（预留，不在第一期）
- 完整官方 Remote 菜单内建（A 侧 UI 形态待探测后定）
- 独立 headless 会话世界作为主路径
- CDP/UI 遥控作为主路径

---

## 2. 核心决策

| 决策 | 选择 |
| --- | --- |
| 产品终局 | Antigravity 正式产品能力，不是一次性旁路脚本 |
| 技术路线 | Gateway 控制面 + 挂接 B 本机已运行 Antigravity 后端 |
| 模块拆分 | NAT Traversal（系统扩展）与 Remote Session（业务能力）分离 |
| 穿透能力 | 系统扩展导航名「内网穿透 (NAT Traversal)」；frpc 为第一 provider；面板内嵌 frps Dashboard |
| 网络 | 双 NAT + 阿里云 frps；第一期手动配置 SSH/frpc 对端 |
| 对等模型 | 双向对等，第一期先打通一对机器 |
| 执行位置 | 全在 Host（被控端）：工作区、终端、文件、审批引擎、额度 |
| 会话可见 | Joint Session：B 本机 UI 应能看到同一会话 |
| 操作权 | 控制端主导；Host 默认可看，不抢操作 |
| 断线策略 | 控制端掉线后，Host 继续跑完当前回合；重连后接上 |
| 项目选择 | 第一期选 B 已有 Project；未来支持 B 上选目录 |
| 权限策略 | 继承 B 当前项目/全局设置，不另造远程策略 |
| 鉴权 | 第一期复用 SSH 信任；未来升级设备配对码 |
| 部署 | 第一期两边都装并运行 Gateway + Antigravity |
| 安全边界 | 不改安装包；secrets 与公开配置分离 |
| 交付顺序 | 先写完整设计；优先实现 frpc 管理台；再做 Remote Session |
| 架构风格 | 对齐 Dream Skin：domain/application/http + provider 注入；开闭原则；未启用零影响 |

---

## 3. 总体架构

### 3.1 双模块架构

```text
┌──────────────────────────────────────────────────────────────┐
│                     Control Machine (A)                      │
│  ┌──────────────────────┐   ┌─────────────────────────────┐  │
│  │ Antigravity UI       │   │ Shrimp Gateway              │  │
│  │ (尽量在此操作)        │   │ - enable remote             │  │
│  │                      │   │ - peer config               │  │
│  │                      │   │ - session orchestration     │  │
│  └──────────▲───────────┘   └──────────────┬──────────────┘  │
│             │  UI 形态待探测               │                  │
│             └──────────────┬───────────────┘                  │
│                            │ uses                             │
│                   ┌────────▼────────┐                         │
│                   │ NAT Traversal   │                         │
│                   │ - frpc provider │                         │
│                   │ - ssh trust     │                         │
│                   │ - link status   │                         │
│                   └────────┬────────┘                         │
└────────────────────────────┼──────────────────────────────────┘
                             │ frps / SSH tunnel
┌────────────────────────────┼──────────────────────────────────┐
│                     Host Machine (B)                          │
│                   ┌────────▼────────┐                         │
│                   │ NAT Traversal   │                         │
│                   │ - frpc provider │                         │
│                   │ - local expose  │                         │
│                   └────────┬────────┘                         │
│                            │                                  │
│  ┌─────────────────────────▼──────────────────────────────┐   │
│  │ Shrimp Gateway                                         │   │
│  │ - attach local Antigravity backend                     │   │
│  │ - list projects                                        │   │
│  │ - proxy session events / approvals                     │   │
│  └───────────────┬────────────────────────────────────────┘   │
│                  │                                            │
│                  ▼                                            │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Antigravity 2.x (already running)                      │   │
│  │ language_server / agent backend                        │   │
│  │ - conversations / projects                             │   │
│  │ - tools / terminal / files                             │   │
│  │ - approvals / quota / permissions                      │   │
│  │ - desktop UI shows Joint Session                       │   │
│  └────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 模块职责

#### A. NAT Traversal（系统扩展，与 Dream Skin 同级）

**一句话：** 解决“两台机器如何稳定、可配置、可观测地互通”。

负责：

- provider 抽象（第一期 `frpc`，可扩展）
- frpc 配置管理台：写配置、启停、状态
- 对端 link 的建立与健康检查
- 给上层提供稳定通道 API

不负责：

- Antigravity 会话
- prompt / diff / 审批业务语义

#### B. Remote Session（业务能力）

**一句话：** 在已连通的 peer 上，挂接 Host 的 Antigravity 后端，完成远程写代码 Joint Session。

负责：

- 选择 peer / project
- 挂接 B 本机已运行后端
- 会话创建、消息、事件流
- 审批转发（控制端主导）
- 断线重连后的会话接续

不负责：

- frpc.ini 细节
- 穿透进程生命周期（交给 NAT Traversal）

#### C. Antigravity Host Backend（执行面）

**一句话：** 真正拥有会话与执行环境的一侧。

负责：

- 会话存储与执行
- 工作区文件与终端
- 权限与额度
- Host 本机 UI 展示 Joint Session

### 3.3 为什么必须挂“已运行后端”

“会话落在 B”不等于“B 的 Antigravity 窗口能看见”。

若另起独立 headless daemon：

- 远程编码可能通
- 但桌面 UI 连的是另一条会话总线
- Joint Session 会退化成二次同步

因此主路径是：

> **远程控制挂到 B 当前 Antigravity 正在使用的 backend。**

第一期前提：

- B 已手动打开 Antigravity
- 否则连接失败，并提示先打开

---

## 4. NAT Traversal 设计

### 4.1 定位

名称偏能力，不偏工具：

- 模块名建议：`lib/nat-traversal/`
- 对外能力名：NAT Traversal / Peer Link
- 配置键：`natTraversal`
- frpc 只是第一个 provider

对标现有系统扩展风格（如 Dream Skin）：

- 独立目录
- 配置可选
- secrets 隔离
- HTTP/API + 面板入口
- 可单独启用/停用


### 4.1.1 命名与导航风格（对齐现有系统扩展）

现有「系统扩展」导航文案风格：

- `主题皮肤 (Dream Skin)`
- `用量统计 (Token Analytics)`
- `会话同步 (Session Sync)`

本能力统一命名：

| 用途 | 名称 |
| --- | --- |
| 侧边导航 / 面板标题 | **内网穿透 (NAT Traversal)** |
| 配置键 | `natTraversal` |
| 代码目录 | `lib/nat-traversal/` |
| 前端模块 | `desktop/src/modules/nat-traversal.ts` |
| API 前缀 | `/v1/nat-traversal` |
| CLI | `shrimp nat-traversal ...` |

说明：

- 对外产品名用能力名 **NAT Traversal**，不叫 `frp-extension`
- frpc / frps 是 provider 与运维对象，作为页内子区块出现
- 中文主标题用「内网穿透」，与 Dream Skin / Session Sync 的「中文 (English)」格式一致

页内信息架构建议：

1. **概览**：启用开关、当前 provider、总状态
2. **frpc 客户端**：连接参数、proxy、启停、日志
3. **frps 控制台**：嵌入/代理展示远程 frps Dashboard
4. **对端 Peers**：手动 SSH/服务地址、连通测试

### 4.2 Provider 接口（稳定契约）

Remote Session 只依赖这些能力，不直接依赖 frpc：

```ts
type PeerId = string;

interface NatTraversalProvider {
  id: string; // "frpc" | "ssh" | ...
  capabilities(): string[];
  validateConfig(config: unknown): { ok: true } | { ok: false; error: string };
  applyConfig(config: unknown): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<ProviderStatus>;
  ensureLink(peerId: PeerId): Promise<LinkHandle>;
  linkStatus(peerId: PeerId): Promise<LinkStatus>;
  openService(peerId: PeerId, service: ServiceName): Promise<ServiceEndpoint>;
}

type ServiceName =
  | "gateway-api"
  | "antigravity-backend"
  | "health";
```

第一期 `openService` 可以很薄：返回本地回环地址 + 端口映射结果。

### 4.3 frpc 管理台（优先实现）

#### 目标

在网关面板中管理本机 frpc：

1. 配置 frps 地址、端口、token、本地 proxy
2. 写入受控配置文件
3. 启停 / 重启 frpc
4. 查看运行状态与最近错误
5. 做基础连通探测

#### 配置模型

公开配置（可进 `gateway.config.json` 的非敏感部分）：

```json
{
  "natTraversal": {
    "enabled": true,
    "activeProvider": "frpc",
    "frpc": {
      "binPath": "",
      "configPath": "",
      "serverAddr": "x.x.x.x",
      "serverPort": 7000,
      "logLevel": "info",
      "proxies": [
        {
          "name": "shrimp-gateway",
          "type": "tcp",
          "localIp": "127.0.0.1",
          "localPort": 8787,
          "remotePort": 18787
        }
      ]
    },
    "peers": [
      {
        "id": "home-mac",
        "displayName": "Home Mac",
        "ssh": {
          "host": "home-mac.frp.example",
          "port": 22,
          "user": "pa",
          "identityFile": "~/.ssh/id_ed25519"
        },
        "services": {
          "gatewayApi": "127.0.0.1:18787"
        }
      }
    ]
  }
}
```

敏感项进 secrets（如 `gateway.secrets.json` 或独立 `nat-traversal.secrets.json`）：

```json
{
  "natTraversal": {
    "frpc": {
      "token": "..."
    }
  }
}
```

约束：

- token 不得进入公开配置模板
- 配置文件写入网关数据目录，不覆盖用户系统级未知 frpc 配置，除非用户显式指定
- 默认不自动接管用户已有全局 frpc，除非管理台导入/接管

#### 进程管理

- 由 Gateway 管理子进程或已知 pid 文件（第一期先子进程）
- 状态：`stopped | starting | running | error`
- 记录：启动时间、pid、最近 stdout/stderr 尾部、最后错误
- 停止必须可幂等

#### 管理 API（建议）

```text
GET  /v1/nat-traversal/capabilities
GET  /v1/nat-traversal/status
GET  /v1/nat-traversal/config
PUT  /v1/nat-traversal/config
POST /v1/nat-traversal/start
POST /v1/nat-traversal/stop
POST /v1/nat-traversal/restart
POST /v1/nat-traversal/test-link
GET  /v1/nat-traversal/peers
PUT  /v1/nat-traversal/peers/:id
DELETE /v1/nat-traversal/peers/:id
```

#### 面板能力（第一期）

导航入口：`系统扩展 → 内网穿透 (NAT Traversal)`

- 启用开关
- frpc 连接参数编辑（serverAddr/serverPort/proxies）
- proxy 列表增删改
- 一键写配置
- 启停按钮 + 状态徽章
- 最近日志/错误
- peer 手动录入（SSH 地址等）
- “测试连通”
- **frps Dashboard 展示区**（见下节）

#### frps Dashboard 嵌入（已确认需求）

用户已在远端部署 frps Dashboard，例如：

`http://39.105.19.237:7500/static/#/`

该页通常需要浏览器弹窗 Basic Auth（用户名/密码）。管理台需要把这个页面也展示出来，方便查看服务端状态，而不是只让用户另开浏览器。

设计要求：

1. **配置项**
   - `dashboardUrl`：如 `http://39.105.19.237:7500/static/#/`
   - `dashboardUser` / `dashboardPassword`：进入 secrets，不进公开配置
2. **展示方式（优先顺序）**
   - **A. 网关反代嵌入（推荐）**  
     面板 iframe 指向本机 Gateway 代理地址，例如 `/v1/nat-traversal/frps-dashboard/`  
     由 Gateway 注入 Basic Auth 访问远端 Dashboard，避免浏览器弹窗/跨域/iframe 鉴权问题
   - **B. 直接 iframe 原地址**  
     仅当 Dashboard 无鉴权或浏览器可接受时降级使用
   - **C. 外部打开**  
     始终提供“在浏览器打开”兜底按钮
3. **安全**
   - Dashboard 密码只存 secrets
   - 反代默认仅本机 Gateway 可访问（跟随现有面板本地访问模型）
   - 不在前端 localStorage 明文缓存密码
   - UI 可显示“已配置鉴权 / 未配置”，不回显完整密码
4. **状态**
   - 可探测 Dashboard 是否可达（经反代 HEAD/GET）
   - 失败时展示明确错误：DNS/超时/401/502，而不是空白 iframe

补充 API：

```text
GET  /v1/nat-traversal/frps-dashboard/status
ALL  /v1/nat-traversal/frps-dashboard/*   # reverse proxy to configured dashboard
```

公开配置示例补充：

```json
{
  "natTraversal": {
    "frpc": {
      "serverAddr": "39.105.19.237",
      "serverPort": 7000
    },
    "frpsDashboard": {
      "enabled": true,
      "url": "http://39.105.19.237:7500/static/#/"
    }
  }
}
```

secrets 示例补充：

```json
{
  "natTraversal": {
    "frpc": { "token": "..." },
    "frpsDashboard": {
      "username": "...",
      "password": "..."
    }
  }
}
```

#### 第一期不做

- 在管理台里完整“取代” frps 服务端运维（扩容、证书、多实例编排）
- 多 provider 可视化编排器
- 自动端口分配市场
- 跨用户分享 tunnel 配置
- 把 frps Dashboard 账号做成多租户权限系统

### 4.3.1 Phase 1 implementation deltas

Phase 1 code is already on this branch. The following deviations from the original draft are accepted:

1. **frps Dashboard UX**
   - Implemented: gateway reverse proxy + open in a new tab
   - Deferred: in-page iframe embed
   - Reason: avoid breaking the management panel layout; proxy still solves Basic Auth / CORS issues

2. **Local frpc discovery / import**
   - Implemented: `GET /v1/nat-traversal/discover-frpc`, `POST /v1/nat-traversal/import-frpc`
   - Token stays in the original frpc config file by default and is not copied into gateway secrets

3. **Link API for Remote Session**
   - Provider methods already existed; service/HTTP now expose:
     - `POST /v1/nat-traversal/ensure-link`
     - `POST /v1/nat-traversal/open-service`
   - Remote Session must depend on these APIs, not on frpc process internals

4. **CLI**
   - Not required for Phase 1 acceptance
   - Can follow after HTTP/panel path is stable

5. **Cross-platform tests**
   - NAT unit suite is green on Windows after supervisor injection + path-normalized assertions

### 4.4 SSH 信任如何用


第一期鉴权与运维通道复用现有 SSH：

- peer 记录里保存 SSH host/user/port/identity
- `test-link` 与部分管理动作可走 SSH
- frpc 负责常驻业务端口映射
- 不在第一期发明新的身份系统

未来配对码：

- 生成 short code / QR
- 双方确认后写入 trusted peer
- 逐步减少对“人手填 SSH”的依赖

---

## 5. Remote Session 设计

### 5.1 会话模型

```text
RemoteSession {
  id
  controllerPeerId   // A
  hostPeerId         // B
  hostProjectId
  hostConversationId
  controlMode        // "controller-led"
  state              // connecting|ready|running|awaiting_approval|disconnected|ended
  createdAt
  lastEventAt
}
```

原则：

- 会话权威状态在 Host（B）
- 控制端保存投影/缓存，不另造权威存储
- Joint Session 的可见性依赖挂接同一 backend，而不是复制 transcript

### 5.2 控制权

控制端主导：

| 动作 | 控制端 A | Host 本机 B |
| --- | --- | --- |
| 发 prompt | 默认允许 | 默认只读跟随 |
| 看流式输出 | 是 | 是 |
| 看 diff / 终端 | 是 | 是 |
| 审批高危操作 | 默认由 A | 默认不抢，除非未来“接管” |
| 掉线后当前回合 | B 继续跑完 | 继续执行 |

第一期不做复杂协作锁；不做双边同时编辑冲突合并。

### 5.3 关键流程

#### 开启功能

1. 两边 Gateway 启用 NAT Traversal
2. 配置并启动 frpc
3. 录入对端 peer（手动 SSH/服务地址）
4. 启用 Remote Session 能力

#### 建立远程会话

1. A 选择 peer = B
2. NAT Traversal `ensureLink(B)`
3. A 请求 B Gateway：`attachLocalBackend`
4. B 确认本机 Antigravity backend 可用；否则失败并提示打开 Antigravity
5. A 拉取 B 的 project 列表
6. A 选择 project，请求 `createRemoteSession`
7. B 在本机 backend 创建/绑定 conversation
8. 双方订阅事件流

#### 写代码闭环

1. A 发送 `DISPATCH_PROMPT`
2. B backend 执行 agent turn
3. 事件流回传：assistant text / tool calls / terminal / diff
4. 需审批时，B 发出 `APPROVAL_REQUIRED`
5. A 展示并回 `APPROVAL_DECISION`
6. B 继续执行
7. turn 结束，状态落在 B

#### 断线重连

1. A 掉线，B 不中断当前 turn
2. A 重连后通过 `sessionId` 恢复事件游标
3. 拉取缺失事件与当前状态
4. 若有 pending approval 且策略允许，继续由 A 处理

### 5.4 协议消息（逻辑层）

最小集合：

| 消息 | 方向 | 作用 |
| --- | --- | --- |
| `PEER_HELLO` | 双向 | 版本、能力、节点身份 |
| `ATTACH_BACKEND` | A→B | 挂接本机 Antigravity backend |
| `LIST_PROJECTS` | A→B | 列出 Host 项目 |
| `CREATE_SESSION` | A→B | 在指定 project 建会话 |
| `DISPATCH_PROMPT` | A→B | 发送用户输入 |
| `SESSION_EVENT` | B→A | 流式文本/工具/终端/diff 等 |
| `APPROVAL_REQUIRED` | B→A | 请求审批 |
| `APPROVAL_DECISION` | A→B | 允许/拒绝 |
| `RESUME_SESSION` | A→B | 重连续订 |
| `SESSION_END` | 双向 | 结束 |

传输层第一期可先走：

- Gateway HTTP + SSE/WebSocket over NAT Traversal link
- 不必一开始自研完整二进制协议

### 5.5 Host 挂接策略

探测顺序（实现期落实）：

1. 本机 Antigravity 是否在运行
2. backend 发现信息（端口、pipe、discovery file、`persistent_mode` 痕迹等）
3. 是否可调用 `agentapi` / HTTP language server API
4. 是否能列出 projects / conversations
5. 新建 conversation 后，桌面 UI 是否可见（Joint 验证）

若官方挂点不足：

- 记录缺口
- 不通过改 asar 硬来
- 评估次优：扩展点 / 受支持 CLI / 有限 API
- A 侧 UI 形态同步降级决策

### 5.6 A 侧控制面形态

原则：

- 人尽量待在 Antigravity
- 网关负责开启与编排

第一期不锁死具体 UI，等探测后再选：

1. 尽量只在 A 的 Antigravity 中完成
2. 网关面板发起，连上后回到 Antigravity
3. Antigravity + 轻量桥接浮层

无论哪种，Remote Session 的领域 API 保持稳定。

---

## 6. 网关集成方式

### 6.1 代码布局（建议）

```text
lib/
  nat-traversal/
    index.mjs
    paths.mjs
    domain/
      errors.mjs
      config-schema.mjs
      provider-contract.mjs
      status.mjs
    application/
      service.mjs
    providers/
      registry.mjs
      frpc.mjs
      ssh.mjs
    process/
      frpc-supervisor.mjs
    infra/
      secret-store.mjs
      dashboard-proxy.mjs
    http/
      routes.mjs
  remote-session/          # Phase 2+
    domain/
    application/
    host-attach/
    http/
```

原则对齐现有工程：

- 模块自包含
- server.js 只做最小路由挂载
- 配置可选；未启用时零影响
- 测试独立


## 6.1A 架构约束（开闭原则 / 可扩展 / 易维护）

本模块必须对齐现有系统扩展架构，尤其参考 `lib/dream-skin/` 与 extension registry 的做法。这是实现硬约束，不是建议。

### 必须遵守

1. **模块自包含**
   - 业务代码放在 `lib/nat-traversal/`（Remote Session 后续放 `lib/remote-session/`）
   - `server.js` 只做最小 import + 路由挂载 + 配置装配
   - 不把 frpc/进程/反代细节散进 `server.js`

2. **分层清晰（对标 Dream Skin）**
   ```text
   lib/nat-traversal/
     domain/           # 纯规则：配置校验、状态枚举、错误码、provider 契约
     application/      # service 编排：唯一用例入口
     providers/        # 可替换实现：frpc、ssh、future...
     process/          # 进程监督等基础设施
     http/             # 路由与 DTO，不写业务决策
     index.mjs         # 对外导出
   ```
   - `domain` 不依赖 HTTP、子进程、文件系统副作用（校验函数可纯）
   - `http/routes` 只做解析请求、调 service、映射错误码
   - `application/service` 通过构造注入 provider / supervisor / secretStore

3. **开闭原则（Open/Closed）**
   - 对扩展开放：新增穿透实现 = 新增 provider，不改 Remote Session
   - 对修改关闭：核心 service 不出现 `if (provider === 'frpc') { ...大段实现... }` 分支堆叠
   - provider 注册表 + 统一接口（validate/apply/start/stop/status/ensureLink）
   - 能力用 `capabilities` / feature flags 声明，UI 按能力展示，不按硬编码身份写死

4. **依赖注入，不硬编码全局**
   - `createNatTraversalService({ configStore, secretStore, providers, supervisorFactory, clock, logger })`
   - frpc 二进制路径、配置目录、dashboard 反代 client 均可注入，便于测试

5. **配置可选，未启用零影响**
   - `natTraversal.enabled !== true` 时不启进程、不挂危险路由副作用
   - 不引入新的必需环境变量
   - 故障隔离：本模块失败不影响既有 gateway 主路径

6. **secrets 与公开配置分离**
   - token / dashboard 密码只进 secrets
   - 公开配置可展示、可备份；secrets 不进模板、不进前端回显

7. **可测试**
   - domain 与 service 必须可单测（假 provider / 假 supervisor）
   - HTTP 集成测只验证路由装配与错误映射
   - 不依赖真实公网 frps 才能跑核心单测

8. **可回滚**
   - 删除 `lib/nat-traversal/` + 撤销 server/panel 挂载即可移除
   - 不污染既有 client endpoint 路由逻辑

### 反例（禁止）

- 在 `server.js` 里直接 `spawn('frpc')`
- UI 写死只支持 frpc，导致以后加 provider 要改全站
- Remote Session 直接读 `frpc.ini`
- 为了快把配置、进程、反代、会话全塞进一个大文件

### 扩展点预留

| 扩展点 | 第一期 | 未来 |
| --- | --- | --- |
| Tunnel provider | `frpc` | `ssh`, `tailscale`, ... |
| Dashboard source | frps web dashboard 反代 | 其他状态面板 |
| Peer auth | 手动 SSH / 预配置 | 配对码 |
| Consumer | 管理台 + 后续 Remote Session | 其他跨机能力 |

### 6.2 配置开关

```json
{
  "natTraversal": { "enabled": false },
  "remoteSession": { "enabled": false }
}
```

依赖关系：

- `remoteSession.enabled = true` 时，要求 `natTraversal.enabled = true`
- NAT Traversal 可单独启用（只做穿透管理，不做远程会话）

### 6.3 CLI（建议）

```text
shrimp nat-traversal status
shrimp nat-traversal start
shrimp nat-traversal stop
shrimp nat-traversal test --peer home-mac

shrimp remote status
shrimp remote peers
shrimp remote projects --peer home-mac
shrimp remote open --peer home-mac --project <id>
```

第一期至少先保证 NAT Traversal CLI/API；Remote CLI 可随第二刀补齐。

---

## 7. 安全设计

### 7.1 威胁面

远程写代码 ≈ 对端机器的高权限执行入口。

主要风险：

1. 未授权 peer 连入
2. token / SSH key 泄漏
3. 穿透端口暴露过宽
4. 审批绕过
5. 控制端被盗用后远程作恶

### 7.2 第一期控制措施

- 仅信任手动配置的 peer + 现有 SSH 信任
- frpc token 进 secrets
- 默认只映射必要本地端口（gateway / backend），不扫全机
- 审批决策只接受当前 controller session
- Host 侧保留完整执行审计（依赖 Antigravity 既有日志/会话）
- 不改 Antigravity 安装包，降低不可逆污染

### 7.3 明确不做的危险捷径

- 无鉴权公网开放 backend
- 把 approval 默认改成 always-allow 以“方便远程”
- 为 Joint Session 直接 patch asar

---

## 8. 分期计划

### Phase 0 — 设计与探测基线（当前）

- 完成本设计文档
- 锁定双模块边界
- 后续实现前补充 Antigravity backend 挂点探测清单

### Phase 1 — NAT Traversal / frpc 管理台（优先）

状态：**已实现（本分支）**

交付：

1. `lib/nat-traversal` 模块骨架
2. 导航命名：`内网穿透 (NAT Traversal)`
3. frpc 配置读写（公开配置 + secrets）
4. 启停/重启/状态
5. HTTP API
6. 网关面板基础管理台
7. frps Dashboard 配置 + 反代（新标签打开）
8. peer 手动配置
9. `test-link` / `ensure-link` / `open-service`
10. 本机 frpc 发现与导入
11. 单元测试（含 Windows 基线）

验收：

- 能在面板配置 frpc 并成功启动
- 能看到 running/error 状态
- 能配置 frps Dashboard 地址与账号，并通过网关代理打开页面
- 能对手动 peer 做连通测试
- Remote Session 可调用 `ensureLink` / `openService`
- 不启用时不影响现有网关

### Phase 2 — Remote Session 编码闭环

交付：

1. Host backend attach
2. project 列表
3. create session / dispatch prompt
4. event stream
5. approval relay
6. disconnect/resume 当前 turn

验收：

- A 连接 B（B 已开 Antigravity）
- 在 B 项目中完成一次真实改文件 + 命令执行
- A 可审批
- 会话在 B 可追踪；尽量验证 Joint 可见

### Phase 3 — Joint / UX 强化

- 强化 B 本机 UI 可见性
- A 侧控制面更贴近 Antigravity
- 更好的重连与会话列表
- 基础 takeover（可选）

### Phase 4 — 产品化增强

- 设备配对码
- 自动拉起 Antigravity
- Host 上浏览选目录
- 更多 NAT Traversal providers
- 更完整的官方 UI 内建体验

---

## 9. 测试策略

### NAT Traversal

- 配置校验（缺 token、端口冲突、非法 proxy）
- secrets 与公开配置分离
- supervisor 启停幂等
- status 状态机
- test-link 成功/失败路径
- 未启用时路由不可用或安全 no-op

### Remote Session

- protocol codec
- attach 失败（Antigravity 未打开）
- create session / resume
- approval roundtrip
- 控制权：非 controller 默认不能批
- 断线后 Host 继续当前 turn 的行为约定测试（能单测的部分）

### 手工验收

1. 两台机 frpc 通
2. B 打开 Antigravity
3. A 开启 remote，选 B 项目
4. 让 agent 修改一个文件并运行命令
5. 触发一次审批
6. A 主动断网，确认 B 当前回合继续
7. A 重连，状态可接上

---

## 10. 风险与开放问题

### 10.1 已知风险

1. **Antigravity backend 挂点不确定**  
   现有线索：`language_server`、`agentapi`、`persistent_mode`、本地 HTTP/API 端口。  
   是否足够支撑 Joint Session 仍需探测。

2. **Joint 可见性可能受 UI 订阅模型限制**  
   即使会话进了同一 backend，桌面 UI 也未必自动刷新到前台会话列表。

3. **A 侧“尽量在 Antigravity 操作”可能受官方 UI 约束**  
   第一期允许降级，但领域层不能绑死在临时 UI。

4. **frpc 与用户已有穿透配置冲突**  
   管理台需避免擅自覆盖。

### 10.2 开放问题（实现前再收敛）

1. B 本机 backend 的权威发现方式是什么？
2. project/conversation 列表的稳定 API 是什么？
3. approval 事件是否已有可订阅接口？
4. A 侧第一期具体 UI 降级选哪条？
5. frpc 二进制是复用系统安装，还是网关侧可选管理？
6. frps Dashboard 反代是否需要支持 HTTPS 自签证书与自定义 Header？
7. Dashboard 路径是固定 `/static/#/`，还是允许用户填任意 frps 版本路径？

其中 1-4 不阻塞 Phase 1；5-7 在 Phase 1 实现时按“可配置 + 合理默认”处理即可。

---

## 11. 成功标准

### 设计成功

- 双模块边界清晰：通道 ≠ 会话
- 与 Codex Remote 心智一致：Host 执行，Client 控制
- 一人两机可落地，同时保留正式产品演进路径

### Phase 1 成功

- frpc 管理台可配置、可启停、可观测
- peer 可手动录入并测通
- 为 Remote Session 提供稳定 `ensureLink` / `openService` / `testLink`
- Dashboard 反代可用；面板默认新标签打开

### Phase 2 成功

- 远程写代码闭环跑通
- 控制端主导审批
- 会话权威在 Host
- 不靠改 asar

---

## 12. 建议落地顺序（确认后执行）

1. 评审并批准本设计
2. 实现 Phase 1：NAT Traversal + frpc 管理台  **（已完成）**
3. 并行/紧随做 Antigravity backend 挂点探测笔记  **（见 `2026-08-14-antigravity-host-backend-probe.md`）**
4. 再写 Phase 2 implementation plan  **（已完成：`plans/2026-08-14-antigravity-remote-session.md`）**
5. 实现 Remote Session 编码闭环

---

## 13. 决策摘要（给评审快速扫）

- 要做正式产品能力，但第一期只服务个人两台机
- 不做 CDP 主路径，不做独立会话世界主路径
- 通道层独立成 NAT Traversal，frpc 管理台优先
- Remote Session 挂 B 已运行 Antigravity 后端
- 控制端主导，Host 继续当前回合
- 未来再嵌官方 UI、配对码、自动拉起
