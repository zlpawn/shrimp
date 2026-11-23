# 读书平台能力画像与路由目录 (Platforms Catalog)

本目录定义 `leo-novel-router` 纳管的内置读书平台与外部官方平台 Skill 路由规则。

> **路由优先级（B 模式：官方 Skill 优先 + 能力互补双通道）**：
> 1. **外部 / 官方平台 Skill 优先**：`probe.mjs` 优先探测目标平台对应的官方 Skill 是否已安装；已安装且覆盖当前意图时，优先读取其 `SKILL.md` 并调度执行；
> 2. **缺失官方 Skill 引导（JIT Install Prompt）**：当用户请求的平台提供官方 Skill（如微信读书 `Tencent/WeChatReading`）但本地未安装时，先提示用户安装命令并征询确认；
> 3. **内置浏览器适配器补齐写操作与正文拉取**：官方网关不支持的能力（如微信读书拉取章节全文、书内精确偏移检索、同步/修改/删除网页划线），由内置 `scripts/*.mjs` + `leo-lantern` 接力完成。

---

## weread（微信读书）

- **域名特征**：`weread.qq.com`（书架 `/web/shelf`、阅读页 `/web/reader/<hash>`）
- **双通道协同架构**：

| 通道 | 安装 / 依赖 | 覆盖能力 | 凭证来源 |
| :--- | :--- | :--- | :--- |
| **官方 Skill (`weread-skills`)** | `npx skills add Tencent/WeChatReading -g` | 书城搜书（`/store/search`）、书架（`/shelf/sync`）、书籍详情/目录/进度、**查看/导出个人划线与想法**、章节热门划线、阅读时长统计（`/readdata/detail`）、书评与推荐 | `~/.shrimp/skills/leo-novel-router/secrets.json`（`weread_api_key`）或环境变量 `WEREAD_API_KEY`，请求 `https://i.weread.qq.com/api/agent/gateway` |
| **内置浏览器引擎 (`scripts/weread.mjs`)** | `leo-lantern`（Chrome 已登录会话） | **拉取章节正文全文进对话**（Canvas/XHTML 解码）、**书内全文精确偏移检索**（`/web/book/search`）、**同步划线回网页**（`addBookmark`）、**修改划线样式/颜色**（`updateBookmark`）、**删除划线**（`removeBookmark`）、以及按书名归档导出 | Chrome 当前微信读书登录态 + `window.__WRPA__.sr` |

- **能力边界与路由选择**：
  - **纯查询 / 统计 / 推荐 / 书城搜索 / 免开浏览器导出**：优先走官方 `weread-skills`；若未安装，展示 `npx skills add Tencent/WeChatReading -g` 引导卡片（用户暂不安装时，书架/目录/划线导出可降级由 `scripts/weread.mjs` 兜底）。
  - **正文阅读 / 对话划线同步 / 删改划线**：官方网关不提供正文文本和写入划线的接口，统一交由 [`scripts/weread.mjs`](../scripts/weread.mjs) 执行。
- **划线样式枚举**：
  - `style`：`0`=直线、`1`=马克笔、`2`=波浪线
  - `colorStyle`：`1`=红、`2`=紫、`3`=蓝、`4`=绿、`5`=橙（默认 `5`）

---

## 外部官方平台 Skill 扩展槽位（预留）

| 平台 | 识别域名 / 关键词 | 候选 Skill 名 | 安装 / 来源 | 当前状态 |
| :--- | :--- | :--- | :--- | :--- |
| **微信读书 (WeRead)** | `weread.qq.com`、微信读书 | `weread-skills` | `npx skills add Tencent/WeChatReading -g` | 官方 Skill + 内置浏览器双通道 |
| **得到 (Dedao)** | `dedao.cn`、得到电子书 | `dedao`、`dedao-reader`、`dedao-official` | 待接入 | 预留外部路由 |
| **豆瓣阅读** | `read.douban.com`、豆瓣阅读 | `douban-read`、`douban-reading` | 待接入 | 预留外部路由 |
| **Kindle** | `read.amazon.com`、`read.amazon.cn`、Kindle | `kindle`、`kindle-reader` | 待接入 | 预留外部路由 |

> 当用户新增外部官方平台 Skill 时，安装至 `~/.agents/skills/<skill-name>/`（或通过 `config.json` 的 `external_skills` 映射域名与 Skill 名），`probe.mjs` 会在运行期自动发现并优先路由。
