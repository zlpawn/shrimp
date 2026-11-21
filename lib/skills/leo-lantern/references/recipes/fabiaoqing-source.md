# 发表情 (fabiaoqing.com) 表情包、热梗图与斗图嘴替事实探针 (`recipes/fabiaoqing-source.mjs`)

基于用户真实 Chrome 会话与网页 DOM 解析，严格遵循 **100% 事实保真（Ground Truth）** 原则。完整提取表情包文字配文、情绪意图、原始来源链接、所属专辑/套图名称，自动探测并将图片链接升级至 `/large/` 无损超清画质，支持静态 JPG/PNG 与动态 GIF 表情包全量本地化下载至 `media/` 目录。深度赋能 `bqb-downloader`（职场嘴替）、`space-xhs-writer`（小红书配图/梗图）、`leo-xhs-router` 等下游技能。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | `search` | 采集模式：`search`（关键词站内检索）、`pack`（表情包套图/合集）、`hot`（全网实时热门榜）、`post`（单张表情深度解析）。 |
| `--query` | `-q` | string | 否 | `摸鱼` | 检索关键词（`mode` 为 `search` 时使用，如 `"摸鱼"`, `"不想上班"`, `"收到"`, `"熊猫头"`）。 |
| `--url` | `-u` | string | 条件必填 | `""` | 目标套图合集（`pack`）或单张表情（`post`）链接。传入链接包含 `/bqb/detail/` 自动切换为 `pack` 模式。 |
| `--limit` | `-n` | number | 否 | `10` | 抓取表情包数量上限。支持自动跨页抓取填满上限。 |
| `--out`, `--out-dir` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/fabiaoqing-source-config.json`（默认 `D:\素材\表情包`）供后续复用。 |
| `--skip-media`, `--no-media` | - | flag | 否 | `false` | 极速轻量模式：跳过图片/动图下载，仅保存配文事实与原图直链。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |

## 多媒体与动态动图支持

- **画质自动超清化**：自动将网络缩略图（`bmiddle`/`thumb`）替换为 `/large/` 超清无损原画。
- **全格式支持**：无缝支持静态 JPG、PNG 以及动态动图 GIF，保持原始帧率与透明通道。
- **套图全量提取**：支持一键输入合集链接（如“更适合中国宝宝体质的表情包”），全套表情包一键打包沉淀。

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-HHmmss_<slug>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据（含配文字段、高清直链、本地媒体索引）。
- `📄 帖子事实.md`：图文并茂的表情包存证档案（自带本地图片/GIF 预览与文件大小）。
- `📁 media/`：本地全量超清表情包与动图资产库。

## 调用示例

```bash
# 1. 站内检索指定情绪/职场嘴替表情包并下载超清原图与 GIF（默认模式）：
node <skillDir>/recipes/fabiaoqing-source.mjs --query "不想上班" --limit 6

# 2. 搜索并下载经典熊猫头/斗图梗图：
node <skillDir>/recipes/fabiaoqing-source.mjs --query "熊猫头" --limit 8

# 3. 抓取套图合集 (Meme Pack / 专辑) 并下载全部组图：
node <skillDir>/recipes/fabiaoqing-source.mjs --url "https://fabiaoqing.com/bqb/detail/id/55049.html" --limit 10

# 4. 抓取全网实时热门表情包榜单：
node <skillDir>/recipes/fabiaoqing-source.mjs --mode hot --limit 8

# 5. 指定并记忆输出工作区目录：
node <skillDir>/recipes/fabiaoqing-source.mjs --out "D:\素材\表情包"
```
