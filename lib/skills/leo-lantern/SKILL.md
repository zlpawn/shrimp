---
name: leo-lantern
description: 通过 leo-lantern CLI/服务实现 Chrome 浏览器远程调试 (CDP) 控制与无头自动化，支持页面导航、元素交互、DOM 快照、网络抓包与 Cookie 提取。
---

# Leo Lantern 浏览器自动化控制

触发时机：用户需要自动化操控 Chrome 浏览器、远程点击网页元素、自动化填写表单、抓取动态渲染内容、截取网页长图或提取指定网站登录态与 Cookie。

## 工作流

1. **健康探测**：先执行 `leo-lantern health`，确认浏览器桥接插件已就绪。
2. **任务生命周期**：
   - 开启后台任务组：`leo-lantern start-task --title="browser-task"`
   - 导航或接管目标标签页：`leo-lantern goto "https://example.com"` 或 `leo-lantern claim --tabId=<tabId>`
3. **页面感知与交互**：
   - 获取交互式 DOM 树：`leo-lantern snapshot`
   - 等待元素加载：`leo-lantern wait --sel="button.submit"`
   - 填写与点击：`leo-lantern fill --sel="#input" --val="text"`，`leo-lantern click --text="确定"`
   - 读取精简内容：`leo-lantern content --max-chars=4000`
4. **任务清理**：
   - 结束任务：`leo-lantern end-task`

## 常用命令

```bash
leo-lantern health
leo-lantern tabs
leo-lantern start-task --title "my-task"
leo-lantern goto "https://example.com"
leo-lantern snapshot
leo-lantern click --text "登录"
leo-lantern fill --sel "#username" --val "admin"
leo-lantern screenshot --out page.png
leo-lantern end-task
```

> **提示（脱离网关自包含运行）**：
> - **独立 CLI 模式**：可在技能目录直接通过 Node.js 执行命令行交互：
>   `node ./scripts/cli/index.mjs <command>`
> - **独立 MCP 模式**：客户端（如 Claude Desktop / Codex）可直接将以下命令注册为 Stdio MCP 服务：
>   `node <skillDir>/scripts/mcp/index.mjs`
