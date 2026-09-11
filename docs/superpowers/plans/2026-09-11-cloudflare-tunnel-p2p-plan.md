# Cloudflare Tunnel 跨平台集成与多端对等互联实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Shrimp 网关中无缝集成跨平台 Cloudflare Tunnel（Win & Mac 双系统，支持 Quick/Token 双模式），精简 `.env` 保持模型配置单一事实来源，并实现基于 Cloudflare 域名的多端对等（P2P）增量会话同步与安全鉴权。

**Architecture:**
- **穿透层**：在 `lib/nat-traversal` 模块采用已有的 Provider 扩展体系，新增 `cloudflared.mjs` 和 `cloudflared-supervisor.mjs`。跨平台以 `npm install -g cloudflared` 为优先检测与安装引导，同时适配 macOS Homebrew 与 Windows 路径。支持 Quick Tunnel 正则动态捕获临时公网 URL，以及 Token 模式持久化运行。
- **凭据隔离**：Token 严格存放于 `nat-traversal.secrets.json`，绝不污染 `gateway.secrets.json`，同时支持 `CLOUDFLARE_TUNNEL_TOKEN` 环境变量。
- **环境精简**：清理 `.env.example`，收归模型配置至 `gateway.config.json`。
- **P2P 会话同步**：扩展 Peer 结构支持 Cloudflare 端点，实现带强制鉴权与路径穿越拦截的 `/v1/session-sync/manifest`、`file/:sessionId`、`push` 接口，采用 LWW（最后写入优先）策略。
- **Web UI**：在 Desktop Panel Catalog 视图并列呈现 FRP 与 Cloudflare 卡片，并提供专属的 Cloudflare 配置控制台与一键会话同步按钮。

**Tech Stack:** Node.js (>=18), ES Modules, child_process (spawn/detached), Node Test Runner (`node --test`), TypeScript & esbuild (Desktop UI).

## Global Constraints
- 绝不向 `gateway.secrets.json` 写入穿透或网络相关配置。
- 保证所有新文件严格遵循 ES Modules (`.mjs` 或 TypeScript)。
- 保持跨平台兼容性：所有文件路径与进程管理必须同时支持 macOS 与 Windows。
- 每一个任务遵循 TDD 流程：先写失败测试，实现后通过并提交。

---

### Task 1: 极简 `.env.example` 规范与测试保持

**Files:**
- Modify: `.env.example`
- Modify: `tests/unit/init-config.test.mjs`

**Interfaces:**
- `.env.example` 仅暴露 `PORT`、`HOST`、`GATEWAY_API_KEY` 及说明注释。

- [ ] **Step 1: 编写检查 `.env.example` 极简规范的测试**
在 `tests/unit/init-config.test.mjs` 中添加针对 `.env.example` 精简性的断言（不包含 `ARK_API_KEY`、`OFFICIAL_ANTHROPIC` 等）。

- [ ] **Step 2: 运行测试验证失败**
Run: `node --test tests/unit/init-config.test.mjs`
Expected: FAIL（因为当前 `.env.example` 仍包含大量冗余模型环境变量）。

- [ ] **Step 3: 精简修改 `.env.example`**
更新 `.env.example` 内容为极简 3 变量及指向 `gateway.config.json` 的引导注释。

- [ ] **Step 4: 运行测试验证通过**
Run: `node --test tests/unit/init-config.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交 Commit**
```bash
git add .env.example tests/unit/init-config.test.mjs
git commit -m "refactor(config): streamline .env.example to minimal runtime settings"
```

---

### Task 2: 扩展 NAT Traversal 配置模式与凭据安全存储

**Files:**
- Modify: `lib/nat-traversal/domain/config-schema.mjs`
- Modify: `lib/nat-traversal/infra/secret-store.mjs`
- Create: `tests/unit/nat-traversal-cloudflared-config.test.mjs`

**Interfaces:**
- `defaultNatTraversalConfig()` 包含 `cloudflared: { binPath: "", mode: "quick", localUrl: "http://127.0.0.1:8787", logLevel: "info", publicUrl: "" }`。
- `secretStore.load()` 返回 `{ frpc: { token: "" }, frpsDashboard: { ... }, cloudflared: { token: "" } }`，并且 `process.env.CLOUDFLARE_TUNNEL_TOKEN` 可覆盖。

- [ ] **Step 1: 编写失败测试 `nat-traversal-cloudflared-config.test.mjs`**
编写测试验证：
1. `normalizeNatTraversalConfig()` 正确解析 `cloudflared` 字段与默认值；
2. `secretStore` 正确读取、保存 `cloudflared.token`，并验证环境变量覆盖优先级；
3. 验证对旧版 `nat-traversal.secrets.json` 结构的向下兼容。

- [ ] **Step 2: 运行测试验证失败**
Run: `node --test tests/unit/nat-traversal-cloudflared-config.test.mjs`
Expected: FAIL

- [ ] **Step 3: 完善 `config-schema.mjs` 与 `secret-store.mjs`**
在 `config-schema.mjs` 中增加 `cloudflared` 的归一化与默认值，在 `secret-store.mjs` 中添加 `cloudflared` 对象处理与环境变量读取。

- [ ] **Step 4: 运行测试验证通过**
Run: `node --test tests/unit/nat-traversal-cloudflared-config.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交 Commit**
```bash
git add lib/nat-traversal/domain/config-schema.mjs lib/nat-traversal/infra/secret-store.mjs tests/unit/nat-traversal-cloudflared-config.test.mjs
git commit -m "feat(nat-traversal): add cloudflared config schema and secure token store"
```

---

### Task 3: 实现跨平台 `cloudflared-supervisor.mjs`（Win & Mac 进程与 URL 提取）

**Files:**
- Create: `lib/nat-traversal/process/cloudflared-supervisor.mjs`
- Create: `tests/unit/nat-traversal-cloudflared-supervisor.test.mjs`

**Interfaces:**
- `createCloudflaredSupervisor({ binPath, mode, token, localUrl, pidPath, logPath, logger })`
- 方法：`start()`, `stop()`, `getStatus()`, `extractQuickUrl(output)`

- [ ] **Step 1: 编写 Supervisor 核心行为单测**
编写测试验证：
1. `buildArgs({ mode, token, localUrl })` 在 Quick 模式生成 `tunnel --url ... --no-autoupdate`，Token 模式生成 `tunnel run --token ... --no-autoupdate`；
2. `extractQuickUrl()` 正则准确从包含各类 ansi/log 文本中提取 `https://[a-zA-Z0-9-]+\.trycloudflare\.com`；
3. 二进制自动检测逻辑（Windows 识别 `.exe` / `cmd`，Mac 识别 Homebrew 与 npm 全局目录）；
4. PID 文件的读写与进程状态探测。

- [ ] **Step 2: 运行测试验证失败**
Run: `node --test tests/unit/nat-traversal-cloudflared-supervisor.test.mjs`
Expected: FAIL (module not found)

- [ ] **Step 3: 实现 `lib/nat-traversal/process/cloudflared-supervisor.mjs`**
编写完整的跨平台进程守护、日志追加、URL 捕获与状态汇报逻辑。

- [ ] **Step 4: 运行测试验证通过**
Run: `node --test tests/unit/nat-traversal-cloudflared-supervisor.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交 Commit**
```bash
git add lib/nat-traversal/process/cloudflared-supervisor.mjs tests/unit/nat-traversal-cloudflared-supervisor.test.mjs
git commit -m "feat(nat-traversal): implement cross-platform cloudflared supervisor"
```

---

### Task 4: 实现 `cloudflared.mjs` Provider 并集成至 Registry

**Files:**
- Create: `lib/nat-traversal/providers/cloudflared.mjs`
- Modify: `lib/nat-traversal/providers/registry.mjs`
- Modify: `lib/nat-traversal/application/service.mjs`
- Create: `tests/unit/nat-traversal-cloudflared-provider.test.mjs`

**Interfaces:**
- `createCloudflaredProvider({ paths, logger, supervisorFactory, whichBin })`
- 符合 Provider 标准接口：`id: "cloudflared"`, `capabilities()`, `start()`, `stop()`, `status()`, `applyConfig()`。
- `service.mjs` 支持多 Provider 状态聚合查询（供 Catalog 视图展示）。

- [ ] **Step 1: 编写 Provider 接口单测**
编写测试验证 Provider 注册、启动停止调用、Token 应用、状态输出结构对齐。

- [ ] **Step 2: 运行测试验证失败**
Run: `node --test tests/unit/nat-traversal-cloudflared-provider.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 `cloudflared.mjs` 并修改 `registry.mjs` / `service.mjs`**
接入注册表，实现完整生命周期调用，并在 `service.status()` 中增加 `providers` 概览。

- [ ] **Step 4: 运行测试验证通过**
Run: `node --test tests/unit/nat-traversal-cloudflared-provider.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交 Commit**
```bash
git add lib/nat-traversal/providers/cloudflared.mjs lib/nat-traversal/providers/registry.mjs lib/nat-traversal/application/service.mjs tests/unit/nat-traversal-cloudflared-provider.test.mjs
git commit -m "feat(nat-traversal): integrate cloudflared provider into registry and service"
```

---

### Task 5: 实现安全的多端对等（P2P）会话同步协议

**Files:**
- Create: `lib/session-sync/peer-protocol.mjs`
- Modify: `server.js` (挂载 `/v1/session-sync/manifest`, `/v1/session-sync/file/:sessionId`, `/v1/session-sync/push`, `/v1/session-sync/peers/:peerId/sync`)
- Modify: `lib/remote-session/transport/peer-client.mjs` (支持携带 Auth Header)
- Create: `tests/unit/session-sync-peer-protocol.test.mjs`

**Interfaces:**
- `GET /v1/session-sync/manifest` -> `{ sessions: [...] }`（带鉴权）
- `GET /v1/session-sync/file/:sessionId` -> 会话 JSON（带鉴权、防路径穿越）
- `POST /v1/session-sync/push` -> 接收会话并执行 LWW 写入（带鉴权）
- `POST /v1/session-sync/peers/:peerId/sync` -> 本机主动对端拉取/推送并合并

- [ ] **Step 1: 编写安全与同步协议测试**
测试防路径穿越（恶意 `../../` 被拦截 400）、未携带 Token 被拦截 401、正常携带 Token 读取 manifest、以及 LWW（旧时间戳不覆盖本地新文件）。

- [ ] **Step 2: 运行测试验证失败**
Run: `node --test tests/unit/session-sync-peer-protocol.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现端点与同步器逻辑**
在 `lib/session-sync/peer-protocol.mjs` 中实现清单生成、会话读写、路径保护与 LWW 策略，并在 `server.js` 注册相应路由。

- [ ] **Step 4: 运行测试验证通过**
Run: `node --test tests/unit/session-sync-peer-protocol.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交 Commit**
```bash
git add lib/session-sync/peer-protocol.mjs server.js lib/remote-session/transport/peer-client.mjs tests/unit/session-sync-peer-protocol.test.mjs
git commit -m "feat(session-sync): implement secure P2P session sync protocol with LWW"
```

---

### Task 6: 前端 Desktop Panel 升级（Catalog 双卡片与 Cloudflare 控制台）

**Files:**
- Modify: `desktop/src/modules/nat-traversal.ts`
- Modify: `desktop/src/modules/remote-session.ts` (增加 Peer 会话同步触发按钮)

**Interfaces:**
- Catalog 页面支持在 FRP 与 Cloudflare Tunnel 之间无缝切换与并列状态展示。
- Cloudflare 详情页支持：运行控制（启动/停止/重启）、模式切换单选（Quick 临时公网 vs Token 自定义域名）、临时链接一键复制、安装命令指引（`npm install -g cloudflared`）、实时日志看板。

- [ ] **Step 1: 在 `nat-traversal.ts` 中构建 Cloudflare Catalog 卡片与 Detail 视图**
- [ ] **Step 2: 在 `remote-session.ts` 中增加对端「同步会话」操作按钮**
- [ ] **Step 3: 运行前端构建**
Run: `npm run build:panel`
Expected: 成功生成 `desktop/dist/panel.bundle.js` 与 `panel.css` 无报错。
- [ ] **Step 4: 提交 Commit**
```bash
git add desktop/src/modules/nat-traversal.ts desktop/src/modules/remote-session.ts desktop/dist/
git commit -m "feat(ui): add Cloudflare Tunnel management and P2P sync actions to panel"
```

---

### Task 7: 全系统回归验证与验收测试

**Files:**
- Create: `tests/integration/nat-traversal-cloudflared-api.test.mjs`

- [ ] **Step 1: 编写 API 级集成测试**
测试完整的 API 生命周期：GET 配置、POST 保存、切换 Provider、检查状态响应。

- [ ] **Step 2: 运行集成测试**
Run: `node --test tests/integration/nat-traversal-cloudflared-api.test.mjs`
Expected: PASS

- [ ] **Step 3: 运行全量测试套件与静态检查**
Run: `npm test && npm run check`
Expected: 全部测试通过，语法检查 0 错误。

- [ ] **Step 4: 提交 Commit**
```bash
git add tests/integration/nat-traversal-cloudflared-api.test.mjs
git commit -m "test(integration): add e2e api tests for cloudflared provider"
```
