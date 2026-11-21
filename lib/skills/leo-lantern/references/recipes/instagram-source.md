# Instagram 前沿情报与视觉创作素材探针 (`recipes/instagram-source.mjs`)

基于用户真实 Chrome 登录态，无感突破 Instagram 严苛的登录墙与反爬限制。严格遵循 **100% 事实保真（Ground Truth）** 原则，完整提取原贴 Caption（自动展开更多文案）、博主信息、发帖时间、互动数据、Hashtags，并将多图轮播（Carousel）高清原图与短视频（Reels）原视频下载到本地，为下游 `leo-xhs-router`（小红书图文）或 `leo-video-router`（二创短视频）提供一手高保真事实物料。

## 参数完全参考表

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

## 多媒体下载引擎机制

- **多图轮播（Carousel）与单图**：结合从 Chrome 导出的登录 Cookie，使用 `gallery-dl` 提取全部最高分辨率 CDN 原图；遇到网络异常时自动使用浏览器原生高保真 Fetch 兜底。
- **Reels / 短视频**：自动提取高码率无水印 mp4 视频流（支持 `gallery-dl` 与 `yt-dlp` 双重容灾引擎）并完整落盘至本地 `media/`。

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<target>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据，直接投喂给下游 Router。
- `📄 帖子事实.md`：图文并茂、结构规整的人类与 Agent 双用存证档案。
- `📁 media/`：本地全量原图（单图/多图）与视频资产库。

## 调用示例

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
