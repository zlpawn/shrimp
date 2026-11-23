---
name: leo-lantern
description: 通过 leo-lantern CLI/服务实现 Chrome 浏览器远程调试 (CDP) 控制与自动化（操作用户真实的有界面 Chrome），支持页面导航、元素交互、DOM 快照、网络抓包与 Cookie 提取。
---

# Leo Lantern 浏览器自动化控制

触发时机：用户需要自动化操控 Chrome 浏览器、远程点击网页元素、自动化填写表单、抓取动态渲染内容、截取网页长图或提取指定网站登录态与 Cookie。

## 核心机制与架构

- **桥接服务（Bridge Server）**：监听本地端口（默认 `19526`，扩展同时支持 `19526` 与 `19527` 双端口兼听保底），负责分发命令队列并接收 Chrome 扩展回传的结果。
- **Chrome 扩展（Extension）**：常驻浏览器后台，通过长轮询消费命令。在目标页面上结合 **CDP（Chrome DevTools Protocol 原生可信输入事件）** 与 DOM 树完成精准操作。支持在扩展「高级设置」中可视化查看与修改 Bridge 端口；若启动网关（默认 `8787`），自动渐进式呈现网关配置与导出。
- **任务组与窗口隔离**：默认**新开独立窗口**（`sameWindow: false`）执行自动化，与用户当前正在浏览操作的窗口互不干扰。独立窗口与用户窗口共享同一 Chrome profile，所有 Cookie、LocalStorage 及登录态直接可用。

## 工作流

1. **服务启动与健康探测**：
   - **桥接按需启动，一般不用手动管**：操作浏览器的命令发现桥接没开，会自动在后台拉起并等扩展连上（需要 Chrome 已打开）。桥接连续 10 分钟没有收到命令就自动退出；扩展的轮询和心跳不算命令。`health`、`doctor` 只检查，不会启动桥接。
     - 主动启动并等待扩展：`leo-lantern start`（或 `node <skillDir>/scripts/cli/index.mjs start`）
     - 前台运行、调整空闲时间：`node <skillDir>/scripts/cli/index.mjs server --port 19526 --idle-exit-min 30`（`0` 表示不自动退出，也可用环境变量 `LEO_LANTERN_IDLE_EXIT_MIN`）
   - **端口冲突自愈与换端口指引**：若 `19526` 与 `19527` 均被本地其他进程占用，CLI 将自动探测下一个可用空闲端口（如 `19528`），并抛出 `bridge_port_occupied` 错误，提示用户在 Chrome 扩展的「高级设置」->「Bridge 地址」中填入推荐端口（如 `19528`）保存，随后带 `--port 19528` 参数重试。
   - 检查服务与扩展在线状态：`leo-lantern health` 或 `leo-lantern doctor`（若 `extensionOnline: false`，请在 `chrome://extensions` 确认已加载扩展并保持 Chrome 运行；更新扩展后可用 `leo-lantern ext-reload` 重载）。
2. **任务生命周期与标签页管理（支持独立窗口隔离或接管现有标签页）**：
   - 开启/复用任务组：`leo-lantern start-task --title="browser-task"`（默认新开独立窗口，不干扰用户浏览；同窗口执行可加 `--same-window=true`）
   - 查看/接管/关闭标签页：`leo-lantern tabs`、`leo-lantern claim --tabId=<tabId>`（显式接管已有标签页，慎用；`start-task` 开的 `about:blank` 占位页若未使用，会在接管或 `end-task` 时自动关闭）、`leo-lantern close-tab <tabId>`
   - 导航/新标签/刷新：`leo-lantern goto "https://example.com"`、`leo-lantern new-tab "https://example.com"`（强制新开加 `--force`）、`leo-lantern reload`（跳过缓存加 `--bypass-cache`）
   - 结束任务：`leo-lantern end-task`（同时关闭整个任务标签组加 `--close-group`）
3. **页面感知与复杂交互（任意网页通用）**：
   - 获取高信息量交互 DOM 树（含 `tag`、`text`、`selector`、`id`、`rect`、`visible`、`ref`、`generation`）：`leo-lantern state` 或 `leo-lantern snapshot`
   - 精准检索元素：`leo-lantern find --text "保存"` / `--sel "button.submit"` / `--target '{"kind":"semantic","role":"button","name":"Sign in"}'`
   - 点击元素（原生 CDP 可信物理事件，支持 `ref` / `text` / `sel` / `target`）：
     - `leo-lantern click --ref 10`（最简推荐）
     - `leo-lantern click --text="进入配置"`
     - `leo-lantern click --sel="button.submit"`
     - `leo-lantern click --target '{"kind":"ref","ref":10}'`（缺省 `generation` 自动对齐当前文档）
   - 填写表单（原生 CDP `Input.insertText` 可信物理输入，兼容 React/Vue 受控组件与 FormStore，支持 `--blur` 失焦校验）：
     - `leo-lantern fill --ref 10 --val "text"` 或 `leo-lantern fill --sel "#input" --val "text" --blur`
   - 键盘按键（原生 CDP `Input.dispatchKeyEvent`，`isTrusted: true`，适用于回车提交、Tag 标签确认与快捷键）：
     - `leo-lantern press Enter --sel="input[placeholder*='标签']"`
   - 上传文件（原生 CDP `DOM.setFileInputFiles`，绕过系统弹窗直接注入任意 `<input type="file">`，默认匹配 `input[type='file']`）：
     - 单文件：`leo-lantern upload "/path/to/file.png"`
     - 多文件批量：`leo-lantern upload "/path/to/file1.png" "/path/to/file2.png"`
     - 指定选择器：`leo-lantern upload --sel="input[type='file']" --files="file1.png,file2.png"`
   - 执行页面脚本（自动 IIFE 闭包隔离并支持顶层 `await`，统一返回 `{ ok, evalResult, hasResult, resultType }`）：
     - `leo-lantern eval "1+1"`
     - `leo-lantern eval "const btns = document.querySelectorAll('button'); btns.length"`
     - 本地脚本文件（避免命令行引号与中文转义）：`leo-lantern eval --file "/path/to/script.js"`
   - 等待内容出现或流式文本稳定：
     - 固定文本等待：`leo-lantern wait --text="成功" --timeout-ms 5000`
     - AI/流式内容静止等待（N 毫秒无内容变化）：`leo-lantern wait --idle --idle-ms 2000`
     - 某个区域静止等待：`leo-lantern wait --sel ".chat-messages" --idle --idle-ms 2000`
   - 读取页面纯文本：`leo-lantern content --max-chars=4000`
4. **网络抓包、截图与凭证导出**：
   - 网络抓包（XHR/fetch API 拦截）：`leo-lantern net-start` $\rightarrow$ `leo-lantern net-get --grep="api"` $\rightarrow$ `leo-lantern net-stop`
   - 页面或元素截图：
     - 可视区域截图：`leo-lantern screenshot --out=page.png`
     - 整页长截图：`leo-lantern screenshot --full-page --out=full.png`
     - 元素区域截图：`leo-lantern screenshot --sel=".chat-box" --out=chat.png` 或 `leo-lantern screenshot --ref=10 --out=btn.png`
   - 导出 Cookie（凭证中继神器，供 curl / Python / yt-dlp / gallery-dl 使用，推荐存放在 `~/.shrimp/skills/leo-lantern/cookies/<domain>.txt`）：
     - Netscape 格式：`leo-lantern cookies --domain="example.com" --format=txt --out="$HOME/.shrimp/skills/leo-lantern/cookies/example.com.txt"`
     - JSON 格式：`leo-lantern cookies --domain="example.com" --format=json`
     - 按 URL 读取（含父域名上的 Cookie，需扩展 1.3.13+）：`leo-lantern cookies --url="https://a.example.com/path" --out="$HOME/.shrimp/skills/leo-lantern/cookies/example.com.json"`
     - 读不到时打开网站再读（需扩展 1.3.15+）：`leo-lantern cookies --url="https://a.example.com/" --open-if-missing --out="$HOME/.shrimp/skills/leo-lantern/cookies/example.com.json"`。在后台独立窗口打开，读完一定关闭，不影响正在执行的任务；若跳到登录页或出现密码框，会以 `login_required` 报错退出，请提示用户在 Chrome 登录后重试，不要反复尝试。

## 常用命令速查

```bash
# 启动 / 健康探测 / 标签页管理
leo-lantern start
leo-lantern health
leo-lantern doctor
leo-lantern tabs
leo-lantern start-task --title "my-task"
leo-lantern goto "https://example.com"

# 页面感知与交互（React/Vue/Web Component 兼容）
leo-lantern state
leo-lantern find --text "保存"
leo-lantern click --ref 10
leo-lantern fill --sel "#username" --val "admin" --blur
leo-lantern press Enter --sel "input[placeholder*='标签']"
leo-lantern upload --sel "input[type='file']" --files "a.png,b.png"
leo-lantern eval --file "./script.js"
leo-lantern wait --idle --idle-ms 2000
leo-lantern content --max-chars 4000

# 抓包、截图与凭证导出
leo-lantern net-start && leo-lantern net-get --grep "api" && leo-lantern net-stop
leo-lantern screenshot --full-page --out full.png
leo-lantern cookies --domain "example.com" --format txt --out "$HOME/.shrimp/skills/leo-lantern/cookies/example.com.txt"

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
    - **对策**：许多现代组件库要求在 `input` 事件后触发 `Enter` 按键，使用 `leo-lantern press Enter --sel="input[placeholder*='标签']"`。`press` 优先采用 CDP 原生可信键盘事件（`Input.dispatchKeyEvent`，`isTrusted: true`），完全支持回车确认、提交表单与快捷键；若 CDP 遇到极端受限环境则自动降级为合成键盘事件。

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

针对高频复杂业务平台，技能内置了开箱即用的发布与采集 Recipe 脚本。**执行某个平台的 Recipe 前，请先读取对应文档获取完整参数表与调用示例**（均位于 `<skillDir>/references/recipes/`）。

### 1. 内容自动发布配方

> 任一步骤失败均以非零退出码中止，不会继续提交；`🎉` 只在确认发布成功时出现。B 站与小红书点击后只提示“已点击”，须查看截图或平台管理页核对。

| 平台 | 脚本路径 | 核心能力 | 详细文档 |
| :--- | :--- | :--- | :--- |
| 哔哩哔哩 | `recipes/bilibili-publish.mjs` | 视频 CDP 上传、推荐高光帧/自定义封面、AI 声明、标签回车注入、定时发布 | [bilibili-publish.md](references/recipes/bilibili-publish.md) |
| 小红书 | `recipes/xhs-publish.mjs` | 多图批量上传（1~18张）、Markdown 脱壳、Shadow DOM 穿透提交、定时发布 | [xhs-publish.md](references/recipes/xhs-publish.md) |
| 抖音 | `recipes/douyin-publish.mjs` | 视频/图文双模发布、EditorKit 富文本与话题注入、封面裁剪弹层、AI 声明、全页预览 | [douyin-publish.md](references/recipes/douyin-publish.md) |

### 2. 站点情报与素材采集配方

| 平台 | 脚本路径 | 核心能力 | 详细文档 |
| :--- | :--- | :--- | :--- |
| X (Twitter) | `recipes/x-source.mjs` | 关注流/搜索/用户推文抓取，`name=orig` 原图、`gallery-dl` / `yt-dlp` 视频本地化 | [x-source.md](references/recipes/x-source.md) |
| LINUX DO | `recipes/linuxdo-source.mjs` | 过 Cloudflare 5秒盾，提取楼主原文 Markdown、高赞回复与 `/original/` 原图 | [linuxdo-source.md](references/recipes/linuxdo-source.md) |
| Instagram | `recipes/instagram-source.mjs` | 关注/博主/标签/单帖抓取，轮播原图与 Reels 视频本地化（`gallery-dl` + `yt-dlp`） | [instagram-source.md](references/recipes/instagram-source.md) |
| Reddit | `recipes/reddit-source.mjs` | 首页/板块/搜索/单帖抓取，正文 Markdown、高赞评论与 `v.redd.it` 原画视频下载 | [reddit-source.md](references/recipes/reddit-source.md) |
| YouTube | `recipes/youtube-source.mjs` | 视频列表/频道/搜索/详情提取，封面、双语字幕（逐字稿）与 MP4 下载 | [youtube-source.md](references/recipes/youtube-source.md) |
| Pixabay | `recipes/pixabay-source.mjs` | 免版税照片/插画/矢量图/视频检索，授权信息、相机 EXIF 与高清原画下载 | [pixabay-source.md](references/recipes/pixabay-source.md) |
| 发表情 | `recipes/fabiaoqing-source.mjs` | 关键词/套图合集/热门榜采集，自动升阶 `/large/` 超清图与动态 GIF | [fabiaoqing-source.md](references/recipes/fabiaoqing-source.md) |
| GitHub | `recipes/github-source.mjs` | 单仓/Trending/搜索采集，语言占比、Release、原生 `README.md` 与预览图落盘 | [github-source.md](references/recipes/github-source.md) |
| Product Hunt | `recipes/producthunt-source.mjs` | 每日热榜/分类/搜索/单品解析，Slogan、Pitch、官网直链与 Logo/截图下载 | [producthunt-source.md](references/recipes/producthunt-source.md) |
| 抖音 | `recipes/douyin-source.mjs` | 热榜/搜索/单视频解析，嗅探真实 CDN 无水印 MP4、封面与高赞神评 | [douyin-source.md](references/recipes/douyin-source.md) |
| 哔哩哔哩 | `recipes/bilibili-source.mjs` | 排行榜/热门/搜索/单视频解析，`__INITIAL_STATE__`、神评与 1080P 视频合并 | [bilibili-source.md](references/recipes/bilibili-source.md) |
| 中国专利 (CNIPA) | `recipes/cnipa-source.mjs` | 过瑞数 WAF 同源检索/高级检索/详情/事务查询、时间切片去重与说明书逐页 PNG | [cnipa-source.md](references/recipes/cnipa-source.md) |
| Google Patents | `recipes/google-patents-source.mjs` | 全球专利多维检索与详情深采，权利要求/说明书全文、CPC、引用/同族、附图与 PDF 下载 | [google-patents-source.md](references/recipes/google-patents-source.md) |

> **提示（脱离网关自包含运行）**：
> - **独立 CLI 模式**：可在技能目录直接通过 Node.js 执行命令行交互：`node ./scripts/cli/index.mjs <command>`
> - **发布 Recipe 通用约定**：支持 `--dry-run` 预览截停、`--now` 立即发布；所有业务参数均由命令行传入，无硬编码。
