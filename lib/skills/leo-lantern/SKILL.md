---
name: leo-lantern
description: 通过 leo-lantern CLI/服务实现 Chrome 浏览器远程调试 (CDP) 控制与无头自动化，支持页面导航、元素交互、DOM 快照、网络抓包与 Cookie 提取。
---

# Leo Lantern 浏览器自动化控制

触发时机：用户需要自动化操控 Chrome 浏览器、远程点击网页元素、自动化填写表单、抓取动态渲染内容、截取网页长图或提取指定网站登录态与 Cookie。

## 核心机制与架构

- **桥接服务（Bridge Server）**：监听本地端口（默认 `19527`），负责分发命令队列并接收 Chrome 扩展回传的结果。
- **Chrome 扩展（Extension）**：常驻浏览器后台，通过长轮询消费命令。在目标页面上结合 **CDP（Chrome DevTools Protocol 原生可信输入事件）** 与 DOM 树完成精准操作。
- **任务组隔离与同窗执行**：默认同窗（`sameWindow: true`）并自动接管当前已登录标签页，避免重复登录或反复弹窗。

## 工作流

1. **服务启动与健康探测**：
   - 检查桥接状态：`leo-lantern health`
   - 若提示 `bridge_unavailable`，请先启动服务：`leo-lantern server --port 19527`
2. **任务生命周期（可选，支持直接操作当前标签页）**：
   - 开启/复用任务组：`leo-lantern start-task --title="browser-task"`（默认接管当前激活 tab，无需重复登录）
   - 查看所有标签页：`leo-lantern tabs`
   - 接管指定标签页：`leo-lantern claim --tabId=<tabId>`
   - 导航或新标签：`leo-lantern goto "https://example.com"` 或 `leo-lantern new-tab "https://example.com"`
3. **页面感知与交互**：
   - 获取高信息量交互 DOM 树（含 tag, text, selector, id, rect, visible 等）：`leo-lantern snapshot`
   - 精准定位状态（Ref 体系）：`leo-lantern state` 与 `leo-lantern find --target '{"kind":"css","selector":"button"}'`
   - 点击元素（原生 CDP 可信事件，完美触发 React/Vue/Radix 处理器）：`leo-lantern click --text="进入配置"` 或 `leo-lantern click --sel="button.submit"`
   - 填写表单（原生 Prototype Setter，支持 React 受控组件）：`leo-lantern fill --sel="#input" --val="text"`
   - 执行脚本（CDP 原生环境，绕过 CSP，支持 Promise 与返回值）：`leo-lantern eval "1+1"` 或 `leo-lantern eval "document.title"`
   - 等待内容加载：`leo-lantern wait --text="成功" --timeout-ms 5000`
   - 读取页面纯文本：`leo-lantern content --max-chars=4000`
4. **网络抓包与数据导出**：
   - 开启网络抓包：`leo-lantern net-start`
   - 查看抓包结果：`leo-lantern net-get --grep="api"`
   - 停止网络抓包：`leo-lantern net-stop`
   - 页面截图：`leo-lantern screenshot --out=page.png`
   - 导出指定域名 Cookie：`leo-lantern cookies --domain="example.com" --format=json`
5. **任务清理**：
   - 结束任务：`leo-lantern end-task`

## 常用命令

```bash
# 启动后台服务（若未启动）
leo-lantern server --port 19527

# 健康状态探测
leo-lantern health
leo-lantern tabs

# 开始任务并直接感知当前页面
leo-lantern start-task --title "my-task"
leo-lantern snapshot

# 页面交互（React/Vue 兼容）
leo-lantern click --text "登录"
leo-lantern fill --sel "#username" --val "admin"
leo-lantern eval "1+1"
leo-lantern screenshot --out page.png

# 结束任务
leo-lantern end-task
```

> **提示（脱离网关自包含运行）**：
> - **独立 CLI 模式**：可在技能目录直接通过 Node.js 执行命令行交互：
>   `node ./scripts/cli/index.mjs <command>`
> - **独立 MCP 模式**：客户端（如 Claude Desktop / Codex）可直接将以下命令注册为 Stdio MCP 服务：
>   `node <skillDir>/scripts/mcp/index.mjs`
