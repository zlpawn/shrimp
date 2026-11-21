# X (Twitter) 前沿情报与事实素材探针 (`recipes/x-source.mjs`)

基于用户真实 Chrome 登录态，无感突破 X 官方 API 高额费用与反爬风控壁垒。严格恪守 **100% 事实保真（Ground Truth）** 原则，将原推文正文、作者认证、精确发布时间戳、互动量面板（回复/转帖/点赞/书签/浏览量）与多媒体资产（图片与视频）完整下载至本地，供下游 `leo-xhs-router` 或 `leo-video-router` 进行二次创作。

## 参数完全参考表

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

## 多媒体下载引擎机制

- **高清原图**：优先直取 `pbs.twimg.com` 升级为 `name=orig` 无损原图；若遇复杂多图卡片或网络阻塞，自动无缝回退至 `gallery-dl`（携带从 Chrome 导出的登录 Cookie）执行全量采集。
- **高清视频**：检测到推文含视频时，自动联动 `yt-dlp` 提取最高码率视频流并落盘至本地 `media/`。

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<slug>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据，直接投喂给下游 Router（`leo-xhs-router` / `leo-video-router`）。
- `📄 帖子事实.md`：图文并茂、排版精美的人类与 Agent 双用存证档案。
- `📁 media/`：本地全量原图与视频资产库。

## 调用示例

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
