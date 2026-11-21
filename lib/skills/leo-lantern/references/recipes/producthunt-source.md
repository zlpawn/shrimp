# Product Hunt 全球科技新产品、AI 神器与创投风向标事实探针 (`recipes/producthunt-source.mjs`)

基于用户真实 Chrome 会话与网页 DOM 解析，严格遵循 **100% 事实保真（Ground Truth）** 原则。完整提取每日全球上榜新产品名称、一句话定位（Slogan）、官方完整介绍文案（Pitch）、所属领域标签（Topics）、Upvotes 赞同票数、**官网直链（带有 `?ref=producthunt` 追踪源）**、榜单排名与上线事实，并将产品高清 Logo、社交宣传封面（`og:image`）与功能展示截图下载至 `media/` 目录。深度赋能科技自媒体、`leo-xhs-router`（每日 AI 神器精选推文）与产品竞品调研。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | `today` | 采集模式：`today`（今日 Top 上榜新品）、`product`（单款产品深度解析）、`topic`（垂直领域分类榜）、`search`（关键词站内检索）。 |
| `--url` | `-u` | string | 条件必填 | `""` | 目标产品链接（如 `https://www.producthunt.com/products/maxma-2`）。 |
| `--topic` | `-t` | string | 否 | `""` | 主题分类过滤（用于 `topic` 模式，如 `artificial-intelligence`, `developer-tools`）。 |
| `--query` | `-q` | string | 否 | `""` | 搜索关键词（用于 `search` 模式）。 |
| `--limit` | `-n` | number | 否 | `5` | 抓取产品数量上限。 |
| `--out`, `--out-dir` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/producthunt-source-config.json`（默认 `D:\素材\ProductHunt`）供后续复用。 |
| `--no-deep` | - | flag | 否 | `false` | 浅层提取模式：仅依据榜单列表提取，不逐个深入抓取官网外链与完整 Pitch。 |
| `--skip-media`, `--no-media` | - | flag | 否 | `false` | 极速轻量模式：跳过 Logo 与截图下载，仅保存文字事实。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |

## 多媒体与资产本地化机制

- **Logo 与封面超清化**：抓取并下载原始 Imgix 矢量/PNG 图标与宣发大图。
- **官网直链真实还原**：精确解析外跳按钮获取产品真正的独立官方网站地址。
- **全量无损图文清单**：自动输出嵌入本地图片的 Markdown 清单，开箱即用于小红书图文卡片排版。

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-HHmmss_<slug>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据（含产品名、Slogan、Pitch、官网、Upvotes、Logo 与截图路径）。
- `📄 帖子事实.md`：图文并茂的海外科技新产品情报档案。
- `📁 media/`：本地全量 Logo、封面大图与功能截图资产库。

## 调用示例

```bash
# 1. 抓取今日全站最火 Top 5 科技新产品及完整 Pitch 与截图（默认模式）：
node <skillDir>/recipes/producthunt-source.mjs --mode today --limit 5

# 2. 深度解析单篇产品详情、提取官网外链与高分辨率图文：
node <skillDir>/recipes/producthunt-source.mjs --url "https://www.producthunt.com/products/maxma-2"

# 3. 抓取特定分类（如 AI 领域）热门产品：
node <skillDir>/recipes/producthunt-source.mjs --mode topic --topic artificial-intelligence --limit 5

# 4. 搜索特定关键词工具：
node <skillDir>/recipes/producthunt-source.mjs --mode search --query "coding agent" --limit 3

# 5. 指定并记忆输出工作区目录：
node <skillDir>/recipes/producthunt-source.mjs --out "D:\素材\ProductHunt"
```
