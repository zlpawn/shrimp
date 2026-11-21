# Reddit 前沿情报与深度社区讨论事实探针 (`recipes/reddit-source.mjs`)

基于用户真实 Chrome 登录态，无感突破 Reddit 严格的客户端风控与反爬防护。严格遵循 **100% 事实保真（Ground Truth）** 原则，完整提取原帖标题、楼主完整 Markdown（含代码块、排版与外链）、发帖 Subreddit、发布作者、精确点赞/评论数、**社区精选高赞回复（Top Comments）**，并将插图（单图/多图 Gallery）及原画视频（v.redd.it）完整下载到本地，为下游 `leo-xhs-router`（海外科技热点转小红书）或 `leo-video-router`（二创短视频）提供极具讨论深度的一手事实物料。

## 参数完全参考表

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

## 多媒体下载与深度社区讨论提炼

- **多图相册与高清原图**：自动识别 `i.redd.it` / `preview.redd.it` 高清原图直链并发下载到本地 `media/`。
- **Reddit 原画视频**：检测到 Reddit 独立视频帖（v.redd.it）时，联动 `yt-dlp` 高速拉取原始视频与音轨合并封装。
- **社区高赞神评**：自动深入详情页提取真实点赞排名前列的深度回复与观点，完美补全帖子争议点与社区共识。

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<target>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据（含标题、楼主 Markdown、多媒体路径、社区高赞回复列表）。
- `📄 帖子事实.md`：图文并茂、社区回复层次分明的人类与 Agent 双用存证档案。
- `📁 media/`：本地全量原图与视频资产库。

## 调用示例

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
