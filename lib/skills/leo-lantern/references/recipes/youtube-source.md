# YouTube 前沿情报、音视频素材与讲稿转写事实探针 (`recipes/youtube-source.mjs`)

基于用户真实 Chrome 会话与原生播放流解析，严格遵循 **100% 事实保真（Ground Truth）** 原则。完整提取视频标题、发布频道、精确发布日期、观看/点赞互动数据、**原始简介文案（含时间轴章节与参考外链）**、**视频逐字讲稿/带时间戳字幕（Transcript）**，并将原画封面（.webp/.jpg）、多语言字幕文件（.srt/.vtt）与原画视频（.mp4）下载至本地，为下游 `leo-video-router`（视频笔记生成与二创解构）或 `leo-xhs-router`（前沿视频提炼为小红书图文）提供最核心的事实依据。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | `feed` | 采集模式：`feed`（首页推荐流）、`channel`（频道视频页）、`search`（关键词搜索）、`post`（单视频深度解析）。 |
| `--channel` | `-c` | string | 条件必填 | `""` | 目标频道 Handle（`mode` 为 `channel` 时必填，如 `@AnthropicAI`, `@mkbhd`）。 |
| `--query` | `-q` | string | 条件必填 | `""` | 搜索关键词（`mode` 为 `search` 时必填）。 |
| `--url` | - | string | 条件必填 | `""` | 目标视频或 Shorts 链接（`mode` 为 `post` 时必填）。 |
| `--limit` | `-n` | number | 否 | `3` | 抓取视频数量上限。 |
| `--out`, `--out-dir` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/youtube-source-config.json` 供后续复用。 |
| `--format` | - | string | 否 | `18/best[height<=720]/best` | 视频下载清晰度格式。 |
| `--no-video` | - | flag | 否 | `false` | 极速轻量模式：仅下载原画封面与字幕转写文稿，不下载沉重的视频本体文件。 |
| `--use-cookies` | - | flag | 否 | `false` | 从 Chrome 导出 Cookie 携带请求（适用于受限/年龄分级视频；公开视频默认直取避免 SABR 实验拦截）。 |
| `--skip-media`, `--no-media` | - | flag | 否 | `false` | 跳过所有媒体下载，仅抓取纯元数据与简介。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |

## 多媒体与逐字文稿转写机制

- **原画封面下载**：自动抓取 YouTube 官方最高清晰度缩略图并落盘至 `media/`。
- **逐字稿与字幕解析**：自动探测并下载中英双语字幕，并将时间轴与逐字发言格式化注入 `帖子事实.md`。
- **MP4 原画视频**：默认按平衡画质流（720P/1080P）拉取本地音视频文件，支持 `--no-video` 纯文本极速模式。

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<target>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据（含标题、时长、逐字讲稿、多媒体文件索引）。
- `📄 帖子事实.md`：图文并茂、附带完整时间戳文稿的人类与 Agent 双用存证档案。
- `📁 media/`：本地全量原图、字幕文件与视频资产库。

## 调用示例

```bash
# 1. 抓取当前首页推荐流最新 3 篇（默认模式）：
node <skillDir>/recipes/youtube-source.mjs --mode feed --limit 3

# 2. 定向抓取指定频道最新视频并提取字幕讲稿与封面（极速轻量模式）：
node <skillDir>/recipes/youtube-source.mjs --mode channel --channel @AnthropicAI --no-video --limit 3

# 3. 站内关键词搜索：
node <skillDir>/recipes/youtube-source.mjs --mode search --query "Claude Code tutorial" --limit 3

# 4. 深度解析单篇视频并下载原画视频与逐字稿：
node <skillDir>/recipes/youtube-source.mjs --mode post --url "https://www.youtube.com/watch?v=6eBSHbLKuN0"

# 5. 指定并记忆输出工作区目录：
node <skillDir>/recipes/youtube-source.mjs --out "D:\素材\YouTube"
```
