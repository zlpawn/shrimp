# Antigravity Host Backend Probe Results

**日期：** 2026-08-15  
**机器：** 当前 Windows Host  
**方式：** 只读探测  
**约束：** 不启动/重启 gateway，不打开/关闭 Codex 桌面，不改 asar，不 kill 进程

关联：

- 设计：`docs/superpowers/specs/2026-08-14-antigravity-remote-session-design.md`
- 清单：`docs/superpowers/specs/2026-08-14-antigravity-host-backend-probe.md`
- 原始 JSON：
  - `docs/superpowers/specs/2026-08-15-antigravity-host-backend-probe-result.json`
  - `docs/superpowers/specs/2026-08-15-antigravity-host-backend-probe-result.deep.json`

---

## 1. Executive result

| Capability | Status | Evidence |
| --- | --- | --- |
| process presence | **YES** | 多个 `Antigravity.exe` + `language_server.exe` 在跑 |
| install root discovery | **YES** | `C:\Users\xtea\AppData\Local\Programs\Antigravity` |
| language_server binary | **YES** | `...\resources\bin\language_server.exe` |
| local control port discovery | **PARTIAL** | 动态 HTTPS 本地口：当前 `https://127.0.0.1:9608/`；CDP：`127.0.0.1:9607` |
| project list API | **PARTIAL (filesystem)** | `C:\Users\xtea\.gemini\config\projects\*.json` 可读 |
| conversation store | **PARTIAL (filesystem)** | `C:\Users\xtea\.gemini\antigravity\conversations\*.db` 存在 |
| conversation create API | **NO** | 未找到稳定 HTTP/gRPC 创建接口 |
| event subscribe API | **NO** | 未找到可订阅事件流接口 |
| approval decide API | **NO** | 未找到审批接口 |
| joint UI visibility hook | **UNKNOWN / blocked** | 无已确认的“创建后让桌面 UI 立即看见”的官方挂点 |

**结论：**

1. Host 上 Antigravity **已经在运行**，可被探测。
2. 本地 backend 不是固定端口，而是 `language_server --https_server_port 0` 动态分配。
3. 当前动态口 `https://127.0.0.1:9608/` 对 `/` `/health` `/api/health` 等返回的是 **SPA HTML**，不是干净 REST JSON API。
4. 项目列表可先通过磁盘 store 做只读枚举。
5. 真正的 Remote Session 编码闭环（create conversation / dispatch prompt / approvals / joint visibility）**还不能宣称可用**。
6. 因此 Phase 2 当前应继续以：
   - **fake host 闭环** 为可交付主路径
   - **filesystem project list** 为 partial 增强
   - **真实 attach** 作为下一阶段 reverse-engineering 任务

推荐第一切片模式：

> `local-host partial`

---

## 2. Measured facts

### 2.1 Install / process

- Install root:
  - `C:\Users\xtea\AppData\Local\Programs\Antigravity`
- Binaries:
  - `Antigravity.exe`
  - `resources\bin\language_server.exe`
  - `resources\app.asar`（只记录存在，不修改）
- Running:
  - 多个 `Antigravity.exe`
  - 1 个 `language_server.exe`

### 2.2 Local endpoints

从 `main.log` 可见启动方式：

```text
language_server.exe ... --https_server_port 0 --csrf_token <uuid> ...
Local: https://127.0.0.1:<dynamic-port>/
```

本次实测：

- 最新 Local URL：`https://127.0.0.1:9608/`
- CDP / DevTools：
  - `DevToolsActivePort` => `9607`
  - `http://127.0.0.1:9607/json/version` 200
  - `http://127.0.0.1:9607/json/list` 200
- `https://127.0.0.1:9608/` 200，但 body 是 Antigravity SPA HTML
- 历史日志里出现过 `6045`，只是某次动态分配结果，**不是稳定契约**

### 2.3 Auth surface

- spawn 参数含 `--csrf_token ...`
- SPA 注入：

```js
window.__APP_CONFIG__ = {
  productName: "antigravity",
  csrfToken: "...",
  appVersion: "2.8.1",
  devMode: false
}
```

- 带/不带 CSRF header 访问 `/health` 等路径，目前都返回 HTML 壳，不能据此认定已有公开 API

### 2.4 Project / conversation storage

项目：

- 目录：`C:\Users\xtea\.gemini\config\projects\`
- 样例：

```json
{
  "id": "59df0025-4f03-4edc-b9e4-4d29007b299d",
  "name": "nightmare",
  "projectResources": {
    "resources": [
      {
        "gitFolder": {
          "folderUri": "file:///d%3A%5CJava%20Project%5CAI%5Cbg%5Cnightmare",
          "defaultBranch": "master"
        }
      }
    ]
  }
}
```

会话：

- 目录：`C:\Users\xtea\.gemini\antigravity\conversations\`
- 形态：大量 `*.db`（SQLite 风格本地库）
- 说明：可离线观察历史会话，但直接写库不能保证 Joint UI / 权限 / 审批一致性

### 2.5 Official remote control clue

`language_server.log` 出现：

```text
[RemoteControl] RemoteControlEnabled value: false
[RemoteControl] Resolved proxyServerURL: ""
```

这进一步说明：当前安装上官方 Remote Control 并未启用；不能假设已有现成 remote session 产品开关可直接复用。

---

## 3. Decision for implementation

### Keep as-is

- Phase 2 fake/local API loop：继续作为主可交付
- NAT Traversal / panel / peer path：不变
- 不改 asar
- 不把 CDP 作为主执行路径

### Safe next enhancements (recommended order)

1. **Filesystem project enumerator**
   - 从 `~/.gemini/config/projects/*.json` 列出 Host 项目
   - 仅用于 `listProjects` partial 实现
2. **Dynamic local endpoint discovery**
   - 解析 `main.log` / 启动参数 / 监听端口
   - 记录 `https://127.0.0.1:<port>/` + csrf token
3. **API reverse-engineering spike**
   - 在确认不修改 asar 的前提下，抓 SPA 实际 XHR/fetch
   - 目标：project list / conversation create / prompt / events / approvals
4. **Only then** 把 `createLocalHostBackend` 从 `host_backend_unsupported` 升级为真实 attach

### Explicit non-goals now

- 直接写 `conversations/*.db` 冒充 Joint Session
- 用 CDP 点 UI 作为主路径
- 修改 `app.asar`
- 宣称真实远程写代码闭环已完成

---

## 4. Updated support matrix

| Method | Current support |
| --- | --- |
| `isRunning()` | YES（进程探测） |
| `attach()` | PARTIAL（可发现 endpoint，但无确认控制 API） |
| `listProjects()` | PARTIAL via filesystem |
| `createConversation()` | NO |
| `dispatchPrompt()` | NO |
| `subscribeEvents()` | NO |
| `decideApproval()` | NO |
| `getConversation()` | PARTIAL via local db research only |

---

## 5. Next action

优先做：

> **local-host partial: filesystem project list + dynamic endpoint discovery notes**

这能在不碰 Codex 桌面、不改 asar 的前提下，把 Host 探测从“知道进程在跑”推进到“能列真实项目”。
