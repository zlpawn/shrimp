# 哔哩哔哩 (Bilibili) 热门视频、全站排行榜与高赞神评事实探针 (`recipes/bilibili-source.mjs`)

基于用户真实 Chrome 会话执行，严格遵循 **100% 事实保真（Ground Truth）** 原则。深度挖掘 `window.__INITIAL_STATE__` 原生数据与页面内嵌 API，提取完整视频标题、BV号/AID/CID、UP主昵称与个人空间、发布时间、视频时长、所属分区、标签、播放/弹幕/点赞/投币/收藏/分享互动量、UP主原始简介与动态、精选高赞神评（含评论者、IP属地、点赞数、发布时间），并**自动联动 Chrome 导出的 Cookie 通过 yt-dlp 与原生 CDN 流下载 1080P/原画 MP4 视频、原画封面图与 UP 主头像**至 `media/` 目录。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | `ranking` | 采集模式：`ranking`（全站排行榜 Top 视频）、`popular`（综合热门视频）、`search`（关键词全网搜索）、`video`（单视频详情解析）。 |
| `--url` | `-u` | string | 条件必填 | `""` | 目标 B站 视频链接（如 `https://www.bilibili.com/video/BV1gHWg6GEqj`）。 |
| `--query` | `-q` | string | 否 | `""` | 搜索关键词（用于 `search` 模式，如 `"AI工具"`）。 |
| `--limit` | `-n` | number | 否 | `5` | 抓取视频数量上限。 |
| `--out`, `--out-dir` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/bilibili-source-config.json`（默认 `D:\素材\B站`）供后续复用。 |
| `--download-video` | - | flag | 否 | `true` | 是否下载 1080P/原画高清 MP4 视频文件。 |
| `--no-download-video` | - | flag | 否 | `false` | 极速轻量模式：仅提取视频事实、文案简介、封面与神评，跳过大视频文件下载。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |

## 多媒体与资产本地化机制

- **登录态与 1080P 音视频合并**：自动导出 Chrome 浏览器真实 Cookie，驱动 `yt-dlp` 高清下载分离的音视频轨并通过 `ffmpeg` 无损合成 MP4。
- **原画封面与头像沉淀**：自动转换协议头提取原始分辨率封面与头像。
- **神评与IP属地存证**：直连页面高赞评论流，留存包含真实 IP 属地与点赞数的神评。

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<target>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据（含稿件指标、UP主信息、神评、媒体路径）。
- `📄 帖子事实.md`：图文并茂的人类与 Agent 双用存证档案。
- `📁 media/`：本地 1080P MP4 视频、原画封面与 UP 主头像资产库。

## 调用示例

```bash
# 1. 抓取 B站全站排行榜前 5 名爆款视频及 1080P MP4 视频（默认模式）：
node <skillDir>/recipes/bilibili-source.mjs --mode ranking --limit 5

# 2. 抓取 B站综合热门榜视频：
node <skillDir>/recipes/bilibili-source.mjs --mode popular --limit 5

# 3. 深度解析单篇视频详情、提取完整数据与神评并下载视频：
node <skillDir>/recipes/bilibili-source.mjs --url "https://www.bilibili.com/video/BV1gHWg6GEqj"

# 4. 搜索特定关键词视频（如 "AI工具"）前 3 个作品：
node <skillDir>/recipes/bilibili-source.mjs --mode search --query "AI工具" --limit 3

# 5. 极速模式（仅提取文案、数据、封面与神评，不下载几十/几百兆的大视频）：
node <skillDir>/recipes/bilibili-source.mjs --mode ranking --limit 5 --no-download-video

# 6. 指定并记忆输出工作区目录：
node <skillDir>/recipes/bilibili-source.mjs --out "D:\素材\B站"
```
