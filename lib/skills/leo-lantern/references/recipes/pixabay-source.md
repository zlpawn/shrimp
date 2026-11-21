# Pixabay 高清免版税视觉与音视频素材事实探针 (`recipes/pixabay-source.mjs`)

基于用户真实 Chrome 会话与原生结构化元数据解析，严格遵循 **100% 事实保真（Ground Truth）** 原则。完整提取免版税素材标题、作者/创作者（主页、头像、粉丝数、社交外链）、作品分类（照片/插画/矢量图/视频）、**商用授权事实（Pixabay Content License：免版税、商业免署名、可自由修改）**、长宽分辨率、宽高比/时长、**相机拍摄参数（EXIF：相机型号、镜头、光圈、曝光时间、ISO）**、全站互动数据（浏览/下载/点赞/评论数）、关联标签（Tags），并将超清原画大图（1280px / 2560px Zoom）、矢量透明图（PNG）或高清视频切片（4K/HD MP4）下载至本地，为下游 `leo-video-router`（B-roll 素材注入与混剪）与 `space-xhs-cover` / `leo-xhs-router`（视觉封面与图文插图）提供高质量免版权素材储备。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | `search` | 采集模式：`search`（关键词站内检索）、`post`（单作品深度解析）、`explore`（精选/探索推荐流）。 |
| `--query` | `-q` | string | 否 | `wallpaper` | 检索关键词（`mode` 为 `search` 时使用，如 `"cyberpunk"`, `"mountain lake"`）。 |
| `--type` | `-t` | string | 否 | `all` | 素材类型过滤：`all`、`photos`（照片）、`illustrations`（插画）、`vectors`（矢量图）、`videos`（视频）。 |
| `--url` | `-u` | string | 条件必填 | `""` | 目标素材详情页链接（`mode` 为 `post` 时必填）。 |
| `--limit` | `-n` | number | 否 | `3` | 抓取素材数量上限。 |
| `--out`, `--out-dir` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/pixabay-source-config.json`（默认 `D:\素材\Pixabay`）供后续复用。 |
| `--no-deep` | - | flag | 否 | `false` | 浅层提取模式：仅依据检索列表元数据下载，不逐个访问详情页拉取完整 EXIF。 |
| `--skip-media`, `--no-media` | - | flag | 否 | `false` | 极速轻量模式：跳过高清媒体文件下载，仅保存事实元数据与简介。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |

## 多媒体与事实存证机制

- **高清原图与矢量透明图**：自动探测最优清晰度源（`zoom` 2560px 或 `2x` 1280px / 矢量透明 PNG）流式下载至 `media/`。
- **4K/HD 原画视频切片**：自动解析原始 MP4 视频直链流式落盘至 `media/`，并记录视频精确时长（秒）与长宽比。
- **相机拍摄 EXIF 还原**：精准提取机身型号、镜头规格、焦距、光圈、曝光时间与 ISO 感光度，原样注入 `帖子事实.md`。

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-HHmmss_<slug>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据（含创作者、授权协议、技术参数、互动指标、本地媒体索引）。
- `📄 帖子事实.md`：图文并茂的人类与 Agent 双用免版税素材事实清单。
- `📁 media/`：本地全量原图、矢量图与 MP4 视频素材库。

## 调用示例

```bash
# 1. 站内检索优质照片并下载原图与 EXIF 事实（默认模式）：
node <skillDir>/recipes/pixabay-source.mjs --mode search --query "cyberpunk city" --type photos --limit 3

# 2. 检索免版税 4K/HD 视频切片并下载 MP4 资产：
node <skillDir>/recipes/pixabay-source.mjs --mode search --query "nature waterfall" --type videos --limit 2

# 3. 抓取精选矢量透明图 (Vectors)：
node <skillDir>/recipes/pixabay-source.mjs --mode search --query "technology icon" --type vectors --limit 3

# 4. 深度解析单篇作品详情页并下载高分辨率原画：
node <skillDir>/recipes/pixabay-source.mjs --url "https://pixabay.com/photos/alps-mountains-valley-nature-lake-10445555/"

# 5. 指定并记忆输出工作区目录：
node <skillDir>/recipes/pixabay-source.mjs --out "D:\素材\Pixabay"
```
