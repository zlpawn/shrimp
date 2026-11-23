# 读书平台能力画像与路由目录 (Platforms Catalog)

本目录定义 `leo-novel-router` 纳管的内置读书平台与外部官方平台 Skill 路由规则。

> **路由优先级（B 模式：外部官方 Skill 优先，内置适配器开箱兜底）**：
> 1. **已安装的外部 / 官方平台 Skill**：若 `probe.mjs`（或上下文 `Available skills:`）探测到目标平台对应的独立官方/社区 Skill 已安装，优先交接给该官方 Skill 执行；
> 2. **内置适配器（`scripts/*.mjs`）**：若无外部官方 Skill 且属于内置支持平台（本期为 `weread` 微信读书），调用内置适配器执行；
> 3. **未接入平台**：告知用户当前未命中已接入适配器，建议提供官方 Skill / Marketplace 检索，或按需使用 `leo-lantern` 做基础网页探测。

---

## weread（微信读书）

- **域名特征**：`weread.qq.com`（支持书架 `/web/shelf`、阅读页 `/web/reader/<hash>`）
- **实现方式**：内置适配器 [`scripts/weread.mjs`](../scripts/weread.mjs) + 底层浏览器控制 `leo-lantern`（复用用户已登录 Chrome Profile）
- **底层机制**：
  - 正文渲染在 `.wr_canvasContainer` 的 `<canvas>` 上，直接读 DOM 拿不到正文；
  - 本适配器通过 `leo-lantern` 驱动页面加载章节，拦截 `POST /web/book/chapter/e_0..e_3` 响应并解码 XHTML 提取结构化段落；
  - 书内检索通过 `GET /web/book/search`（`window.__WRPA__.sr` 生成 `x-wrpa-0` 签名头），同步划线通过 `POST /web/book/addBookmark` 并结合 `/web/book/search` 锚点校准字符偏移，确保跨章节零漂移；
  - 划线样式：`style`（`0`=直线、`1`=马克笔、`2`=波浪线），`colorStyle`（`1`~`5`，默认 `5`）。
- **支持指令**：
  - `shelf`：获取我的书架列表与书籍链接
  - `toc`：获取书籍信息与完整章节目录（含付费/试读状态）
  - `read`：拉取指定章节正文到对话，或 `--save` 落盘到 `<书名>/chapters/`
  - `search`：书内全文关键词检索（返回章节、摘要及精确偏移）
  - `bookmarks`：查看本书当前所有划线（可选按章过滤）
  - `highlight`：将指定文本精确同步为微信读书网页划线
  - `update-highlight`：修改已有划线的样式（直线/马克笔/波浪线）或颜色
  - `remove-highlight`：删除指定 `bookmarkId` 的划线
  - `export`：按章节导出全部划线与个人想法为 Markdown 至 `~/素材/novel/<书名>/`
- **边界与约束**：
  - 依赖 Chrome 已启动且 `leo-lantern` 扩展在线；未登录时抛出 `login_required`，需提示用户在 Chrome 扫码登录后重试；
  - 收费/未购买章节（目录标记 `disabled`）无法绕过权限拉取；
  - 获取当前正在阅读的章节源码时，需短暂切换相邻章再切回（期间拦截 `/web/book/read` 避免污染阅读进度）。

---

## 外部官方平台 Skill 扩展槽位（预留）

| 平台 | 识别域名 / 关键词 | 候选 Skill 名 | 当前状态 |
| :--- | :--- | :--- | :--- |
| **得到 (Dedao)** | `dedao.cn`、得到电子书 | `dedao`、`dedao-reader`、`dedao-official` | 预留外部路由 |
| **豆瓣阅读** | `read.douban.com`、豆瓣阅读 | `douban-read`、`douban-reading` | 预留外部路由 |
| **Kindle** | `read.amazon.com`、`read.amazon.cn`、Kindle | `kindle`、`kindle-reader` | 预留外部路由 |

> 当用户新增外部官方平台 Skill 时，可直接安装至 `~/.agents/skills/<skill-name>/`（或通过 `config.json` 的 `external_skills` 映射域名与 Skill 名），`probe.mjs` 会在运行期自动发现并优先路由。
