# Leo Lantern Dual Mode (MCP + CLI) 架构与实现全景设计规范

> **文档定位**：本规范是“真实 Chrome 浏览器附着与自动化控制”的完整工程蓝图。任何大模型（LLM）或工程师依据本文档中的架构图、数据契约、通信协议与边界算法，即可 100% 独立开发并复现该系统，无需依赖额外的隐性上下文。

---

## 1. 背景与核心解决痛点

### 1.1 背景
AI Agent（如 Cursor, Claude Code, Codex, Antigravity）在执行日常开发、数据采集、自动化填表、API 逆向分析时，经常需要操作用户的真实浏览器。

### 1.2 现有方案的痛点
1. **Chrome 136+ 封锁 9222 调试端口**：
   * Chrome 136+ 针对默认用户配置目录（Default Profile）拒绝了 `--remote-debugging-port=9222` 参数，导致 Playwright / Puppeteer 无法直接附着到用户日常正在使用的 Chrome 窗口。
2. **Cookie 与登录态丢失（无头/独立实例的缺陷）**：
   * 传统自动化新建的临时浏览器缺少用户的日常 Cookie、企业 SSO、VPN 认证状态及内网访问权限；
   * Chrome 127+ 引入了 App-Bound Encryption（v20 加密前缀），外部进程直接读取 `Cookies` SQLite 数据库已无法解密。
3. **Native Messaging 部署繁琐**：
   * 必须修改操作系统的注册表（Windows）或全局系统清单目录（macOS `/Library/...`），跨平台兼容性极差且难以自动化分发。

### 1.3 核心目标
* **双模式调用（Dual-Mode）**：
  * **MCP 模式**：通过标准 Stdio JSON-RPC 提供原生 Tool Call（供 Cursor / Claude Code 等直接调用）；
  * **CLI 模式**：提供免安装、开箱即用的命令行工具（`leo-lantern`），供终端用户或 Shell 脚本使用。
* **零外部依赖（Zero-Dependency）**：
  * 服务端纯使用 **Node.js 标准库**（`node:http`, `node:readline`, `node:crypto`, `node:events`），无需 `npm install` 任何重型运行时。
* **脱离网关、独立运行（Standalone & Decoupled）**：
  * 默认监听专属控制端口 **`19527`**。不启动本地网关（Shrimp Gateway）也能 100% 独立运行；若与网关共存，支持前端自动握手同步与端口降级。
* **单扩展多能（Unified Extension）**：
  * 扩展端（Manifest V3）一网打尽：DOM 点击/填表、页面快照（Token 极省）、JS 执行、CDP 无焦点后台截屏、Cookie 解密提取。

---

## 2. 整体架构拓扑与模块划分

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           调用入口层 (Caller Interfaces)                          │
├──────────────────────────────────────┬──────────────────────────────────────────┤
│             模式 A: CLI 模式          │             模式 B: MCP 模式              │
│    (终端开发者 / Shell 脚本 / CI)      │    (Cursor / Claude Code / Codex / IDE)  │
│                                      │                                          │
│     $ leo-lantern click --text "登录"        │       AI 触发 Tool Call:                 │
│     $ leo-lantern screenshot --out shot.png │       `browser_click({ text: "登录" })`    │
│                  │                   │                    │                     │
│                  ▼                   │                    ▼                     │
│          [ CLI 参数解析器 ]            │          [ MCP Stdio 协议转换器 ]         │
│          (clis/leo-lantern/index.mjs)               │          (mcps/leo-lantern/index.mjs)            │
└──────────────────┬───────────────────┴────────────────────┬─────────────────────┘
                   │                                        │
                   │ (HTTP JSON-RPC: POST /cmd)             │ (进程内直接调度 / HTTP)
                   ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      核心中枢层：本地 Bridge Server (单进程)                       │
│                     (Node.js 纯标准库 node:http, 默认端口 19527)                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│  • 异步命令队列 (Command Queue) —— 带超时控制 (TTL) 与 Promise 挂起等待               │
│  • 长轮询分发器 (Long-Polling Engine) —— /ext/poll 挂起请求并在 1ms 内推送任务       │
│  • 健康与诊断子系统 (/health, /doctor) —— 状态自检、心跳感知与联通性诊断             │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       │ HTTP 长轮询机制 (GET /ext/poll?waitMs=25000)
                                       │ 执行结果回传 (POST /ext/result)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      执行终端层：Chrome 扩展 (Manifest V3)                        │
│                   (目录: extensions/leo-cookie-txt-locally)                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  • Service Worker (`background.js`):                                            │
│      - 长轮询循环 (Long-polling Loop)                                            │
│      - chrome.alarms 定时唤醒保活（防止 MV3 Service Worker 被浏览器挂起）        │
│      - 端口自适应握手 (syncGatewayUrl)                                           │
│  • 执行能力引擎 (Execution Handlers):                                            │
│      - 标签控制：chrome.tabs (新建、切换、获取列表、关闭)                          │
│      - DOM 交互：chrome.scripting (按可见文本/选择器查找、点击、表单输入、快照)    │
│      - CDP 深度控制：chrome.debugger (后台无焦点截屏 Page.captureScreenshot)      │
│      - 凭据提取：chrome.cookies (读取真实已解密 Cookie)                           │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       ▼
                     [ 用户的真实 Chrome 浏览器实例 ]
                     (保留全部日常登录态、VPN、SSO、Cookie、已开标签)
```

---

## 3. 通信线协议与数据契约（Wire Protocol）

Bridge Server 默认监听在 `http://127.0.0.1:19527`。

### 3.1 客户端/AI 调用端点

#### (1) `GET /health`
* **用途**：极简健康检查。
* **响应示例**：
  ```json
  {
    "ok": true,
    "bridge": true,
    "port": 19527,
    "extensionOnline": true,
    "lastSeenMs": 1200
  }
  ```

#### (2) `GET /doctor`
* **用途**：完整诊断信息（端口、待处理队列数、扩展注册信息）。
* **响应示例**：
  ```json
  {
    "ok": true,
    "bridge": {
      "online": true,
      "port": 19527,
      "host": "127.0.0.1",
      "pendingCommandsCount": 0,
      "waitingPollsCount": 1
    },
    "extension": {
      "online": true,
      "info": {
        "id": "abcdefghijklmnop",
        "name": "Leo Leo Lantern",
        "version": "1.2.0",
        "capabilities": ["cookies", "tabs", "dom", "cdp"]
      },
      "lastSeenAgoMs": 850
    }
  }
  ```

#### (3) `POST /cmd`
* **用途**：向浏览器派发控制指令并同步等待执行结果。
* **请求体格式**：
  ```json
  {
    "type": "dom.click",
    "params": {
      "text": "登录",
      "selector": "#login-btn",
      "tabId": 12345
    },
    "timeoutMs": 25000
  }
  ```
* **成功响应**：
  ```json
  {
    "ok": true,
    "result": { "clicked": true, "tag": "button", "text": "登录" }
  }
  ```
* **失败响应**：
  ```json
  {
    "ok": false,
    "error": "Element not found for click (selector: #login-btn, text: 登录)"
  }
  ```

---

### 3.2 扩展长轮询与回传端点

#### (1) `POST /ext/hello`
* **用途**：扩展加载/上线时的握手注册。
* **请求体**：
  ```json
  {
    "id": "chrome-extension-id",
    "name": "Leo Leo Lantern",
    "version": "1.2.0",
    "capabilities": ["cookies", "tabs", "dom", "cdp"]
  }
  ```

#### (2) `POST /ext/heartbeat`
* **用途**：更新扩展心跳与存活时间戳 `lastSeen`。

#### (3) `GET /ext/poll?waitMs=25000`
* **用途**：扩展向 Bridge 挂起长轮询请求。
* **执行逻辑**：
  1. 若当前命令队列已有指令，**立即返回**：
     ```json
     { "ok": true, "cmd": { "id": "cmd_a1b2c3d4", "type": "dom.click", "params": { "text": "登录" } } }
     ```
  2. 若当前无指令，Bridge **保持该 HTTP 连接挂起（Hold）**；
  3. 一旦有新指令下发，Bridge **在 1ms 内立刻写入响应**；
  4. 若超过 `waitMs`（默认 25s）仍无指令，超时返回 `{ "ok": true, "cmd": null }`，扩展立即发起下一次 poll。

#### (4) `POST /ext/result`
* **用途**：扩展在浏览器中执行完毕后回传结果。
* **请求体**：
  ```json
  {
    "id": "cmd_a1b2c3d4",
    "ok": true,
    "result": { "clicked": true },
    "error": null
  }
  ```

---

## 4. MCP Tools 标准规范（Tool Definitions）

MCP Server 遵循 Model Context Protocol 标准，通过 `stdio` 暴露以下 11 个工具：

| 工具名称 | 关键输入参数（JSON Schema） | 功能描述与返回值 |
| :--- | :--- | :--- |
| **`browser_health`** | `{}` | 检查 Bridge 与扩展是否在线、当前端口等。 |
| **`browser_doctor`** | `{}` | 输出详细诊断日志与队列信息。 |
| **`browser_open_tabs`** | `{}` | 列出所有标签页：`[{ id, title, url, active, windowId }]`。 |
| **`browser_new_tab`** | `{ url?: string }` | 新开标签页并返回 `{ id, url, title }`。 |
| **`browser_goto`** | `{ url: string, tabId?: number }` *(url 必填)* | 跳转指定标签页（默认活跃标签）到目标 URL。 |
| **`browser_click`** | `{ text?: string, selector?: string, tabId?: number }` | 点击元素（按可见文本模糊匹配或 CSS 选择器精准定位）。 |
| **`browser_fill`** | `{ selector: string, value: string, tabId?: number }` *(必填)* | 聚焦并填入文本，自动触发 `input` 与 `change` 事件。 |
| **`browser_snapshot`** | `{ tabId?: number }` | 提取当前页面的可交互元素树（按钮、输入框、链接等），结构极简省 Token。 |
| **`browser_eval`** | `{ script: string, tabId?: number }` *(script 必填)* | 在页面上下文执行任意 JS 表达式，返回 `{ evalResult: any }`。 |
| **`browser_screenshot`** | `{ tabId?: number, fullPage?: boolean }` | 基于 CDP 截取页面 PNG 图像（Base64 返回），后台执行无需前台窗口抢焦点。 |
| **`browser_cookies`** | `{ domain: string }` *(domain 必填)* | 读取真实 Chrome 中指定域名下的所有 Cookie 列表。 |

---

## 5. CLI 命令行规范（`leo-lantern`）

CLI 客户端封装在 clis/leo-lantern/index.mjs（基于 clis/leo-lantern/lib/cli.mjs）：

```bash
# 1. 状态自检
leo-lantern health
leo-lantern doctor

# 2. 标签页管理
leo-lantern tabs
leo-lantern new-tab https://github.com
leo-lantern goto https://github.com/trending --tabId 1024
leo-lantern close-tab 1024

# 3. DOM 交互与填写
leo-lantern click --text "Sign In"
leo-lantern click --selector "#submit-btn"
leo-lantern fill --selector "#username" --val "my_account"

# 4. 页面提取、执行与截图
leo-lantern snapshot
leo-lantern eval "document.title"
leo-lantern screenshot --out ./page.png
leo-lantern cookies --domain github.com

# 5. 独立前台启动 Bridge 服务
leo-lantern server --port 19527
```

---

## 6. Chrome 扩展（Manifest V3）关键实现算法

### 6.1 `manifest.json` 配置
```json
{
  "manifest_version": 3,
  "name": "Leo Leo Lantern",
  "version": "1.2.0",
  "description": "Export cookies and empower AI Agents (MCP/CLI) to interact with real Chrome.",
  "permissions": [
    "cookies",
    "activeTab",
    "storage",
    "alarms",
    "scripting",
    "tabs",
    "tabGroups",
    "debugger"
  ],
  "host_permissions": ["<all_urls>"],
  "externally_connectable": {
    "matches": [
      "http://127.0.0.1:*/*",
      "http://localhost:*/*"
    ]
  },
  "background": {
    "service_worker": "background.js"
  }
}
```

### 6.2 MV3 Service Worker 保活算法
Chrome MV3 会在 Background Service Worker 空闲 30 秒后强制休眠。本方案采用双重保活机制：
1. **`chrome.alarms` 唤醒**：配置周期间隔为 0.1~0.4 分钟的 alarms，到期强制激活并触发 `claimAndExecute()`；
2. **长轮询自然保活**：由于 `fetch('/ext/poll?waitMs=25000')` 保持挂起，挂起连接的返回和下一次发起会重置浏览器的空闲计数器。

### 6.3 DOM 智能点击算法 (`dom.click`)
在 `chrome.scripting.executeScript` 注入的代码中：
```javascript
(sel, text) => {
  let el = null;
  // 1. 优先按 CSS 选择器定位
  if (sel) el = document.querySelector(sel);
  
  // 2. 若未找到，按可见文本在交互元素中模糊匹配
  if (!el && text) {
    const lower = text.toLowerCase();
    const candidates = Array.from(document.querySelectorAll(
      "button, a, input[type='button'], input[type='submit'], [role='button'], span, div, p"
    ));
    el = candidates.find(e => e.innerText && e.innerText.trim().toLowerCase().includes(lower));
  }
  
  if (!el) return { ok: false, error: `Element not found (sel: ${sel}, text: ${text})` };
  
  // 3. 自动平滑居中滚动至视口
  el.scrollIntoView({ behavior: "instant", block: "center" });
  el.click();
  return { ok: true, tag: el.tagName.toLowerCase(), text: el.innerText?.slice(0, 100) };
}
```

### 6.4 表单赋值与事件触发算法 (`dom.fill`)
现代前端框架（React / Vue / Angular）对 input 的直接赋值无法触发响应式更新。注入代码必须主动派发事件：
```javascript
(sel, val) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, error: `Input element not found: ${sel}` };
  el.focus();
  el.value = val;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, selector: sel, value: val };
}
```

### 6.5 CDP 无感后台截屏算法 (`cdp.screenshot`)
利用 `chrome.debugger` API：
```javascript
async function captureCdpScreenshot(tabId) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    const shot = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });
    return { data: shot.data, mimeType: "image/png" };
  } finally {
    await chrome.debugger.detach({ tabId });
  }
}
```
* **优势**：不需要把标签页置为当前前台激活焦点，不会抢占用户当前屏幕焦点，后台安静完成高清截图。

### 6.6 端口自适应握手算法
* **独立模式**：默认长轮询 `http://127.0.0.1:19527`；
* **网关模式**：当用户在浏览器中打开网关管理页（例如 `http://127.0.0.1:9000`）时，网关页面向扩展发送 `externally_connectable` 消息：
  ```javascript
  chrome.runtime.sendMessage(EXTENSION_ID, {
    action: "syncGatewayUrl",
    gatewayUrl: window.location.origin
  });
  ```
  扩展接收后自动存储 `gatewayUrl`，并在轮询队列中同时兼顾 19527 与网关端口，实现完全零配置自适应。

---

## 7. 目录文件结构拓扑

```text
.
├── clis/
│   └── leo-lantern/                      # 独立 CLI 子工程
│       ├── index.mjs                     # CLI 入口
│       └── lib/
│           ├── protocol.mjs
│           ├── server.mjs
│           └── cli.mjs
├── mcps/
│   └── leo-lantern/                      # 独立 MCP 子工程
│       ├── index.mjs                     # MCP 入口
│       └── lib/
│           ├── protocol.mjs
│           ├── server.mjs
│           └── mcp-server.mjs
├── extensions/
│   └── leo-cookie-txt-locally/           # Chrome 扩展源码 (Manifest V3)
│       ├── manifest.json                 # 权限配置 (debugger, scripting, tabs, cookies 等)
│       ├── background.js                 # Service Worker (保活、长轮询、DOM/CDP 执行引擎)
│       ├── popup.html / popup.js         # 扩展弹窗 UI
│       └── icons/                        # 扩展图标 (16/48/128)
├── clis/leo-lantern/tests/
│   ├── server.test.mjs
│   └── cli.test.mjs
├── mcps/leo-lantern/tests/
│   └── mcp.test.mjs
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-08-20-browser-bridge-dual-mode-design.md # 本规范文档
```

---

## 8. 测试策略与验收用例

开发完成后，可通过以下自动化测试矩阵进行全量回归：

1. **Bridge Server 核心测试** (`clis/leo-lantern/tests/server.test.mjs`):
   * `start / stop` 生命周期；
   * `/health` 与 `/doctor` 状态自检；
   * `/ext/hello` 注册与 `lastSeen` 心跳更新；
   * `dispatch()` 任务下发 -> `/ext/poll` 立即捕获 -> `/ext/result` 回传完成的完整闭环；
   * 指令超时 TTL 自动清理机制。
2. **CLI 客户端测试** (`clis/leo-lantern/tests/cli.test.mjs`):
   * 命令行参数（`--flag`, positional）解析正确性；
   * `leo-lantern health` 与 `leo-lantern doctor` 输出格式验证。
3. **MCP 服务测试** (`mcps/leo-lantern/tests/mcp.test.mjs`):
   * JSON-RPC 2.0 `initialize` 与 `ping` 响应；
   * `tools/list` 输出包含 11 个标准浏览器工具；
   * `tools/call` 调用 `browser_health` 等工具的执行回包。
4. **运行全量测试命令**：
   ```bash
   npm run check
   npm run test:leo-lantern
   ```
