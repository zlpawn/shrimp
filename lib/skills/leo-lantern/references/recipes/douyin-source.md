# 抖音 (Douyin) 热门短视频、实时热榜与原声神评事实探针 (`recipes/douyin-source.mjs`)

基于真实 Chrome 会话环境执行，突破抖音频繁迭代的反爬签名与风控限制。严格遵循 **100% 事实保真（Ground Truth）** 原则，完整提取原视频文案、发布者昵称与主页、发布时间、点赞/评论/收藏/分享互动量、BGM 原声音乐、精选高赞神评（评论人、地区、时间、赞同数），并**自动捕获并无水印下载原画 MP4 视频、超清封面图与作者头像**至 `media/` 目录。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | `hot` | 采集模式：`hot`（抖音官方实时热榜 Top 视频）、`search`（关键词全网搜索）、`video`（单作品详情解析）。 |
| `--url` | `-u` | string | 条件必填 | `""` | 目标抖音短视频/作品链接（如 `https://www.douyin.com/video/7688277931189095730`）。 |
| `--query` | `-q` | string | 否 | `""` | 搜索关键词（用于 `search` 模式，如 `"AI工具"`）。 |
| `--limit` | `-n` | number | 否 | `5` | 抓取短视频数量上限。 |
| `--out`, `--out-dir` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/douyin-source-config.json`（默认 `D:\素材\抖音`）供后续复用。 |
| `--download-video` | - | flag | 否 | `true` | 是否下载原画无水印 MP4 视频文件。 |
| `--no-download-video` | - | flag | 否 | `false` | 极速轻量模式：仅提取文案事实、封面与神评，跳过大视频文件下载。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |

## 多媒体与资产本地化机制

- **原画无水印 MP4 直下**：通过真实浏览沙箱解析并下载完整 CDN 视频流，零水印高码率留存。
- **神评与热榜闭环**：抓取热榜当前热度值（如 `1122.2万热度`）与原视频的高赞热评串。
- **全格式双规存证**：同步沉淀机器可读 `帖子事实.json` 与人类高可读 `帖子事实.md`。

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<target>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据（含标题、文案、BGM、互动量、神评、媒体路径）。
- `📄 帖子事实.md`：图文并茂的人类与 Agent 双用存证档案。
- `📁 media/`：本地无水印 MP4 视频、超清封面与作者头像资产库。

## 调用示例

```bash
# 1. 抓取抖音实时热榜前 5 名热门爆款短视频及原画 MP4（默认模式）：
node <skillDir>/recipes/douyin-source.mjs --mode hot --limit 5

# 2. 深度解析单篇短视频、下载原画视频与封面、神评：
node <skillDir>/recipes/douyin-source.mjs --url "https://www.douyin.com/video/7688277931189095730"

# 3. 全网搜索特定领域（如 "AI工具"）爆款视频事实：
node <skillDir>/recipes/douyin-source.mjs --mode search --query "AI工具" --limit 3

# 4. 仅抓取文案与热评，跳过视频文件下载：
node <skillDir>/recipes/douyin-source.mjs --mode hot --limit 5 --no-download-video

# 5. 指定并记忆输出工作区目录：
node <skillDir>/recipes/douyin-source.mjs --out "D:\素材\抖音"
```
