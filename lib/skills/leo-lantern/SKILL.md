---
name: leo-lantern
description: 通过 leo-lantern CLI/服务实现 Chrome 浏览器远程调试 (CDP) 控制与自动化（操作用户真实的有界面 Chrome），支持页面导航、元素交互、DOM 快照、网络抓包与 Cookie 提取。
---

# Leo Lantern 浏览器自动化控制

触发时机：用户需要自动化操控 Chrome 浏览器、远程点击网页元素、自动化填写表单、抓取动态渲染内容、截取网页长图或提取指定网站登录态与 Cookie。

## 核心机制与架构

- **桥接服务（Bridge Server）**：监听本地端口（默认 `19527`），负责分发命令队列并接收 Chrome 扩展回传的结果。
- **Chrome 扩展（Extension）**：常驻浏览器后台，通过长轮询消费命令。在目标页面上结合 **CDP（Chrome DevTools Protocol 原生可信输入事件）** 与 DOM 树完成精准操作。
- **任务组与窗口隔离**：默认**新开独立窗口**（`sameWindow: false`）执行自动化，与用户当前正在浏览操作的窗口互不干扰。独立窗口与用户窗口共享同一 Chrome profile，所有 Cookie、LocalStorage 及登录态直接可用。

## 工作流

1. **服务启动与健康探测**：
   - **桥接按需启动，一般不用手动管**：操作浏览器的命令发现桥接没开，会自动在后台拉起并等扩展连上（需要 Chrome 已打开）。桥接连续 10 分钟没有收到命令就自动退出；扩展的轮询和心跳不算命令。`health`、`doctor` 只检查，不会启动桥接。
     - 主动启动并等待扩展：`leo-lantern start`（或 `node <skillDir>/scripts/cli/index.mjs start`）
     - 前台运行、调整空闲时间：`node <skillDir>/scripts/cli/index.mjs server --port 19527 --idle-exit-min 30`（`0` 表示不自动退出，也可用环境变量 `LEO_LANTERN_IDLE_EXIT_MIN`）
   - 检查服务与扩展在线状态：
     - `leo-lantern health`（或 `node <skillDir>/scripts/cli/index.mjs health`）
     - 若 `extensionOnline: false`，请在 Chrome 扩展管理页（`chrome://extensions`）确认已加载扩展，并保持 Chrome 处于运行状态。
2. **任务生命周期（可选，支持直接操作当前标签页）**：
   - 开启/复用任务组：`leo-lantern start-task --title="browser-task"`（默认新开独立窗口，不干扰用户浏览；若需在同窗口执行可指定 `--same-window=true`）
   - 查看所有标签页：`leo-lantern tabs`
   - 接管指定标签页：`leo-lantern claim --tabId=<tabId>`（显式接管用户已有的指定标签页，此操作会控制该页面，慎用；`start-task` 开的 `about:blank` 占位页若还没用过，会在接管或 `end-task` 时自动关闭）
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
     - 执行本地脚本文件（免 Windows 命令行引号与中文转义）：`leo-lantern eval --file "/path/to/script.js"`
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
     - 按 URL 读取（包含父域名上的 Cookie，需要扩展 1.3.13+）：`leo-lantern cookies --url="https://a.example.com/path" --out=cookies.json`
     - 读不到时打开网站再读（需要扩展 1.3.15+）：`leo-lantern cookies --url="https://a.example.com/" --open-if-missing --out=cookies.json`。在后台独立窗口打开，读完一定关闭，不影响正在执行的任务。如果跳到登录页或出现密码框，就以 `login_required` 报错退出，请提示用户在 Chrome 登录后重试，不要反复尝试。
5. **任务清理**：
   - 结束任务：`leo-lantern end-task`

## 常用命令

```bash
# 启动桥接并等待扩展（可省略，操作浏览器的命令会自动启动）
leo-lantern start

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

6. **Web Component 与 Shadow DOM 穿透交互**：
   - **现象**：在小红书、Shopify 或使用现代前端框架（Vue 3 `defineCustomElement` / Lit / Polymer）的页面上，部分核心按钮（如 `<xhs-publish-btn>`）在常规 DOM 查找中返回空或未匹配。
   - **根因**：元素被封装在闭包 Shadow DOM 中（`el.shadowRoot` 为 null，或存储于内部属性 `el._sr`）。
   - **穿透方案**：
     ```bash
     leo-lantern eval "(() => {
       const host = document.querySelector('custom-element-tag');
       const root = host?._sr || host?.shadowRoot || host;
       const btn = root.querySelector('button.submit');
       if (btn) btn.click();
     })()"
     ```

7. **富文本编辑框（Contenteditable）安全数据绑定**：
   - **现象**：对 `div[contenteditable="true"]` 直接使用常规表单赋值，界面虽有文字但框架（Vue/React）字数统计和发布按钮未激活。
   - **最佳实践**：使用原生 `insertText` 模拟用户输入流：
     ```bash
     leo-lantern eval "(() => {
       const el = document.querySelector('div[contenteditable=\"true\"]');
       if (el) {
         el.focus();
         document.execCommand('selectAll', false, null);
         document.execCommand('insertText', false, '要注入的文本内容');
       }
     })()"
     ```

8. **模糊文本语义匹配与侧边栏推广链接防误触 (Anti-Ad Ambiguity Guard)**：
   - **现象**：使用 `click --text="关键词"` 定位表单功能时，若页面左侧栏存在同名或近似推广/广告链接（如“花火/花生”），可能意外点击进入第三方推广页面。
   - **防范机制**：
     - 表单控件交互严禁使用全局模糊匹配，必须限定在主内容区域容器内（如 `.content-main` 或通过特异选择器定位）；
     - 自动化脚本中若发现新开无关外部域名标签页，应通过 `leo-lantern close-tab <tabId>` 及时关闭，并通过 `claim --tabId=<原tabId>` 恢复主工作流。

9. **选择器歧义（`selector_ambiguous`）与高特异性选择器**：
   - **现象**：大型创作者平台后台（如 B 站、抖音）多个输入框可能复用相同的底层类名（如 `input.semi-input`），导致 CLI 提示 `N matches for css target`。
   - **对策**：改用携带属性语义的高特异性选择器，如 `input[placeholder*='标题']`、`input[placeholder*='标签']`，或结合父级节点层级缩小范围。

10. **标签组件（Tag Input）与键盘 Enter 键模拟**：
    - **现象**：向标签输入框填入文本后，页面未生成胶囊标签标签。
    - **对策**：许多现代组件库要求在 `input` 事件后触发 `Enter` 按键，使用 `leo-lantern press Enter --sel="input[placeholder*='标签']"`。`press` 派发的是带 `key/code/keyCode` 的脚本键盘事件（`isTrusted: false`），不是物理按键；只接受可信事件的组件和浏览器默认行为（如回车提交表单）不会响应。

11. **自定义日历与分时联动控件交互 (Cascading Date/Time Picker)**：
    - **机制**：平台定时发布面板并非标准 HTML5 日期控件，而是包含时区、日历表格、时/分双列滚动的复合控件。例如新版 B 站创作者中心将时间滚轮拆分为双列 `ul`（`uls[0]` 为 00~23 小时，`uls[1]` 为 00~55 分钟）。
    - **操作时序**：点击日期外层触发器展开日历 $\rightarrow$ 过滤纯数字文本节点并点击目标日 $\rightarrow$ 点击时间外层触发器 $\rightarrow$ 针对双列滚轮分别点选对应小时与分钟 $\rightarrow$ 再次点击触发器收起面板 $\rightarrow$ 校验显示文本。

12. **B 站创作者平台 SPA 表单异步抽帧、封面槽位与 Toast 拦截自愈机制 (Bilibili Async Upload Guard)**：
    - **现象 1（上传检测假死）**：依赖 `content` 匹配纯文本易受 SPA 外层公告导航遮蔽或字符截断导致长轮询超时。
    - **对策 1**：优先使用 DOM 探针校验核心输入框（`input[placeholder*="标题"]`、`.submit-add`）或 `body.innerText` 是否已出现表单特征，实现秒级就绪感知。
    - **现象 2（封面未显式选中被静默拦截）**：B 站视频抽帧完成后，卡片列表第 0 项为“AI 生成”按钮，后续才是候选抽帧。若仅使用合成事件派发或误点首项，封面槽位保持 `.cover-empty`，点击提交时将被 Toast 拦截：`Σ( ° △ °|||) 请先上传封面`。
    - **对策 2**：精准过滤并抓取 `.img-item-box.img-item-cover` 执行原生物理 `.click()`，并在提交前显式断言 `.cover-slot .cover-img` 存在，确保封面装载。
    - **现象 3（提交后置确认缺失）**：B 站提交后并不会立即重定向，而是弹出轻量 Toast（如时间不可用、封面缺失）或原地切换为“稿件投递成功”。
    - **对策 3**：点击提交后必须捕获页面全局 Toast / 警告弹窗（`.bcc-message`, `.toast`, `.bcc-dialog`），若有拦截错误立即中止并抛出明细；确认命中“稿件投递成功”或“查看进度”才认定投递完毕。

## 平台自动化配方 (Recipes)

针对高频复杂业务场景，技能内置了开箱即用的自动化发布 Recipe 脚本，解决各平台表单结构复杂、风控拦截和组件特殊交互问题。

### 1. 哔哩哔哩视频自动化投稿 (`recipes/bilibili-publish.mjs`)

集成视频 CDP 极速批量上传（绕过系统文件弹窗）、标题 80 字符校验、简介 2000 字符限制校验、视频系统推荐高光封面帧定位选取（支持 `--cover-index`）、AIGC 平台合规声明（`含AI生成内容`）、标签批量注入与 Enter 确认、定时发布日历与时分自动选择（黄金时段 15:00~17:00）。**默认直接发布**；传入 `--dry-run` 才会停在提交前并截取表单核对图。

#### 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 平台约束与功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--video` | `-v` | string | **是** | - | 本地视频文件路径（支持 `.mp4`, `.mov`, `.mkv` 等主流格式）。自动校验文件是否存在。 |
| `--title` | `-t` | string | **是** | - | 稿件标题。**严格限制 $\le 80$ 字符**，超长自动拦截并报错。 |
| `--desc` | `-d` | string | 否 | `""` | 稿件简介文案。**严格限制 $\le 2000$ 字符**。支持多行或极简单句，自动格式化注入 Quill 编辑器。 |
| `--desc-file`| `-f` | string | 否 | `""` | 从外部文本/Markdown 文件读取简介（与 `--desc` 二选一）。 |
| `--tags` | - | string | 否 | `[]` | 标签列表，以英文逗号 `,` 分割。每个标签 $\le 20$ 字，总数 $\le 10$ 个。自动模拟回车完成标签创建。 |
| `--cover-index`| - | number | 否 | `1` | 自动选取视频系统推荐高光帧序号（从 1 开始，默认使用第 1 帧推荐封面）。 |
| `--cover` | - | string | 否 | `""` | 本地自定义封面图片路径（jpg/png）。若提供则优先上传自定义封面，忽略 `--cover-index`。 |
| `--no-ai` | - | boolean | 否 | `false` | 关闭默认的平台 AI 声明。默认会自动在“创作声明”中勾选「含AI生成内容」（同时保持「自制」属性）。 |
| `--schedule` | `-s` | string | 否 | `""` | 定时发布时间，格式为 `YYYY-MM-DD HH:MM`（例如 `"2026-11-05 16:30"`）。平台要求距离当前 $\ge 5$ 分钟且 $\le 15$ 天。留空则为立即发布模式。 |
| `--dry-run` | - | boolean | 否 | `false` | 预览模式。完成上传、所有表单字段填妥、封面选中并联动日历后，**停留在最终提交前**，截取核对截图供人工复核。不传时会直接点击「立即投稿」。 |
| `--upload-timeout-sec` | - | number | 否 | `1800` | 等待视频上传完成的最长秒数。超时未确认完成则中止，不会继续提交。 |
| `--out` | - | string | 否 | `bilibili_publish_review.png` | 流程结束后的核对/存证截图落盘路径。 |

> **无硬编码说明**：脚本内部**无任何写死/固定的业务参数**（无写死视频名、无写死标题、无写死标签与发布时间），所有内容均由调用方通过参数传入，具有 100% 的通用性与平台独立性。

#### 调用示例

```bash
# 1. 直接发布（默认行为，不传 --schedule 时立即发布）：
node <skillDir>/recipes/bilibili-publish.mjs \
  --video "<视频文件路径，如 path/to/your_video.mp4>" \
  --title "<视频标题，不超过80字>" \
  --desc "<视频简介文案，不超过2000字>" \
  --tags "<标签1,标签2,标签3>" \
  --cover-index 1 \
  --schedule "<YYYY-MM-DD HH:MM，留空为立即发布>"

# 2. 只预览（填妥所有选项，停在提交前并保存核对截图）：
node <skillDir>/recipes/bilibili-publish.mjs \
  --video "<视频文件路径>" \
  --title "<视频标题>" \
  --desc "<视频简介>" \
  --tags "<标签1,标签2>" \
  --dry-run
```

---

### 2. 小红书创作者平台一键发布 (`recipes/xhs-publish.mjs`)

集成了标题 20 字截断安全校验、正文 1000 字符限制校验与 Markdown 脱壳、CDP 原生多图批量上传、黄金时段（15:00~17:00）定时发布配置、Shadow DOM 穿透提交以及后台结果截图存档。

#### 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 平台约束与功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--images` | `-i` | string | **是** | - | 图片列表（以英文逗号分隔），支持 1~18 张图片。自动检查文件存在性。 |
| `--title` | `-t` | string | **是** | - | 笔记标题。**严格限制 $\le 20$ 字符**，超出自动拦截报错。 |
| `--content` | `-c` | string | 否 | `""` | 笔记正文。**严格限制 $\le 1000$ 字符**，支持自动 Markdown 标记脱壳清洗。 |
| `--content-file`| `-f` | string | 否 | `""` | 从 Markdown 文件提取正文（优先匹配 `## 正文可复制版` 区块）。 |
| `--schedule` | `-s` | string | 否 | `""` | 定时发布时间，格式为 `YYYY-MM-DD HH:MM`（支持 15:00~17:00 黄金时段）。 |
| `--dry-run` | - | boolean | 否 | `false` | 安全预览模式，填完表单停留在提交前并截取表单。 |
| `--out` | - | string | 否 | `xhs_publish_result.png` | 存证截图落盘路径。 |

#### 调用示例

```bash
node <skillDir>/recipes/xhs-publish.mjs \
  --title "别再用Chrome了！实测Zig极速AI浏览器" \
  --content-file "./内容.md" \
  --images "01.png,02.png,03.png" \
  --schedule "2026-11-03 16:00" \
  --out "publish_proof.png"
```

---

### 3. 抖音创作者服务平台自动化发布 (`recipes/douyin-publish.mjs`)

原生支持**视频投稿**与**多图图文**双模自动发布。集成作品标题与描述限制校验、CDP 极速文件上传、遗留未发布草稿自动清理、Bytedance EditorKit 富文本与话题标签注入、自定义封面上传裁剪弹层联动、平台「内容由AI生成」自主声明、定时发布（2小时~14天）、全页高保真预览核对图（Full-Page Screenshot）。**默认直接发布**；传入 `--dry-run` 才会停在提交前。

#### 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 平台约束与功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--video` | `-v` | string | 条件必填 | - | 本地视频文件路径（.mp4/.mov等）。与 `--images` 二选一，提供时走**视频发布**流程。 |
| `--images` | `-i` | string | 条件必填 | - | 本地图片列表（以英文逗号分隔），支持 1~35 张图片。提供时走**图文发布**流程。 |
| `--title` | `-t` | string | **是** | - | 作品标题。**视频严格限制 $\le 30$ 字，图文限制 $\le 20$ 字**。**建议精练短小（如《请慢用》）**，因抖音移动端信息流中标题与描述紧密相连，过长会导致第一行折叠并影响视觉。 |
| `--desc` | `-d` | string | 否 | `""` | 作品描述文案。**完全可选（可不写/留空）**。**严格限制 $\le 1000$ 字符**。不写时直接清空富文本，保持纯标题极简发布。 |
| `--desc-file`| `-f` | string | 否 | `""` | 从外部文本/Markdown 文件读取描述（与 `--desc` 二选一）。 |
| `--tags` | - | string | 否 | `[]` | 话题标签列表（如 `AI工具,效率`），自动格式化为 `#话题` 规范追加至正文末尾。 |
| `--cover` | - | string | 否 | `""` | 自定义封面图片路径。提供时自动穿透视频封面裁剪弹窗上传，并跳过横屏补充提示。 |
| `--no-ai` | - | boolean | 否 | `false` | 关闭默认的平台 AI 声明。默认会自动在「自主声明」中规范勾选「内容由AI生成」。 |
| `--visibility` | - | string | 否 | `"公开"` | 谁可以看：`公开` / `好友可见` / `仅自己可见`。 |
| `--schedule` | `-s` | string | 否 | `""` | 定时发布时间，格式为 `YYYY-MM-DD HH:MM`。平台要求在当前时间 **2 小时后至 14 天内**。 |
| `--dry-run` | - | boolean | 否 | `false` | 预览模式。完成上传、所有表单字段填妥并渲染手机预览后，**停留在最终提交前**，截取高清全页核对图供人工复核。不传时会直接点击「发布」。 |
| `--reuse-form` | - | boolean | 否 | `false` | 沿用已打开的同体裁编辑页，**不上传** `--video`/`--images`，只重新填写字段。用于失败后续跑；不传时总是重新上传。 |
| `--out` | - | string | 否 | `douyin_publish_review.png` | 流程结束后的全页核对/存证截图落盘路径。 |

#### 调用示例

```bash
# 1. 视频直接发布（默认行为）：
node <skillDir>/recipes/douyin-publish.mjs \
  --video "path/to/video.mp4" \
  --title "视频标题（30字内）" \
  --desc "视频简介文案" \
  --tags "AI视频,效率工具" \
  --schedule "2026-11-06 15:30"

# 2. 只预览（填妥所有选项，截取全页预览图，不提交）：
node <skillDir>/recipes/douyin-publish.mjs \
  --video "path/to/video.mp4" \
  --title "视频标题" \
  --desc "视频简介文案" \
  --tags "AI视频,效率工具" \
  --dry-run

# 3. 多图图文发布：
node <skillDir>/recipes/douyin-publish.mjs \
  --images "img1.png,img2.png" \
  --title "图文标题（20字内）" \
  --desc "图文正文描述" \
  --tags "摄影,胶片感" \
  --schedule "2026-11-06 17:00"
```

---

### 4. X (Twitter) 前沿情报与事实素材探针 (`recipes/x-source.mjs`)

基于用户真实 Chrome 登录态，无感突破 X 官方 API 高额费用与反爬风控壁垒。严格恪守 **100% 事实保真（Ground Truth）** 原则，将原推文正文、作者认证、精确发布时间戳、互动量面板（回复/转帖/点赞/书签/浏览量）与多媒体资产（图片与视频）完整下载至本地，供下游 `leo-xhs-router` 或 `leo-video-router` 进行二次创作。

#### 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | `following` | 采集模式：`following`（关注流）、`search`（全网搜索）、`user`（用户主页）、`for-you`（推荐流）。 |
| `--query` | `-q` | string | 条件必填 | `""` | 搜索关键词或高级检索式（`mode` 为 `search` 时必填，如 `"AI agent" min_faves:50`）。 |
| `--user` | `-u` | string | 条件必填 | `""` | 目标账号 Handle（`mode` 为 `user` 时必填，如 `karpathy` 或 `@sama`）。 |
| `--type` | `-t` | string | 否 | `top` | 搜索类型：`top`（热门最高赞）或 `latest`（最新发布）。 |
| `--limit` | `-n` | number | 否 | `10` | 抓取推文数量上限。 |
| `--out` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/x-source-config.json` 供后续默认复用。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |
| `--skip-media` | - | flag | 否 | `false` | 跳过多媒体下载，仅抓取纯事实文本与指标。 |
| `--scroll-max`| - | number | 否 | `15` | 最大向下滚动探针次数。 |

#### 多媒体下载引擎机制
- **高清原图**：优先直取 `pbs.twimg.com` 升级为 `name=orig` 无损原图；若遇复杂多图卡片或网络阻塞，自动无缝回退至 `gallery-dl`（携带从 Chrome 导出的登录 Cookie）执行全量采集。
- **高清视频**：检测到推文含视频时，自动联动 `yt-dlp` 提取最高码率视频流并落盘至本地 `media/`。

#### 标准交付产物结构
每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<slug>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据，直接投喂给下游 Router（`leo-xhs-router` / `leo-video-router`）。
- `📄 帖子事实.md`：图文并茂、排版精美的人类与 Agent 双用存证档案。
- `📁 media/`：本地全量原图与视频资产库。

#### 调用示例

```bash
# 1. 抓取关注圈最新动态（默认模式）：
node <skillDir>/recipes/x-source.mjs --mode following --limit 10

# 2. 全网关键词热点搜索并下载素材：
node <skillDir>/recipes/x-source.mjs --mode search --query "coding agent" --limit 5

# 3. 定向提取某个大佬主页最新推文：
node <skillDir>/recipes/x-source.mjs --mode user --user karpathy --limit 5

# 4. 指定并记忆输出工作区目录：
node <skillDir>/recipes/x-source.mjs --out "D:\素材\X"
```

---

### 5. LINUX DO 前沿快讯与社区硬核技术事实探针 (`recipes/linuxdo-source.mjs`)

基于用户真实 Chrome 登录态，无缝突破 LINUX DO 的 Cloudflare 5秒盾与论坛信任等级权限拦截。深度结合 Discourse 原生客户端数据流与 DOM 探针，提取 **100% 原始楼主 Markdown（含代码块、公式与表格）**、精确互动指标（阅读/点赞/回复）以及社区高赞解决方案楼层，并将贴内插图完整下载到本地。

#### 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--channel` | `-c` | string | 否 | `news` | 抓取板块：`news`（前沿快讯）、`hot`（热门话题）、`top`（全站精华/高赞）、`latest`（最新发布）。 |
| `--query` | `-q` | string | 条件必填 | `""` | 站内搜索检索词（提供时自动走站内搜索流）。 |
| `--limit` | `-n` | number | 否 | `5` | 抓取帖子数量上限。 |
| `--out` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/linuxdo-source-config.json` 供后续复用。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |
| `--skip-media` | - | flag | 否 | `false` | 跳过插图下载，仅抓取纯事实文本与指标。 |

#### 标准交付产物结构
每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<channel_or_query>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据，直接投喂给下游 Router（`leo-xhs-router` / `leo-video-router`）。
- `📄 帖子事实.md`：图文并茂、结构规整的人类与 Agent 双用存证档案（包含楼主原文与高赞解答）。
- `📁 media/`：本地全量原图资产库。

#### 调用示例

```bash
# 1. 抓取前沿快讯板块（默认模式，最适合科技/自媒体前沿资讯）：
node <skillDir>/recipes/linuxdo-source.mjs --channel news --limit 5

# 2. 抓取全站高赞精华帖（最适合挖掘高价值开源神器与避坑干货）：
node <skillDir>/recipes/linuxdo-source.mjs --channel top --limit 5

# 3. 站内关键词搜索：
node <skillDir>/recipes/linuxdo-source.mjs --query "Claude Code" --limit 5

# 4. 指定并记忆输出工作区目录：
node <skillDir>/recipes/linuxdo-source.mjs --out "D:\素材\linuxdo"
```


---

### 6. Instagram 前沿情报与视觉创作素材探针 (`recipes/instagram-source.mjs`)

基于用户真实 Chrome 登录态，无感突破 Instagram 严苛的登录墙与反爬限制。严格遵循 **100% 事实保真（Ground Truth）** 原则，完整提取原贴 Caption（自动展开更多文案）、博主信息、发帖时间、互动数据、Hashtags，并将多图轮播（Carousel）高清原图与短视频（Reels）原视频下载到本地，为下游 `leo-xhs-router`（小红书图文）或 `leo-video-router`（二创短视频）提供一手高保真事实物料。

#### 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | `feed` | 采集模式：`feed`（主页关注/推荐流）、`user`（博主主页）、`tag`（标签探索）、`explore`（探索页）、`post`（单帖深度解析）。 |
| `--user`, `--username` | `-u` | string | 条件必填 | `""` | 目标博主用户名（`mode` 为 `user` 时必填，如 `openai`）。 |
| `--tag` | `-t` | string | 条件必填 | `""` | 目标 Hashtag 名称（`mode` 为 `tag` 时必填，如 `generativeai`）。 |
| `--url` | - | string | 条件必填 | `""` | 目标帖子或 Reels 链接（`mode` 为 `post` 时必填）。 |
| `--limit` | `-n` | number | 否 | `5` | 抓取帖子数量上限。 |
| `--out`, `--out-dir` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/instagram-source-config.json` 供后续复用。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |
| `--skip-media`, `--no-media` | - | flag | 否 | `false` | 跳过媒体下载，仅抓取纯事实文本与指标。 |

#### 多媒体下载引擎机制
- **多图轮播（Carousel）与单图**：结合从 Chrome 导出的登录 Cookie，使用 `gallery-dl` 提取全部最高分辨率 CDN 原图；遇到网络异常时自动使用浏览器原生高保真 Fetch 兜底。
- **Reels / 短视频**：自动提取高码率无水印 mp4 视频流（支持 `gallery-dl` 与 `yt-dlp` 双重容灾引擎）并完整落盘至本地 `media/`。

#### 标准交付产物结构
每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<target>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据，直接投喂给下游 Router。
- `📄 帖子事实.md`：图文并茂、结构规整的人类与 Agent 双用存证档案。
- `📁 media/`：本地全量原图（单图/多图）与视频资产库。

#### 调用示例

```bash
# 1. 抓取主页关注/推荐信息流最新 3 篇（默认模式）：
node <skillDir>/recipes/instagram-source.mjs --mode feed --limit 3

# 2. 定向提取某个博主主页的最新帖子：
node <skillDir>/recipes/instagram-source.mjs --mode user --username openai --limit 5

# 3. 话题标签探索流抓取：
node <skillDir>/recipes/instagram-source.mjs --mode tag --tag robotics --limit 5

# 4. 深度解析单篇帖子并下载全部轮播原图或短视频：
node <skillDir>/recipes/instagram-source.mjs --mode post --url "https://www.instagram.com/p/DeHeOpaTKQS/"

# 5. 指定并记忆输出工作区目录：
node <skillDir>/recipes/instagram-source.mjs --out "D:\素材\Instagram"
```


---

### 7. Reddit 前沿情报与深度社区讨论事实探针 (`recipes/reddit-source.mjs`)

基于用户真实 Chrome 登录态，无感突破 Reddit 严格的客户端风控与反爬防护。严格遵循 **100% 事实保真（Ground Truth）** 原则，完整提取原帖标题、楼主完整 Markdown（含代码块、排版与外链）、发帖 Subreddit、发布作者、精确点赞/评论数、**社区精选高赞回复（Top Comments）**，并将插图（单图/多图 Gallery）及原画视频（v.redd.it）完整下载到本地，为下游 `leo-xhs-router`（海外科技热点转小红书）或 `leo-video-router`（二创短视频）提供极具讨论深度的一手事实物料。

#### 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | `feed` | 采集模式：`feed`（首页推荐流）、`sub`（指定社区板块）、`search`（站内关键词搜索）、`post`（单帖深度解析）。 |
| `--sub`, `--subreddit` | `-s` | string | 条件必填 | `""` | 目标 Subreddit 板块名（`mode` 为 `sub` 时必填，如 `ClaudeAI`, `technology`, `stocks`）。 |
| `--sort` | - | string | 否 | `hot` | 板块排序规则：`hot`（热门）、`top`（全板块最高赞）、`new`（最新）。 |
| `--query` | `-q` | string | 条件必填 | `""` | 搜索关键词（`mode` 为 `search` 时必填）。 |
| `--url` | - | string | 条件必填 | `""` | 目标 Reddit 帖子链接（`mode` 为 `post` 时必填）。 |
| `--limit` | `-n` | number | 否 | `5` | 抓取帖子数量上限。 |
| `--out`, `--out-dir` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/reddit-source-config.json` 供后续复用。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |
| `--skip-media`, `--no-media` | - | flag | 否 | `false` | 跳过媒体下载，仅抓取纯正文与高赞评论。 |

#### 多媒体下载与深度社区讨论提炼
- **多图相册与高清原图**：自动识别 `i.redd.it` / `preview.redd.it` 高清原图直链并发下载到本地 `media/`。
- **Reddit 原画视频**：检测到 Reddit 独立视频帖（v.redd.it）时，联动 `yt-dlp` 高速拉取原始视频与音轨合并封装。
- **社区高赞神评**：自动深入详情页提取真实点赞排名前列的深度回复与观点，完美补全帖子争议点与社区共识。

#### 标准交付产物结构
每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<target>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据（含标题、楼主 Markdown、多媒体路径、社区高赞回复列表）。
- `📄 帖子事实.md`：图文并茂、社区回复层次分明的人类与 Agent 双用存证档案。
- `📁 media/`：本地全量原图与视频资产库。

#### 调用示例

```bash
# 1. 抓取当前首页流最新 3 篇（默认模式）：
node <skillDir>/recipes/reddit-source.mjs --mode feed --limit 3

# 2. 定向抓取 r/ClaudeAI 社区热门帖子与高赞讨论：
node <skillDir>/recipes/reddit-source.mjs --mode sub --sub ClaudeAI --limit 5

# 3. 站内关键词搜索：
node <skillDir>/recipes/reddit-source.mjs --mode search --query "Cursor vs Windsurf" --limit 5

# 4. 深度解析单篇帖子与社区高赞神评：
node <skillDir>/recipes/reddit-source.mjs --mode post --url "https://www.reddit.com/r/ClaudeAI/comments/1xrevbv/claude_saved_my_old_iphone_from_becoming_ewaste/"

# 5. 指定并记忆输出工作区目录：
node <skillDir>/recipes/reddit-source.mjs --out "D:\素材\Reddit"
```

> **提示（脱离网关自包含运行）**：
> - **独立 CLI 模式**：可在技能目录直接通过 Node.js 执行命令行交互：
>   `node ./scripts/cli/index.mjs <command>`
> - **发布 Recipe 的退出码**：任一步骤失败都以非零退出并中止，不会继续提交；`🎉` 只在确认发布成功时出现。B 站和小红书无法确认平台是否受理，点击后只提示“已点击”，须查看截图或平台管理页核对。
