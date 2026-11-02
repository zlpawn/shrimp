---
name: leo-lantern
description: 通过 leo-lantern CLI/服务实现 Chrome 浏览器远程调试 (CDP) 控制与无头自动化，支持页面导航、元素交互、DOM 快照、网络抓包与 Cookie 提取。
---

# Leo Lantern 浏览器自动化控制

触发时机：用户需要自动化操控 Chrome 浏览器、远程点击网页元素、自动化填写表单、抓取动态渲染内容、截取网页长图或提取指定网站登录态与 Cookie。

## 核心机制与架构

- **桥接服务（Bridge Server）**：监听本地端口（默认 `19527`），负责分发命令队列并接收 Chrome 扩展回传的结果。
- **Chrome 扩展（Extension）**：常驻浏览器后台，通过长轮询消费命令。在目标页面上结合 **CDP（Chrome DevTools Protocol 原生可信输入事件）** 与 DOM 树完成精准操作。
- **任务组与窗口隔离**：默认**新开独立窗口**（`sameWindow: false`）执行自动化，与用户当前正在浏览操作的窗口互不干扰。独立窗口与用户窗口共享同一 Chrome profile，所有 Cookie、LocalStorage 及登录态直接可用。

## 工作流

1. **服务启动与健康探测**：
   - **手动启动后台服务（若未启动或提示 `bridge_unavailable` / `command not found`）**：
     - 若全局命令可用：`leo-lantern server --port 19527`
     - 若 `leo-lantern` 未在系统 PATH 中，Agent 直接使用 Node 从本 Skill 目录拉起服务：
       ```bash
       # 形式 1：使用当前 Skill 目录路径（无论本 Skill 安装在何处）
       node <skillDir>/scripts/cli/index.mjs server --port 19527

       # 形式 2：若当前终端已处于本 Skill 根目录下：
       node scripts/cli/index.mjs server --port 19527
       ```
   - 检查服务与扩展在线状态：
     - `leo-lantern health`（或 `node <skillDir>/scripts/cli/index.mjs health`）
     - 若 `extensionOnline: false`，请在 Chrome 扩展管理页（`chrome://extensions`）确认已加载扩展，并保持 Chrome 处于运行状态。
2. **任务生命周期（可选，支持直接操作当前标签页）**：
   - 开启/复用任务组：`leo-lantern start-task --title="browser-task"`（默认新开独立窗口，不干扰用户浏览；若需在同窗口执行可指定 `--same-window=true`）
   - 查看所有标签页：`leo-lantern tabs`
   - 接管指定标签页：`leo-lantern claim --tabId=<tabId>`（显式接管用户已有的指定标签页，此操作会控制该页面，慎用）
   - 导航或新标签：`leo-lantern goto "https://example.com"` 或 `leo-lantern new-tab "https://example.com"`
3. **页面感知与交互**：
   - 获取高信息量交互 DOM 树（含 tag, text, selector, id, rect, visible, ref, generation 等）：`leo-lantern snapshot` 或 `leo-lantern state`
   - 精准定位状态（Ref 体系）：`leo-lantern state` 与 `leo-lantern find --text "保存"` 返回的元素均包含 `ref` 和 `generation`，支持直接复制
   - 点击元素（原生 CDP 可信物理事件，支持 text / sel / ref）：
     - `leo-lantern click --ref 10`（最简推荐）
     - `leo-lantern click --text="进入配置"`
     - `leo-lantern click --sel="button.submit"`
     - `leo-lantern click --target '{"kind":"ref","ref":10}'`（无需手动拼接 generation，缺省自动对齐当前文档）
   - 填写表单（原生 Prototype Setter，支持 React 受控组件）：`leo-lantern fill --ref 10 --val "text"` 或 `leo-lantern fill --sel "#input" --val "text"`
    - 上传文件（原生 CDP `DOM.setFileInputFiles`，绕过系统弹窗直接注入）：
      - 单文件：`leo-lantern upload "/path/to/file.png"`
      - 多文件批量：`leo-lantern upload "/path/to/file1.png" "/path/to/file2.png"`
      - 指定选择器：`leo-lantern upload --sel="input[type='file']" --files="file1.png,file2.png"`
   - 执行脚本（自动函数闭包隔离，避免 `const`/`let` 重复声明冲突，统一返回 `{ ok, evalResult, hasResult, resultType }`）：
     - `leo-lantern eval "1+1"`
     - `leo-lantern eval "const btns = document.querySelectorAll('button'); btns.length"`
   - 等待内容出现或流式文本稳定：
     - 固定文本等待：`leo-lantern wait --text="成功" --timeout-ms 5000`
     - AI/流式内容静止等待（N 毫秒无内容变化）：`leo-lantern wait --idle --idle-ms 2000`
     - 某个区域静止等待：`leo-lantern wait --sel ".chat-messages" --idle --idle-ms 2000`
   - 读取页面纯文本：`leo-lantern content --max-chars=4000`
4. **网络抓包与数据导出**：
   - 开启网络抓包：`leo-lantern net-start`
   - 查看抓包结果：`leo-lantern net-get --grep="api"`
   - 停止网络抓包：`leo-lantern net-stop`
   - 页面或元素截图：
     - 整页截图：`leo-lantern screenshot --out=page.png`
     - 元素区域截图：`leo-lantern screenshot --sel=".chat-box" --out=chat.png` 或 `leo-lantern screenshot --ref=10 --out=btn.png`
   - 导出 Cookie（凭证中继神器，直接给 curl / Python 脚本使用）：
     - Netscape 格式（curl 直接读）：`leo-lantern cookies --domain="example.com" --format=txt --out=cookies.txt`
     - JSON 格式：`leo-lantern cookies --domain="example.com" --format=json`
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

# 页面交互（React/Vue 兼容，支持 ref / text / sel）
leo-lantern click --ref 10
leo-lantern click --text "登录"
leo-lantern fill --sel "#username" --val "admin"
leo-lantern eval "1+1"
leo-lantern wait --idle --idle-ms 2000
leo-lantern screenshot --sel ".result-box" --out result.png

# 凭证中继与导出
leo-lantern cookies --domain "example.com" --format txt --out /tmp/cookie.txt

# 结束任务
leo-lantern end-task
```

## 常见排查与边界说明 (Troubleshooting)

1. **Ref 定位与 Generation 机制**：
   - `snapshot` / `state` / `find` 返回的所有元素对象中均已携带 `generation` 与 `ref`。
   - CLI 支持直接传入 `--ref <N>`（如 `leo-lantern click --ref 10`），或以 JSON 形式传入 `--target '{"kind":"ref","ref":10}'`。
   - 若省略 `generation`，系统会自动绑定当前页面上下文的活动代际；若提供了 `generation` 且页面已发生全局跳转，系统会精准识别出 `stale_ref_generation` 并阻止误操作。

2. **UI 组件库（Ant Design / Element Plus 等）交互最佳实践**：
   - **下拉选择框（Select / Cascader）**：
     Ant Design 的 `<Select>` 组件将展开事件绑定在内层的 `.ant-select-selector` 或 `input[role='combobox']` 的 `mousedown` 事件上。
     - **直接定位**：优先使用 `--sel ".ant-select-selector"` 或通过 `state` 获取的内层 `ref`。
     - **自动穿透**：`leo-lantern click` 内置对 `.ant-select` 根节点的智能穿透，自动分发到实际响应事件的 `.ant-select-selector`。
     - **手动脚本兜底**：如遇复杂定制浮层，可通过 `eval` 派发：
       ```bash
       leo-lantern eval "(() => { const el = document.querySelector('.ant-select-selector'); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); })()"
       ```

3. **模态弹窗/遮罩层拦截物理点击 (Modal Wrap Interception)**：
   - **现象**：`click` 返回成功且 `clickEvents: 1`，但弹窗未响应或未关闭。
   - **根因**：`leo-lantern click` 优先采用 CDP 原生可信物理事件（`isTrusted: true`），遵循 Chromium 的真实 Hit-Testing 机制。部分组件库（如 Ant Design 的 `Modal.confirm`）在反复快速开关或销毁时，可能会残留 `ant-modal-wrap` 遮罩层且层级覆盖了按钮，导致物理事件落在遮罩上（可通过 `eval "document.elementFromPoint(x, y)"` 验证顶层命中元素）。
   - **应对建议**：
     - 若属组件库残存遮罩异常，刷新页面或重新打开页面即可恢复；
     - 若需在遮罩覆盖下强行触发按钮处理器，可通过 `leo-lantern eval "document.querySelector('...').click()"` 绕过物理 Hit-Testing 直接派发。

4. **eval 脚本变量作用域与结果解析**：
   - `eval` 默认通过 IIFE 闭包执行脚本，因此即使连续多次使用 `const x = 1;` 声明变量，也不会污染全局命名空间，彻底规避 `Identifier '...' has already been declared` 异常。
   - 输出结构统一为 `{ ok: true, evalResult: <val|null>, hasResult: true, resultType: "...", task: {...} }`，无需编写额外解析适配代码。

5. **流式 AI 对话与动态页面等待**：
   - 针对 LLM 流式输出或长轮询接口，建议使用 `wait --idle --idle-ms 2000`，当页面文本连续 2 秒不再发生变化时自动唤醒继续执行后续步骤。

> **提示（脱离网关自包含运行）**：
> - **独立 CLI 模式**：可在技能目录直接通过 Node.js 执行命令行交互：
>   `node ./scripts/cli/index.mjs <command>`
> - **独立 MCP 模式**：客户端（如 Claude Desktop / Codex）可直接将以下命令注册为 Stdio MCP 服务：
>   `node <skillDir>/scripts/mcp/index.mjs`
